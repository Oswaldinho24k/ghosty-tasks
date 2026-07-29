import { createFileRoute } from "@tanstack/react-router";
import type { WwEvent } from "../server/bus.server";

export const Route = createFileRoute("/api/stream")({
  server: {
    handlers: {
      GET: async () => {
        const { useSession } = await import("@tanstack/react-start/server");
        const { sessionConfig } = await import("../server/session.server");
        const s = await useSession<{ user?: { sub: string; name: string } }>(sessionConfig());
        const user = s.data.user;
        if (!user) return new Response("unauthorized", { status: 401 });

        const { ensureSchema } = await import("../server/schema.server");
        await ensureSchema();

        const { dbq } = await import("../dbq.server");
        const bus = await import("../server/bus.server");
        // El namespace se resuelve UNA vez y viaja con el suscriptor: el stream vive
        // minutos, mucho después de que el contexto del request se haya ido.
        const { currentNamespace } = await import("../server/tenant.server");
        const ns = await currentNamespace();

        // Subscribe to all projects the user is a member of
        const projectRows = await dbq(
          `SELECT p.id FROM task_projects p
           WHERE p.archived = 0
             AND (p.created_by = ? OR EXISTS (SELECT 1 FROM task_project_members m WHERE m.project_id = p.id AND m.user_sub = ?))`,
          [user.sub, user.sub]
        );
        const channels = [
          ...projectRows.map((r) => bus.ch.project(Number(r.id))),
          bus.ch.user(user.sub),
          bus.ch.presence(),
        ];

        const enc = new TextEncoder();
        let unsub = () => {};
        let heartbeat: ReturnType<typeof setInterval> | undefined;

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const send = (ev: WwEvent | { t: string; [k: string]: unknown }) => {
              controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
            };
            send({ t: "presence:init", online: bus.onlineUsers(ns) });
            unsub = bus.addClient(ns, user.sub, user.name, channels, (ev) => {
              try { send(ev); } catch { /* controller cerrado */ }
            });
            heartbeat = setInterval(() => {
              try { controller.enqueue(enc.encode(`: ping\n\n`)); } catch { /* cerrado */ }
            }, 25_000);
          },
          cancel() {
            if (heartbeat) clearInterval(heartbeat);
            unsub();
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
