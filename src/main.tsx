import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
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
