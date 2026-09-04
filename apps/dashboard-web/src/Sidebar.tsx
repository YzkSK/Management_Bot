import { FEATURE_METADATA } from "@management-bot/shared";
import { NavLink } from "react-router-dom";

/** ページ実装済みの機能のみここに登録する(未実装の機能はリンクにしない)。 */
const FEATURE_PATHS: Record<string, (guildId: string) => string> = {
  logging: (guildId) => `/guilds/${guildId}/logs`,
};

interface SidebarProps {
  guildId?: string;
}

export function Sidebar({ guildId }: SidebarProps) {
  return (
    <nav aria-label="機能メニュー">
      <ul>
        {FEATURE_METADATA.map((feature) => {
          const buildPath = FEATURE_PATHS[feature.key];
          const path = guildId && buildPath ? buildPath(guildId) : undefined;
          return <li key={feature.key}>{path ? <NavLink to={path}>{feature.name}</NavLink> : feature.name}</li>;
        })}
      </ul>
    </nav>
  );
}
