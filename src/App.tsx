import { useCallback, useEffect, useState } from "react";
import type { ShopPublic } from "../shared/types";
import { CodeGate } from "./components/ui";
import { Display } from "./pages/Display";
import { Home } from "./pages/Home";
import { Kitchen } from "./pages/Kitchen";
import { MasterAdmin } from "./pages/MasterAdmin";
import { Register } from "./pages/Register";
import { ShopAdmin } from "./pages/ShopAdmin";
import { adminKey, api, codeKey, load, MASTER_KEY, save } from "./util";

/**
 * 合言葉・PIN を使う設定か。サーバーの設定（REQUIRE_AUTH）に従う。
 * 端末に覚えている値ですぐ表示し、裏でサーバーに確かめる。分からないとき（初回かつ電波なし）は使わない扱い。
 */
function useAuthRequired(): boolean | null {
  const cached = load<ShopPublic[]>("shops", []);
  const [required, setRequired] = useState<boolean | null>(cached.length ? cached.some((s) => s.authRequired) : null);
  useEffect(() => {
    api<ShopPublic[]>("/api/shops", null)
      .then((shops) => {
        save("shops", shops);
        setRequired(shops.some((s) => s.authRequired));
      })
      .catch(() => setRequired((r) => r ?? false));
  }, []);
  return required;
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

function cachedShop(shopId: string): ShopPublic | null {
  return load<ShopPublic[]>("shops", []).find((s) => s.id === shopId) ?? load<{ shop: ShopPublic } | null>(`snap:${shopId}`, null)?.shop ?? null;
}

function Loading() {
  return <div className="page"><main className="empty-state"><p>読み込んでいます…</p></main></div>;
}

function StaffScreen({ shopId, screen, auth }: { shopId: string; screen: "register" | "kitchen"; auth: boolean }) {
  const [stored, setCode, clear] = useStoredCode(codeKey(shopId));
  const code = auth ? stored : "";
  if (code == null) {
    return (
      <CodeGate
        shopId={shopId}
        shop={cachedShop(shopId)}
        title={screen === "register" ? "レジ" : "厨房"}
        label="お店の合言葉"
        minRole="staff"
        storageKey={codeKey(shopId)}
        onOk={setCode}
        devHint="合言葉は 1111"
      />
    );
  }
  return screen === "register" ? <Register shopId={shopId} code={code} onAuthError={clear} /> : <Kitchen shopId={shopId} code={code} onAuthError={clear} />;
}

function AdminScreen({ shopId, auth }: { shopId: string; auth: boolean }) {
  const [code, setCode, clear] = useStoredCode(adminKey(shopId));
  const master = localStorage.getItem(MASTER_KEY);
  const effective = auth ? code ?? master : "";
  if (effective == null) {
    return (
      <CodeGate
        shopId={shopId}
        shop={cachedShop(shopId)}
        title="管理"
        label="管理PIN（またはテック部の全体PIN）"
        minRole="admin"
        storageKey={adminKey(shopId)}
        onOk={setCode}
        devHint="管理PINは 9999、全体PINは 0000"
      />
    );
  }
  return <ShopAdmin shopId={shopId} code={effective} onAuthError={() => { clear(); if (!code) localStorage.removeItem(MASTER_KEY); location.reload(); }} />;
}

function MasterScreen({ auth }: { auth: boolean }) {
  const [stored, setCode, clear] = useStoredCode(MASTER_KEY);
  const code = auth ? stored : "";
  const shops = load<ShopPublic[]>("shops", []);
  if (code == null) {
    return (
      <CodeGate
        shopId={shops[0]?.id ?? "a"}
        shop={{ name: "テック部", color: "#374151", prefix: "T" }}
        title="全体の売上"
        label="テック部の全体PIN"
        devHint="全体PINは 0000"
        minRole="master"
        storageKey={MASTER_KEY}
        onOk={setCode}
      />
    );
  }
  return <MasterAdmin code={code} onAuthError={clear} />;
}

export function App() {
  const parts = location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const auth = useAuthRequired();
  const [shopId, screen] = parts;
  useEffect(() => {
    if (shopId && ["register", "kitchen", "display", "admin"].includes(screen)) save(LAST_SCREEN_KEY, { shopId, screen });
  }, [shopId, screen]);

  if (parts.length === 0) return <Home />;
  if (screen === "display") return <Display shopId={shopId} />;
  if (auth == null) return <Loading />;
  if (parts.length === 1 && parts[0] === "admin") return <MasterScreen auth={auth} />;
  if (screen === "register" || screen === "kitchen") return <StaffScreen key={`${shopId}/${screen}`} shopId={shopId} screen={screen} auth={auth} />;
  if (screen === "admin") return <AdminScreen shopId={shopId} auth={auth} />;
  return <Home />;
}
