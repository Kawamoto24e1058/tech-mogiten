import { useCallback, useEffect, useState } from "react";
import type { DiscountRule, MenuItem } from "../../shared/types";
import { yen } from "../../shared/logic";
import { Banner, Btn } from "../components/ui";
import { Logo } from "../components/Logo";
import { LinkRow } from "../components/ShareLinks";
import { joinLink, myShops } from "../myshops";
import { adminKey, api, uuid } from "../util";

/*
 * 配達（テック部版）。
 *   /hub/admin   … 管理（中心の店の管理用リンクを開いた端末）: 参加する店・届け先・配達係のリンク
 *   /hub/order   … 届け先の係: 両方の店のメニューから注文し、配達番号（配-N）をお客さんに伝える
 *   /hub/courier … 配達係: できた配達を受け取る → 届けてお金をもらう → 各店のレジに渡す
 */

interface Part { shopId: string; shopName: string; orderId: string; total: number; lines: { name: string; qty: number }[]; settledAt: number | null; status?: string }
interface Delivery { id: string; no: number; placeName: string; note: string; status: "open" | "picked" | "delivered" | "cancelled"; parts: Part[]; total: number; createdAt: number }
interface Board { role: string; place: { id: string; name: string } | null; deliveries: Delivery[]; cash: { shopId: string; shopName: string; color: string; amount: number; count: number }[] }
interface HubShopMenu { id: string; name: string; color: string; menu: MenuItem[]; discounts: DiscountRule[]; error?: string }

const hub = <T,>(path: string, key: string | null, init?: RequestInit) => api<T>(`/api/hub${path}`, key, init);

/** リンクの #k=… を端末に覚えて、アドレス欄から消す */
function useHubKey(role: "place" | "courier"): string | null {
  const [key] = useState(() => {
    const m = /#k=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (m) {
      localStorage.setItem(`hub:${role}`, m[1]);
      history.replaceState(null, "", location.pathname);
      return m[1];
    }
    return localStorage.getItem(`hub:${role}`);
  });
  return key;
}

/** 配達の進み具合（いくつかの店の分がそろったか） */
function stateOf(d: Delivery): { text: string; tone: "cook" | "ready" | "go" | "done" | "off" } {
  if (d.status === "cancelled") return { text: "取り消し", tone: "off" };
  if (d.status === "delivered") return { text: "届けた", tone: "done" };
  if (d.status === "picked") return { text: "配達中", tone: "go" };
  const ready = d.parts.every((p) => p.status === "ready" || p.status === "handed");
  return ready ? { text: "できた・配達係待ち", tone: "ready" } : { text: "調理中", tone: "cook" };
}
const PART_LABEL: Record<string, string> = { cooking: "調理中", ready: "できた", handed: "受け取り済み", cancelled: "取り消し" };

function HubHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="appbar">
      <nav className="appbar__left" aria-label="現在の場所">
        <a className="appbar__home" href="/" aria-label="トップに戻る"><Logo size={26} /></a>
        <span className="appbar__crumb"><span className="hub-badge" aria-hidden>配</span><span className="appbar__shop">{title}</span></span>
        {sub && <span className="appbar__title">{sub}</span>}
      </nav>
    </header>
  );
}

function usePoll<T>(load: () => Promise<T>, ms: number, deps: unknown[]): { data: T | null; error: string; reload: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込めません");
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void reload();
    const t = setInterval(() => { if (document.visibilityState === "visible") void reload(); }, ms);
    return () => clearInterval(t);
  }, [reload, ms]);
  return { data, error, reload };
}

// ====================================================================
// 管理
// ====================================================================
export function HubAdmin() {
  const [pub, setPub] = useState<{ setup: boolean; owner: string | null } | null>(null);
  const [error, setError] = useState("");
  const loadPub = useCallback(() => hub<{ setup: boolean; owner: string | null }>("/public", null).then(setPub).catch((e) => setError(e.message)), []);
  useEffect(() => { void loadPub(); }, [loadPub]);
  if (!pub) return <div className="page page--grid"><HubHeader title="配達センター" /><main className="recover"><p className="hint">{error || "読み込んでいます…"}</p></main></div>;
  if (!pub.setup) return <HubSetup onDone={loadPub} />;
  const key = pub.owner ? localStorage.getItem(adminKey(pub.owner)) : null;
  if (!key) {
    return (
      <div className="page page--grid"><HubHeader title="配達センター" sub="管理" />
        <main className="recover"><Banner kind="warn">配達センターの管理は、中心の店（テック部）の管理用リンクを開いた端末からできます。</Banner></main>
      </div>
    );
  }
  return <HubManage adminKey={key} />;
}

