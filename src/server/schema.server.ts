import { dbqManySettled } from "../dbq.server";
import { currentNamespace } from "./tenant.server";

// Migraciones ADITIVAS e idempotentes de las tablas `task_*`. Todo es IF NOT EXISTS.
//
// Las tareas viven en la MISMA DB que el chat de ese workspace (tablas `gc_*`), así
// que el prefijo es la única frontera entre productos: nada de `gw_*` (el nombre
// viejo del repo, "ghosty-work") ni de tocar tablas ajenas — salvo `gc_users`, que es
// el perfil compartido y lo escriben los dos a propósito.
//
// El memo es POR NAMESPACE: un solo proceso sirve todos los workspaces, y con un
// `done` global el primer tenant lo fijaba y los demás se saltaban sus migraciones →
// "no such table" en cada workspace nuevo. No se cachean los fallos.
const done = new Map<string, Promise<void>>();
export async function ensureSchema(): Promise<void> {
  const ns = await currentNamespace();
  let p = done.get(ns);
  if (!p) {
    p = migrate().catch((e) => {
      done.delete(ns);
      throw e;
    });
    done.set(ns, p);
  }
  return p;
}

const DDL: string[] = [
  // Key-value config del producto tareas (el chat tiene su propio gc_config).
  `CREATE TABLE IF NOT EXISTS task_config (
    k          TEXT PRIMARY KEY,
    v          TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,

  // Proyectos (tableros)
  `CREATE TABLE IF NOT EXISTS task_projects (
    id          INTEGER PRIMARY KEY,
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    icon        TEXT,
    color       TEXT NOT NULL DEFAULT '#7c3aed',
    archived    INTEGER NOT NULL DEFAULT 0,
    created_by  TEXT NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  )`,

  // Miembros POR PROYECTO. Ojo: el padrón del workspace NO vive aquí — lo dice gs.
  `CREATE TABLE IF NOT EXISTS task_project_members (
    project_id INTEGER NOT NULL,
    user_sub   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'member',
    PRIMARY KEY (project_id, user_sub)
  )`,
  `CREATE INDEX IF NOT EXISTS task_project_members_user ON task_project_members(user_sub)`,

  // Columnas del kanban
  `CREATE TABLE IF NOT EXISTS task_columns (
    id         INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    color      TEXT,
    wip_limit  INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE INDEX IF NOT EXISTS task_columns_project ON task_columns(project_id, position)`,

  // Tareas
  `CREATE TABLE IF NOT EXISTS task_tasks (
    id           INTEGER PRIMARY KEY,
    project_id   INTEGER NOT NULL,
    column_id    INTEGER NOT NULL,
    parent_id    INTEGER,
    title        TEXT NOT NULL,
    description  TEXT,
    status       TEXT NOT NULL DEFAULT 'open',
    priority     TEXT,
    assignee_sub TEXT,
    due_date     INTEGER,
    position     REAL NOT NULL DEFAULT 0,
    created_by   TEXT NOT NULL,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE INDEX IF NOT EXISTS task_tasks_project ON task_tasks(project_id, column_id, position)`,
  `CREATE INDEX IF NOT EXISTS task_tasks_assignee ON task_tasks(assignee_sub, status)`,
  `CREATE INDEX IF NOT EXISTS task_tasks_parent ON task_tasks(parent_id) WHERE parent_id IS NOT NULL`,

  // Etiquetas
  `CREATE TABLE IF NOT EXISTS task_labels (
    task_id INTEGER NOT NULL,
    label   TEXT NOT NULL,
    color   TEXT NOT NULL DEFAULT '#6b7280',
    PRIMARY KEY (task_id, label)
  )`,
  `CREATE INDEX IF NOT EXISTS task_labels_task ON task_labels(task_id)`,

  // Checklist dentro de una tarea
  `CREATE TABLE IF NOT EXISTS task_checklist_items (
    id         INTEGER PRIMARY KEY,
    task_id    INTEGER NOT NULL,
    body       TEXT NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE INDEX IF NOT EXISTS task_checklist_task ON task_checklist_items(task_id, position)`,

  // Comentarios
  `CREATE TABLE IF NOT EXISTS task_comments (
    id           INTEGER PRIMARY KEY,
    task_id      INTEGER NOT NULL,
    sender_sub   TEXT NOT NULL,
    sender_name  TEXT NOT NULL,
    avatar       TEXT,
    body         TEXT NOT NULL,
    edited_at    INTEGER,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE INDEX IF NOT EXISTS task_comments_task ON task_comments(task_id, created_at)`,

  // Bitácora por tarea
  `CREATE TABLE IF NOT EXISTS task_activities (
    id         INTEGER PRIMARY KEY,
    task_id    INTEGER NOT NULL,
    user_sub   TEXT NOT NULL,
    action     TEXT NOT NULL,
    old_val    TEXT,
    new_val    TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE INDEX IF NOT EXISTS task_activities_task ON task_activities(task_id, created_at)`,

  // Goals (épicas ligeras)
  `CREATE TABLE IF NOT EXISTS task_goals (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'open',
    due_date    INTEGER,
    created_by  TEXT NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE INDEX IF NOT EXISTS task_goals_project ON task_goals(project_id)`,

  `CREATE TABLE IF NOT EXISTS task_goal_tasks (
    goal_id INTEGER NOT NULL,
    task_id INTEGER NOT NULL,
    PRIMARY KEY (goal_id, task_id)
  )`,

  // Mensajes del agente por tarea
  `CREATE TABLE IF NOT EXISTS task_ghosty_messages (
    id           INTEGER PRIMARY KEY,
    task_id      INTEGER NOT NULL,
    sender_sub   TEXT NOT NULL,
    sender_name  TEXT NOT NULL,
    body         TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'msg',
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE INDEX IF NOT EXISTS task_ghosty_msg_task ON task_ghosty_messages(task_id, created_at)`,

  // Tokens del puente Teams → Tasks
  `CREATE TABLE IF NOT EXISTS task_bridge_tokens (
    id         INTEGER PRIMARY KEY,
    token      TEXT UNIQUE NOT NULL,
    label      TEXT,
    project_id INTEGER,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,

  // El perfil compartido con Teams. Tasks NO lo crea desde cero (Teams ya lo hizo al
  // provisionar el workspace), pero un workspace al que se entre PRIMERO por Tasks sí
  // lo necesita. Mismas columnas base que gc_users en ghosty-chat.
  `CREATE TABLE IF NOT EXISTS gc_users (
    id         INTEGER PRIMARY KEY,
    sub        TEXT UNIQUE NOT NULL,
    email      TEXT NOT NULL,
    name       TEXT NOT NULL,
    avatar     TEXT NOT NULL DEFAULT '',
    handle     TEXT UNIQUE,
    is_owner   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
];

// Columnas aditivas: `${tabla}.${columna}` → declaración. Se aplican solo si faltan.
const COLUMNS: Array<[string, string, string]> = [
  ["task_tasks", "updated_at_check", "INTEGER"],
  // Borrar una tarea es tirar trabajo: se archiva y deja de verse, pero se puede
  // recuperar. Nadie quiere descubrir que el botón de la basura era literal.
  ["task_tasks", "archived", "INTEGER NOT NULL DEFAULT 0"],
  // Última vez que esta persona entró. Sirve para ordenar la lista de miembros por quien
  // está activo, en vez de alfabéticamente: en un equipo grande eso es lo que importa.
  ["gc_users", "last_seen_at", "INTEGER"],
];

async function migrate(): Promise<void> {
  // Un solo round-trip para TODO el DDL (antes eran ~30 seriados, y los pagaba el
  // primer request de cada workspace).
  const res = await dbqManySettled(DDL.map((sql) => ({ sql })));
  const fails = res
    .map((r, i) => (r.ok ? null : `${DDL[i].slice(0, 48)}… → ${r.error}`))
    .filter(Boolean) as string[];

  for (const [table, col, decl] of COLUMNS) {
    try {
      const info = await dbqManySettled([{ sql: `PRAGMA table_info(${table})` }]);
      if (!info[0].ok) {
        fails.push(`PRAGMA ${table} → ${info[0].error}`);
        continue;
      }
      if (info[0].rows.some((r) => r.name === col)) continue;
      const add = await dbqManySettled([{ sql: `ALTER TABLE ${table} ADD COLUMN ${col} ${decl}` }]);
      if (!add[0].ok) fails.push(`ALTER ${table}.${col} → ${add[0].error}`);
    } catch (e) {
      fails.push(`${table}.${col} → ${String(e).slice(0, 90)}`);
    }
  }

  if (fails.length) {
    throw new Error(`ensureSchema: ${fails.length} sentencia(s) fallaron: ${fails.join(" | ")}`);
  }
}
