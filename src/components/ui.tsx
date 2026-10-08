import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ShopPublic } from "../../shared/types";
import type { ConnStatus } from "../sync";
import { api, ApiError, buzz } from "../util";
import { IconAlert, IconBack, IconCheck, IconClose, IconInfo, IconOffline } from "./icons";

type ShopLook = Pick<ShopPublic, "name" | "color" | "prefix">;

/** 背景色の上で読みやすい文字色（白か黒）を選ぶ。管理画面で好きな色を選んでも読めるように。 */
export function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return (1.05) / (L + 0.05) >= 4.5 ? "#fff" : "#111827";
}

export function accentStyle(color: string | undefined): CSSProperties {
  const c = color ?? "#374151";
  // color-mix() を使う派生色は、--accent を変えた要素で定義し直さないと親の色のままになるため、ここでまとめて渡す
  return {
    "--accent": c,
    "--on-accent": readableOn(c),
    "--accent-soft": `color-mix(in srgb, ${c} 8%, white)`,
    "--accent-ring": `color-mix(in srgb, ${c} 35%, transparent)`,
  } as CSSProperties;
}

/** 金額。数字を大きく、「円」を小さく表示する。 */
export function Money({ value, className = "" }: { value: number; className?: string }) {
  return (
    <span className={`money ${className}`}>
      <span className="money__num">{value.toLocaleString("ja-JP")}</span>
      <span className="money__unit">円</span>
    </span>
  );
}

/** 画面全体の枠。店舗の色を --accent として子要素に渡す。 */
export function Page({ shop, children, className = "" }: { shop: ShopLook | null; children: ReactNode; className?: string }) {
  return (
    <div className={`page ${className}`} style={accentStyle(shop?.color)}>
      {children}
    </div>
  );
}

export function ShopBadge({ shop, size = "md" }: { shop: ShopLook | null; size?: "md" | "lg" }) {
  return (
    <span className={`shop-badge shop-badge--${size}`} aria-hidden>
      {shop?.prefix || shop?.name.slice(0, 1) || "・"}
    </span>
  );
}

/** 店舗の色のヘッダー。別の店舗の画面を操作する事故を防ぐため、店舗名を常に表示する。 */
export function AppBar({ shop, title, right, back }: { shop: ShopLook | null; title: string; right?: ReactNode; back?: string }) {
  return (
    <header className="appbar">
      <div className="appbar__left">
        {back && <a className="appbar__back" href={back} aria-label="トップに戻る"><IconBack size={22} /></a>}
        <ShopBadge shop={shop} />
        <div className="appbar__titles">
          <span className="appbar__shop">{shop?.name ?? "読み込み中"}</span>
          {title && <span className="appbar__title">{title}</span>}
        </div>
      </div>
      <div className="appbar__right">{right}</div>
    </header>
  );
}

/** 接続状態。オンラインのときは目立たせず、問題があるときだけ目立たせる。 */
export function ConnBadge({ status, pending }: { status: ConnStatus; pending: number }) {
  if (status === "online" && pending === 0) {
    return (
      <span className="conn conn--online" role="status">
        <span className="conn__dot" aria-hidden /><span className="conn__text">オンライン</span>
      </span>
    );
  }
  const label =
    status === "offline" ? (pending > 0 ? `オフライン・未送信${pending}件` : "オフライン")
    : status === "auth" ? "合言葉が変わりました"
    : status === "connecting" ? "接続中…"
    : `送信中 ${pending}件`;
  return (
    <span className={`conn conn--${status}`} role="status" aria-live="polite">
      {status === "offline" ? <IconOffline size={16} /> : <span className="conn__spinner" aria-hidden />}
      {label}
    </span>
  );
}

