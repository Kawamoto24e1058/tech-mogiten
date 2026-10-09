/**
 * ホーム画面への追加（PWA のインストール）。
 * Chrome・Edge（Android・PC）は beforeinstallprompt で追加の確認を出せる。
 * iPhone・iPad の Safari には仕組みがないので、共有メニューからの手順を案内する。
 */
type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: PromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

/** 画面の表示より前に呼ぶ（イベントは読み込み直後に1回だけ来る） */
export function captureInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as PromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export function onInstallChange(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

export const canPromptInstall = () => deferred != null;

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  notify();
  return outcome === "accepted";
}

/** すでにホーム画面のアプリとして開いているか */
export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
