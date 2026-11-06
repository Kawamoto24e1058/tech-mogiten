import { useEffect, useState } from "react";
import type { ShopPublic } from "../../shared/types";
import { Banner, Page } from "../components/ui";
import { keyFromText, rememberShop } from "../myshops";
import { adminKey, api, codeKey } from "../util";

/** 共有リンク（/店舗ID/join#k=キー）を開いたとき。キーをこの端末に覚えてトップへ */
export function Join({ shopId }: { shopId: string }) {
  const [error, setError] = useState("");
  useEffect(() => {
    const key = keyFromText(location.hash);
    // アドレスバーや履歴にキーを残さない
    history.replaceState(null, "", location.pathname);
    (async () => {
      try {
        if (!key) throw new Error("リンクが途中で切れています。もう一度、リンク全体を開いてください");
        const { role } = await api<{ role: string }>(`/api/shops/${encodeURIComponent(shopId)}/auth`, null, { method: "POST", body: JSON.stringify({ code: key }) });
        if (role === "admin" || role === "master") localStorage.setItem(adminKey(shopId), key);
        else localStorage.setItem(codeKey(shopId), key);
        rememberShop(await api<ShopPublic>(`/api/shops/${encodeURIComponent(shopId)}/public`, null));
        location.replace("/?joined=" + encodeURIComponent(shopId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "開けませんでした");
      }
    })();
  }, [shopId]);
  return (
    <Page shop={null} className="page--center">
      <main className="gate">
        {error ? (
          <>
            <Banner kind="error">{error}</Banner>
            <p className="hint">リンクが作り直された場合は、店舗の代表者に新しいリンクをもらってください。</p>
            <a className="btn" href="/">トップに戻る</a>
          </>
        ) : <p>店舗を開いています…</p>}
      </main>
    </Page>
  );
}
