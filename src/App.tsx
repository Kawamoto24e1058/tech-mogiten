import { useCallback, useEffect, useState } from "react";
import type { ShopPublic } from "../shared/types";
import { CodeGate } from "./components/ui";
import { CreateShop } from "./pages/CreateShop";
import { Display } from "./pages/Display";
import { Home } from "./pages/Home";
import { Join } from "./pages/Join";
import { Kitchen } from "./pages/Kitchen";
import { MasterAdmin } from "./pages/MasterAdmin";
import { Register } from "./pages/Register";
import { ShopAdmin } from "./pages/ShopAdmin";
import { Setup } from "./pages/Setup";
import { forgetShop, rememberShop } from "./myshops";
import { adminKey, api, ApiError, codeKey, load, save } from "./util";

/**
 * 店舗の情報（名前・色・リンクで保護しているか）。端末に覚えている値ですぐ表示し、裏でサーバーに確かめる。
 * 店舗ごとに「保護しているか」が違う（「店舗をつくる」で作った店舗はリンクで保護。以前からある店舗は「保護する」を押すまで誰でも開ける）
 */
function useShopInfo(shopId: string) {
  const cacheKey = `shop:${shopId}`;
  const [info, setInfo] = useState<ShopPublic | null>(() => load<ShopPublic | null>(cacheKey, null));
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    api<ShopPublic>(`/api/shops/${encodeURIComponent(shopId)}/public`, null)
      .then((s) => { save(cacheKey, s); setInfo(s); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) {
          // 削除された店舗は、この端末の一覧と「前回の続き」からも外す
          forgetShop(shopId);
          if (load<{ shopId: string } | null>(LAST_SCREEN_KEY, null)?.shopId === shopId) localStorage.removeItem(LAST_SCREEN_KEY);
          localStorage.removeItem(cacheKey);
          setMissing(true);
        }
      });
  }, [shopId, cacheKey]);
  return { info, missing };
}

/** 最後に開いた画面。トップの「続きから」に出す */
export const LAST_SCREEN_KEY = "lastScreen";

function useStoredCode(key: string) {
  const [code, setCode] = useState<string | null>(() => localStorage.getItem(key));
  const clear = useCallback(() => {
    localStorage.removeItem(key);
    setCode(null);
  }, [key]);
  return [code, setCode, clear] as const;
}

function Loading() {
  return <div className="page"><main className="empty-state"><p>読み込んでいます…</p></main></div>;
}

function NotFound() {
  return (
    <div className="page page--center">
      <main className="gate">
        <h1 className="gate__title">店舗が見つかりません</h1>
        <p className="hint">リンクが正しいか確かめてください。店舗の代表者に、もう一度リンクを送ってもらうと確実です。</p>
        <a className="btn" href="/">トップに戻る</a>
      </main>
    </div>
  );
}

function StaffScreen({ shop, screen }: { shop: ShopPublic; screen: "register" | "kitchen" }) {
  const [stored, setCode, clear] = useStoredCode(codeKey(shop.id));
  // 管理用リンクを開いた端末は、レジ・厨房もそのまま使える
  const code = shop.authRequired ? stored ?? localStorage.getItem(adminKey(shop.id)) : "";
  if (code == null) {
    return (
      <CodeGate
        shopId={shop.id}
        shop={shop}
        title={screen === "register" ? "レジ" : "厨房"}
        label="部員用リンクを貼り付け（または、そのリンクをこの端末で開く）"
        minRole="staff"
        storageKey={codeKey(shop.id)}
        onOk={setCode}
        devHint="デモの店舗は 1111"
      />
    );
  }
  return screen === "register" ? <Register shopId={shop.id} code={code} onAuthError={clear} /> : <Kitchen shopId={shop.id} code={code} onAuthError={clear} />;
}

function AdminScreen({ shop, setup }: { shop: ShopPublic; setup?: boolean }) {
  const [code, setCode, clear] = useStoredCode(adminKey(shop.id));
  const effective = shop.authRequired ? code : "";
  if (effective == null) {
    return (
      <CodeGate
        shopId={shop.id}
        shop={shop}
        title="管理"
        label="管理用リンクを貼り付け（または、そのリンクをこの端末で開く）"
        minRole="admin"
        storageKey={adminKey(shop.id)}
        onOk={setCode}
        devHint="デモの店舗は 9999"
      />
    );
  }
  if (setup) return <Setup shopId={shop.id} code={effective} />;
  return <ShopAdmin shopId={shop.id} code={effective} onAuthError={() => { clear(); location.reload(); }} />;
}

function ShopRoute({ shopId, screen }: { shopId: string; screen: string }) {
  const { info, missing } = useShopInfo(shopId);
  useEffect(() => {
    if (info && ["register", "kitchen", "admin"].includes(screen)) rememberShop(info);
  }, [info, screen]);
  if (missing) return <NotFound />;
  if (!info) return <Loading />;
  if (screen === "register" || screen === "kitchen") return <StaffScreen key={`${shopId}/${screen}`} shop={info} screen={screen} />;
  if (screen === "admin") return <AdminScreen shop={info} />;
  if (screen === "setup") return <AdminScreen shop={info} setup />;
  return <Home />;
}

export function App() {
  const parts = location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [shopId, screen] = parts;
  useEffect(() => {
    if (shopId && ["register", "kitchen", "display", "admin"].includes(screen)) save(LAST_SCREEN_KEY, { shopId, screen });
  }, [shopId, screen]);

  if (parts.length === 0) return <Home />;
  if (parts.length === 1 && parts[0] === "new") return <CreateShop />;
  if (parts.length === 1 && parts[0] === "admin") return <MasterAdmin />;
  if (screen === "display") return <Display shopId={shopId} />;
  if (screen === "join") return <Join shopId={shopId} />;
  if (screen) return <ShopRoute shopId={shopId} screen={screen} />;
  return <Home />;
}
