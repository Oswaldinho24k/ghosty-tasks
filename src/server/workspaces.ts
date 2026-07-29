import { createServerFn } from "@tanstack/react-start";

// El apex (tasks.ghosty.studio, sin subdominio) no tiene tenant: es el selector.
// Una persona puede pertenecer a varios workspaces —su tier en gs marca el tope— y
// cada uno es un tablero distinto con su propia DB.
export const listMyWorkspacesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { useSession } = await import("@tanstack/react-start/server");
  const { sessionConfig } = await import("./session.server");
  const s = await useSession<{ user?: { sub: string } }>(sessionConfig());
  const sub = s.data.user?.sub;

  const IDP = process.env.GHOSTY_IDENTITY_URL ?? "https://www.ghosty.studio";
  const ROOT = process.env.TASKS_ROOT_DOMAIN ?? "tasks.ghosty.studio";
  const empty = { portal: IDP, workspaces: [] as Array<{ slug: string; role: string; url: string }> };
  if (!sub) return empty;

  try {
    const { myWorkspaces } = await import("./membership.server");
    const rows = await myWorkspaces(sub);
    return {
      portal: IDP,
      workspaces: rows.map((w) => ({
        slug: w.slug,
        role: w.role,
        url: `https://${w.slug}.${ROOT}`,
      })),
    };
  } catch {
    // gs caído: mejor el selector vacío con el enlace al portal que una pantalla rota.
    return empty;
  }
});

/** ¿Este host trae workspace (subdominio) o es el apex? */
export const tenantStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const { currentSlug } = await import("./tenant.server");
  return { slug: await currentSlug() };
});
