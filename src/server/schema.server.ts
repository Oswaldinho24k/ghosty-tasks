import { dbq } from "../dbq.server";

// Migraciones ADITIVAS e idempotentes. Todo es IF NOT EXISTS.
// Si falla (DB transitoria), done se resetea y el siguiente request reintenta.
let done: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  if (!done) {
    done = migrate().catch((e) => {
      done = null;
      throw e;
    });
  }
  return done;
}

async function hasColumn(table: string, col: string): Promise<boolean> {
  const rows = await dbq(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === col);
}

async function migrate(): Promise<void> {
  const fails: string[] = [];
  const exec = async (sql: string) => {
    try {
      await dbq(sql);
    } catch (e) {
      fails.push(`${sql.slice(0, 48)}… → ${String(e).slice(0, 90)}`);
    }
  };
  const addColumn = async (table: string, col: string, decl: string) => {
    let has: boolean;
    try {
      has = await hasColumn(table, col);
    } catch (e) {
      fails.push(`PRAGMA ${table} → ${String(e).slice(0, 90)}`);
      return;
    }
    if (has) return;
    await exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
  };

  // Workspace users (mirrors gc_users pattern but for ghosty-work)
  await exec(`CREATE TABLE IF NOT EXISTS gw_users (
    sub        TEXT PRIMARY KEY,
    email      TEXT NOT NULL,
    name       TEXT NOT NULL,
    avatar     TEXT NOT NULL DEFAULT '',
    handle     TEXT UNIQUE,
    is_owner   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  // Invite tokens (one-use)
  await exec(`CREATE TABLE IF NOT EXISTS gw_invites (
    token      TEXT PRIMARY KEY,
    created_by TEXT NOT NULL,
    used_by    TEXT,
    used_at    INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  // Key-value config store
  await exec(`CREATE TABLE IF NOT EXISTS gw_config (
    k          TEXT PRIMARY KEY,
    v          TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  // Projects
  await exec(`CREATE TABLE IF NOT EXISTS gw_projects (
    id          INTEGER PRIMARY KEY,
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    icon        TEXT,
    color       TEXT NOT NULL DEFAULT '#7c3aed',
    archived    INTEGER NOT NULL DEFAULT 0,
    created_by  TEXT NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  // Project members (owner + member roles)
  await exec(`CREATE TABLE IF NOT EXISTS gw_project_members (
    project_id INTEGER NOT NULL,
    user_sub   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'member',
    PRIMARY KEY (project_id, user_sub)
  )`);
  await exec(`CREATE INDEX IF NOT EXISTS gw_project_members_user ON gw_project_members(user_sub)`);

  // Kanban columns per project
  await exec(`CREATE TABLE IF NOT EXISTS gw_columns (
    id         INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    color      TEXT,
    wip_limit  INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  await exec(`CREATE INDEX IF NOT EXISTS gw_columns_project ON gw_columns(project_id, position)`);

  // Tasks
  await exec(`CREATE TABLE IF NOT EXISTS gw_tasks (
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
  )`);
  await exec(`CREATE INDEX IF NOT EXISTS gw_tasks_project ON gw_tasks(project_id, column_id, position)`);
  await exec(`CREATE INDEX IF NOT EXISTS gw_tasks_assignee ON gw_tasks(assignee_sub, status)`);
  await exec(`CREATE INDEX IF NOT EXISTS gw_tasks_parent ON gw_tasks(parent_id) WHERE parent_id IS NOT NULL`);

  // Task labels (freeform, colored chips)
  await exec(`CREATE TABLE IF NOT EXISTS gw_task_labels (
    task_id INTEGER NOT NULL,
    label   TEXT NOT NULL,
    color   TEXT NOT NULL DEFAULT '#6b7280',
    PRIMARY KEY (task_id, label)
  )`);
  await exec(`CREATE INDEX IF NOT EXISTS gw_task_labels_task ON gw_task_labels(task_id)`);

  // Checklist items inside a task
  await exec(`CREATE TABLE IF NOT EXISTS gw_checklist_items (
    id         INTEGER PRIMARY KEY,
    task_id    INTEGER NOT NULL,
    body       TEXT NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  await exec(`CREATE INDEX IF NOT EXISTS gw_checklist_task ON gw_checklist_items(task_id, position)`);

  // Human comments on tasks
  await exec(`CREATE TABLE IF NOT EXISTS gw_task_comments (
    id           INTEGER PRIMARY KEY,
    task_id      INTEGER NOT NULL,
    sender_sub   TEXT NOT NULL,
    sender_name  TEXT NOT NULL,
    avatar       TEXT,
    body         TEXT NOT NULL,
    edited_at    INTEGER,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  await exec(`CREATE INDEX IF NOT EXISTS gw_comments_task ON gw_task_comments(task_id, created_at)`);

  // Activity log per task
  await exec(`CREATE TABLE IF NOT EXISTS gw_task_activities (
    id         INTEGER PRIMARY KEY,
    task_id    INTEGER NOT NULL,
    user_sub   TEXT NOT NULL,
    action     TEXT NOT NULL,
    old_val    TEXT,
    new_val    TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  await exec(`CREATE INDEX IF NOT EXISTS gw_activities_task ON gw_task_activities(task_id, created_at)`);

  // Goals (lightweight epics, opt-in)
  await exec(`CREATE TABLE IF NOT EXISTS gw_goals (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'open',
    due_date    INTEGER,
    created_by  TEXT NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  await exec(`CREATE INDEX IF NOT EXISTS gw_goals_project ON gw_goals(project_id)`);

  // Goal ↔ Task links
  await exec(`CREATE TABLE IF NOT EXISTS gw_goal_tasks (
    goal_id INTEGER NOT NULL,
    task_id INTEGER NOT NULL,
    PRIMARY KEY (goal_id, task_id)
  )`);

  // Ghosty AI messages per task (Phase 3)
  await exec(`CREATE TABLE IF NOT EXISTS gw_ghosty_messages (
    id           INTEGER PRIMARY KEY,
    task_id      INTEGER NOT NULL,
    sender_sub   TEXT NOT NULL,
    sender_name  TEXT NOT NULL,
    body         TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'msg',
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  await exec(`CREATE INDEX IF NOT EXISTS gw_ghosty_msg_task ON gw_ghosty_messages(task_id, created_at)`);

  // Bridge tokens (Ghosty Teams → Ghosty Tasks webhook, Phase 3)
  await exec(`CREATE TABLE IF NOT EXISTS gw_bridge_tokens (
    id         INTEGER PRIMARY KEY,
    token      TEXT UNIQUE NOT NULL,
    label      TEXT,
    project_id INTEGER,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  // Additive columns for future migrations go here
  await addColumn("gw_tasks", "updated_at_check", "INTEGER");
  await addColumn("gw_users", "banned", "INTEGER NOT NULL DEFAULT 0");

  if (fails.length) {
    throw new Error(`ensureSchema: ${fails.length} sentencia(s) fallaron: ${fails.join(" | ")}`);
  }
}
