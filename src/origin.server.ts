export async function reqOrigin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL;
  const { getRequestHeader, getRequestHost, getRequestProtocol } = await import(
    "@tanstack/react-start/server"
  );
  const ghosty = getRequestHeader("x-ghosty-origin");
  if (ghosty) return ghosty;
  const host = getRequestHeader("x-forwarded-host") || getRequestHost();
  const proto = getRequestHeader("x-forwarded-proto") || getRequestProtocol() || "https";
  return host ? `${proto}://${host}` : "";
}