export function Btn({
  children, onClick, variant = "default", disabled, big, className = "", type = "button", ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "default" | "danger" | "ghost" | "ok" | "accent";
  disabled?: boolean;
  big?: boolean;
  className?: string;
  type?: "button" | "submit";
  ariaLabel?: string;
}) {
  return (
    <button
      type={type}
      aria-label={ariaLabel}
      className={`btn btn--${variant} ${big ? "btn--big" : ""} ${className}`}
      disabled={disabled}
      onClick={() => {
        buzz();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose は描き直すたびに新しい関数になるので、最新のものを ref で持つ。
  // 依存に入れると、文字を打つたびにフォーカスが入力欄から外れてしまう。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    // 開いたときに1回だけ。入力欄が autoFocus で選ばれていれば、そのままにする
    if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2 className="modal__title">{title}</h2>
          <button className="modal__close" onClick={onClose} aria-label="閉じる"><IconClose size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Banner({ kind, children, action }: { kind: "warn" | "error" | "ok" | "info"; children: ReactNode; action?: ReactNode }) {
  const icon = { warn: <IconAlert size={18} />, error: <IconAlert size={18} />, ok: <IconCheck size={18} />, info: <IconInfo size={18} /> }[kind];
  return (
    <div className={`banner banner--${kind}`} role={kind === "error" || kind === "warn" ? "alert" : "status"}>
      <span className="banner__icon">{icon}</span>
      <div className="banner__body">{children}</div>
      {action}
    </div>
  );
}

export function Notices({ notices, onDismiss }: { notices: { id: string; text: string; kind: "error" | "warn" }[]; onDismiss: (id: string) => void }) {
  if (!notices.length) return null;
  return (
    <div className="notices">
      {notices.map((n) => (
        <Banner key={n.id} kind={n.kind} action={<button className="link banner__action" onClick={() => onDismiss(n.id)}>閉じる</button>}>
          {n.text}
        </Banner>
      ))}
    </div>
  );
}

/** 合言葉・PIN の入力。正しければ端末に保存する。 */
export function CodeGate({
  shopId, shop, title, label, minRole, onOk, storageKey, devHint,
}: {
  shopId: string;
  shop: ShopLook | null;
  title: string;
  label: string;
  minRole: "staff" | "admin" | "master";
  storageKey: string;
  onOk: (code: string) => void;
  devHint?: string;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // この端末で初めて開いたときは店舗の色と名前がまだないので、取りに行く
  const [fetched, setFetched] = useState<ShopLook | null>(null);
  useEffect(() => {
    if (shop) return;
    api<ShopPublic>(`/api/shops/${encodeURIComponent(shopId)}/public`, null).then(setFetched).catch(() => {});
  }, [shop, shopId]);
  const look = shop ?? fetched;
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const { role } = await api<{ role: string }>(`/api/shops/${encodeURIComponent(shopId)}/auth`, null, { method: "POST", body: JSON.stringify({ code }) });
      const rank = { staff: 1, admin: 2, master: 3 } as Record<string, number>;
      if (rank[role] < rank[minRole]) {
        setError(minRole === "admin" ? "これはレジ・厨房用の合言葉です。管理PINを入力してください" : "権限が足りません");
      } else {
        localStorage.setItem(storageKey, code);
        onOk(code);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "エラーが起きました");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page shop={look} className="page--center">
      <form
        className="gate"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <ShopBadge shop={look} size="lg" />
        <div className="gate__shop">{look?.name}</div>
        <h1 className="gate__title">{title}</h1>
        <label htmlFor="code" className="gate__label">{label}</label>
        <input id="code" className="input input--big" type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        {error && <p className="error" role="alert">{error}</p>}
        <Btn type="submit" variant="accent" big disabled={!code || busy}>{busy ? "確認中…" : "はじめる"}</Btn>
        <p className="hint">この端末では、次から入力不要です。</p>
        {import.meta.env.DEV && devHint && <p className="dev-hint">開発用: {devHint}</p>}
        <a className="gate__home" href="/">トップに戻る</a>
      </form>
    </Page>
  );
}

export function useWakeLock(active = true) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // 電池残量が少ないときなどは失敗するが、動作には影響しない
      }
    };
    const onVisible = () => document.visibilityState === "visible" && void request();
    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [active]);
}

export function useNow(intervalMs = 15000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useIsWide(minWidth = 900) {
  const q = `(min-width: ${minWidth}px)`;
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return wide;
}
