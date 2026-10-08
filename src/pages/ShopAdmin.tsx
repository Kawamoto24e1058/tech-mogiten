import { useCallback, useEffect, useState } from "react";
import type { DaySummary, MenuItem, Order, ShopPublic } from "../../shared/types";
import { DENOMINATIONS } from "../../shared/types";
import { ticketLabel, yen } from "../../shared/logic";
import { AppBar, Banner, Btn, Modal, Page } from "../components/ui";
import { ItemRanking, Kpis, SlotBars, SubStats } from "../components/Summary";
import { api, ApiError, timeOf, todayJst } from "../util";

interface AdminState {
  shop: ShopPublic;
  hasAdminPin: boolean;
  menu: MenuItem[];
  orders: Order[];
  tickets: { ticket: number; orderId: string; seq: number; status: string }[];
  days: string[];
  audit: { at: number; action: string; orderId: string | null; detail: Record<string, unknown> }[];
}

type Tab = "sales" | "orders" | "menu" | "closing" | "settings";
const TABS: [Tab, string][] = [["sales", "売上"], ["orders", "注文"], ["menu", "メニュー"], ["closing", "締め"], ["settings", "設定"]];
const STATUS_JA: Record<string, string> = { cooking: "調理中", ready: "できた", handed: "渡した", cancelled: "キャンセル" };
const ACTION_JA: Record<string, string> = {
  cancel: "キャンセル", "ticket.change": "札の変更", "ticket.release": "札を空きに戻す", "menu.add": "メニュー追加",
  "menu.edit": "メニュー変更", "menu.delete": "メニュー削除", settings: "店舗設定の変更", codes: "合言葉・PINの変更",
  float: "釣り銭準備金", closing: "レジ締め", "ticket.release-all": "札をすべて空きに戻す", reset: "練習データの消去",
};

type Mutate = (path: string, method: string, body?: unknown, msg?: string) => Promise<AdminState | null>;

