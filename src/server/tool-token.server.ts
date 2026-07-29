import crypto from "node:crypto";

// Token-capacidad del turno. La caja del agente ejecuta código que el propio modelo
// escribe, así que ahí NUNCA entra el secreto maestro: solo esto, que dice "quien te
// habló es <sub> y trabaja en el tablero <projectId>", caduca pronto y va firmado.
//
// El agente puede leerlo (está en su env) pero no forjar otro: sin el secreto no puede
// cambiarse el `sub` para actuar como alguien más.
//
// Mismo molde que los tool-token de los conectores en Ghosty Teams.
const TTL_S = 15 * 60;

type Payload = { sub: string; projectId: number; exp: number };

function secret(): string {
  const s = process.env.GHOSTY_PARTNER_SECRET;
  if (!s) throw new Error("falta GHOSTY_PARTNER_SECRET");
  return s;
}

export function mintToolToken(sub: string, projectId: number, ttlSeconds = TTL_S): string {
  const payload: Payload = { sub, projectId, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToolToken(token: string): Payload | null {
  const [body, sig] = (token ?? "").split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    if (!p.sub || !p.projectId) return null;
    if (p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}
