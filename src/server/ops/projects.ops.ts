import { dbq, num } from "../../dbq.server";

// Las mutaciones de TABLERO, sin sesión: reciben quién las pide. Mismo motivo que
// `tasks.ops.ts` — la UI saca el `sub` de la cookie y el agente del token, pero el cuerpo
// tiene que ser uno solo o acaban divergiendo.
//
// Se extrajo aquí el 2026-08-06 porque Ghosty Teams había empezado a reimplementar "crear
// tablero" del otro lado (mismo slug, mismas tres columnas, misma alta del dueño). Dos
// implementaciones de lo mismo en repos distintos es exactamente lo que este directorio
// existe para evitar.

export type ProjectRow = { id: number; slug: string; name: string };

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "project"
  );
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  for (let i = 2; ; i++) {
    const rows = await dbq("SELECT 1 FROM task_projects WHERE slug = ?", [slug]);
    if (!rows[0]) return slug;
    slug = `${base}-${i}`;
  }
}

/** Tableros vivos del espacio. */
export async function listProjects(): Promise<ProjectRow[]> {
  const rows = await dbq(
    "SELECT id, slug, name FROM task_projects WHERE COALESCE(archived,0) = 0 ORDER BY id"
  );
  return rows.map((r) => ({ id: num(r.id), slug: r.slug ?? "", name: r.name ?? "" }));
}

/**
 * Crea un tablero y lo deja usable: tres columnas y su dueño dentro.
 *
 * ⚠️ Las tres columnas no son decoración y sus NOMBRES importan: `move_task` cierra una
 * tarea moviéndola a "Done" por nombre, así que un tablero nacido sin ellas no se podría
 * cerrar. Y sin la fila de miembro, `requireProjectMember` le negaría al creador su propio
 * tablero en la siguiente petición.
 */
export async function createProject(
  sub: string,
  input: { name: string; description?: string | null; icon?: string | null; color?: string | null }
): Promise<ProjectRow> {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new Error("el tablero necesita un nombre");
  const slug = await uniqueSlug(slugify(name));
  const rows = await dbq(
    "INSERT INTO task_projects (slug, name, description, icon, color, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, slug, name",
    [slug, name, input.description ?? null, input.icon ?? null, input.color ?? "#7c3aed", sub]
  );
  const project = { id: num(rows[0].id), slug: rows[0].slug ?? "", name: rows[0].name ?? "" };

  const cols: [string, number, string][] = [
    ["To Do", 0, "#6b7280"],
    ["In Progress", 1, "#3b82f6"],
    ["Done", 2, "#22c55e"],
  ];
  for (const [col, pos, color] of cols)
    await dbq("INSERT INTO task_columns (project_id, name, position, color) VALUES (?, ?, ?, ?)", [
      project.id,
      col,
      pos,
      color,
    ]);

  await dbq(
    "INSERT OR IGNORE INTO task_project_members (project_id, user_sub, role) VALUES (?, ?, ?)",
    [project.id, sub, "owner"]
  );
  return project;
}
