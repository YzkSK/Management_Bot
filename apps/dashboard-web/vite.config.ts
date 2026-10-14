import { getThemeInitScript } from "@starwind-ui/react/theme";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// リポジトリルートのpackage.jsonのversionをビルド時定数としてクライアントへ埋め込む(フッター表示用)。
const { version } = createRequire(import.meta.url)("../../package.json");

function starwindThemeInitPlugin() {
  return {
    name: "starwind-theme-init",
    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { "data-starwind-theme-init": "" },
          children: getThemeInitScript(),
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [starwindThemeInitPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
});
