import { dbq } from "./dbq.server";
import { workspaceRoster } from "./server/membership.server";

// El perfil de la persona vive en `gc_users`, la MISMA tabla que usa Ghosty Teams en
// la DB de este workspace. No es un padrón (eso lo decide gs): es una proyección de
// identidad que escribe el producto por el que entres primero, y que sirve a los dos
// para pintar nombre, avatar y @handle.
import type { Row } from "./dbq.server";
import { localAvatar } from "./utils/avatar";

export { localAvatar };

export type SessionUser = {
  sub: string;
  email: string;
  name: string;
  avatar: string;
  isOwner: boolean;
  handle: string;
};


function slugHandle(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 20) || "user"
  );
}

async function ensureUniqueHandle(base: string, ownSub: string): Promise<string> {
  const b = slugHandle(base);
  let h = b;
  for (let i = 2; ; i++) {
    const rows = await dbq("SELECT sub FROM gc_users WHERE handle = ?", [h]);
    if (!rows[0] || rows[0].sub === ownSub) return h;
    h = `${b}${i}`;
  }
}

/**
 * Proyecta la identidad que firmó gs en `gc_users`. `isOwner` NO se calcula aquí: lo
 * dice el rol del control-plane. Antes salía de `SELECT COUNT(*) == 0`, que es una
 * carrera — en un workspace recién creado se apropiaba quien entrara primero.
 *
 * `name`/`avatar` solo se siembran al crear la fila: son editables desde Teams y
 * machacarlos en cada login con el crudo del IdP borraría lo que la persona puso.
 */
export async function upsertUser(
  id: { sub: string; email: string; name: string; avatar: string },
  role: string | null
): Promise<SessionUser> {
  const isOwner = role === "OWNER";
  const base = id.email.split("@")[0] || id.name;
  const existing = await dbq("SELECT is_owner, handle, name, avatar FROM gc_users WHERE sub = ?", [id.sub]);
  if (existing[0]) {
    let handle = existing[0].handle as string | null;
    if (!handle) {
      handle = await ensureUniqueHandle(base, id.sub);
      await dbq("UPDATE gc_users SET handle=? WHERE sub=?", [handle, id.sub]);
    }
    // El email sí converge (es la identidad), y el rol también: si en gs te hicieron
    // owner, la proyección tiene que enterarse.
    await dbq("UPDATE gc_users SET email=?, is_owner=? WHERE sub=?", [id.email, isOwner ? 1 : 0, id.sub]);
    return {
      ...id,
      name: (existing[0].name as string) || id.name,
      avatar: localAvatar(existing[0].avatar as string) || id.avatar,
      isOwner,
      handle,
    };
  }
  const handle = await ensureUniqueHandle(base, id.sub);
  // OR IGNORE: dos logins simultáneos (uno por Teams, otro por Tasks) pueden competir
  // por el mismo sub/handle.
  await dbq(
    "INSERT OR IGNORE INTO gc_users (sub, email, name, avatar, is_owner, handle) VALUES (?, ?, ?, ?, ?, ?)",
    [id.sub, id.email, id.name, id.avatar, isOwner ? 1 : 0, handle]
  );
  return { ...id, isOwner, handle };
}

export type WorkspaceMember = {
  sub: string;
  handle: string;
  name: string;
  email: string;
  avatar: string;
  isOwner: boolean;
};

/**
 * Los miembros del workspace = el roster de gs, enriquecido con el perfil local.
 *
 * Listar `gc_users` sería listar "quien ya entró", no "quien pertenece": alguien
 * recién agregado al equipo no aparecería y no se le podría asignar una tarea.
 */
export async function listWorkspaceMembers(): Promise<WorkspaceMember[]> {
  const roster = await workspaceRoster().catch(() => []);

  // Perfiles que YA existen en la DB de este workspace: quien tiene fila aquí entró por
  // Teams, o sea que pertenece de hecho.
  let profiles: Row[] = [];
  try {
    profiles = await dbq("SELECT sub, handle, name, email, avatar, is_owner FROM gc_users");
  } catch {
    /* workspace virgen */
  }

  // UNIÓN a propósito. gs es la fuente de verdad de la pertenencia, pero su fila de
  // Membership se crea best-effort al entrar a Teams: quien se unió antes de eso —o a
  // quien le falló— no aparece en el roster y quedaba invisible aquí (no se le podía
  // asignar una tarea ni el agente lo encontraba). Ejemplo real: omac.crw, con perfil en
  // el workspace y sin membresía en gs.
  const bySub = new Map<string, WorkspaceMember>();
  const profileOf = new Map(profiles.map((p) => [p.sub ?? "", p]));

  for (const m of roster) {
    const p = profileOf.get(m.sub);
    bySub.set(m.sub, {
      sub: m.sub,
      handle: (p?.handle as string) ?? "",
      // Quien todavía no ha entrado a ningún producto no tiene perfil: se muestra por su
      // correo en vez de como una fila anónima.
      name: (p?.name as string) || m.email || m.sub.slice(0, 8),
      email: (p?.email as string) || m.email,
      avatar: localAvatar(p?.avatar as string),
      isOwner: m.role === "OWNER",
    });
  }

  for (const p of profiles) {
    const sub = p.sub ?? "";
    if (!sub || bySub.has(sub)) continue;
    bySub.set(sub, {
      sub,
      handle: (p.handle as string) ?? "",
      name: (p.name as string) || sub.slice(0, 8),
      email: (p.email as string) ?? "",
      avatar: localAvatar(p.avatar as string),
      isOwner: Number(p.is_owner) === 1,
    });
  }

  return [...bySub.values()].sort((a, b) => a.name.localeCompare(b.name));
}

