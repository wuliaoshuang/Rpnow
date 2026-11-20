/**
 * 小手机联系人头像：有头像用头像，没有就用名字首字 + 按名字定的底色。
 * 微信和朋友圈共用（朋友圈不编随机头像地址——没有头像就是首字圆圈）。
 */

/** 名字定一个头像底色（没头像的联系人用首字 + 底色）。 */
export function colorFor(name: string): string {
  const palette = ['#7c6aae', '#5b8c5a', '#c07a5a', '#5a7fa6', '#a65a7a', '#8a7a3a'];
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return palette[h % palette.length];
}

export function PhoneAvatar({
  name,
  avatarUrl,
  size,
}: {
  name: string;
  avatarUrl?: string;
  size: string;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={`${size} shrink-0 rounded-lg object-cover`}
      />
    );
  }
  return (
    <span
      className={`${size} flex shrink-0 items-center justify-center rounded-lg text-lg font-semibold text-white`}
      style={{ backgroundColor: colorFor(name) }}
    >
      {name.charAt(0) || '？'}
    </span>
  );
}