export function ShopAdmin({ shopId, code, onAuthError }: { shopId: string; code: string; onAuthError: () => void }) {
  const [tab, setTab] = useState<Tab>("sales");
  const [day, setDay] = useState(todayJst());
  const [st, setSt] = useState<AdminState | null>(null);
  const [sum, setSum] = useState<DaySummary | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const base = `/api/shops/${encodeURIComponent(shopId)}/admin`;

  const call = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T | null> => {
      setError("");
      try {
        return await api<T>(`${base}${path}${path.includes("?") ? "&" : "?"}day=${day}`, code, init);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403) && !init) onAuthError();
        setError(e instanceof Error ? e.message : "エラー");
        return null;
      }
    },
    [base, code, day, onAuthError],
  );

  const refresh = useCallback(async () => {
    const [a, s] = await Promise.all([call<AdminState>("/state"), call<DaySummary>("/summary")]);
    if (a) setSt(a);
    if (s) setSum(s);
  }, [call]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!info) return;
    const t = setTimeout(() => setInfo(""), 4000);
    return () => clearTimeout(t);
  }, [info]);

  const mutate: Mutate = async (path, method, body, msg) => {
    const r = await call<AdminState>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r) {
      setSt(r);
      if (msg) setInfo(msg);
      const s = await call<DaySummary>("/summary");
      if (s) setSum(s);
    }
    return r;
  };

  const downloadCsv = async () => {
    try {
      const res = await fetch(`${base}/csv?day=${day}`, { headers: { authorization: `Bearer ${code}` } });
      if (!res.ok) throw new Error();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = `売上-${st?.shop.name ?? shopId}-${day}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      setError("CSVを書き出せませんでした。電波を確認してください");
    }
  };

  const shop = st?.shop ?? null;
  const days = Array.from(new Set([todayJst(), ...(st?.days ?? [])])).sort().reverse();

  return (
    <Page shop={shop} className="page--work">
      <AppBar shop={shop} title="管理" back="/" right={<button className="appbar__btn" onClick={() => void refresh()}>更新</button>} />
      <nav className="tabbar" aria-label="管理メニュー">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? "is-on" : ""} aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>
        ))}
      </nav>
      <main className="admin">
        {(tab === "sales" || tab === "orders" || tab === "closing") && days.length > 1 && (
          <label className="day-select">
            <span>日付</span>
            <select className="input" value={day} onChange={(e) => setDay(e.target.value)}>
              {days.map((d) => <option key={d} value={d}>{d}{d === todayJst() ? "（今日）" : ""}</option>)}
            </select>
          </label>
        )}
        {error && <Banner kind="error">{error}</Banner>}
        {info && <div className="toast" role="status">✓ {info}</div>}
        {!st || !sum ? <p className="hint">読み込んでいます…</p> : (
          <>
            {tab === "sales" && (
              <>
                <Kpis s={sum} />
                <SubStats s={sum} />
                <ItemRanking s={sum} />
                <SlotBars s={sum} />
                <Btn onClick={() => void downloadCsv()}>CSVで書き出す</Btn>
              </>
            )}
            {tab === "orders" && <OrdersTab st={st} mutate={mutate} />}
            {tab === "menu" && <MenuTab st={st} mutate={mutate} />}
            {tab === "closing" && <ClosingTab key={sum.day} sum={sum} call={call} setSum={setSum} setInfo={setInfo} onCsv={() => void downloadCsv()} />}
            {tab === "settings" && <SettingsTab st={st} mutate={mutate} />}
          </>
        )}
      </main>
    </Page>
  );
}

function describe(d: Record<string, unknown>): string {
  const parts: string[] = [];
  if (d.seq != null) parts.push(`注文${d.seq}`);
  if (d.name != null) parts.push(String(d.name));
  if (d.price != null) parts.push(yen(Number(d.price)));
  if (d.total != null) parts.push(yen(Number(d.total)));
  if (d.reason) parts.push(`理由: ${d.reason}`);
  if (d.ticket != null) parts.push(`札 ${d.ticket}`);
  if (d.from !== undefined) parts.push(`札 ${d.from ?? "なし"} → ${d.to ?? "なし"}`);
  if (d.amount != null) parts.push(yen(Number(d.amount)));
  if (d.diff != null) parts.push(`差額 ${yen(Number(d.diff))}`);
  if (d.soldOut != null) parts.push(d.soldOut ? "売り切れ" : "販売中");
  return parts.join(" / ");
}

function OrdersTab({ st, mutate }: { st: AdminState; mutate: Mutate }) {
  const [selected, setSelected] = useState<Order | null>(null);
  const [mode, setMode] = useState<"menu" | "cancel" | "ticket">("menu");
  const [reason, setReason] = useState("");
  const [newTicket, setNewTicket] = useState("");
  const [releasing, setReleasing] = useState<number | null>(null);
  const label = (t: number | null) => ticketLabel(st.shop.prefix, t);
  const orders = [...st.orders].reverse();
  const open = (o: Order) => { setSelected(o); setMode("menu"); setReason(""); setNewTicket(o.ticket ? String(o.ticket) : ""); };

  return (
    <>
      <section className="panel">
        <h3 className="panel__title">使用中の札 <span className="muted">{st.tickets.length} / {st.shop.ticketCount}枚</span></h3>
        {st.tickets.length === 0 ? <p className="hint">使用中の札はありません。</p> : (
          <>
            <ul className="chips">
              {[...st.tickets].sort((a, b) => a.ticket - b.ticket).map((t) => (
                <li key={t.ticket}>
                  <button className={`ticket-chip ticket-chip--${t.status}`} onClick={() => setReleasing(t.ticket)} aria-label={`${label(t.ticket)} ${STATUS_JA[t.status]} 押すと空きに戻せます`}>
                    {label(t.ticket)}<small>{STATUS_JA[t.status]}</small>
                  </button>
                </li>
              ))}
            </ul>
            <p className="hint">返ってこない札は、押すと空きに戻せます。</p>
          </>
        )}
      </section>

      <section className="panel">
        <h3 className="panel__title">注文 <span className="muted">{st.orders.length}件</span></h3>
        {orders.length === 0 ? <p className="hint">この日の注文はありません。</p> : (
          <ul className="order-rows">
            {orders.map((o) => (
              <li key={o.id}>
                <button className={`order-row ${o.status === "cancelled" ? "is-cancelled" : ""}`} onClick={() => open(o)} disabled={o.status === "cancelled"}>
                  <span className="order-row__no">#{o.seq}</span>
                  <span className="order-row__main">
                    <span className="order-row__items">{o.lines.map((l) => `${l.name}×${l.qty}`).join("、")}</span>
                    <span className="order-row__meta">{timeOf(o.createdAt)} ・ {label(o.ticket)} ・ {STATUS_JA[o.status]}{o.cancelReason ? `（${o.cancelReason}）` : ""}</span>
                  </span>
                  <b className="order-row__total">{yen(o.total)}</b>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="panel history">
        <summary className="panel__title">変更履歴 <span className="muted">{st.audit.length}件</span></summary>
        {st.audit.length === 0 ? <p className="hint">この日の変更はありません。</p> : (
          <ul>
            {st.audit.map((a, i) => (
              <li key={i}><time>{timeOf(a.at)}</time> <b>{ACTION_JA[a.action] ?? a.action}</b> <span className="muted">{describe(a.detail)}</span></li>
            ))}
          </ul>
        )}
      </details>

      {selected && (
        <Modal title={`注文 #${selected.seq}`} onClose={() => setSelected(null)}>
          <p className="modal__summary">{selected.lines.map((l) => `${l.name}×${l.qty}`).join("、")}<br /><b>{yen(selected.total)}</b> ・ {label(selected.ticket)}</p>
          {mode === "menu" && (
            <div className="modal__actions modal__actions--stack">
              <Btn onClick={() => setMode("ticket")}>札の番号を変える</Btn>
              <Btn variant="danger" onClick={() => setMode("cancel")}>キャンセルして返金する</Btn>
              <p className="hint">内容を変えたいときは、キャンセルしてからレジで入力し直してください。</p>
            </div>
          )}
          {mode === "cancel" && (
            <>
              <Banner kind="warn">お客さんに <b>{yen(selected.total)}</b> を返してください。売上から差し引かれます。</Banner>
              <label className="field">理由
                <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例: 入力ミス" autoFocus />
              </label>
              <div className="modal__actions">
                <Btn variant="ghost" onClick={() => setMode("menu")}>戻る</Btn>
                <Btn variant="danger" disabled={!reason.trim()} onClick={async () => {
                  if (await mutate(`/orders/${encodeURIComponent(selected.id)}/cancel`, "POST", { reason }, `注文 #${selected.seq} をキャンセルしました`)) setSelected(null);
                }}>キャンセルする</Btn>
              </div>
            </>
          )}
          {mode === "ticket" && (
            <>
              <label className="field">新しい札の番号（空欄で「札なし」）
                <input className="input" inputMode="numeric" value={newTicket} onChange={(e) => setNewTicket(e.target.value.replace(/\D/g, ""))} autoFocus />
              </label>
              <div className="modal__actions">
                <Btn variant="ghost" onClick={() => setMode("menu")}>戻る</Btn>
                <Btn variant="accent" onClick={async () => {
                  if (await mutate(`/orders/${encodeURIComponent(selected.id)}/ticket`, "POST", { ticket: newTicket ? Number(newTicket) : null }, "札を変更しました")) setSelected(null);
                }}>変更する</Btn>
              </div>
            </>
          )}
        </Modal>
      )}

      {releasing != null && (
        <Modal title={`札 ${label(releasing)} を空きに戻しますか？`} onClose={() => setReleasing(null)}>
          <p>札をなくした・返ってこなかったときに使います。注文は消えません。</p>
          <div className="modal__actions">
            <Btn variant="ghost" onClick={() => setReleasing(null)}>やめる</Btn>
            <Btn variant="danger" onClick={async () => {
              if (await mutate(`/tickets/${releasing}/release`, "POST", {}, "札を空きに戻しました")) setReleasing(null);
            }}>空きに戻す</Btn>
          </div>
        </Modal>
      )}
    </>
  );
}

