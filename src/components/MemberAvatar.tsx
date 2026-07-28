export function MemberAvatar({
  name,
  avatar,
  size = 24,
  title,
}: {
  name: string;
  avatar: string;
  size?: number;
  title?: string;
}) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const style = { width: size, height: size, fontSize: size * 0.38 };

  if (avatar) {
    return (
      <img
        src={avatar}
        alt={name}
        title={title ?? name}
        className="rounded-full object-cover ring-1 ring-border"
        style={style}
      />
    );
  }
  return (
    <span
      title={title ?? name}
      className="inline-flex items-center justify-center rounded-full bg-brand/20 font-semibold text-brand ring-1 ring-border"
      style={style}
    >
      {initials}
    </span>
  );
}
