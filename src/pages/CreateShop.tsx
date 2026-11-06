import { useState } from "react";
import type { ShopPublic } from "../../shared/types";
import { AppBar, Banner, Btn, Page } from "../components/ui";
import { rememberShop } from "../myshops";
import { SetupSteps } from "./Setup";
import { adminKey, api, codeKey } from "../util";

/** 店舗の色の候補（白い文字でも黒い文字でも読める濃さ）。名前は読み上げと選択中の表示に使う */
const COLORS = [
  { hex: "#1565c0", name: "青" }, { hex: "#c2410c", name: "オレンジ" }, { hex: "#15803d", name: "緑" }, { hex: "#7e22ce", name: "紫" },
  { hex: "#be123c", name: "赤" }, { hex: "#0f766e", name: "青緑" }, { hex: "#a16207", name: "黄土" }, { hex: "#374151", name: "墨" },
];

/** 各部・団体が自分の店舗をつくる。できたら共有リンクを出す */
export function CreateShop() {
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [color, setColor] = useState(COLORS[0].hex);
  const [count, setCount] = useState("30");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const look = { name: name || "新しい店舗", color, prefix: "" };
  const colorName = COLORS.find((c) => c.hex === color)?.name ?? "";
  const missing = [!name.trim() && "店舗名", !agree && "利用規約への同意"].filter(Boolean).join("と");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: string; adminKey: string; staffKey: string; recoveryCode?: string }>("/api/shops", null, {
        method: "POST",
        body: JSON.stringify({ name, organization, color, prefix: "", ticketCount: Number(count || 30) }),
      });
      // 作った端末では、管理も部員の画面もすぐ使えるようにしておく
      localStorage.setItem(adminKey(r.id), r.adminKey);
      localStorage.setItem(codeKey(r.id), r.staffKey);
      // 復旧コードは「部員に共有」の手順で1回だけ見せる（この端末のこのタブの中だけに置く）
      if (r.recoveryCode) sessionStorage.setItem(`recovery:${r.id}`, r.recoveryCode);
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
    <Page shop={look} className="page--work page--grid page--create">
      <AppBar shop={look} title="店舗をつくる" back="/" />
      <main className="admin setup setup--create">
        <SetupSteps step={0} />
        <div className="create">
          <form className="panel setup-panel" onSubmit={(e) => { e.preventDefault(); if (name.trim() && agree) void submit(); }}>
            <p className="eyebrow">Step 01 / 06</p>
            <h2 className="setup-panel__title">お店の名前と色</h2>
            <p className="hint">部・クラス・団体ごとに1つ作ります。データは店舗ごとに分かれていて、ほかの店舗からは見えません。</p>
            <div className="form-rows">
              <label className="form-row">
                <span className="form-row__label">店舗名<small>お客さんに見える名前</small></span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} required autoFocus placeholder="例: 焼き鳥、たこ焼き" />
              </label>
              <label className="form-row">
                <span className="form-row__label">部・団体名<small>任意</small></span>
                <input className="input" value={organization} onChange={(e) => setOrganization(e.target.value)} maxLength={40} placeholder="例: 写真部、2年3組" />
              </label>
              <div className="form-row">
                <span className="form-row__label">お店の色<small>{colorName}</small></span>
                <div className="color-chips" role="radiogroup" aria-label="お店の色">
                  {COLORS.map((c) => (
                    <button key={c.hex} type="button" className={`color-chip ${color === c.hex ? "is-on" : ""}`} role="radio" aria-checked={color === c.hex} aria-label={c.name} title={c.name} style={{ background: c.hex }} onClick={() => setColor(c.hex)}>
                      {color === c.hex && "✓"}
                    </button>
                  ))}
                </div>
              </div>
              <label className="form-row">
                <span className="form-row__label">札の枚数<small>あとから変えられます</small></span>
                <span className="input-unit"><input className="input input--narrow" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 3))} />枚</span>
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span><a href="/terms" target="_blank" rel="noreferrer">利用規約・プライバシーポリシー</a>に同意します（個人情報は入力しない・最後に使ってから180日で自動削除 など）。</span>
            </label>
            {error && <Banner kind="error">{error}</Banner>}
            <Btn type="submit" variant="accent" big disabled={!name.trim() || !agree || busy}>{busy ? "作っています…" : "店舗をつくる"}</Btn>
            {missing && !busy && <p className="hint create__missing">{missing}が必要です</p>}
          </form>
          <Preview name={name} organization={organization} />
        </div>
      </main>
    </Page>
  );
}

/** 入力に合わせて、ヘッダー・レジのボタン・呼び出し表示がどう見えるかを見せる（お店の色は親の --accent を使う） */
function Preview({ name, organization }: { name: string; organization: string }) {
  const shown = name.trim() || "お店の名前";
  return (
    <aside className="preview" aria-label="見え方のプレビュー">
      <p className="eyebrow">Preview</p>
      <div className="preview__bar">
        <span className="shop-badge" aria-hidden>{shown.slice(0, 1)}</span>
        <span className="preview__name">{shown}</span>
        {organization.trim() && <span className="preview__org">{organization.trim()}</span>}
      </div>
      <div className="preview__call">
        <span className="preview__label">お呼び出し中</span>
        <span className="preview__ticket">5</span>
      </div>
      <div className="preview__btn">札 5 で会計を確定</div>
      <p className="preview__note">お店の色は、ヘッダーの印・次に押すボタン・選択中の表示に使われます。</p>
    </aside>
  );
}
