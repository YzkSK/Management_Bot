import { FEATURE_METADATA } from "@management-bot/shared";

export function Sidebar() {
  return (
    <nav aria-label="機能メニュー">
      <ul>
        {FEATURE_METADATA.map((feature) => (
          <li key={feature.key}>{feature.name}</li>
        ))}
      </ul>
    </nav>
  );
}
