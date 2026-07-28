// El origin de ESTE request. Con multitenancy por subdominio tiene que salir del
// host real: `APP_URL` fija un solo origen, así que todos los workspaces firmarían el
// handshake como el apex y el IdP devolvería la identidad al host equivocado.
// Queda como último recurso (dev local sin proxy delante).
export async function reqOrigin(): Promise<string> {
  const { getRequestHeader, getRequestHost, getRequestProtocol } = await import(
    "@tanstack/react-start/server"
  );
  const ghosty = getRequestHeader("x-ghosty-origin");
  if (ghosty) return ghosty;
  const host = getRequestHeader("x-forwarded-host") || getRequestHost();
  const proto = getRequestHeader("x-forwarded-proto") || getRequestProtocol() || "https";
  if (host) return `${proto}://${host}`;
  return process.env.APP_URL ?? "";
}
