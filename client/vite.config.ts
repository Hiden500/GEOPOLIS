import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared/src")
    },
  },

  server: {
    proxy: {
      // Регэксп с границей пути (/$ или /), а не префикс — иначе "/game"
      // матчит и статику вроде /game_map.json, отправляя её на Express,
      // где такого роута нет (404 "Cannot GET").
      "^/game($|/)": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "^/scenarios($|/)": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "^/budget($|/)": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "^/research($|/)": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "^/actions($|/)": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});