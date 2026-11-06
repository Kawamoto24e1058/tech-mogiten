import { createRoot } from "react-dom/client";
import { App } from "./App";
import { captureInstallPrompt } from "./install";
import { load } from "./util";
import "./styles.css";

captureInstallPrompt();

// 書体（IBM Plex Sans JP）。定義が大きいので最初の表示を待たせないよう後から読み込む。届くまでは端末の標準の書体で出る
void import("./fonts");

// ホーム画面のアイコンから開いたときは、前回の担当の画面へそのまま進む（トップは左上の戻るで出せる）
const params = new URLSearchParams(location.search);
// 見た目の案（比べる用）。?look=ticket / pop / yatai で切り替え、端末に覚える。?look=none で元に戻す
{
  const look = params.get("look");
  try { if (look) look === "none" ? localStorage.removeItem("look") : localStorage.setItem("look", look); } catch { /* 保存できなくても表示はできる */ }
  let saved: string | null = null;
  try { saved = localStorage.getItem("look"); } catch { /* 同上 */ }
  if (saved) document.documentElement.dataset.look = saved;
}
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
