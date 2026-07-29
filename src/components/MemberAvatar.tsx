export function MemberAvatar({
  name,
  avatar,
  size = 24,
  title,
  online,
  ring = true,
}: {
  name: string;
  avatar: string;
  size?: number;
  title?: string;
  /** Punto verde de conectado. La presencia ya viajaba por el bus y nadie la usaba. */
  online?: boolean;
  /**
   * Anillo propio. Se apaga cuando quien lo envuelve ya dibuja uno (el filtro por
   * persona): dos anillos concéntricos de distinto grosor se ven como un error de
   * alineación, y en las iniciales se notaba más porque cambia el fondo.
   */
  ring?: boolean;
}) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const style = { width: size, height: size, fontSize: size * 0.38 };

  const dot = online ? (
    <span
      className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-surface bg-emerald-500"
      style={{ width: Math.max(7, size * 0.3), height: Math.max(7, size * 0.3) }}
      title="En línea"
    />
  ) : null

  if (avatar) {
    return (
      <span className="relative inline-flex shrink-0">
        <img
          src={avatar}
          alt={name}
          title={title ?? name}
          className={`block rounded-full object-cover ${ring ? 'ring-1 ring-border' : ''}`}
          style={style}
        />
        {dot}
      </span>
    )
  }
  return (
    <span className="relative inline-flex shrink-0">
      <span
        title={title ?? name}
        className={`inline-flex items-center justify-center rounded-full bg-brand/20 font-semibold leading-none text-brand ${
          ring ? 'ring-1 ring-border' : ''
        }`}
        style={style}
      >
        {initials}
      </span>
      {dot}
    </span>
  )
}
