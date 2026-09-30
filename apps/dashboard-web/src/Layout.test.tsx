import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./Layout.js";

// Viteのdefineで注入される定数(Footer)。bun testでは注入されないため定義する。
Object.assign(globalThis, { __APP_VERSION__: "0.0.0-test" });

function renderAt(path: string): string {
  const layout = <Layout discordUsername="user" avatarUrl={null} onLogout={() => {}} showStatus={false} />;
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={layout} />
          <Route path="/guilds/:guildId" element={layout}>
            <Route path="logs" element={null} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Layout", () => {
  test("サーバー選択画面ではサイドバーを出さない(issue #527)", () => {
    expect(renderAt("/")).not.toContain('aria-label="サーバーを選択"');
  });

  test("サーバー選択後の画面ではサイドバーを出す", () => {
    expect(renderAt("/guilds/g1/logs")).toContain('aria-label="サーバーを選択"');
  });
});
