import { dbq, num } from "../../dbq.server";

// Quién puede TRABAJAR un tablero. Ver es de todo el workspace —nadie se pierde el
// contexto—, pero crear, mover, editar y comentar es de sus miembros.
//
// Vive en las ops y no en la UI a propósito: es el único punto por el que pasan las dos
// superficies. El agente actúa con el `sub` de quien le habló, así que hereda esto sin
// una línea extra — si a ti no te toca ese tablero, tu agente tampoco lo mueve.

export class NotAMemberError extends Error {
  constructor() {
    super("no eres miembro de este proyecto; pídele a alguien del tablero que te asigne una tarea");
  }
}

const memberCache = new Map<string, { ok: boolean; exp: number }>();
const TTL_MS = 30_000;

export async function isProjectMember(sub: string, projectId: number): Promise<boolean> {
  const key = `${sub}|${projectId}`;
  const hit = memberCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.ok;

  const rows = await dbq(
    `SELECT
       (SELECT COUNT(*) FROM task_project_members WHERE project_id = ? AND user_sub = ?) AS m,
       (SELECT COUNT(*) FROM task_projects WHERE id = ? AND created_by = ?) AS creador`,
    [projectId, sub, projectId, sub]
  );
  let ok = num(rows[0]?.m) > 0 || num(rows[0]?.creador) > 0;

  // El dueño del WORKSPACE siempre pasa: si no, quien administra el equipo puede quedarse
  // fuera de un tablero que sí le toca.
  if (!ok) {
    try {
      const { workspaceRoster } = await import("../membership.server");
      ok = (await workspaceRoster()).some((r) => r.sub === sub && r.role === "OWNER");
    } catch {
      /* gs caído → nos quedamos con lo local */
    }
  }

  memberCache.set(key, { ok, exp: Date.now() + TTL_MS });
  return ok;
}

export async function requireProjectMember(sub: string, projectId: number): Promise<void> {
  if (!(await isProjectMember(sub, projectId))) throw new NotAMemberError();
}

/**
 * Asignarle una tarea a alguien lo mete al tablero. Es la puerta de entrada, y por eso no
 * hace falta una pantalla de administración: pones a alguien en una tarea y ya puede
 * trabajar. Vale igual desde la interfaz que desde el agente.
 */
export async function joinByAssignment(projectId: number, sub: string | null | undefined): Promise<void> {
  if (!sub) return;
  await dbq(
    "INSERT OR IGNORE INTO task_project_members (project_id, user_sub, role) VALUES (?, ?, ?)",
    [projectId, sub, "member"]
  ).catch(() => {});
  memberCache.delete(`${sub}|${projectId}`);
}

/** El proyecto al que pertenece una tarea (las ops reciben ids sueltos). */
export async function projectOfTask(taskId: number): Promise<number> {
  const rows = await dbq("SELECT project_id FROM task_tasks WHERE id = ?", [taskId]);
  return num(rows[0]?.project_id);
}
