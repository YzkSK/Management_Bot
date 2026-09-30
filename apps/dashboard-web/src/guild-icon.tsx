import { cn } from "@/lib/utils";

/** サーバーアイコン。アイコン未設定のサーバーは頭文字で表す。 */
export function GuildIcon({ name, iconUrl, className }: { name: string; iconUrl: string | null; className?: string }) {
  if (iconUrl) return <img src={iconUrl} alt="" className={cn("shrink-0 object-cover", className)} />;
  return (
    <span className={cn("bg-muted flex shrink-0 items-center justify-center font-bold", className)} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}
