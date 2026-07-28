import { createFileRoute } from "@tanstack/react-router";

// Las fotos de perfil viven en Ghosty Teams (`/api/attachment/:id`, objetos privados
// de EasyBits con URL firmada). Aquí llegan como ruta RELATIVA en `gc_users.avatar`,
// que es el perfil compartido; apuntarlas tal cual desde Tasks daba 404, y apuntarlas
// al host de Teams da 401 porque su cookie de sesión no viaja entre subdominios.
//
// Este proxy es lo que las arregla: el SERVIDOR de Tasks pide el archivo a Teams
// firmando con GHOSTY_PARTNER_SECRET, y devuelve el redirect a la URL firmada. Para el
// browser la imagen es del mismo origen, así que no hay cookies de terceros ni firmas
// paseándose por el HTML.
export const Route = createFileRoute("/api/avatar/$id")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { id: string } }) => {
        const { useSession } = await import("@tanstack/react-start/server");
        const { sessionConfig } = await import("../server/session.server");
        const s = await useSession<{ user?: { sub: string } }>(sessionConfig());
        if (!s.data.user) return new Response("unauthorized", { status: 401 });

        const { currentSlug } = await import("../server/tenant.server");
        const slug = await currentSlug();
        const secret = process.env.GHOSTY_PARTNER_SECRET;
        if (!slug || !secret) return new Response("not found", { status: 404 });

        const TEAMS_ROOT = process.env.TEAMS_ROOT_DOMAIN ?? "teams.ghosty.studio";
        const crypto = await import("node:crypto");
        const ts = Math.floor(Date.now() / 1000);
        const sig = crypto.createHmac("sha256", secret).update(`${ts}.${params.id}`).digest("hex");
        const target = `https://${slug}.${TEAMS_ROOT}/api/attachment/${encodeURIComponent(params.id)}?ts=${ts}&sig=${sig}`;

        const r = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(5000) });
        const loc = r.headers.get("location");
        if (!loc) return new Response("not found", { status: 404 });
        return new Response(null, {
          status: 302,
          // Por debajo del TTL de la URL firmada que acabamos de obtener.
          headers: { Location: loc, "Cache-Control": "private, max-age=3000" },
        });
      },
    },
  },
});
