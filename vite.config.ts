import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// cloudflare() で Worker と Durable Object も Vite の中で動かす。
// `npm run dev` だけで画面（自動リロード付き）と API の両方が http://localhost:5173 で動く。
export default defineConfig({
  plugins: [react(), cloudflare()],
  server: { host: true },
});
