import { useCallback, useEffect, useState } from "react";
import type { DaySummary, MenuItem, Order, ShopPublic } from "../../shared/types";
import { DENOMINATIONS } from "../../shared/types";
import { ticketLabel, yen } from "../../shared/logic";
import { Btn, Modal, ShopHeader } from "../components/ui";
import { ItemTable, Kpis, SlotBars } from "../components/Summary";
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

type Tab = "sales" | "orders" | "tickets" | "menu" | "closing" | "settings" | "history";
const TABS: [Tab, string][] = [
  ["sales", "売上"], ["orders", "注文"], ["tickets", "番号札"], ["menu", "メニュー"], ["closing", "レジ締め"], ["settings", "設定"], ["history", "履歴"],
];
const STATUS_JA: Record<string, string> = { cooking: "調理中", ready: "できた", handed: "渡した", cancelled: "キャンセル" };
const ACTION_JA: Record<string, string> = {
  cancel: "キャンセル", "ticket.change": "札の変更", "ticket.release": "札を空きに戻す", "menu.add": "メニュー追加",
  "menu.edit": "メニュー変更", "menu.delete": "メニュー削除", settings: "店舗設定の変更", codes: "合言葉・PINの変更",
  float: "釣り銭準備金", closing: "レジ締め",
};

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

  const mutate = async (path: string, method: string, body?: unknown, msg?: string) => {
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
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
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
    <div className="page">
      <ShopHeader shop={shop} title="管理" right={<Btn variant="ghost" className="btn--on-color" onClick={() => void refresh()}>更新</Btn>} />
      <div className="admin-bar">
        <label>
          日付{" "}
          <select className="input" value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d) => <option key={d} value={d}>{d}{d === todayJst() ? "（今日）" : ""}</option>)}
          </select>
        </label>
        <nav className="tabs tabs--admin" aria-label="管理メニュー">
          {TABS.map(([k, label]) => (
            <button key={k} className={`tab ${tab === k ? "tab--active" : ""}`} aria-pressed={tab === k} onClick={() => { setTab(k); setInfo(""); }}>{label}</button>
          ))}
        </nav>
      </div>
      {error && <div className="error-box" role="alert">{error}</div>}
      {info && <div className="ok-box" role="status">{info}</div>}
      <main className="admin">
        {!st || !sum ? <p>読み込んでいます…</p> : (
          <>
            {tab === "sales" && (
              <>
                <Kpis s={sum} />
                <ItemTable s={sum} />
                <SlotBars s={sum} />
                <Btn onClick={() => void downloadCsv()}>CSVで書き出す（{day}）</Btn>
              </>
            )}
            {tab === "orders" && <OrdersTab st={st} mutate={mutate} />}
            {tab === "tickets" && <TicketsTab st={st} mutate={mutate} />}
            {tab === "menu" && <MenuTab st={st} mutate={mutate} />}
            {tab === "closing" && <ClosingTab key={sum.day} sum={sum} call={call} setSum={setSum} setInfo={setInfo} />}
            {tab === "settings" && <SettingsTab st={st} mutate={mutate} />}
            {tab === "history" && (
              <ul className="history">
                {st.audit.length === 0 && <p className="hint">この日の変更履歴はありません。</p>}
                {st.audit.map((a, i) => (
                  <li key={i}>
                    <time>{timeOf(a.at)}</time> <b>{ACTION_JA[a.action] ?? a.action}</b>{" "}
                    <span className="hint">{describe(a.detail)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
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

type Mutate = (path: string, method: string, body?: unknown, msg?: string) => Promise<AdminState | null>;

function OrdersTab({ st, mutate }: { st: AdminState; mutate: Mutate }) {
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [reason, setReason] = useState("");
  const [retick, setRetick] = useState<Order | null>(null);
  const [newTicket, setNewTicket] = useState("");
  const orders = [...st.orders].reverse();
  return (
    <>
      <p className="hint">会計確定後の訂正はここで行います。内容を変える場合は、キャンセルしてからレジで入力し直してください。</p>
      {orders.length === 0 && <p className="hint">この日の注文はありません。</p>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>注文</th><th>時刻</th><th>札</th><th>内容</th><th className="num">合計</th><th>状態</th><th>操作</th></tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className={o.status === "cancelled" ? "row--cancelled" : ""}>
                <td>{o.seq}</td>
                <td>{timeOf(o.createdAt)}</td>
                <td>{ticketLabel(st.shop.prefix, o.ticket)}</td>
                <td>{o.lines.map((l) => `${l.name}×${l.qty}`).join("、")}</td>
                <td className="num">{yen(o.total)}</td>
                <td>{STATUS_JA[o.status]}{o.cancelReason && <small className="hint">（{o.cancelReason}）</small>}</td>
                <td className="actions">
                  {o.status !== "cancelled" && (
                    <>
                      <Btn variant="ghost" onClick={() => { setRetick(o); setNewTicket(o.ticket ? String(o.ticket) : ""); }}>札を変更</Btn>
                      <Btn variant="danger" onClick={() => { setCancelling(o); setReason(""); }}>キャンセル</Btn>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cancelling && (
        <Modal title={`注文 ${cancelling.seq} をキャンセルしますか？`} onClose={() => setCancelling(null)}>
          <p>{cancelling.lines.map((l) => `${l.name}×${l.qty}`).join("、")}（{yen(cancelling.total)}）</p>
          <p className="warn-box">お客さんに <b>{yen(cancelling.total)}</b> を返金してください。売上から差し引かれます。</p>
          <label className="field">理由（必須）
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例: 入力ミス、お客さんの都合" />
          </label>
          <div className="modal__actions">
            <Btn onClick={() => setCancelling(null)}>やめる</Btn>
            <Btn variant="danger" disabled={!reason.trim()} onClick={async () => {
              if (await mutate(`/orders/${encodeURIComponent(cancelling.id)}/cancel`, "POST", { reason }, `注文 ${cancelling.seq} をキャンセルしました`)) setCancelling(null);
            }}>キャンセルする</Btn>
          </div>
        </Modal>
      )}
      {retick && (
        <Modal title={`注文 ${retick.seq} の札を変更`} onClose={() => setRetick(null)}>
          <label className="field">札番号（空欄で「札なし」）
            <input className="input" inputMode="numeric" value={newTicket} onChange={(e) => setNewTicket(e.target.value.replace(/\D/g, ""))} />
          </label>
          <div className="modal__actions">
            <Btn onClick={() => setRetick(null)}>やめる</Btn>
            <Btn variant="primary" onClick={async () => {
              if (await mutate(`/orders/${encodeURIComponent(retick.id)}/ticket`, "POST", { ticket: newTicket ? Number(newTicket) : null }, "札を変更しました")) setRetick(null);
            }}>変更する</Btn>
          </div>
        </Modal>
      )}
    </>
  );
}

function TicketsTab({ st, mutate }: { st: AdminState; mutate: Mutate }) {
  const [releasing, setReleasing] = useState<number | null>(null);
  const used = new Map(st.tickets.map((t) => [t.ticket, t]));
  return (
    <>
      <p className="hint">使用中: {used.size}枚 / 空き: {st.shop.ticketCount - [...used.keys()].filter((t) => t <= st.shop.ticketCount).length}枚。返ってこない札は「空きに戻す」で再利用できます。</p>
      <div className="ticket-grid ticket-grid--admin">
        {Array.from({ length: st.shop.ticketCount }, (_, i) => i + 1).map((n) => {
          const t = used.get(n);
          return (
            <button key={n} className={`ticket-cell ${t ? "ticket-cell--used" : ""}`} onClick={() => t && setReleasing(n)} aria-label={`${ticketLabel(st.shop.prefix, n)} ${t ? `使用中 注文${t.seq}` : "空き"}`}>
              {n}
              <small>{t ? `注文${t.seq}・${STATUS_JA[t.status]}` : "空き"}</small>
            </button>
          );
        })}
      </div>
      {releasing != null && (
        <Modal title={`札 ${ticketLabel(st.shop.prefix, releasing)} を空きに戻しますか？`} onClose={() => setReleasing(null)}>
          <p>札をなくした・返ってこなかったときに使います。注文そのものは消えません。</p>
          <div className="modal__actions">
            <Btn onClick={() => setReleasing(null)}>やめる</Btn>
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
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [deleting, setDeleting] = useState<MenuItem | null>(null);
  const [edits, setEdits] = useState<Record<string, { name: string; price: string }>>({});
  const move = (i: number, d: number) => {
    const a = st.menu[i];
    const b = st.menu[i + d];
    if (!a || !b) return;
    void mutate(`/menu/${a.id}`, "PUT", { sort: b.sort }).then(() => mutate(`/menu/${b.id}`, "PUT", { sort: a.sort }));
  };
  return (
    <>
      <p className="hint">価格を変えても、すでに会計した注文の金額は変わりません。</p>
      <ul className="menu-admin">
        {st.menu.map((m, i) => {
          const e = edits[m.id] ?? { name: m.name, price: String(m.price) };
          const changed = e.name !== m.name || e.price !== String(m.price);
          return (
            <li key={m.id} className="menu-admin__row">
              <input className="input" aria-label="商品名" value={e.name} onChange={(ev) => setEdits({ ...edits, [m.id]: { ...e, name: ev.target.value } })} />
              <label className="price-input"><input className="input" aria-label="価格" inputMode="numeric" value={e.price} onChange={(ev) => setEdits({ ...edits, [m.id]: { ...e, price: ev.target.value.replace(/\D/g, "") } })} />円</label>
              {changed && (
                <Btn variant="primary" onClick={async () => {
                  if (await mutate(`/menu/${m.id}`, "PUT", { name: e.name, price: Number(e.price) }, `「${e.name}」を保存しました`)) {
                    const next = { ...edits };
                    delete next[m.id];
                    setEdits(next);
                  }
                }}>保存</Btn>
              )}
              <Btn variant={m.soldOut ? "danger" : "default"} onClick={() => void mutate(`/menu/${m.id}`, "PUT", { soldOut: !m.soldOut })}>{m.soldOut ? "売り切れ中" : "販売中"}</Btn>
              <Btn variant="ghost" ariaLabel={`${m.name}を上へ`} onClick={() => move(i, -1)} disabled={i === 0}>↑ 上へ</Btn>
              <Btn variant="ghost" ariaLabel={`${m.name}を下へ`} onClick={() => move(i, 1)} disabled={i === st.menu.length - 1}>↓ 下へ</Btn>
              <Btn variant="ghost" onClick={() => setDeleting(m)}>削除</Btn>
            </li>
          );
        })}
      </ul>
      <form className="menu-admin__add" onSubmit={async (e) => {
        e.preventDefault();
        if (await mutate("/menu", "POST", { name, price: Number(price) }, `「${name}」を追加しました`)) { setName(""); setPrice(""); }
      }}>
        <h2>商品を追加</h2>
        <label className="field">商品名<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 焼きそば" /></label>
        <label className="field">価格（円）<input className="input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} placeholder="例: 400" /></label>
        <Btn type="submit" variant="primary" disabled={!name.trim() || price === ""}>追加する</Btn>
      </form>
      {deleting && (
        <Modal title={`「${deleting.name}」を削除しますか？`} onClose={() => setDeleting(null)}>
          <p>レジに表示されなくなります。これまでの売上の記録は残ります。</p>
          <div className="modal__actions">
            <Btn onClick={() => setDeleting(null)}>やめる</Btn>
            <Btn variant="danger" onClick={async () => { if (await mutate(`/menu/${deleting.id}`, "DELETE", undefined, "削除しました")) setDeleting(null); }}>削除する</Btn>
          </div>
        </Modal>
      )}
    </>
  );
}

function ClosingTab({ sum, call, setSum, setInfo }: {
  sum: DaySummary;
  call: <T>(path: string, init?: RequestInit) => Promise<T | null>;
  setSum: (s: DaySummary) => void;
  setInfo: (s: string) => void;
}) {
  const [float, setFloat] = useState(String(sum.floatCash || ""));
  const [den, setDen] = useState<Record<string, string>>(() =>
    Object.fromEntries(DENOMINATIONS.map((d) => [d, sum.closing ? String(sum.closing.denominations[d] ?? "") : ""])),
  );
  const [memo, setMemo] = useState(sum.closing?.memo ?? "");
  const counted = DENOMINATIONS.reduce((s, d) => s + d * Number(den[d] || 0), 0);
  const diff = counted - sum.expectedCash;
  return (
    <>
      <section className="closing">
        <h2>1. 釣り銭準備金（開店時にレジに入れたお金）</h2>
        <div className="row">
          <label className="price-input"><input className="input" inputMode="numeric" value={float} onChange={(e) => setFloat(e.target.value.replace(/\D/g, ""))} aria-label="釣り銭準備金" />円</label>
          <Btn onClick={async () => {
            const s = await call<DaySummary>("/float", { method: "PUT", body: JSON.stringify({ amount: Number(float || 0) }) });
            if (s) { setSum(s); setInfo("釣り銭準備金を保存しました"); }
          }}>保存</Btn>
        </div>
      </section>
      <section className="closing">
        <h2>2. 閉店後に現金を数える</h2>
        <table className="table den-table">
          <thead><tr><th>金種</th><th>枚数</th><th className="num">金額</th></tr></thead>
          <tbody>
            {DENOMINATIONS.map((d) => (
              <tr key={d}>
                <td>{d.toLocaleString()}円</td>
                <td><input className="input input--narrow" inputMode="numeric" aria-label={`${d}円の枚数`} value={den[d]} onChange={(e) => setDen({ ...den, [d]: e.target.value.replace(/\D/g, "") })} /></td>
                <td className="num">{yen(d * Number(den[d] || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="closing">
        <h2>3. 結果</h2>
        <dl className="closing__result">
          <div><dt>数えた現金</dt><dd>{yen(counted)}</dd></div>
          <div><dt>あるはずの現金</dt><dd>{yen(sum.expectedCash)}<small>（準備金 {yen(sum.floatCash)} ＋ 売上 {yen(sum.sales)}）</small></dd></div>
          <div className={`closing__diff ${diff === 0 ? "closing__diff--ok" : "closing__diff--ng"}`}>
            <dt>差額</dt>
            <dd>{diff === 0 ? "✓ ぴったり（0円）" : `${diff > 0 ? "＋" : "−"}${yen(Math.abs(diff))}（${diff > 0 ? "多い" : "足りない"}）`}</dd>
          </div>
        </dl>
        <label className="field">メモ（締めた人の名前、差額の理由など）<input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
        <Btn variant="primary" big onClick={async () => {
          const s = await call<DaySummary>("/closing", { method: "POST", body: JSON.stringify({ denominations: Object.fromEntries(DENOMINATIONS.map((d) => [d, Number(den[d] || 0)])), memo }) });
          if (s) { setSum(s); setInfo("レジ締めを記録しました。CSVも書き出して保管してください"); }
        }}>レジ締めを記録する</Btn>
        {sum.closing && <p className="hint">記録済み: {timeOf(sum.closing.at)}（差額 {yen(sum.closing.diff)}）</p>}
        {sum.closing && sum.closing.expected !== sum.expectedCash && <p className="warn-box">記録した後に売上や準備金が変わっています。もう一度「レジ締めを記録する」を押してください。</p>}
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
      <form className="settings" onSubmit={(e) => { e.preventDefault(); void mutate("/settings", "PUT", { name, color, prefix, ticketCount: Number(count) }, "店舗の設定を保存しました"); }}>
        <h2>店舗</h2>
        <label className="field">店舗名<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">店舗の色（画面上部と番号札の色）
          <span className="row"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="店舗の色" /><code>{color}</code></span>
        </label>
        <label className="field">札の記号（例: A → 「A-5」）<input className="input input--narrow" value={prefix} maxLength={3} onChange={(e) => setPrefix(e.target.value)} /></label>
        <label className="field">番号札の枚数<input className="input input--narrow" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} /></label>
        <Btn type="submit" variant="primary">保存</Btn>
      </form>
      <form className="settings" onSubmit={async (e) => {
        e.preventDefault();
        const body: Record<string, string> = {};
        if (staffCode) body.staffCode = staffCode;
        if (adminPin) body.adminPin = adminPin;
        if (await mutate("/codes", "PUT", body, "合言葉・PINを変更しました。ほかの端末では入力し直しが必要です")) { setStaffCode(""); setAdminPin(""); }
      }}>
        <h2>合言葉・PIN</h2>
        <p className="hint">
          {st.shop.configured ? "合言葉は設定済みです。" : "合言葉がまだ設定されていません。設定するまでレジ・厨房は使えません。"}
          {st.hasAdminPin ? " 管理PINは設定済みです。" : " 管理PINはまだ設定されていません（全体PINでのみ管理できます）。"}
        </p>
        <label className="field">レジ・厨房の合言葉（部員に共有する。4文字以上）<input className="input" value={staffCode} onChange={(e) => setStaffCode(e.target.value)} autoComplete="off" /></label>
        <label className="field">管理PIN（管理者だけが知る。4文字以上）<input className="input" value={adminPin} onChange={(e) => setAdminPin(e.target.value)} autoComplete="off" /></label>
        <Btn type="submit" variant="primary" disabled={!staffCode && !adminPin}>変更する</Btn>
      </form>
    </>
  );
}
