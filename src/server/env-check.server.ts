// ── Lo que el proceso necesita para servir: se comprueba al arrancar ─────────────
//
// Gemelo del de Ghosty Teams (`src/server/env-check.server.ts`), y aquí duele más: este
// repo YA perdió dos veces por una variable ausente, las dos sin una sola línea de log.
//
//   · `GHOSTY_RUNTIME_URL` nunca estuvo en la caja → el agente **no funcionó nunca**, y el
//     síntoma («este workspace no tiene runtime configurado») era indistinguible de un
//     tenant que a propósito no lo tiene.
//   · `SQLD_AUTH_TOKEN` se quedó estático cuando sqld pasó a exigir JWT por namespace →
//     tres días de pantalla negra con el unit `active` y el puerto escuchando.
//
// ⚠️ Sólo MATA en producción: negarse a arrancar en una laptop haría que alguien comentara
// la comprobación, que es como mueren estas cosas.
//
// ⚠️ Aquí NO va nada que tenga default en el código. `TEAMS_ROOT_DOMAIN`, `TASKS_ROOT_DOMAIN`
// y `GHOSTY_RUNTIME_URL` lo tienen y la caja no los trae: listarlos anunciaría un fallo en
// cada arranque con todo funcionando, y un aviso falso enseña a ignorar los avisos.

const REQUIRED: Record<string, string> = {
  SESSION_SECRET: "firma las cookies de sesión — sin esto nadie entra",
  SQLD_URL: "la base de datos del tenant",
  SQLD_NAMESPACE: "el tenant por defecto",
  SQLD_JWT_PRIVATE_KEY: "sqld exige JWT por namespace desde el 2026-08-17",
  GHOSTY_PARTNER_SECRET: "firma HMAC contra Studio y contra Teams",
  GHOSTY_IDENTITY_URL: "dónde vive Studio (login y padrón)",
};

export function assertEnv(): void {
  const faltantes = Object.keys(REQUIRED).filter((k) => !(process.env[k] ?? "").trim());
  if (!faltantes.length) return;

  const detalle = faltantes.map((k) => `  · ${k} — ${REQUIRED[k]}`).join("\n");
  const msg = `[env] faltan ${faltantes.length} variable(s) sin las que no se puede servir:\n${detalle}`;

  if (process.env.NODE_ENV !== "production") {
    console.warn(`${msg}\n[env] (en dev sólo se avisa; en producción el proceso no arranca)`);
    return;
  }
  // Salir es el punto: systemd reintenta, falla, y `systemctl status` enseña ESTA lista.
  console.error(msg);
  process.exit(1);
}
