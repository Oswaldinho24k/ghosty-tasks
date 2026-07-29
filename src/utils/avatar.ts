// La foto de perfil vive en Ghosty Teams y en `gc_users.avatar` viaja como ruta SUYA
// (`/api/attachment/<id>`): desde Tasks eso da 404, y apuntada a su host da 401 porque su
// cookie no cruza subdominios. Se reescribe al proxy propio — ver routes/api.avatar.$id.ts.
//
// TODO lo que devuelva `gc_users.avatar` al cliente tiene que pasar por aquí: la primera
// vez se aplicó solo en dos lecturas y la lista de miembros del proyecto quedó rota.
export function localAvatar(av: string | null | undefined): string {
  const v = av ?? ''
  const m = v.match(/^\/api\/attachment\/(.+)$/)
  return m ? `/api/avatar/${m[1]}` : v
}
