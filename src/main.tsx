import { createRoot } from "react-dom/client";
import { App } from "./App";
import { captureInstallPrompt } from "./install";
import { load } from "./util";
import "./styles.css";

captureInstallPrompt();

// ホーム画面のアイコンから開いたときは、前回の担当の画面へそのまま進む（トップは左上の戻るで出せる）
const params = new URLSearchParams(location.search);
const last = load<{ shopId: string; screen: string } | null>("lastScreen", null);
if (location.pathname === "/" && params.has("app") && last && ["register", "kitchen", "display", "admin"].includes(last.screen)) {
  location.replace(`/${encodeURIComponent(last.shopId)}/${last.screen}`);
} else {
  createRoot(document.getElementById("root")!).render(<App />);
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 登録できなくてもオンラインでは動く
    });
  });
}
