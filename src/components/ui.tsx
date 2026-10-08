import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ShopPublic } from "../../shared/types";
import type { ConnStatus } from "../sync";
import { api, ApiError, buzz } from "../util";

/** 店舗の色のヘッダー。別の店舗の画面を操作する事故を防ぐため、店舗名を常に表示する。 */
export function ShopHeader({ shop, title, right }: { shop: Pick<ShopPublic, "name" | "color" | "prefix"> | null; title: string; right?: ReactNode }) {
  return (
    <header className="shop-header" style={{ background: shop?.color ?? "#334155" }}>
      <div className="shop-header__name">
        {shop?.prefix && <span className="shop-header__prefix" aria-hidden>{shop.prefix}</span>}
        <span>{shop?.name ?? "読み込み中"}</span>
        <span className="shop-header__title">{title}</span>
      </div>
      <div className="shop-header__right">{right}</div>
    </header>
  );
}

const STATUS_TEXT: Record<ConnStatus, string> = {
  connecting: "接続中…",
  online: "オンライン",
  offline: "オフライン",
  auth: "合言葉が変わりました",
};

export function ConnBadge({ status, pending }: { status: ConnStatus; pending: number }) {
  const label = status === "offline" && pending > 0 ? `オフライン・未送信 ${pending}件` : pending > 0 && status === "online" ? `送信中 ${pending}件` : STATUS_TEXT[status];
  return (
    <span className={`conn conn--${status}`} role="status" aria-live="polite">
      <span className="conn__dot" aria-hidden>{status === "online" ? "●" : status === "offline" ? "×" : "…"}</span>
      {label}
    </span>
  );
}

export function Btn({
  children, onClick, variant = "default", disabled, big, className = "", type = "button", ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "default" | "danger" | "ghost" | "ok";
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
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Notices({ notices, onDismiss }: { notices: { id: string; text: string; kind: "error" | "warn" }[]; onDismiss: (id: string) => void }) {
  if (!notices.length) return null;
  return (
    <div className="notices" role="alert">
      {notices.map((n) => (
        <div key={n.id} className={`notice notice--${n.kind}`}>
          <span><b>{n.kind === "error" ? "エラー" : "注意"}:</b> {n.text}</span>
          <Btn variant="ghost" onClick={() => onDismiss(n.id)}>閉じる</Btn>
        </div>
      ))}
    </div>
  );
}

/** 合言葉・PIN の入力。正しければ端末に保存する。 */
export function CodeGate({
  shopId, shop, label, minRole, onOk, storageKey, authPath,
}: {
  shopId?: string;
  shop: Pick<ShopPublic, "name" | "color" | "prefix"> | null;
  label: string;
  minRole: "staff" | "admin" | "master";
  storageKey: string;
  onOk: (code: string) => void;
  authPath?: string;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const path = authPath ?? `/api/shops/${encodeURIComponent(shopId!)}/auth`;
      const { role } = await api<{ role: string }>(path, null, { method: "POST", body: JSON.stringify({ code }) });
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
    <div className="page">
      <ShopHeader shop={shop} title="" />
      <main className="gate">
        <form
          className="gate__form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="code" className="gate__label">{label}</label>
          <input id="code" className="input input--big" type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          {error && <p className="error" role="alert">{error}</p>}
          <Btn type="submit" variant="primary" big disabled={!code || busy}>{busy ? "確認中…" : "はじめる"}</Btn>
          <p className="hint">一度入力すると、この端末では次から入力不要です。</p>
        </form>
      </main>
    </div>
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
