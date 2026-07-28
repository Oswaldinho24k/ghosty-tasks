import { createServerFn } from "@tanstack/react-start";

// Sesión + login con Ghosty.studio (IdP del ecosistema).
// Antes usaba Formmy como IdP — ya NO. FORMMY_PARTNER_SECRET_GHOSTY está deprecado.
const IDP = process.env.GHOSTY_IDENTITY_URL ?? "https://www.ghosty.studio";

async function session() {
  const { useSession } = await import("@tanstack/react-start/server");
  const { sessionConfig } = await import("./session.server");
  return useSession<{ user?: import("../users.server").SessionUser }>(sessionConfig());
}

export const me = createServerFn({ method: "GET" }).handler(async () => {
  const s = await session();
  return s.data.user ?? null;
});

type Me = Awaited<ReturnType<typeof me>>;
let _meCache: Me | undefined;
export async function cachedMe(): Promise<Me> {
  if (typeof window === "undefined") return me();
  if (_meCache !== undefined) {
    me().then((u) => { _meCache = u; }).catch(() => {});
    return _meCache;
  }
  _meCache = await me();
  return _meCache;
}

export function peekMe(): Me | undefined {
  return _meCache;
}

export function clearMeCache() {
  _meCache = undefined;
}

// Devuelve el URL del handshake de identidad. Si GHOSTY_PARTNER_SECRET está
// configurado, firma el request (HMAC); si no, ghosty.studio acepta sin firma.
export const startGhostyLogin = createServerFn({ method: "GET" })
  .validator((d: Record<string, never> | undefined) => d ?? {})
  .handler(async () => {
    // Del REQUEST, nunca de una env fija: cada workspace tiene su subdominio y el IdP
    // devuelve la identidad al origin que le firmamos.
    const { reqOrigin } = await import("../origin.server");
    const origin = await reqOrigin();
    const secret = process.env.GHOSTY_PARTNER_SECRET;
    const params: Record<string, string> = { o: origin };
    if (secret) {
      const crypto = await import("node:crypto");
      const ts = Math.floor(Date.now() / 1000);
      const sig = crypto.createHmac("sha256", secret).update(`${ts}.${origin}`).digest("hex");
      params.ts = String(ts);
      params.sig = sig;
    }
    const p = new URLSearchParams(params);
    return { url: `${IDP}/identity/connect?${p}`, idpOrigin: IDP };
  });

// Recibe la identidad de ghosty.studio, crea sesión.
// Verifica la firma HMAC solo si GHOSTY_PARTNER_SECRET está configurado.
export const completeGhostyLogin = createServerFn({ method: "POST" })
  .validator((d: { payload: string; sig?: string }) => d)
  .handler(async ({ data }) => {
    const secret = process.env.GHOSTY_PARTNER_SECRET;
    if (secret && data.sig) {
      const crypto = await import("node:crypto");
      const expected = crypto.createHmac("sha256", secret).update(data.payload).digest("hex");
      const a = Buffer.from(expected);
      const b = Buffer.from(data.sig);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("firma inválida");
    }
    const id = JSON.parse(Buffer.from(data.payload, "base64url").toString()) as {
      sub: string; email: string; name: string; avatar: string; ts: number;
    };
    if (Math.abs(Math.floor(Date.now() / 1000) - id.ts) > 300) throw new Error("identidad expirada");

    // El acceso lo decide gs, no una tabla local: Tasks no tiene padrón propio ni
    // invitaciones — quien está en el equipo en Ghosty Teams entra aquí, y punto.
    const { currentSlug } = await import("./tenant.server");
    const { membershipOf } = await import("./membership.server");
    const slug = await currentSlug();
    const m = await membershipOf(id.sub);
    if (slug && !m.member) throw new Error("no eres miembro de este workspace");

    // Después del guard: crear las tablas es trabajo que no se le hace a un extraño.
    await (await import("./schema.server")).ensureSchema();

    const { upsertUser } = await import("../users.server");
    const user = await upsertUser(
      { sub: id.sub, email: id.email, name: id.name, avatar: id.avatar },
      m.role
    );

    const s = await session();
    await s.update({ user });
    return { ok: true as const, user };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const s = await session();
  await s.clear();
  // Single-logout: también cerramos la sesión del IdP para que /login no re-autentique silencioso.
  return { ok: true as const, next: `${IDP}/logout` };
});