function MenuTab({ st, mutate }: { st: AdminState; mutate: Mutate }) {
  const [editing, setEditing] = useState<MenuItem | "new" | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const open = (m: MenuItem | "new") => {
    setEditing(m);
    setName(m === "new" ? "" : m.name);
    setPrice(m === "new" ? "" : String(m.price));
    setStock(m === "new" || m.stock == null ? "" : String(m.stock));
    setConfirmDelete(false);
  };
  const move = async (i: number, d: number) => {
    const a = st.menu[i];
    const b = st.menu[i + d];
    if (!a || !b) return;
    await mutate(`/menu/${a.id}`, "PUT", { sort: b.sort });
    await mutate(`/menu/${b.id}`, "PUT", { sort: a.sort });
  };
  const idx = editing && editing !== "new" ? st.menu.findIndex((m) => m.id === editing.id) : -1;

  return (
    <>
      <section className="panel">
        <h3 className="panel__title">メニュー <span className="muted">{st.menu.length}品</span></h3>
        <ul className="menu-rows">
          {st.menu.map((m) => (
            <li key={m.id}>
              <button className="menu-row" onClick={() => open(m)}>
                <span className="menu-row__name">{m.name}</span>
                {m.stock != null && <span className={`menu-row__stock ${m.stock <= 10 ? "is-low" : ""}`}>残り{m.stock}</span>}
                <span className="menu-row__price">{m.price < 0 ? `−${yen(-m.price)}` : yen(m.price)}</span>
                <span className="menu-row__edit" aria-hidden>編集 ›</span>
              </button>
              <button
                className={`switch ${m.soldOut ? "is-off" : "is-on"}`}
                role="switch"
                aria-checked={!m.soldOut}
                aria-label={`${m.name} ${m.soldOut ? "売り切れ" : "販売中"}`}
                onClick={() => void mutate(`/menu/${m.id}`, "PUT", { soldOut: !m.soldOut })}
              >
                {m.soldOut ? "売り切れ" : "販売中"}
              </button>
            </li>
          ))}
        </ul>
        <Btn variant="accent" onClick={() => open("new")}>＋ 商品を追加</Btn>
        <p className="hint">商品を押すと、名前・価格・残り数・並び順を変えられます。価格を変えても、すでに会計した注文の金額は変わりません。セット割などの割引は、価格をマイナス（例: -100）にした商品として登録します。</p>
      </section>

      {editing && (
        <Modal title={editing === "new" ? "商品を追加" : "商品を編集"} onClose={() => setEditing(null)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const ok = editing === "new"
              ? await mutate("/menu", "POST", { name, price: Number(price), stock: stock === "" ? null : Number(stock) }, `「${name}」を追加しました`)
              : await mutate(`/menu/${editing.id}`, "PUT", { name, price: Number(price), stock: stock === "" ? null : Number(stock) }, `「${name}」を保存しました`);
            if (ok) setEditing(null);
          }}>
            <label className="field">商品名<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 焼きそば" autoFocus /></label>
            <label className="field">価格<small className="muted">割引はマイナスで入力（例: -100）</small>
              <span className="input-unit"><input className="input" inputMode="text" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d-]/g, "").replace(/(?!^)-/g, ""))} placeholder="400" />円</span>
            </label>
            <label className="field">残り数<small className="muted">用意した数を入れると、売れるたびに減り、0 で自動的に売り切れになります。数えないときは空欄</small>
              <span className="input-unit"><input className="input" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value.replace(/\D/g, ""))} placeholder="空欄" />個</span>
            </label>
            {editing !== "new" && (
              <div className="row">
                <Btn variant="ghost" onClick={() => void move(idx, -1)} disabled={idx <= 0}>↑ 上へ</Btn>
                <Btn variant="ghost" onClick={() => void move(idx, 1)} disabled={idx >= st.menu.length - 1}>↓ 下へ</Btn>
              </div>
            )}
            <div className="modal__actions">
              {editing !== "new" && !confirmDelete && <Btn variant="ghost" className="mr-auto" onClick={() => setConfirmDelete(true)}>削除</Btn>}
              {editing !== "new" && confirmDelete && (
                <Btn variant="danger" className="mr-auto" onClick={async () => { if (await mutate(`/menu/${editing.id}`, "DELETE", undefined, "削除しました")) setEditing(null); }}>本当に削除する</Btn>
              )}
              <Btn type="submit" variant="accent" disabled={!name.trim() || price === "" || price === "-"}>保存</Btn>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function ClosingTab({ sum, call, setSum, setInfo, onCsv }: {
  sum: DaySummary;
  call: <T>(path: string, init?: RequestInit) => Promise<T | null>;
  setSum: (s: DaySummary) => void;
  setInfo: (s: string) => void;
  onCsv: () => void;
}) {
  const [float, setFloat] = useState(String(sum.floatCash || ""));
  const [den, setDen] = useState<Record<string, string>>(() =>
    Object.fromEntries(DENOMINATIONS.map((d) => [d, sum.closing ? String(sum.closing.denominations[d] || "") : ""])),
  );
  const [memo, setMemo] = useState(sum.closing?.memo ?? "");
  const counted = DENOMINATIONS.reduce((s, d) => s + d * Number(den[d] || 0), 0);
  const diff = counted - sum.expectedCash;
  const stale = sum.closing && sum.closing.expected !== sum.expectedCash;

  return (
    <>
      <section className="panel step">
        <h3 className="panel__title"><span className="step__no">1</span>開店時：釣り銭準備金</h3>
        <p className="hint">開店前にレジに入れたお金です。</p>
        <div className="row">
          <span className="input-unit"><input className="input" inputMode="numeric" value={float} onChange={(e) => setFloat(e.target.value.replace(/\D/g, ""))} aria-label="釣り銭準備金" />円</span>
          <Btn onClick={async () => {
            const s = await call<DaySummary>("/float", { method: "PUT", body: JSON.stringify({ amount: Number(float || 0) }) });
            if (s) { setSum(s); setInfo("釣り銭準備金を保存しました"); }
          }}>保存</Btn>
        </div>
      </section>

      <section className="panel step">
        <h3 className="panel__title"><span className="step__no">2</span>閉店後：現金を数える</h3>
        <div className="den-grid">
          {DENOMINATIONS.map((d) => (
            <label key={d} className="den">
              <span className="den__name">{d.toLocaleString()}円</span>
              <input className="input" inputMode="numeric" value={den[d]} onChange={(e) => setDen({ ...den, [d]: e.target.value.replace(/\D/g, "") })} aria-label={`${d}円の枚数`} />
              <span className="den__unit">枚</span>
            </label>
          ))}
        </div>
      </section>

      <section className="panel step">
        <h3 className="panel__title"><span className="step__no">3</span>確認して記録</h3>
        <dl className="result">
          <div><dt>数えた現金</dt><dd>{yen(counted)}</dd></div>
          <div><dt>あるはずの現金</dt><dd>{yen(sum.expectedCash)}</dd></div>
        </dl>
        <div className={`diff ${diff === 0 ? "is-ok" : "is-ng"}`}>
          {diff === 0 ? "✓ ぴったりです" : `${diff > 0 ? "多い" : "足りない"}：${yen(Math.abs(diff))}`}
        </div>
        <label className="field">メモ<input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="締めた人の名前、差額の理由など" /></label>
        {stale && <Banner kind="warn">記録した後に売上が変わっています。もう一度記録してください。</Banner>}
        <Btn variant="accent" big onClick={async () => {
          const s = await call<DaySummary>("/closing", { method: "POST", body: JSON.stringify({ denominations: Object.fromEntries(DENOMINATIONS.map((d) => [d, Number(den[d] || 0)])), memo }) });
          if (s) { setSum(s); setInfo("レジ締めを記録しました"); }
        }}>レジ締めを記録する</Btn>
        {sum.closing && !stale && <p className="hint">{timeOf(sum.closing.at)} に記録済み。CSVも保存しておきましょう。 <button className="link" onClick={onCsv}>CSVで書き出す</button></p>}
      </section>
    </>
  );
}

