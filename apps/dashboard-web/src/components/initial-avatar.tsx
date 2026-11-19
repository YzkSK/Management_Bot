import { Avatar, AvatarFallback, AvatarImage } from "@/components/starwind/avatar";

/**
 * アバター。DiscordのアバターURLがあれば画像を、無い・読み込めない場合は名前の頭文字を無彩色の丸で表示する。
 * 名前は隣に表示される前提のため、読み上げ対象外にする。
 */
export function InitialAvatar({ name, avatarUrl, className }: { name: string; avatarUrl?: string | undefined; className?: string }) {
  return (
    <Avatar key={avatarUrl} size="sm" aria-hidden="true" className={className}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
      <AvatarFallback className="bg-border text-foreground font-bold">{[...name][0] ?? "?"}</AvatarFallback>
    </Avatar>
  );
}
