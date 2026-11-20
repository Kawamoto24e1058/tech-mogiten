import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// cloudflare() で Worker と Durable Object も Vite の中で動かす。
// `npm run dev` だけで画面（自動リロード付き）と API の両方が http://localhost:5173 で動く。
export default defineConfig({
  // テック部版（CLOUDFLARE_ENV=club）は、ローカルの保存場所を分ける（今の公開版と同時に動かして引っ越しを試せるように）
  plugins: [react(), cloudflare(process.env.CLOUDFLARE_ENV === "club" ? { persistState: { path: ".wrangler/state-club" }, inspectorPort: 9230 } : {})],
  server: { host: true },
  // 書体ファイルは data: に埋め込まない（CSP の font-src は self だけ許可している）
  build: { assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined) },
});
