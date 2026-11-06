import { useCallback, useEffect, useState } from "react";
import type { DiscountRule, MenuItem, ShopPublic } from "../../shared/types";
import { ticketLabel, yen } from "../../shared/logic";
import { AppBar, Banner, Btn, Page } from "../components/ui";
import { LinkRow } from "../components/ShareLinks";
import { displayLink, joinLink } from "../myshops";
import { adminKey, api } from "../util";

interface State {
  shop: ShopPublic;
  menu: MenuItem[];
  discounts: DiscountRule[];
  staffKey: string | null;
}

const STEPS = ["店舗", "商品", "割引", "番号札", "部員に共有", "完了"] as const;

/** いまどの手順かを上に出す */
export function SetupSteps({ step }: { step: number }) {
  return (
    <ol className="setup-steps" aria-label="設定の手順">
      {STEPS.map((label, i) => (
        <li key={label} className={i < step ? "is-done" : i === step ? "is-on" : ""} aria-current={i === step ? "step" : undefined}>
          <span className="setup-steps__no">{i < step ? "✓" : i + 1}</span>
          <span className="setup-steps__label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * 店舗をつくった直後の初期設定。1画面に1つずつ、順番に進める。
 * どの手順もあとから管理画面で変えられるので、迷ったら飛ばしてよい
 */
export function Setup({ shopId, code }: { shopId: string; code: string }) {
  const [step, setStep] = useState(() => Math.min(Math.max(Number(new URLSearchParams(location.search).get("step") ?? 1), 1), 5));
  const [st, setSt] = useState<State | null>(null);
  const [error, setError] = useState("");
  const base = `/api/shops/${encodeURIComponent(shopId)}/admin`;

  const call = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T | null> => {
      setError("");
      try {
        return await api<T>(`${base}${path}`, code, init);
      } catch (e) {
        setError(e instanceof Error ? e.message : "エラーが起きました");
        return null;
      }
    },
    [base, code],
  );
  const reload = useCallback(async () => {
    const s = await call<State>("/state");
    if (s) setSt(s);
  }, [call]);
  useEffect(() => { void reload(); }, [reload]);
  const go = (n: number) => {
    setStep(n);
    history.replaceState(null, "", `?step=${n}`);
    window.scrollTo(0, 0);
  };

  const shop = st?.shop ?? null;
  return (
    <Page shop={shop} className="page--work">
      <AppBar shop={shop} title="はじめの設定" back="/" />
      <main className="admin setup">
        <SetupSteps step={step} />
        {error && <Banner kind="error">{error}</Banner>}
        {!st ? <p className="hint">読み込んでいます…</p> : (
          <>
            {step === 1 && <MenuStep st={st} call={call} reload={reload} next={() => go(2)} />}
            {step === 2 && <DiscountStep st={st} call={call} reload={reload} back={() => go(1)} next={() => go(3)} />}
            {step === 3 && <TicketStep st={st} call={call} reload={reload} back={() => go(2)} next={() => go(4)} />}
            {step === 4 && <ShareStep st={st} back={() => go(3)} next={() => go(5)} />}
            {step === 5 && <DoneStep st={st} />}
          </>
        )}
      </main>
    </Page>
  );
}

type Call = <T>(path: string, init?: RequestInit) => Promise<T | null>;
const body = (method: string, b: unknown): RequestInit => ({ method, body: JSON.stringify(b) });

function Nav({ back, next, nextLabel = "次へ", disabled, skip }: { back?: () => void; next: () => void; nextLabel?: string; disabled?: boolean; skip?: () => void }) {
  return (
    <div className="setup-nav">
      {back && <Btn variant="ghost" onClick={back}>戻る</Btn>}
      {skip && <Btn variant="ghost" onClick={skip}>あとで設定する</Btn>}
      <Btn variant="accent" big onClick={next} disabled={disabled}>{nextLabel}</Btn>
    </div>
  );
}

/** 2. 商品を登録する（1つずつ追加） */
function MenuStep({ st, call, reload, next }: { st: State; call: Call; reload: () => Promise<void>; next: () => void }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const add = async () => {
    if (!name.trim() || !price) return;
    if (await call("/menu", body("POST", { name, price: Number(price) }))) {
      setName("");
      setPrice("");
      await reload();
      document.getElementById("setup-item-name")?.focus();
    }
  };
  const items = st.menu.filter((m) => m.price >= 0);
  return (
    <section className="panel setup-panel">
      <h2 className="setup-panel__title">商品を登録しましょう</h2>
      <p className="hint">レジのボタンになります。味違い（タレ・塩など）は別々の商品にすると、厨房にも正しく伝わります。色・残り数・並び順は、あとで管理画面から変えられます。</p>
      <form className="setup-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <label className="field">商品名<input id="setup-item-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 焼きそば" maxLength={30} autoFocus /></label>
        <label className="field">値段<span className="input-unit"><input className="input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="300" />円</span></label>
        <Btn type="submit" disabled={!name.trim() || !price}>＋ 追加</Btn>
      </form>
      {items.length > 0 && (
        <ul className="setup-list">
          {items.map((m) => (
            <li key={m.id}>
              <span>{m.name}</span>
              <b>{yen(m.price)}</b>
              <button className="link" onClick={async () => { if (await call(`/menu/${encodeURIComponent(m.id)}`, { method: "DELETE" })) await reload(); }} aria-label={`${m.name}を消す`}>消す</button>
            </li>
          ))}
        </ul>
      )}
      <Nav next={next} disabled={items.length === 0} nextLabel={items.length === 0 ? "商品を1つ以上登録してください" : `${items.length}品で次へ`} />
    </section>
  );
}

/** 3. まとめ買い割引（任意） */
function DiscountStep({ st, call, reload, back, next }: { st: State; call: Call; reload: () => Promise<void>; back: () => void; next: () => void }) {
  const items = st.menu.filter((m) => m.price > 0);
  const [ids, setIds] = useState<string[]>([]);
  const [every, setEvery] = useState("2");
  const [off, setOff] = useState("");
  const [name, setName] = useState("セット割");
  const sample = items.find((m) => ids.includes(m.id));
  const n = Number(every || 0);
  const save = async () => {
    const rule = { id: "", name, itemIds: ids, every: n, off: Number(off), enabled: true };
    if (await call("/discounts", body("PUT", { discounts: [...st.discounts, rule] }))) {
      await reload();
      setIds([]);
      setOff("");
    }
  };
  return (
    <section className="panel setup-panel">
      <h2 className="setup-panel__title">割引を使いますか？（任意）</h2>
      <p className="hint">「2本で300円」のような、まとめて買うと安くなる割引です。レジで自動で引かれます。使わないなら「次へ」で飛ばせます。</p>
      {st.discounts.length > 0 && (
        <ul className="setup-list">
          {st.discounts.map((d) => <li key={d.id}><span>{d.name}</span><b>{d.every}個ごとに −{yen(d.off)}</b></li>)}
        </ul>
      )}
      <div className="field">対象の商品（合わせて数えます）
        <div className="pick-chips">
          {items.map((m) => (
            <button key={m.id} type="button" className={`pick-chip ${ids.includes(m.id) ? "is-on" : ""}`} aria-pressed={ids.includes(m.id)} onClick={() => setIds(ids.includes(m.id) ? ids.filter((x) => x !== m.id) : [...ids, m.id])}>
              {ids.includes(m.id) ? "✓ " : ""}{m.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field-row">
        <label className="field">何個ごと<span className="input-unit"><input className="input input--narrow" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value.replace(/\D/g, "").slice(0, 2))} />個ごとに</span></label>
        <label className="field">引く金額<span className="input-unit"><input className="input input--narrow" inputMode="numeric" value={off} onChange={(e) => setOff(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="100" />円引き</span></label>
        <label className="field">名前<input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} /></label>
      </div>
      {sample && n >= 1 && Number(off) > 0 && <p className="discount-example">例: {sample.name} 1個 {yen(sample.price)} → {n}個 {yen(sample.price * n - Number(off))}</p>}
      <Btn onClick={() => void save()} disabled={ids.length === 0 || !(n >= 1) || !(Number(off) > 0) || !name.trim()}>この割引を追加</Btn>
      <Nav back={back} next={next} nextLabel={st.discounts.length ? "次へ" : "割引なしで次へ"} />
    </section>
  );
}

/** 4. 番号札と開催日 */
function TicketStep({ st, call, reload, back, next }: { st: State; call: Call; reload: () => Promise<void>; back: () => void; next: () => void }) {
  const [prefix, setPrefix] = useState(st.shop.prefix);
  const [count, setCount] = useState(String(st.shop.ticketCount));
  const [start, setStart] = useState(st.shop.festivalStart ?? "");
  const save = async () => {
    if (await call("/settings", body("PUT", { prefix, ticketCount: Number(count || 30), festivalStart: start || null }))) {
      await reload();
      next();
    }
  };
  return (
    <section className="panel setup-panel">
      <h2 className="setup-panel__title">番号札と開催日</h2>
      <p className="hint">会計のときにお客さんに渡す札です。用意する枚数に合わせてください（行列の長さの目安 × 1.5 くらいが安心です）。</p>
      <div className="field-row">
        <label className="field">札の記号<input className="input input--narrow" value={prefix} maxLength={3} onChange={(e) => setPrefix(e.target.value.toUpperCase())} /></label>
        <label className="field">札の枚数<input className="input input--narrow" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 3))} /></label>
      </div>
      <p className="hint">札は「{ticketLabel(prefix || "A", 5)}」のように表示されます。札を使わないお店でも、そのままで大丈夫です（会計のときに「札なし」を選べます）。</p>
      <label className="field">文化祭の初日<small className="muted">任意。売上が「1日目」「2日目」と表示されます</small>
        <input className="input input--date" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <Nav back={back} next={() => void save()} disabled={!count || Number(count) < 1} />
    </section>
  );
}

/** 5. 部員に共有 */
function ShareStep({ st, back, next }: { st: State; back: () => void; next: () => void }) {
  const id = st.shop.id;
  const admin = localStorage.getItem(adminKey(id));
  return (
    <section className="panel setup-panel">
      <h2 className="setup-panel__title">部員にリンクを配りましょう</h2>
      <p className="hint">部員用リンクを、部員のグループ（LINE など）に送ってください。部員は自分の端末で一度開くだけで、レジ・厨房が使えるようになります。</p>
      {st.staffKey && <LinkRow title="部員用リンク" note="レジ・厨房で使う部員に送ります" url={joinLink(id, st.staffKey)} />}
      {admin && <LinkRow title="管理用リンク（代表者だけ）" note="ほかの端末でも管理したいとき用" url={joinLink(id, admin)} warn="なくすと、ほかの端末から管理できなくなります。スクリーンショットかメモで必ず保存してください。部員全体には配らないでください。" />}
      <LinkRow title="呼び出し表示" note="店先のモニターで開きます（誰でも見られます）" url={displayLink(id)} />
      <Nav back={back} next={next} nextLabel="保存した・配った" />
    </section>
  );
}

/** 6. 完了 */
function DoneStep({ st }: { st: State }) {
  const id = st.shop.id;
  return (
    <section className="panel setup-panel">
      <h2 className="setup-panel__title">準備ができました</h2>
      <p>本番の前に、部員みんなで<b>リハーサル</b>をしておくと安心です。</p>
      <ol className="steps">
        <li>レジで札を選び、商品を押して会計してみる</li>
        <li>厨房で「できた」→「札を受け取って渡した」を押してみる</li>
        <li>終わったら、管理画面の「注文」タブで練習の注文を削除する</li>
      </ol>
      <div className="setup-nav">
        <a className="btn" href={`/${id}/admin`}>管理画面へ</a>
        <a className="btn btn--accent btn--big" href={`/${id}/register`}>レジを開く</a>
      </div>
    </section>
  );
}