function SettingsTab({ st, mutate }: { st: AdminState; mutate: Mutate }) {
  const [name, setName] = useState(st.shop.name);
  const [color, setColor] = useState(st.shop.color);
  const [prefix, setPrefix] = useState(st.shop.prefix);
  const [count, setCount] = useState(String(st.shop.ticketCount));
  const [staffCode, setStaffCode] = useState("");
  const [adminPin, setAdminPin] = useState("");
  return (
    <>
      <form className="panel" onSubmit={(e) => { e.preventDefault(); void mutate("/settings", "PUT", { name, color, prefix, ticketCount: Number(count) }, "保存しました"); }}>
        <h3 className="panel__title">お店</h3>
        <label className="field">店舗名<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="field-row">
          <label className="field">色<span className="row"><input className="color-input" type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="店舗の色" /></span></label>
          <label className="field">札の記号<input className="input input--narrow" value={prefix} maxLength={3} onChange={(e) => setPrefix(e.target.value)} placeholder="A" /></label>
          <label className="field">札の枚数<input className="input input--narrow" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        <p className="hint">札は「{ticketLabel(prefix, 5)}」のように表示されます。</p>
        <Btn type="submit" variant="accent">保存</Btn>
      </form>
      <form className="panel" onSubmit={async (e) => {
        e.preventDefault();
        const body: Record<string, string> = {};
        if (staffCode) body.staffCode = staffCode;
        if (adminPin) body.adminPin = adminPin;
        if (await mutate("/codes", "PUT", body, "変更しました。ほかの端末では入力し直しが必要です")) { setStaffCode(""); setAdminPin(""); }
      }}>
        <h3 className="panel__title">合言葉・PIN</h3>
        {!st.shop.configured && <Banner kind="warn">合言葉が未設定です。設定するまでレジと厨房は使えません。</Banner>}
        <label className="field">レジ・厨房の合言葉<small className="muted">部員に共有します（4文字以上）{st.shop.configured ? "・設定済み" : ""}</small>
          <input className="input" value={staffCode} onChange={(e) => setStaffCode(e.target.value)} autoComplete="off" placeholder="変更するときだけ入力" />
        </label>
        <label className="field">管理PIN<small className="muted">管理する人だけが知るもの（4文字以上）{st.hasAdminPin ? "・設定済み" : ""}</small>
          <input className="input" value={adminPin} onChange={(e) => setAdminPin(e.target.value)} autoComplete="off" placeholder="変更するときだけ入力" />
        </label>
        <Btn type="submit" variant="accent" disabled={!staffCode && !adminPin}>変更する</Btn>
      </form>
      <PrepPanel st={st} mutate={mutate} />
    </>
  );
}

