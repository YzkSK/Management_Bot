import { cn } from "@/lib/utils";

/** 名前から決まる色相(同じ名前は常に同じ色になる)。 */
function hueOf(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  return hash;
}

/** 名前の頭文字を丸で表示する簡易アバター。名前は隣に表示される前提のため、読み上げ対象外にする。 */
export function InitialAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white", className)}
      style={{ backgroundColor: `oklch(0.6 0.14 ${hueOf(name)})` }}
    >
      {[...name][0] ?? "?"}
    </span>
  );
}
