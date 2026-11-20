import { useState } from "react";
import type { ShopPublic } from "../../shared/types";
import { Banner, Btn } from "../components/ui";
import { SiteHeader } from "../components/SiteHeader";
import { LinkRow } from "../components/ShareLinks";
import { joinLink, rememberShop } from "../myshops";
import { adminKey, api, codeKey } from "../util";

interface Moved { id: string; adminKey: string; staffKey: string | null; orders: number; menu: number; days: string[]; shop: ShopPublic }

/**
 * テック部版: 今の公開版（前のURL）から、店舗のデータを丸ごと引っ越す。
 * 前のURLの「管理用リンク」を貼るだけ。店舗ID・部員用リンク・管理用リンクの鍵はそのまま使える
 */
export function Move() {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Moved | null>(null);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api<Moved>("/api/move", null, { method: "POST", body: JSON.stringify({ link }) });
      localStorage.setItem(adminKey(r.id), r.adminKey);
      if (r.staffKey) localStorage.setItem(codeKey(r.id), r.staffKey);
      rememberShop(r.shop);
      setDone(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "引っ越せませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page--grid">
      <SiteHeader cta={false} />
      <main className="recover">
        {done ? (
          <div className="recover__form">
            <h1 className="recover__title">「{done.shop.name}」を引っ越しました</h1>
            <Banner kind="ok">注文 {done.orders} 件（{done.days.length} 日分）・商品 {done.menu} 品・割引・設定を、この新しいURLに移しました。前のURLのデータはそのまま残っています。</Banner>
            <p className="hint">部員用リンクの鍵は前と同じです。部員には、下の<b>新しい部員用リンク</b>を送り直して、一度開いてもらってください（前のリンクを開くと、前のURLのままになります）。</p>
            <div className="link-rows">
              {done.staffKey && <LinkRow who="部員みんなへ送る" title="新しい部員用リンク" note="このURLで、レジと厨房が使えるようになります。" url={joinLink(done.id, done.staffKey)} />}
              <LinkRow who="代表者だけ・送らない" tone="private" title="新しい管理用リンク" note="ほかの代表者の端末で開いてください。" url={joinLink(done.id, done.adminKey)} />
            </div>
            <Banner kind="warn">管理用パスワードは引っ越せません。管理画面の「設定 → 管理用パスワード」で、もう一度決めてください。</Banner>
            <p className="hint">前のURLで営業を続けて注文が増えたら、もう一度同じ管理用リンクで引っ越すと、新しい内容で上書きされます（この新しいURLで受けた注文は消えるので注意）。</p>
            <a className="btn btn--accent btn--big" href={`/${done.id}/admin`}>管理画面を開く</a>
          </div>
        ) : (
          <form className="recover__form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <p className="eyebrow">Tech club edition</p>
            <h1 className="recover__title">前のURLから引っ越す</h1>
            <p className="hint">今まで使っていたURL（tech-mogiten.momotech.workers.dev）の店舗を、メニュー・全日の注文と売上・締め・割引・設定ごと、このテック部版に移します。店舗ごとに1回ずつ行ってください。</p>
            <div className="qs">
              <div className="q">
                <div className="q__head"><span className="q__no" aria-hidden>1</span><label className="q__label" htmlFor="mv-link">前のURLの「管理用リンク」</label></div>
                <p className="q__help">前のURLの管理画面「設定 → リンク → 管理用リンク」の「リンクをコピー」で取れます（…/join#k=… の形）。部員用リンクでは引っ越せません。</p>
                <input id="mv-link" className="input q__input" value={link} onChange={(e) => setLink(e.target.value)} autoFocus placeholder="https://tech-mogiten.momotech.workers.dev/…/join#k=…" />
              </div>
            </div>
            {error && <Banner kind="error">{error}</Banner>}
            <Btn type="submit" variant="accent" big disabled={!link.trim() || busy}>{busy ? "引っ越しています…" : "引っ越す"}</Btn>
            <p className="hint">同じ店舗をもう一度引っ越すと、このURL側の内容は、前のURLの内容で上書きされます。</p>
          </form>
        )}
      </main>
    </div>
  );
}
