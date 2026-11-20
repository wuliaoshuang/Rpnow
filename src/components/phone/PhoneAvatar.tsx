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

/**
 * 群聊头像：前 4 位成员名字的首字拼成 2×2 格（插件同款），右下角
 * 一个“群”字角标。没成员（不应该发生）时显示一个“群”字。
 */
export function GroupAvatar({
  names,
  size,
}: {
  /** 成员名字（groups.ts 的 groupMembers 算出来的顺序，最多取前 4 位）。 */
  names: string[];
  size: string;
}) {
  const cells = names.slice(0, 4);
  return (
    <span className={`${size} relative shrink-0 overflow-visible rounded-lg`}>
      <span className="grid h-full w-full grid-cols-2 grid-rows-2 overflow-hidden rounded-lg">
        {[0, 1, 2, 3].map((i) => {
          const name = cells[i];
          return (
            <span
              key={i}
              className="flex items-center justify-center text-[11px] font-semibold text-white"
              style={{ backgroundColor: name ? colorFor(name) : '#a3a3a3' }}
            >
              {name ? name.charAt(0) : ''}
            </span>
          );
        })}
      </span>
      <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-[#07C160] text-[9px] font-bold text-white ring-2 ring-white">
        群
      </span>
    </span>
  );
}
