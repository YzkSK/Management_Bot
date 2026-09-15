import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { applyTheme, getStoredTheme } from "./theme.js";
import { queryClient } from "./trpc.js";
import "./index.css";

// 描画前に適用し、ダークモード設定時に一瞬ライト表示になるちらつき(FOUC)を防ぐ。
applyTheme(getStoredTheme());

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
