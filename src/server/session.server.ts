const MAX_AGE = 60 * 60 * 24 * 30;

export function sessionConfig() {
  return {
    password: process.env.SESSION_SECRET!,
    name: "gw_session",
    maxAge: MAX_AGE,
    cookie: {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      maxAge: MAX_AGE,
    },
  };
}
