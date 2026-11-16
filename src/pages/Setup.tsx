import { useCallback, useEffect, useState } from "react";
import type { DiscountRule, MenuItem, ShopPublic } from "../../shared/types";
import { yen } from "../../shared/logic";
import { AppBar, Banner, Btn, Page } from "../components/ui";
import { LinkRow, RecoveryCodeBox } from "../components/ShareLinks";
import { DiscountEditor, describeRule } from "../components/DiscountEditor";
import { TicketFields } from "../components/TicketFields";
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
          <span className="setup-steps__bar" aria-hidden />
          <span className="setup-steps__no">{String(i + 1).padStart(2, "0")}{i < step && <span className="sr-only">（済み）</span>}</span>
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
    <Page shop={shop} className="page--work page--create">
      <AppBar shop={shop} title="はじめの設定" back="/" />
      <main className="admin setup setup--create">
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
      <p className="eyebrow">Step 02 / 06</p>
      <h2 className="setup-panel__title">商品を登録しましょう</h2>
      <p className="hint">レジのボタンになります。味違い（タレ・塩など）は別々の商品にすると、厨房にも正しく伝わります。色・残り数・並び順は、あとで管理画面から変えられます。</p>
      <label className="setup-import">
        <span>前の店舗の「設定のファイル」があれば読み込めます（メニュー・割引・費用）</span>
        <input type="file" accept="application/json,.json" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            const d = JSON.parse(await f.text());
            if (await call("/import", body("POST", d))) await reload();
          } catch {
            alert("この店舗の設定のファイルではありません");
          }
          e.target.value = "";
        }} />
      </label>
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
  const [key, setKey] = useState(0);
  const [draft, setDraft] = useState<DiscountRule | null>(null);
  const put = async (list: DiscountRule[]) => {
    if (await call("/discounts", body("PUT", { discounts: list }))) {
      await reload();
      return true;
    }
    return false;
  };
  return (
    <section className="panel setup-panel">
      <p className="eyebrow">Step 03 / 06</p>
      <h2 className="setup-panel__title">まとめ買い割引を使いますか？</h2>
      <p className="hint">「焼き鳥2本で250円」のような割引です。レジで対象の商品を選ぶと、<b>自動で</b>値引きされます（押し忘れがありません）。使わないなら、下の「割引なしで次へ」で飛ばせます。</p>
      {st.discounts.length > 0 && (
        <ul className="setup-list">
          {st.discounts.map((d) => (
            <li key={d.id}>
              <span>{d.name}<small className="discount-row__desc">{describeRule(d, st.menu)}</small></span>
              <button className="link" onClick={() => void put(st.discounts.filter((x) => x.id !== d.id))} aria-label={`${d.name}を消す`}>消す</button>
            </li>
          ))}
        </ul>
      )}
      <DiscountEditor key={key} items={items} onDraft={setDraft} saveLabel={st.discounts.length ? "もう1つ割引を追加" : "この割引を追加"} onSave={async (rule) => { if (await put([...st.discounts, rule])) { setKey(key + 1); setDraft(null); } }} />
      <Nav
        back={back}
        next={async () => { if (draft && !(await put([...st.discounts, draft]))) return; next(); }}
        nextLabel={draft ? "この割引を追加して次へ" : st.discounts.length ? `割引${st.discounts.length}件で次へ` : "割引なしで次へ"}
      />
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
      <p className="eyebrow">Step 04 / 06</p>
      <h2 className="setup-panel__title">番号札</h2>
      <ol className="tk-flow" aria-label="番号札の使い方">
        <li><b>会計のとき</b>札を1枚お客さんに渡す</li>
        <li><b>できたら</b>呼び出し画面にその番号が出る</li>
        <li><b>受け取るとき</b>札を返してもらって料理を渡す</li>
      </ol>
      <TicketFields count={count} setCount={setCount} prefix={prefix} setPrefix={setPrefix} start={start} setStart={setStart} />
      <p className="hint">札を使わない会計もできます（レジで「札なし」を押します）。どれも、あとで管理画面の「設定」から変えられます。</p>
      <Nav back={back} next={() => void save()} disabled={!count || Number(count) < 1} />
    </section>
  );
}

/** 5. 部員に共有 */
function ShareStep({ st, back, next }: { st: State; back: () => void; next: () => void }) {
  const id = st.shop.id;
  const admin = localStorage.getItem(adminKey(id));
  const recovery = sessionStorage.getItem(`recovery:${id}`);
  const [saved, setSaved] = useState(!recovery);
  return (
    <section className="panel setup-panel">
      <p className="eyebrow">Step 05 / 06</p>
      <h2 className="setup-panel__title">リンクを配りましょう</h2>
      <p className="hint">このアプリは、ログインの代わりに<b>リンク</b>を使います。リンクを一度開いた端末が、その役割の画面を使えるようになります。リンクは3種類あります。</p>
      <div className="link-rows">
        {st.staffKey && <LinkRow who="部員みんなへ送る" title="部員用リンク" note="開いた端末で、レジと厨房が使えるようになります。売上や設定は見られません。" url={joinLink(id, st.staffKey)} />}
        <LinkRow who="店先のモニターで開く" title="呼び出し表示" note="お客さん向けに、できた番号を大きく出す画面です。誰が見ても大丈夫です（注文の中身や売上は出ません）。" url={displayLink(id)} openHere />
        {admin && <LinkRow who="代表者だけ・送らない" tone="private" title="管理用リンク" note="売上・メニュー・設定を変えられるリンクです。自分の別の端末（スマホなど）で管理したいときに開きます。" url={joinLink(id, admin)} warn={st.shop.hasPassword ? "部員のグループには送らないでください。なくしても、管理用パスワードで入り直せます。" : "部員のグループには送らないでください。なくすと、ほかの端末から管理できなくなるので、メモやスクリーンショットで保存しておいてください。"} />}
      </div>
      {recovery && <RecoveryCodeBox code={recovery} shopName={st.shop.name} onSaved={setSaved} />}
      <Nav back={back} next={() => { sessionStorage.removeItem(`recovery:${id}`); next(); }} nextLabel={saved ? "配った・次へ" : "復旧コードを保存してください"} disabled={!saved} />
    </section>
  );
}

/** 6. 完了 */
function DoneStep({ st }: { st: State }) {
  const id = st.shop.id;
  return (
    <section className="panel setup-panel">
      <p className="eyebrow">Step 06 / 06</p>
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
