import { Avatar, AvatarFallback, AvatarImage } from "@/components/starwind/avatar";

/** 名前から決まる色相(同じ名前は常に同じ色になる)。 */
function hueOf(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  return hash;
}

/**
 * アバター。DiscordのアバターURLがあれば画像を、無い・読み込めない場合は名前の頭文字を丸で表示する。
 * 名前は隣に表示される前提のため、読み上げ対象外にする。
 */
export function InitialAvatar({ name, avatarUrl, className }: { name: string; avatarUrl?: string | undefined; className?: string }) {
  return (
    <Avatar key={avatarUrl} size="sm" aria-hidden="true" className={className}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
      <AvatarFallback style={{ backgroundColor: `oklch(0.6 0.14 ${hueOf(name)})` }}>{[...name][0] ?? "?"}</AvatarFallback>
    </Avatar>
  );
}
