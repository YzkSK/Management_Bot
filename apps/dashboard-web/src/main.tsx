import "./styles/starwind.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { applyTheme, followSystemTheme, getStoredTheme, migrateLegacyThemeKey } from "./theme.js";
import { queryClient } from "./trpc.js";

// 描画前に適用し、ダークモード設定時に一瞬ライト表示になるちらつき(FOUC)を防ぐ。
migrateLegacyThemeKey();
applyTheme(getStoredTheme());
followSystemTheme();

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root element not found");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
