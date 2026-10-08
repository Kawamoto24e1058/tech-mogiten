import { createRoot } from "react-dom/client";
import "@fontsource/dela-gothic-one/400.css";
import "@fontsource/zen-kaku-gothic-new/400.css";
import "@fontsource/zen-kaku-gothic-new/900.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/800.css";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 登録できなくてもオンラインでは動く
    });
  });
}
