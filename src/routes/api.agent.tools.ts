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

        const { connectorTools, runConnectorTool } = await import("../server/connectors-bridge.server");

        if (body.action === "list") {
          // Las del tablero MÁS los conectores del usuario (Deník, Calendly…): el canal
          // de tools es uno solo por turno, y sin esto entrar por Tasks le quitaba al
          // agente todo lo que sí tiene en Teams.
          const mine = ACTIONS.map((a) => ({
            name: a.name,
            description: a.description,
            inputSchema: toJsonSchema(a.schema),
          }));
          const theirs = await connectorTools(claims.sub);
          return json({ tools: [...mine, ...theirs] });
        }

        if (body.action === "run") {
          const action = ACTIONS_BY_NAME.get(body.name ?? "");
          // Si no es del tablero, puede ser un conector del usuario → se reenvía a Teams.
          if (!action) return json(await runConnectorTool(claims.sub, body.name ?? "", body.args));
          // Una acción DE TABLERO necesita uno. Con `projectId: 0` —el token que se mina
          // para poder crear el primero— se rechaza aquí en vez de dejar que la consulta
          // busque en el proyecto 0 y devuelva "no encuentro esa tarea", que manda a
          // diagnosticar el lado equivocado.
          if ((action.scope ?? "board") === "board" && !claims.projectId)
            return json({ ok: false, error: "esta acción necesita un tablero; usa list_boards o create_board primero" });
          try {
            const input = parseInput(action.schema, body.args);
            const result = await action.run(
              { sub: claims.sub, projectId: claims.projectId },
              input as never
            );
            // Contar aquí lo que de verdad pasó: en code-mode el agente escribe UN script
            // que llama a varias herramientas, y el worker lo reporta como una sola
            // acción ("Actualizó una tarea" cuando actualizó cuatro). Este endpoint sí ve
            // cada llamada, así que es quien puede decirlo.
            const { publish, ch } = await import("../server/bus.server");
            // Con el detalle (qué tarea) la lista deja de ser seis veces la misma línea.
            const r = result as { ref?: string; title?: string } | null;
            const detail =
              r?.ref ??
              r?.title ??
              (typeof (input as { id?: string }).id === "string" ? (input as { id: string }).id : undefined);
            publish(ch.user(claims.sub), { t: "agent:tool", turnId: "", name: action.name, detail });
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
