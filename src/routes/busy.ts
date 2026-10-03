import { createFileRoute } from "@tanstack/react-router";

// Sonda de ocupación del daemon de sandbox-host (gs, 2026-10-01). Sin esta ruta el daemon
// recibía 404, lo leía como «no sé si está ocupada» y no dejaba dormir a la caja de Tasks
// NUNCA (llevaba despierta desde el 24-sep). Tasks no guarda nada en la caja entre
// peticiones y el daemon ya veta la siesta mientras haya peticiones en curso, así que aquí
// siempre es «libre».
export const Route = createFileRoute("/busy")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify({ busy: false }), {
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        }),
    },
  },
});
