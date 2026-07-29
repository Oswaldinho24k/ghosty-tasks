import { createFileRoute } from "@tanstack/react-router";

// Las herramientas del agente, por HTTP. Mismo contrato que usan los conectores de
// Ghosty Teams —`{action:"list"}` / `{action:"run", name, args}` con un Bearer— porque
// el worker ya trae un módulo que habla eso: así las tools de Tasks existen sin tocar
// el runtime ni rehornear la caja, y el schema se descubre en caliente.
//
// Quién es el que actúa sale del TOKEN, nunca del body: el modelo escribe el body.
// El tenant sale del HOST (la caja pega a <slug>.tasks.ghosty.studio), igual que en
// Teams — por eso el namespace no viaja en el token.
export const Route = createFileRoute("/api/agent/tools")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        const { verifyToolToken } = await import("../server/tool-token.server");
        const claims = verifyToolToken(token);
        if (!claims) return json({ error: "unauthorized" }, 401);

        let body: { action?: string; name?: string; args?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "invalid json" }, 400);
        }

        const { ensureSchema } = await import("../server/schema.server");
        await ensureSchema();
        const { ACTIONS, ACTIONS_BY_NAME } = await import("../server/actions/board.actions");
        const { toJsonSchema, parseInput, ActionInputError } = await import("../server/actions/define");

        if (body.action === "list") {
          return json({
            tools: ACTIONS.map((a) => ({
              name: a.name,
              description: a.description,
              inputSchema: toJsonSchema(a.schema),
            })),
          });
        }

        if (body.action === "run") {
          const action = ACTIONS_BY_NAME.get(body.name ?? "");
          if (!action) return json({ ok: false, error: `no existe la herramienta "${body.name}"` });
          try {
            const input = parseInput(action.schema, body.args);
            const result = await action.run(
              { sub: claims.sub, projectId: claims.projectId },
              input as never
            );
            return json({ ok: true, result });
          } catch (e) {
            // Un error de entrada es información para el agente (puede corregir y
            // reintentar), no un 500: se devuelve 200 con ok:false, como los conectores.
            const msg = e instanceof ActionInputError ? e.message : (e as Error)?.message ?? "error";
            return json({ ok: false, error: msg });
          }
        }

        return json({ error: "action debe ser list o run" }, 400);
      },
    },
  },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
