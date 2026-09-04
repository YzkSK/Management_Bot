interface HeaderProps {
  discordUserId: string;
}

export function Header({ discordUserId }: HeaderProps) {
  return (
    <header style={{ display: "flex", justifyContent: "space-between", padding: "0.75rem 1rem", borderBottom: "1px solid #ddd" }}>
      <strong>Management Bot Dashboard</strong>
      <span>{discordUserId}</span>
    </header>
  );
}