function HubSetup({ onDone }: { onDone: () => void }) {
  const shops = myShops().filter((s) => localStorage.getItem(adminKey(s.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await hub("/setup", null, { method: "POST", body: JSON.stringify({ link: joinLink(id, localStorage.getItem(adminKey(id)) ?? "") }) });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "はじめられませんでした");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page page--grid"><HubHeader title="配達センター" sub="はじめる" />
      <main className="recover">
        <div className="recover__form">
          <h1 className="recover__title">配達をはじめる</h1>
          <p className="hint">中心になる店（料理を作って配達を出す店。テック部）を選びます。そのあと、参加する店（Grok など）と届け先（屋内展示など）を足します。</p>
          {shops.length === 0 && <Banner kind="warn">この端末には、管理できる店がありません。先に「引っ越し」か、中心の店の管理用リンクを開いてください。</Banner>}
          {shops.map((s) => (
            <Btn key={s.id} variant="accent" big disabled={busy} onClick={() => void start(s.id)}>「{s.name}」を中心に配達をはじめる</Btn>
          ))}
          {error && <Banner kind="error">{error}</Banner>}
        </div>
      </main>
    </div>
  );
}

function HubManage({ adminKey: key }: { adminKey: string }) {
  type Admin = { owner: string; shops: { id: string; name: string; color: string }[]; places: { id: string; name: string; key: string }[]; courierKey: string };
  const { data, error, reload } = usePoll(() => hub<Admin>("/admin", key), 60000, [key]);
  const [shopLink, setShopLink] = useState("");
  const [place, setPlace] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const run = async (path: string, body: unknown, ok: string) => {
    setErr("");
    try {
      await hub(path, key, { method: "POST", body: JSON.stringify(body ?? {}) });
      setMsg(ok);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "できませんでした");
    }
  };
  return (
    <div className="page page--grid"><HubHeader title="配達センター" sub="管理" />
      <main className="admin hub-admin">
        <header className="admin-head"><h1 className="admin-head__title">配達センター</h1><a className="btn" href="/hub/courier">配達係の画面を見る</a></header>
        {(error || err) && <Banner kind="error">{error || err}</Banner>}
        {msg && <div className="toast" role="status">✓ {msg}</div>}
        {data && (
          <>
            <section className="panel">
              <h3 className="panel__title">参加する店</h3>
              <ul className="setup-list">
                {data.shops.map((s) => (
                  <li key={s.id}>
                    <span><i className="swatch" style={{ background: s.color }} aria-hidden />{s.name}{s.id === data.owner && <small className="discount-row__desc">中心の店</small>}</span>
                    {s.id !== data.owner && <button className="link" onClick={() => { if (confirm(`「${s.name}」を配達から外しますか？`)) void run(`/admin/shops/${s.id}/delete`, {}, "外しました"); }}>外す</button>}
                  </li>
                ))}
              </ul>
              <form className="pass-form" onSubmit={(e) => { e.preventDefault(); void run("/admin/shops", { link: shopLink }, "店を足しました").then(() => setShopLink("")); }}>
                <label className="field" htmlFor="hub-shop">店を足す<small className="muted">その店の「部員用リンク」を貼り付け（その店の代表者からもらう）</small></label>
                <input id="hub-shop" className="input" value={shopLink} onChange={(e) => setShopLink(e.target.value)} placeholder="…/join#k=…" />
                <Btn type="submit" disabled={!shopLink.trim()}>足す</Btn>
              </form>
            </section>
            <section className="panel">
              <h3 className="panel__title">届け先</h3>
              <p className="hint">届け先ごとに「配達注文用リンク」があります。その場所の係の端末で開くと、配達の注文ができます。</p>
              <div className="link-rows">
                {data.places.map((p) => (
                  <div key={p.id}>
                    <LinkRow who={`${p.name}の係へ送る`} title={`${p.name}の配達注文用リンク`} note="開いた端末で、両方の店のメニューから配達を頼めます。" url={`${location.origin}/hub/order#k=${p.key}`} />
                    <button className="link link--danger" onClick={() => { if (confirm(`届け先「${p.name}」を消しますか？（このリンクは使えなくなります）`)) void run(`/admin/places/${p.id}/delete`, {}, "消しました"); }}>この届け先を消す</button>
                  </div>
                ))}
              </div>
              <form className="pass-form" onSubmit={(e) => { e.preventDefault(); void run("/admin/places", { name: place }, "届け先を足しました").then(() => setPlace("")); }}>
                <label className="field" htmlFor="hub-place">届け先を足す<small className="muted">例: 屋内展示、Grokの模擬店</small></label>
                <input id="hub-place" className="input" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={30} />
                <Btn type="submit" disabled={!place.trim()}>足す</Btn>
              </form>
            </section>
            <section className="panel">
              <h3 className="panel__title">配達係</h3>
              <div className="link-rows">
                <LinkRow who="配達係へ送る" title="配達係用リンク" note="できた配達を受け取り、届けてお金をもらい、各店のレジに渡すまでを記録します。" url={`${location.origin}/hub/courier#k=${data.courierKey}`} />
              </div>
              <button className="link link--danger" onClick={() => { if (confirm("配達係用リンクを作り直しますか？（今のリンクは使えなくなります）")) void run("/admin/courier/rotate", {}, "作り直しました"); }}>配達係用リンクを作り直す</button>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

// ====================================================================
// 届け先の係: 注文
// ====================================================================
export function HubOrder() {
  const key = useHubKey("place");
  const [menu, setMenu] = useState<{ place: { id: string; name: string } | null; shops: HubShopMenu[] } | null>(null);
  const [error, setError] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Delivery | null>(null);
  const [warn, setWarn] = useState("");
  const loadMenu = useCallback(() => {
    if (!key) return;
    hub<{ place: { id: string; name: string } | null; shops: HubShopMenu[] }>("/menu", key).then((m) => { setMenu(m); setError(""); }).catch((e) => setError(e.message));
  }, [key]);
  useEffect(() => { loadMenu(); const t = setInterval(loadMenu, 30000); return () => clearInterval(t); }, [loadMenu]);
  const board = usePoll(() => (key ? hub<Board>("/board", key) : Promise.resolve(null)), 5000, [key]);

  if (!key) return <div className="page page--grid"><HubHeader title="配達の注文" /><main className="recover"><Banner kind="warn">配達センターの管理者から届いた「配達注文用リンク」を開いてください。</Banner></main></div>;

  const items = (menu?.shops ?? []).flatMap((s) => s.menu.map((m) => ({ shop: s, item: m, k: `${s.id}:${m.id}` })));
  const lines = items.filter((x) => cart[x.k] > 0).map((x) => ({ ...x, qty: cart[x.k] }));
  const total = lines.reduce((a, l) => a + l.item.price * l.qty, 0);
  const add = (k: string, d: number) => setCart((c) => ({ ...c, [k]: Math.max(0, Math.min(99, (c[k] ?? 0) + d)) }));
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await hub<{ delivery: Delivery; warning?: string }>("/order", key, { method: "POST", body: JSON.stringify({ id: uuid(), note, lines: lines.map((l) => ({ shopId: l.shop.id, itemId: l.item.id, qty: l.qty })) }) });
      setDone(r.delivery);
      setWarn(r.warning ?? "");
      setCart({});
      setNote("");
      void board.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "頼めませんでした");
    } finally {
      setBusy(false);
    }
  };
  const mine = (board.data?.deliveries ?? []).slice().reverse();

  return (
    <div className="page page--grid">
      <HubHeader title="配達の注文" sub={menu?.place?.name} />
      <main className="hub-order">
        <section className="hub-order__menu">
          {error && <Banner kind="error">{error}</Banner>}
          {!menu && !error && <p className="hint">メニューを読み込んでいます…</p>}
          {menu?.shops.map((s) => (
            <div key={s.id} className="hub-shop">
              <h2 className="hub-shop__name"><i className="swatch" style={{ background: s.color }} aria-hidden />{s.name}</h2>
              {s.error && <p className="error">{s.error}</p>}
              <div className="hub-items">
                {s.menu.map((m) => {
                  const k = `${s.id}:${m.id}`;
                  const q = cart[k] ?? 0;
                  return (
                    <div key={k} className={`hub-item ${q ? "is-on" : ""} ${m.soldOut ? "is-soldout" : ""}`}>
                      <button className="hub-item__main" disabled={m.soldOut} onClick={() => add(k, 1)} aria-label={`${m.name} ${yen(m.price)}${m.soldOut ? " 売り切れ" : ""}${q ? ` 現在${q}個` : ""}`}>
                        <span className="hub-item__name">{m.name}</span>
                        <span className="hub-item__price">{m.soldOut ? "売り切れ" : yen(m.price)}</span>
                      </button>
                      {q > 0 && <><span className="hub-item__qty" aria-hidden>{q}</span><button className="hub-item__minus" onClick={() => add(k, -1)} aria-label={`${m.name}を1つ減らす`}>−</button></>}
                    </div>
                  );
                })}
              </div>
              {s.discounts.length > 0 && <p className="hint">割引（その店の分に自動で入ります）: {s.discounts.map((d) => d.name).join("、")}</p>}
            </div>
          ))}
        </section>
        <aside className="hub-order__side">
          {done && (
            <div className="hub-done" role="status">
              <span>お客さんに伝えてください</span>
              <b className="hub-done__no">配-{done.no}</b>
              <span>届いたら <b>{yen(done.total)}</b> を配達係にお支払い</span>
              {warn && <Banner kind="warn">{warn}</Banner>}
              <button className="link" onClick={() => setDone(null)}>閉じる</button>
            </div>
          )}
          <section className="hub-cart" aria-label="配達の注文">
            <h2>注文 <span className="muted">{lines.reduce((a, l) => a + l.qty, 0)}点</span></h2>
            {lines.length === 0 ? <p className="hint">メニューを押すと追加されます。</p> : (
              <ul>{lines.map((l) => <li key={l.k}><span><i className="swatch" style={{ background: l.shop.color }} aria-hidden />{l.item.name} ×{l.qty}</span><b>{yen(l.item.price * l.qty)}</b></li>)}</ul>
            )}
            <div className="hub-cart__total"><span>合計（割引前）</span><b>{yen(total)}</b></div>
            <label className="field" htmlFor="hub-note">受け取る人の目印<small className="muted">任意。例: 青い服、受付の前</small></label>
            <input id="hub-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={40} />
            <Btn variant="accent" big disabled={lines.length === 0 || busy} onClick={() => void submit()}>{busy ? "頼んでいます…" : "配達を頼む（届けたときに支払い）"}</Btn>
          </section>
          <section className="hub-mine" aria-label="この届け先の配達">
            <h2>この届け先の配達</h2>
            {mine.length === 0 ? <p className="hint">まだありません。</p> : (
              <ul>
                {mine.map((d) => {
                  const s = stateOf(d);
                  return (
                    <li key={d.id}>
                      <b className="hub-no">配-{d.no}</b>
                      <span className={`hub-state hub-state--${s.tone}`}>{s.text}</span>
                      <span className="hub-mine__sum">{yen(d.total)}</span>
                      {d.status === "open" && <button className="link link--danger" onClick={async () => { if (confirm(`配-${d.no} を取り消しますか？`)) { await hub(`/deliveries/${d.id}/cancel`, key, { method: "POST", body: "{}" }).catch((e) => alert(e.message)); void board.reload(); } }}>取り消す</button>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </main>
    </div>
  );
}

// ====================================================================
// 配達係
// ====================================================================
export function HubCourier() {
  const placeOrCourier = useHubKey("courier");
  const key = placeOrCourier;
  const { data, error, reload } = usePoll(() => (key ? hub<Board>("/board", key) : Promise.resolve(null)), 4000, [key]);
  const [busyId, setBusyId] = useState("");
  const act = async (path: string, body: unknown = {}) => {
    setBusyId(path);
    try {
      await hub(path, key, { method: "POST", body: JSON.stringify(body) });
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "できませんでした");
    } finally {
      setBusyId("");
    }
  };
  if (!key) return <div className="page page--grid"><HubHeader title="配達係" /><main className="recover"><Banner kind="warn">配達センターの管理者から届いた「配達係用リンク」を開いてください。</Banner></main></div>;
  const list = data?.deliveries ?? [];
  const order = { ready: 0, go: 1, cook: 2, done: 3, off: 4 } as const;
  const active = list.filter((d) => d.status === "open" || d.status === "picked").sort((a, b) => order[stateOf(a).tone] - order[stateOf(b).tone] || a.no - b.no);
  const finished = list.filter((d) => d.status === "delivered" || d.status === "cancelled").slice().reverse();
  const cash = (data?.cash ?? []).filter((c) => c.amount > 0);

  return (
    <div className="page page--grid">
      <HubHeader title="配達係" />
      <main className="hub-courier">
        {error && <Banner kind="error">{error}</Banner>}
        <section className="hub-cash" aria-label="手元のお金">
          <h2>手元のお金（各店のレジに渡す分）</h2>
          {cash.length === 0 ? <p className="hint">ありません。</p> : cash.map((c) => (
            <div key={c.shopId} className="hub-cash__row">
              <span><i className="swatch" style={{ background: c.color }} aria-hidden />{c.shopName}<small className="muted">（{c.count}件）</small></span>
              <b>{yen(c.amount)}</b>
              <Btn onClick={() => { if (confirm(`${c.shopName}のレジに ${yen(c.amount)} 渡しましたか？`)) void act("/settle", { shopId: c.shopId }); }} disabled={!!busyId}>{c.shopName}のレジに渡した</Btn>
            </div>
          ))}
        </section>
        <section className="hub-cards" aria-label="配達">
          {active.length === 0 && <p className="hint hub-empty">配達はありません。</p>}
          {active.map((d) => {
            const s = stateOf(d);
            return (
              <article key={d.id} className={`hub-card hub-card--${s.tone}`}>
                <div className="hub-card__head">
                  <b className="hub-no hub-no--big">配-{d.no}</b>
                  <span className={`hub-state hub-state--${s.tone}`}>{s.text}</span>
                </div>
                <p className="hub-card__to">→ <b>{d.placeName}</b>{d.note && `（${d.note}）`}</p>
                <ul className="hub-card__parts">
                  {d.parts.map((p) => (
                    <li key={p.orderId}>
                      <span className="hub-card__shop">{p.shopName}</span>
                      <span className={`pill pill--${p.status ?? "cooking"}`}>{PART_LABEL[p.status ?? "cooking"] ?? p.status}</span>
                      <span className="hub-card__lines">{p.lines.filter((l) => l.qty > 0).map((l) => `${l.name}×${l.qty}`).join("、")}</span>
                      <b>{yen(p.total)}</b>
                    </li>
                  ))}
                </ul>
                <div className="hub-card__total"><span>もらう金額</span><b>{yen(d.total)}</b></div>
                {d.status === "open" && (
                  <Btn variant="accent" big disabled={s.tone !== "ready" || !!busyId} onClick={() => void act(`/deliveries/${d.id}/pick`)}>
                    {s.tone === "ready" ? "受け取った（出発する）" : "まだ調理中です"}
                  </Btn>
                )}
                {d.status === "picked" && (
                  <Btn variant="ok" big disabled={!!busyId} onClick={() => { if (confirm(`配-${d.no}：${yen(d.total)} を受け取りましたか？`)) void act(`/deliveries/${d.id}/delivered`); }}>届けて {yen(d.total)} もらった</Btn>
                )}
                <button className="link link--danger" onClick={() => { if (confirm(`配-${d.no} を取り消しますか？（各店の注文も取り消します）`)) void act(`/deliveries/${d.id}/cancel`); }}>取り消す</button>
              </article>
            );
          })}
        </section>
        {finished.length > 0 && (
          <details className="hub-finished">
            <summary>終わった配達（{finished.length}件）</summary>
            <ul>{finished.map((d) => <li key={d.id}><b className="hub-no">配-{d.no}</b>{d.placeName}<span className={`hub-state hub-state--${stateOf(d).tone}`}>{stateOf(d).text}</span><b>{yen(d.total)}</b></li>)}</ul>
          </details>
        )}
      </main>
    </div>
  );
}
