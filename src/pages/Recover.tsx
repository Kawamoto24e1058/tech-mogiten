import { useState } from "react";
import type { ShopPublic } from "../../shared/types";
import { Banner, Btn, Page } from "../components/ui";
import { RecoveryCodeBox } from "../components/ShareLinks";
import { rememberShop } from "../myshops";
import { adminKey, api } from "../util";

/** 管理用リンクをなくしたとき。店舗のリンク（どれでも）と復旧コードで、新しい管理用リンクを出す */
export function Recover() {
  const [link, setLink] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ id: string; shop: ShopPublic; recoveryCode: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const shopIdOf = (t: string) => {
    const s = t.trim();
    const m = /\/([a-z0-9]{1,16})\/(?:join|display|register|kitchen|admin|setup|report)\b/.exec(s);
    if (m) return m[1];
    return /^[a-z0-9]{1,16}$/.test(s) ? s : null;
  };

  const submit = async () => {
    setError("");
    const id = shopIdOf(link);
    if (!id) {
      setError("店舗のリンク（部員用リンク・呼び出し表示のURLなど）を貼り付けてください");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ adminKey: string; recoveryCode: string; shop: ShopPublic }>(`/api/shops/${encodeURIComponent(id)}/recover`, null, { method: "POST", body: JSON.stringify({ code }) });
      localStorage.setItem(adminKey(id), r.adminKey);
      rememberShop(r.shop);
      setDone({ id, shop: r.shop, recoveryCode: r.recoveryCode });
    } catch (e) {
      setError(e instanceof Error ? e.message : "できませんでした");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Page shop={done.shop} className="page--center">
        <main className="gate gate--wide">
          <h1 className="gate__title">管理できるようになりました</h1>
          <Banner kind="ok">「{done.shop.name}」の新しい管理用リンクを、この端末に入れました。前の管理用リンクと、いま使った復旧コードは使えなくなりました。</Banner>
          <RecoveryCodeBox code={done.recoveryCode} shopName={done.shop.name} onSaved={setSaved} />
          <a className={`btn btn--accent btn--big ${saved ? "" : "is-disabled"}`} href={saved ? `/${done.id}/admin` : undefined} aria-disabled={!saved}>
            {saved ? "管理画面を開く" : "新しい復旧コードを保存してください"}
          </a>
          <p className="hint">ほかの端末でも管理したいときは、管理画面の「設定 → 共有リンク」から新しい管理用リンクを送ってください。</p>
        </main>
      </Page>
    );
  }

  return (
    <Page shop={null} className="page--center">
      <form className="gate gate--wide" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h1 className="gate__title">管理用リンクの再発行</h1>
        <p className="hint">管理用リンクをなくしたときに使います。店舗をつくったときに保存した「復旧コード」が必要です。</p>
        <label className="field">店舗のリンク<small className="muted">部員用リンク・呼び出し表示のURLなど、その店舗のリンクならどれでも</small>
          <input className="input" value={link} onChange={(e) => setLink(e.target.value)} autoFocus />
        </label>
        <label className="field">復旧コード<small className="muted">例: ABCD-2345-EFGH-6789</small>
          <input className="input recovery__input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" />
        </label>
        {error && <Banner kind="error">{error}</Banner>}
        <Btn type="submit" variant="accent" big disabled={!link.trim() || code.replace(/[^0-9A-Z]/gi, "").length < 16 || busy}>{busy ? "確認しています…" : "新しい管理用リンクを出す"}</Btn>
        <p className="hint">復旧コードもない場合は、管理用リンクを開いている別の端末（ほかの代表者など）の「設定 → 共有リンク」から送ってもらってください。どちらもない場合は、店舗の管理はできません（180日使わないと自動で削除されます）。</p>
        <a className="gate__home" href="/">トップに戻る</a>
      </form>
    </Page>
  );
}
