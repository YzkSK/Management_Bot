import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  discordUsername: string;
  onLogout: () => void;
}

export function Header({ discordUsername, onLogout }: HeaderProps) {
  return (
    <header className="flex items-center justify-between border-b px-4 py-3">
      <Link to="/" className="text-sm font-semibold hover:underline">
        Management Bot Dashboard
      </Link>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground text-sm">{discordUsername}</span>
        <Button variant="outline" size="sm" onClick={onLogout}>
          ログアウト
        </Button>
      </div>
    </header>
  );
}
