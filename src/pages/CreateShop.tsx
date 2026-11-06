import { useState } from "react";
import type { ShopPublic } from "../../shared/types";
import { ticketLabel } from "../../shared/logic";
import { AppBar, Banner, Btn, Page } from "../components/ui";
import { rememberShop } from "../myshops";
import { SetupSteps } from "./Setup";
import { adminKey, api, codeKey } from "../util";

/** 店舗の色の候補（白い文字でも黒い文字でも読める濃さ） */
const COLORS = ["#1565c0", "#c2410c", "#15803d", "#7e22ce", "#be123c", "#0f766e", "#a16207", "#374151"];

/** 各部・団体が自分の店舗をつくる。できたら共有リンクを出す */
export function CreateShop() {
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [prefix, setPrefix] = useState("A");
  const [count, setCount] = useState("30");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const look = { name: name || "新しい店舗", color, prefix: prefix || "A" };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: string; adminKey: string; staffKey: string }>("/api/shops", null, {
        method: "POST",
        body: JSON.stringify({ name, organization, color, prefix, ticketCount: Number(count || 30) }),
      });
      // 作った端末では、管理も部員の画面もすぐ使えるようにしておく
      localStorage.setItem(adminKey(r.id), r.adminKey);
      localStorage.setItem(codeKey(r.id), r.staffKey);
      const shop = await api<ShopPublic>(`/api/shops/${r.id}/public`, null);
      rememberShop(shop);
      // 続けて、商品・割引・札・共有を1つずつ設定する
      location.replace(`/${r.id}/setup?step=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "作れませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page shop={look} className="page--work">
      <AppBar shop={look} title="店舗をつくる" back="/" />
      <main className="admin setup">
        <SetupSteps step={0} />
        <form className="panel setup-panel" onSubmit={(e) => { e.preventDefault(); if (name.trim() && agree) void submit(); }}>
          <h2 className="setup-panel__title">お店の名前と色</h2>
          <p className="hint">部・クラス・団体ごとに1つ作ります。データは店舗ごとに分かれていて、ほかの店舗からは見えません。</p>
          <label className="field">店舗名<small className="muted">お客さんに見える名前（例: 焼き鳥、たこ焼き）</small>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} required autoFocus />
          </label>
          <label className="field">部・団体名<small className="muted">任意（例: 写真部、2年3組）</small>
            <input className="input" value={organization} onChange={(e) => setOrganization(e.target.value)} maxLength={40} />
          </label>
          <div className="field">お店の色
            <div className="color-chips" role="radiogroup" aria-label="お店の色">
              {COLORS.map((c) => (
                <button key={c} type="button" className={`color-chip ${color === c ? "is-on" : ""}`} role="radio" aria-checked={color === c} aria-label={c} style={{ background: c }} onClick={() => setColor(c)}>
                  {color === c && "✓"}
                </button>
              ))}
            </div>
          </div>
          <div className="field-row">
            <label className="field">札の記号<input className="input input--narrow" value={prefix} maxLength={3} onChange={(e) => setPrefix(e.target.value.toUpperCase())} /></label>
            <label className="field">札の枚数<input className="input input--narrow" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 3))} /></label>
          </div>
          <p className="hint">番号札は「{ticketLabel(prefix || "A", 5)}」のように表示されます。あとから変えられます。</p>
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span><a href="/terms" target="_blank" rel="noreferrer">利用規約・プライバシーポリシー</a>に同意します（個人情報は入力しない・最後に使ってから180日で自動削除 など）。</span>
          </label>
          {error && <Banner kind="error">{error}</Banner>}
          <Btn type="submit" variant="accent" big disabled={!name.trim() || !agree || busy}>{busy ? "作っています…" : "店舗をつくる"}</Btn>
        </form>
      </main>
    </Page>
  );
}
