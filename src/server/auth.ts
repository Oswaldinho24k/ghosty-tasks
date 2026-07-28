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
  .validator((d: { inviteToken?: string } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    let origin = process.env.APP_URL ?? "";
    if (!origin) {
      const { getRequestHeader, getRequestHost, getRequestProtocol } = await import(
        "@tanstack/react-start/server"
      );
      const ghostyOrigin = getRequestHeader("x-ghosty-origin");
      if (ghostyOrigin) {
        origin = ghostyOrigin;
      } else {
        const host = getRequestHeader("x-forwarded-host") || getRequestHost();
        const proto = getRequestHeader("x-forwarded-proto") || getRequestProtocol() || "https";
        if (host) origin = `${proto}://${host}`;
      }
    }
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
    return { url: `${IDP}/identity/connect?${p}`, idpOrigin: IDP, inviteToken: data.inviteToken };
  });

// Recibe la identidad de ghosty.studio, crea sesión.
// Verifica la firma HMAC solo si GHOSTY_PARTNER_SECRET está configurado.
export const completeGhostyLogin = createServerFn({ method: "POST" })
  .validator((d: { payload: string; sig?: string; inviteToken?: string }) => d)
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

    await (await import("./schema.server")).ensureSchema().catch(() => {});

    const { consumeInvite } = await import("./invites");
    const invited = data.inviteToken ? await consumeInvite(data.inviteToken, id.sub) : false;

    const { isBanned, upsertUser } = await import("../users.server");
    if (await isBanned(id.sub)) throw new Error("sin acceso a este workspace");

    const user = await upsertUser({ sub: id.sub, email: id.email, name: id.name, avatar: id.avatar });

    if (!user.isOwner && !invited) {
      const { isKnownUser } = await import("./invites");
      if (!(await isKnownUser(id.sub))) throw new Error("necesitas una invitación");
    }

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
