import { useCallback, useState } from "react";
import type { ShopPublic } from "../shared/types";
import { CodeGate } from "./components/ui";
import { Display } from "./pages/Display";
import { Home } from "./pages/Home";
import { Kitchen } from "./pages/Kitchen";
import { MasterAdmin } from "./pages/MasterAdmin";
import { Register } from "./pages/Register";
import { ShopAdmin } from "./pages/ShopAdmin";
import { adminKey, codeKey, load, MASTER_KEY } from "./util";

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

function StaffScreen({ shopId, screen }: { shopId: string; screen: "register" | "kitchen" }) {
  const [code, setCode, clear] = useStoredCode(codeKey(shopId));
  if (!code) {
    return <CodeGate shopId={shopId} shop={cachedShop(shopId)} label="お店の合言葉を入力してください" minRole="staff" storageKey={codeKey(shopId)} onOk={setCode} />;
  }
  return screen === "register" ? <Register shopId={shopId} code={code} onAuthError={clear} /> : <Kitchen shopId={shopId} code={code} onAuthError={clear} />;
}

function AdminScreen({ shopId }: { shopId: string }) {
  const [code, setCode, clear] = useStoredCode(adminKey(shopId));
  const master = localStorage.getItem(MASTER_KEY);
  const effective = code ?? master;
  if (!effective) {
    return <CodeGate shopId={shopId} shop={cachedShop(shopId)} label="管理PIN（またはテック部の全体PIN）を入力してください" minRole="admin" storageKey={adminKey(shopId)} onOk={setCode} />;
  }
  return <ShopAdmin shopId={shopId} code={effective} onAuthError={() => { clear(); if (!code) localStorage.removeItem(MASTER_KEY); location.reload(); }} />;
}

function MasterScreen() {
  const [code, setCode, clear] = useStoredCode(MASTER_KEY);
  const shops = load<ShopPublic[]>("shops", []);
  if (!code) {
    return (
      <CodeGate
        shopId={shops[0]?.id ?? "a"}
        shop={{ name: "テック部", color: "#0f172a", prefix: "" }}
        label="テック部の全体PINを入力してください"
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
  if (parts.length === 0) return <Home />;
  if (parts.length === 1 && parts[0] === "admin") return <MasterScreen />;
  const [shopId, screen] = parts;
  if (screen === "register" || screen === "kitchen") return <StaffScreen key={`${shopId}/${screen}`} shopId={shopId} screen={screen} />;
  if (screen === "display") return <Display shopId={shopId} />;
  if (screen === "admin") return <AdminScreen shopId={shopId} />;
  return <Home />;
}
