interface HeaderProps {
  discordUserId: string;
}

export function Header({ discordUserId }: HeaderProps) {
  return (
    <header className="flex items-center justify-between border-b px-4 py-3">
      <strong className="text-sm font-semibold">Management Bot Dashboard</strong>
      <span className="text-muted-foreground text-sm">{discordUserId}</span>
    </header>
  );
}