/** 開店前の準備（札の一括返却・練習データの消去） */
function PrepPanel({ st, mutate }: { st: AdminState; mutate: Mutate }) {
  const [dialog, setDialog] = useState<"tickets" | "reset" | null>(null);
  const [confirm, setConfirm] = useState("");
  const used = st.tickets.length;
  return (
    <section className="panel">
      <h3 className="panel__title">営業の準備</h3>
      <div className="prep-row">
        <div>
          <b>札をすべて空きに戻す</b>
          <p className="hint">開店前に使います。前日に渡し忘れた札などを、まとめて空きにします。いま使用中: {used}枚</p>
        </div>
        <Btn onClick={() => setDialog("tickets")} disabled={used === 0}>空きに戻す</Btn>
      </div>
      <div className="prep-row">
        <div>
          <b>練習データを消す</b>
          <p className="hint">リハーサルの注文・レジ締め・履歴をすべて消します。メニュー・価格・合言葉・店舗の設定は残ります。本番の前に1回だけ使ってください。</p>
        </div>
        <Btn variant="danger" onClick={() => { setConfirm(""); setDialog("reset"); }}>消去する</Btn>
      </div>

      {dialog === "tickets" && (
        <Modal title="札をすべて空きに戻しますか？" onClose={() => setDialog(null)}>
          <p>使用中の札 {used}枚 を空きにします。注文そのものは消えません。</p>
          <Banner kind="warn">営業中に使うと、まだ受け取っていないお客さんの札番号が、次のお客さんにも割り当てられてしまいます。</Banner>
          <div className="modal__actions">
            <Btn variant="ghost" onClick={() => setDialog(null)}>やめる</Btn>
            <Btn variant="danger" onClick={async () => { if (await mutate("/tickets/release-all", "POST", {}, "札をすべて空きに戻しました")) setDialog(null); }}>空きに戻す</Btn>
          </div>
        </Modal>
      )}
      {dialog === "reset" && (
        <Modal title="練習データを消しますか？" onClose={() => setDialog(null)}>
          <Banner kind="error">すべての日の注文・売上・レジ締め・変更履歴が消え、元に戻せません。必要ならCSVを先に書き出してください。</Banner>
          <p className="hint">残り数を設定している商品は、練習で売れた分が戻ります。</p>
          <label className="field">確認のため「消去」と入力してください
            <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </label>
          <div className="modal__actions">
            <Btn variant="ghost" onClick={() => setDialog(null)}>やめる</Btn>
            <Btn variant="danger" disabled={confirm !== "消去"} onClick={async () => { if (await mutate("/reset", "POST", { confirm }, "練習データを消しました")) setDialog(null); }}>消去する</Btn>
          </div>
        </Modal>
      )}
    </section>
  );
}
