import { useState } from "react";
import type { ShopPublic } from "../../shared/types";
import { Banner, Btn, Page } from "../components/ui";
import { PasswordInput } from "../components/PasswordInput";
import { RecoveryCodeBox } from "../components/ShareLinks";
import { SiteHeader } from "../components/SiteHeader";
import { rememberShop } from "../myshops";
import { adminKey, api, ApiError } from "../util";

/**
 * 管理画面に入れなくなったとき。店舗のリンク（どれでも）と管理用パスワードで入る。
 * 管理用パスワードがない前からの店舗は、復旧コードで入る（新しい復旧コードを出す）
 */
export function Recover() {
  const [link, setLink] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [legacy, setLegacy] = useState<{ id: string; shop: ShopPublic; recoveryCode: string } | null>(null);
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
      const r = await api<{ adminKey: string; shop: ShopPublic }>(`/api/shops/${encodeURIComponent(id)}/login`, null, { method: "POST", body: JSON.stringify({ password: secret }) });
      localStorage.setItem(adminKey(id), r.adminKey);
      rememberShop(r.shop);
      location.href = `/${id}/admin`;
      return;
    } catch (e) {
      // 管理用パスワードがない（前からの）店舗は、入れたものを復旧コードとして試す
      if (!(e instanceof ApiError && e.status === 400)) {
        setError(e instanceof Error ? e.message : "できませんでした");
        setBusy(false);
        return;
      }
    }
    try {
      const r = await api<{ adminKey: string; recoveryCode: string; shop: ShopPublic }>(`/api/shops/${encodeURIComponent(id)}/recover`, null, { method: "POST", body: JSON.stringify({ code: secret }) });
      localStorage.setItem(adminKey(id), r.adminKey);
      rememberShop(r.shop);
      setLegacy({ id, shop: r.shop, recoveryCode: r.recoveryCode });
    } catch (e) {
      setError(e instanceof Error ? e.message : "できませんでした");
    } finally {
      setBusy(false);
    }
  };

  if (legacy) {
    return (
      <Page shop={legacy.shop} className="page--center">
        <main className="gate gate--wide">
          <h1 className="gate__title">管理できるようになりました</h1>
          <Banner kind="ok">「{legacy.shop.name}」の新しい管理用リンクを、この端末に入れました。前の管理用リンクと、いま使った復旧コードは使えなくなりました。</Banner>
          <p className="hint">次からは、管理画面の「設定 → 管理用パスワード」でパスワードを決めておくと、復旧コードはいらなくなります。</p>
          <RecoveryCodeBox code={legacy.recoveryCode} shopName={legacy.shop.name} onSaved={setSaved} />
          <a className={`btn btn--accent btn--big ${saved ? "" : "is-disabled"}`} href={saved ? `/${legacy.id}/admin` : undefined} aria-disabled={!saved}>
            {saved ? "管理画面を開く" : "新しい復旧コードを保存してください"}
          </a>
        </main>
      </Page>
    );
  }

  return (
    <div className="page page--grid">
      <SiteHeader />
      <main className="recover">
        <form className="recover__form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <h1 className="recover__title">管理画面に入れなくなったとき</h1>
          <p className="hint">管理用リンクをなくした・端末を変えたときは、店舗のリンクと<b>管理用パスワード</b>で入り直せます。</p>
          <div className="qs">
            <div className="q">
              <div className="q__head"><span className="q__no" aria-hidden>1</span><label className="q__label" htmlFor="rc-link">店舗のリンク</label></div>
              <p className="q__help">部員用リンク・呼び出し表示のURLなど、その店舗のリンクならどれでも大丈夫です（部員の LINE グループに送ったものなど）。</p>
              <input id="rc-link" className="input q__input" value={link} onChange={(e) => setLink(e.target.value)} autoFocus placeholder="https://…" />
            </div>
            <div className="q">
              <div className="q__head"><span className="q__no" aria-hidden>2</span><label className="q__label" htmlFor="rc-pass">管理用パスワード</label></div>
              <p className="q__help">店舗をつくったときに決めたパスワードです。パスワードを決める前からある店舗は、復旧コード（例: ABCD-2345-EFGH-6789）を入れてください。</p>
              <PasswordInput id="rc-pass" value={secret} onChange={setSecret} autoComplete="current-password" />
            </div>
          </div>
          {error && <Banner kind="error">{error}</Banner>}
          <Btn type="submit" variant="accent" big disabled={!link.trim() || secret.length < 8 || busy}>{busy ? "確認しています…" : "管理画面に入る"}</Btn>
          <p className="hint">パスワードも忘れたときは、管理画面を開いている別の端末（ほかの代表者など）の「設定 → リンク」から管理用リンクを送ってもらってください。どれもない場合は、その店舗は管理できません（レジ・厨房はそのまま使えます。180日使わないと自動で削除されます）。</p>
        </form>
      </main>
    </div>
  );
}
