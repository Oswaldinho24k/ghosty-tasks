export const ch = {
  project: (id: number) => `project:${id}`,
  task: (id: number) => `task:${id}`,
  user: (sub: string) => `user:${sub}`,
  presence: () => "presence",
};

export type WwEvent =
  | { t: "task:created"; task: { id: number; project_id: number; column_id: number; title: string; priority: string | null; assignee_sub: string | null; position: number; status: string } }
  | { t: "task:updated"; id: number; patch: Record<string, unknown> }
  | { t: "task:moved"; id: number; column_id: number; position: number }
  | { t: "task:deleted"; id: number; project_id: number }
  | { t: "column:created"; column: { id: number; project_id: number; name: string; position: number; color: string | null } }
  | { t: "column:updated"; id: number; patch: Record<string, unknown> }
  | { t: "column:deleted"; id: number; project_id: number }
  | { t: "columns:reordered"; project_id: number; ordered_ids: number[] }
  | { t: "checklist:updated"; task_id: number }
  | { t: "comment:created"; task_id: number; comment: { id: number; task_id: number; sender_sub: string; sender_name: string; avatar: string | null; body: string; edited_at: number | null; created_at: number } }
  | { t: "comment:updated"; task_id: number; comment: { id: number; task_id: number; sender_sub: string; sender_name: string; avatar: string | null; body: string; edited_at: number | null; created_at: number } }
  | { t: "comment:deleted"; task_id: number; comment_id: number }
  | { t: "goal:created"; goal: { id: number; project_id: number; title: string; description: string | null; status: string; due_date: number | null; created_by: string; created_at: number; total_tasks: number; completed_tasks: number } }
  | { t: "goal:updated"; id: number; project_id: number }
  | { t: "goal:deleted"; id: number; project_id: number }
  | { t: "presence"; sub: string; name: string; status: "online" | "offline" }
  | { t: "presence:init"; online: string[] }
  | { t: "agent:chunk"; turnId: string; value: string }
  | { t: "agent:done"; turnId: string; value: string; created_tasks: Array<{ id: number; title: string; column_id: number }> };

type Listener = (ev: WwEvent) => void;
type Client = { channels: Set<string>; listener: Listener; sub: string };

const clients = new Set<Client>();
const online = new Map<string, number>();

export function publish(channel: string, ev: WwEvent): void {
  for (const c of clients) {
    if (!c.channels.has(channel)) continue;
    try {
      c.listener(ev);
    } catch {
      /* controller cerrado */
    }
  }
}

export function addClient(
  sub: string,
  name: string,
  channels: string[],
  listener: Listener
): () => void {
  const client: Client = { channels: new Set(channels), listener, sub };
  clients.add(client);
  const prev = online.get(sub) ?? 0;
  online.set(sub, prev + 1);
  if (prev === 0) publish(ch.presence(), { t: "presence", sub, name, status: "online" });

  return () => {
    clients.delete(client);
    const n = (online.get(sub) ?? 1) - 1;
    if (n <= 0) {
      online.delete(sub);
      publish(ch.presence(), { t: "presence", sub, name, status: "offline" });
    } else {
      online.set(sub, n);
    }
  };
}

export function onlineUsers(): string[] {
  return [...online.keys()];
}
