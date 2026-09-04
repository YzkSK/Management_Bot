const formatter = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "medium" });

export function formatCreatedAt(iso: string): string {
  return formatter.format(new Date(iso));
}
