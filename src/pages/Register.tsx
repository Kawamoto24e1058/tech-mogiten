import { useEffect, useMemo, useRef, useState } from "react";
import { changeBreakdown, discountLines, menuColor, holdsTicket, linesTotal, quickAmounts, ticketLabel, yen } from "../../shared/logic";
import { RegisterHistory } from "../components/RegisterHistory";
import { HubOrder } from "./Hub";
import { AppBar, Banner, Btn, ConnBadge, Modal, Money, Notices, Page, useIsWide, useWakeLock } from "../components/ui";
import { IconBack, IconBackspace, IconMinus, IconPlus } from "../components/icons";
import type { CSSProperties } from "react";
import { useConnection, viewMenu, viewOrders, viewUnpaid } from "../sync";
import { api, buzz, CLUB, load, save, uuid } from "../util";

type CartLine = { itemId: string; qty: number };
const LOW_TICKETS = 3;
/** 残り数がこれ以下になったら、メニューに「残りN」と出す */
const LOW_STOCK = 10;

/** お釣りの渡し方（例: 500円×1・100円×1） */
function Breakdown({ amount }: { amount: number }) {
  const parts = changeBreakdown(amount);
  if (parts.length === 0) return null;
  return (
    <p className="breakdown" aria-label="お釣りの内訳">
      {parts.map(([d, n]) => (
        <span key={d}>{d.toLocaleString()}円<b>×{n}</b></span>
      ))}
    </p>
  );
}

export function Register({ shopId, code, onAuthError }: { shopId: string; code: string; onAuthError: () => void }) {
  const { conn, state } = useConnection(shopId, "register", code);
  const { snapshot, outbox, status } = state;
  useWakeLock();
  // タブレット（横向き）・PC は「札 → 注文 → 会計」を左から並べる
  const wide = useIsWide(760);

  // テック部版: 配達に参加している店なら、レジから「ほかの店に配達を頼む」ができる
  const [inHub, setInHub] = useState(false);
  const [delivering, setDelivering] = useState(false);
  useEffect(() => {
    if (!CLUB) return;
    api<{ shops: { id: string }[] }>("/api/hub/public", null).then((h) => setInHub(h.shops.some((s) => s.id === shopId))).catch(() => {});
  }, [shopId]);

  const draftKey = `draft:${shopId}`;
  const [cart, setCartRaw] = useState<CartLine[]>(() => load(draftKey, []));
  const [step, setStep] = useState<"order" | "pay">("order");
  const [received, setReceived] = useState("");
  const [ticketChoice, setTicketChoiceRaw] = useState<number | "none" | null>(null);
  // スマホの札の欄（ふだんは畳む）。札を押したら閉じる
  const [showTickets, setShowTickets] = useState(false);
  const setTicketChoice = (v: number | "none" | null) => { setTicketChoiceRaw(v); if (v !== null) setShowTickets(false); };
  const [confirmClear, setConfirmClear] = useState(false);
  const [done, setDone] = useState<{ ticket: string; change: number; orderId: string; cart: CartLine[]; local: boolean; delivery?: { no: number; total: number } | null; deliveryError?: string; unpaidTotal?: number } | null>(null);
  // 先に厨房へ送って、まだ会計していない注文の一覧・会計
  const [unpaidOpen, setUnpaidOpen] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [payReceived, setPayReceived] = useState("");
  const [paidChange, setPaidChange] = useState<number | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState("");
  // 使用中の札を押したとき（札が手元に戻っている＝渡し済みのはず）の確認
  const [reuseTicket, setReuseTicket] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (status === "auth") onAuthError();
  }, [status, onAuthError]);

  const setCart = (next: CartLine[]) => {
    setCartRaw(next);
    save(draftKey, next);
  };

  const menu = viewMenu(snapshot, outbox);
  const shop = snapshot?.shop ?? null;
  const orders = viewOrders(snapshot, outbox);
  const inUse = useMemo(() => new Set(orders.filter(holdsTicket).map((o) => o.ticket!)), [orders]);
  const ticketCount = shop?.ticketCount ?? 0;
  const freeCount = Math.max(0, ticketCount - [...inUse].filter((t) => t <= ticketCount).length);
  // 札は「手元の札の番号を押す」だけ。順番は気にしない。押すまで会計できない（選び忘れ防止）
  const ticket = typeof ticketChoice === "number" ? ticketChoice : null;
  const label = (t: number | null) => ticketLabel(shop?.prefix ?? "", t);

  const allLines = cart
    .map((c) => {
      const m = menu.find((x) => x.id === c.itemId);
      return m ? { ...c, name: m.name, price: m.price, soldOut: m.soldOut, stock: m.stock, remote: m.remote ?? null } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null && x.qty > 0);
  // 配達メニュー（ほかの店の商品）は、このレジの合計に入れない。届けたときに配達係に払う
  const lines = allLines.filter((l) => !l.remote);
  const remoteLines = allLines.filter((l) => l.remote);
  const remoteTotal = remoteLines.reduce((s, l) => s + l.price * l.qty, 0);
  // まとめ買い割引（管理画面で設定）は自動でつける。サーバーでも同じ計算をする
  const autoDiscounts = discountLines(lines, snapshot?.discounts ?? []);
  const total = linesTotal(lines) + linesTotal(autoDiscounts);
  const discountText = autoDiscounts.map((d) => `${d.name}${d.qty > 1 ? `×${d.qty}` : ""} −${yen(-d.price * d.qty)}`).join("、");
  const receivedNum = Number(received || 0);
  const shortBy = total - receivedNum;
  const change = receivedNum - total;
  const itemCount = allLines.reduce((s, l) => s + l.qty, 0);
  const qtyOf = (id: string) => cart.find((c) => c.itemId === id)?.qty ?? 0;
  /** 残り数があるなら、それ以上は選べない */
  const atLimit = (id: string, stock: number | null) => stock != null && qtyOf(id) >= stock;
  const cookingCount = orders.filter((o) => o.status === "cooking").length;
  const unpaidList = viewUnpaid(snapshot, outbox);

  const add = (itemId: string, delta: number) => {
    buzz();
    const cur = cart.find((c) => c.itemId === itemId);
    if (!cur && delta > 0) setCart([...cart, { itemId, qty: delta }]);
    else if (cur) setCart(cart.map((c) => (c.itemId === itemId ? { ...c, qty: c.qty + delta } : c)).filter((c) => c.qty > 0));
  };

  const reset = () => {
    setCart([]);
    setReceived("");
    setTicketChoice(null);
    setStep("order");
  };

  // 札は任意（選ばなければ札なし。受付番号 #N で呼ぶ）
  const ticketOk = true;
  // 札を選ぶだけの画面は出さない（広い画面は左、スマホは上で選ぶ）。選び忘れたら「会計を確定」が押せないので気づける
  const canConfirm = lines.length > 0
    ? total >= 0 && received !== "" && receivedNum >= total && ticketOk
    : remoteLines.length > 0;

  /** 会計を確定する */
  const [sending, setSending] = useState(false);
  /** later = true なら「先に厨房へ送る」（会計はあとで） */
  const finish = async (rec: number, later = false) => {
    const local = lines.length > 0;
    if (local && !later && !(total >= 0 && rec >= total && ticketOk)) return;
    if (later && !(local && total >= 0)) return;
    if (!local && remoteLines.length === 0) return;
    if (sending) return;
    buzz();
    const id = uuid();
    const localCart = cart.filter((c) => lines.some((l) => l.itemId === c.itemId));
    const remoteCart = cart.filter((c) => remoteLines.some((l) => l.itemId === c.itemId));
    if (local) {
      conn.send({
        kind: "createOrder",
        order: { id, ticket, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })), received: later ? 0 : rec, createdAt: Date.now(), ...(later ? { unpaid: true } : {}) },
      });
    }
    // 配達メニューの分は、配達センター経由でその店に頼む
    let delivery: { no: number; total: number } | null = null;
    let deliveryError = "";
    if (remoteLines.length > 0) {
      setSending(true);
      try {
        const r = await api<{ delivery: { no: number; total: number } }>("/api/hub/order", code, {
          method: "POST",
          headers: { "x-hub-shop": shopId },
          body: JSON.stringify({ id: uuid(), lines: remoteLines.map((l) => ({ shopId: l.remote!.shopId, itemId: l.remote!.itemId, qty: l.qty })) }),
        });
        delivery = { no: r.delivery.no, total: r.delivery.total };
      } catch (e) {
        deliveryError = e instanceof Error ? e.message : "配達を頼めませんでした";
      } finally {
        setSending(false);
      }
    }
    setDone({ ticket: local ? label(ticket) : "", change: local && !later ? rec - total : 0, orderId: local ? id : "", cart: localCart, local, delivery, deliveryError, unpaidTotal: later ? total : undefined });
    setUndoError("");
    reset();
    // 配達を頼めなかったときは、配達の商品をカゴに戻しておく（もう一度押せるように）
    if (deliveryError) setCart(remoteCart);
  };
  const confirm = () => { if (canConfirm) void finish(receivedNum); };

  /** お預かりの入力（テンキー・PCのキーボード共通） */
  const typeKey = (k: string) => setReceived((r) => (r + k).replace(/^0+(?=\d)/, "").slice(0, 7));
  // PC ではキーボードの数字・Backspace・Enter でも入力できるようにする
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    if (done || reuseTicket != null || confirmClear || historyOpen || (!wide && step !== "pay")) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (/^[0-9]$/.test(e.key)) typeKey(e.key);
    else if (e.key === "Backspace") setReceived((r) => r.slice(0, -1));
    else if (e.key === "Enter") confirm();
    else return;
    e.preventDefault();
  };
  // 選んでいる札が見えるように、一覧をそこまでスクロールする
  const ticketListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ticketListRef.current?.querySelector(".tk.is-selected")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [ticket, wide, step, done]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  /** 会計完了の画面から、いまの会計を取り消して入力し直す */
  const undo = async () => {
    if (!done) return;
    const id = done.orderId;
    const isPending = () => conn.getState().outbox.some((p) => p.op.kind === "createOrder" && p.op.order.id === id);
    setUndoing(true);
    setUndoError("");
    try {
      if (status !== "online" && conn.retract(id)) {
        // 電波がなく、まだ送っていない → 送るのをやめるだけ
      } else {
        // 送信中なら、届くのを少し待ってから取り消す
        for (let i = 0; i < 30 && isPending(); i++) await new Promise((r) => setTimeout(r, 100));
        if (!(isPending() && conn.retract(id))) {
          await api(`/api/shops/${encodeURIComponent(shopId)}/history/${encodeURIComponent(id)}/cancel`, code, { method: "POST", body: JSON.stringify({ reason: "レジでやり直し" }) });
        }
      }
      setCart(done.cart);
      setStep("pay");
      setDone(null);
    } catch (e) {
      setUndoError(e instanceof Error ? e.message : "取り消せませんでした。履歴から取り消してください");
    } finally {
      setUndoing(false);
    }
  };

  const appbar = (
    <AppBar
      shop={shop}
      title="レジ"
      back="/"
      right={
        <>
          {snapshot && <span className="queue" title="調理を待っている注文の数">調理中 <b>{cookingCount}</b></span>}
          {unpaidList.length > 0 && <button className="appbar__btn appbar__btn--unpaid" onClick={() => { setUnpaidOpen(true); setPaying(null); setPaidChange(null); }}>未会計 <b>{unpaidList.length}</b></button>}
          {inHub && <button className={`appbar__btn appbar__btn--delivery ${delivering ? "is-on" : ""}`} onClick={() => setDelivering(!delivering)}>{delivering ? "レジに戻る" : "配達を頼む"}</button>}
          {snapshot && <button className="appbar__btn" onClick={() => setHistoryOpen(true)}>履歴</button>}
          <ConnBadge status={status} pending={outbox.length} />
        </>
      }
    />
  );
  const payTarget = paying ? unpaidList.find((o) => o.id === paying) ?? null : null;
  const payNum = Number(payReceived || 0);
  const unpaidModal = unpaidOpen && (
    <Modal title={paidChange != null ? "会計しました" : payTarget ? `${payTarget.ticket != null ? `札 ${label(payTarget.ticket)}` : payTarget.seq > 0 ? `#${payTarget.seq}` : "送信中の注文"} の会計` : `未会計 ${unpaidList.length}件`} onClose={() => setUnpaidOpen(false)}>
      {paidChange != null ? (
        <div className="unpaid-done">
          <div className="done__change"><span>お釣り</span><Money value={paidChange} /></div>
          <Breakdown amount={paidChange} />
          <div className="modal__actions">
            {unpaidList.length > 0 && <Btn onClick={() => { setPaidChange(null); setPaying(null); }}>ほかの未会計へ</Btn>}
            <Btn variant="accent" onClick={() => setUnpaidOpen(false)}>閉じる</Btn>
          </div>
        </div>
      ) : payTarget ? (
        <div className="unpaid-pay">
          <p className="unpaid-pay__items">{payTarget.lines.filter((l) => l.price >= 0).map((l) => `${l.name}×${l.qty}`).join("、")}</p>
          <div className="pay__line pay__line--total"><span>合計</span><Money value={payTarget.total} /></div>
          <div className="quick" role="group" aria-label="よく使う金額">
            {[payTarget.total, ...quickAmounts(payTarget.total).slice(0, 3)].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
              <button key={v} className={`chip ${payNum === v ? "is-on" : ""}`} onClick={() => setPayReceived(String(v))}>{v === payTarget.total ? "ちょうど" : `${v.toLocaleString()}円`}</button>
            ))}
          </div>
          <label className="field">お預かり<span className="input-unit"><input className="input" inputMode="numeric" value={payReceived} onChange={(e) => setPayReceived(e.target.value.replace(/\D/g, "").slice(0, 7))} aria-label="お預かり" />円</span></label>
          {payReceived !== "" && payNum >= payTarget.total && <div className="pay__change is-ready"><span>お釣り</span><Money value={payNum - payTarget.total} /></div>}
          <div className="modal__actions">
            <Btn variant="ghost" onClick={() => setPaying(null)}>戻る</Btn>
            <Btn variant="accent" disabled={payReceived === "" || payNum < payTarget.total} onClick={() => {
              buzz();
              conn.send({ kind: "payOrder", orderId: payTarget.id, received: payNum });
              setPaidChange(payNum - payTarget.total);
            }}>{payReceived !== "" && payNum < payTarget.total ? `あと ${yen(payTarget.total - payNum)} 必要です` : "会計する"}</Btn>
          </div>
        </div>
      ) : (
        <ul className="unpaid-list">
          {unpaidList.length === 0 && <p className="hint">未会計の注文はありません。</p>}
          {unpaidList.map((o) => (
            <li key={o.id}>
              <button className="unpaid-row" onClick={() => { setPaying(o.id); setPayReceived(""); }}>
                <b className="unpaid-row__no">{o.ticket != null ? `札 ${label(o.ticket)}` : o.seq > 0 ? `#${o.seq}` : "送信中"}</b>
                <span className="unpaid-row__items">{o.lines.filter((l) => l.price >= 0).map((l) => `${l.name}×${l.qty}`).join("、")}</span>
                <b className="unpaid-row__sum">{yen(o.total)}</b>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
  const historyModal = historyOpen && (
    <RegisterHistory
      shopId={shopId}
      code={code}
      prefix={shop?.prefix ?? ""}
      pending={orders.filter((o) => o.pending && o.seq < 0)}
      onClose={() => setHistoryOpen(false)}
    />
  );

  if (delivering) {
    return (
      <Page shop={shop} className="page--work">
        {appbar}
        <HubOrder embed={{ key: code, shopId, onBack: () => setDelivering(false) }} />
      </Page>
    );
  }

  if (!snapshot) {
    return (
      <Page shop={shop} className="page--work">
        {appbar}
        <main className="empty-state">
          <p>お店の情報を読み込んでいます…</p>
          <p className="hint">初めて開くときは電波が必要です。</p>
        </main>
      </Page>
    );
  }

  const doneSeq = done ? (orders.find((o) => o.id === done.orderId)?.seq ?? -1) : -1;
  if (done) {
    return (
      <Page shop={shop} className="page--work">
        {appbar}
        <main className="done">
          {done.local && (
            <>
              {done.ticket && done.ticket !== "札なし" ? (
                <>
                  <p className="done__lead">この札を渡してください</p>
                  <div className="done__ticket">{done.ticket}</div>
                </>
              ) : (
                <>
                  <p className="done__lead">受付番号をお客さんに伝えてください（呼び出し画面に出ます）</p>
                  <div className="done__ticket">{doneSeq > 0 ? `#${doneSeq}` : "…"}</div>
                  {doneSeq <= 0 && <p className="hint">番号をもらっています…（電波がないときは、つながると番号が出ます）</p>}
                </>
              )}
              {done.unpaidTotal != null ? (
                <div className="done__later" role="status">
                  <b>厨房に送りました（会計はまだ）</b>
                  <span>あとで <b>{yen(done.unpaidTotal)}</b> を受け取り、上の「未会計」から会計してください</span>
                </div>
              ) : (
                <>
                  <div className="done__change"><span>お釣り</span><Money value={done.change} /></div>
                  <Breakdown amount={done.change} />
                </>
              )}
            </>
          )}
          {done.delivery && (
            <div className="done__delivery" role="status">
              <span>配達を頼みました。お客さんに伝えてください</span>
              <b className="done__delivery-no">配-{done.delivery.no}</b>
              <span>この店の前で待ってもらい、届いたら <b>{yen(done.delivery.total)}</b> を配達係に払います</span>
            </div>
          )}
          {done.deliveryError && <Banner kind="error">配達を頼めませんでした: {done.deliveryError}（配達の商品はカゴに戻しました）</Banner>}
          {status !== "online" && (
            <Banner kind="warn">オフラインのため、まだ厨房に届いていません。口頭で伝えてください（電波が戻ると自動で送られます）。</Banner>
          )}
          <Btn variant="accent" big onClick={() => setDone(null)}>次のお客さん</Btn>
          {undoError && <Banner kind="error">{undoError}</Banner>}
          {done.local && <button className="link done__undo" onClick={() => void undo()} disabled={undoing}>{undoing ? "取り消しています…" : "間違えた（この会計を取り消して入力し直す）"}</button>}
        </main>
        {historyModal}
      {unpaidModal}
        {unpaidModal}
      </Page>
    );
  }

  const banners = (
    <div className="banners">
      <Notices notices={state.notices} onDismiss={(id) => conn.dismiss(id)} />
      {freeCount === 0 ? (
        <Banner kind="error">番号札がすべて使用中です。渡し終わった札を厨房で「渡した」にしてください。</Banner>
      ) : freeCount <= LOW_TICKETS ? (
        <Banner kind="warn">空いている札が残り{freeCount}枚です。</Banner>
      ) : null}
    </div>
  );

  const menuGrid = (
    <section className="menu-grid" aria-label="メニュー">
      {menu.length === 0 && <p className="hint">メニューがありません。管理画面で登録してください。</p>}
      {menu.map((m, i) => {
        const qty = qtyOf(m.id);
        const limit = atLimit(m.id, m.stock);
        const low = !m.soldOut && m.stock != null && m.stock <= LOW_STOCK;
        const discount = m.price < 0;
        return (
          <div
            key={m.id}
            className={`menu-card ${m.soldOut ? "is-soldout" : ""} ${qty ? "is-selected" : ""} ${discount ? "is-discount" : ""}`}
            style={{ "--tile": menuColor(m, i).solid, "--tile-tint": menuColor(m, i).tint } as CSSProperties}
          >
            <button
              className="menu-card__main"
              disabled={m.soldOut || limit}
              onClick={() => add(m.id, 1)}
              aria-label={`${m.name} ${yen(m.price)}${m.soldOut ? " 売り切れ" : ""}${low ? ` 残り${m.stock}` : ""}${qty ? ` 現在${qty}個` : ""}`}
            >
              <span className="menu-card__name">{m.remote && <small className="remote-tag">配達・{m.remote.shopName}</small>}{m.name}</span>
              <span className="menu-card__foot">
                <span className="menu-card__price">{m.soldOut ? "売り切れ" : discount ? `−${yen(-m.price)}` : yen(m.price)}</span>
                {low && <span className={`menu-card__stock ${limit ? "is-limit" : ""}`}>{limit ? "これ以上ありません" : `残り${m.stock}`}</span>}
              </span>
            </button>
            {qty > 0 && (
              <>
                <span className="menu-card__qty" aria-hidden>{qty}</span>
                <button className="menu-card__minus" onClick={() => add(m.id, -1)} aria-label={`${m.name}を1つ減らす`}><IconMinus size={22} /></button>
              </>
            )}
          </div>
        );
      })}
    </section>
  );

  const ticketText = ticket != null ? label(ticket) : "なし";

  /** 札をずらっと並べる。手に取った札の番号を押せばよい（何も押さなければ、前の札の次の番号） */
  const ticketButtons = Array.from({ length: ticketCount }, (_, i) => i + 1).map((n) => {
    const used = inUse.has(n);
    const selected = ticket === n;
    return (
      <button
        key={n}
        className={`tk ${used ? "is-used" : ""} ${selected ? "is-selected" : ""}`}
        aria-pressed={selected}
        aria-label={`${label(n)}${used ? " 使用中" : selected ? " 選択中" : ""}`}
        onClick={() => { buzz(); if (used) setReuseTicket(n); else { setTicketChoice(n); } }}
      >
        {n}
      </button>
    );
  });
  const noTicketButton = (
    <button className={`tk tk--none ${ticketChoice === "none" ? "is-selected" : ""}`} aria-pressed={ticketChoice === "none"} onClick={() => { buzz(); setTicketChoice("none"); }}>
      札なし
    </button>
  );

  /** ① 札（左）。選んだ札を大きく出し、一覧からそのまま押し直せる */
  const ticketPanel = (
    <section className="ticket-panel" aria-label="番号札">
      <h2 className="step-title"><span className="step__no">1</span>渡す札<small className="muted">（任意）</small></h2>
      <div className={`ticket-panel__num ${ticket == null ? "is-none" : ""}`} aria-live="polite">{ticketText}</div>
      <p className="ticket-panel__free">{ticket == null ? "札を使うときだけ押す（押さなければ受付番号で呼びます）" : "間違えたら、別の番号を押す"}</p>
      <div className="tk-grid" ref={ticketListRef} role="group" aria-label="札の番号">{ticketButtons}</div>
      {noTicketButton}
    </section>
  );

  /** ③ 会計（右）。テンキーで受け取った金額を入れ、よく使う金額はボタンで */
  const pay = (
    <section className="pay" aria-label="お会計">
      {wide && <h2 className="step-title"><span className="step__no">3</span>会計</h2>}
      <div className="pay__sum">
        <div className="pay__line pay__line--total"><span>合計</span><Money value={total} /></div>
        <div className="pay__line"><span>お預かり</span>{received ? <Money value={receivedNum} /> : <b className="pay__dash">—</b>}</div>
      </div>
      <div className={`pay__change ${received && shortBy <= 0 ? "is-ready" : ""} ${received && shortBy > 0 ? "is-short" : ""}`} aria-live="polite">
        <span>{received && shortBy > 0 ? "たりません" : "お釣り"}</span>
        {!received ? <b className="pay__dash">—</b> : <Money value={shortBy > 0 ? shortBy : change} />}
      </div>
      {received !== "" && shortBy <= 0 && <Breakdown amount={change} />}
      <div className="quick" role="group" aria-label="よく使う金額">
        <button className={`chip ${received !== "" && receivedNum === total ? "is-on" : ""}`} onClick={() => { buzz(); setReceived(String(total)); }} disabled={lines.length === 0}>ちょうど</button>
        {quickAmounts(total).slice(0, 3).map((v) => (
          <button key={v} className={`chip ${receivedNum === v && v !== total ? "is-on" : ""}`} onClick={() => { buzz(); setReceived(String(v)); }}>{v.toLocaleString()}円</button>
        ))}
      </div>
      <div className="keypad" aria-label="受け取った金額の入力">
        {["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", "00"].map((k) => (
          <button key={k} className="key" onClick={() => { buzz(); typeKey(k); }}>{k}</button>
        ))}
        <button className="key key--sub" onClick={() => setReceived((r) => r.slice(0, -1))} aria-label="1文字消す"><IconBackspace size={24} /></button>
      </div>
      {lines.length > 0 && <Btn className="pay__later" onClick={() => void finish(0, true)} disabled={sending || total < 0}>先に厨房へ送る（会計はあとで）</Btn>}
      <Btn variant="accent" big onClick={confirm} disabled={!canConfirm}>
        {lines.length === 0 ? (remoteLines.length > 0 ? (sending ? "頼んでいます…" : "配達を頼む") : "商品を選んでください") : total < 0 ? "合計がマイナスです（割引を確認）" : !ticketOk ? "① 札を押してください" : received === "" ? "受け取った金額を入れてください" : shortBy > 0 ? `あと ${yen(shortBy)} 必要です` : `${ticket != null ? `札 ${ticketText} で` : ""}会計を確定${remoteLines.length > 0 ? "（配達も頼む）" : ""}`}
      </Btn>
    </section>
  );

  // 使用中の札が手元にある＝前のお客さんに渡したのに「渡した」を押し忘れている、が多い
  const holder = reuseTicket == null ? undefined : orders.find((o) => holdsTicket(o) && o.ticket === reuseTicket);
  const reuseModal = reuseTicket != null && (
    <Modal title={`札 ${label(reuseTicket)} はまだ使用中です`} onClose={() => setReuseTicket(null)}>
      {holder && (
        <p className="modal__summary">
          前の注文：{holder.lines.filter((l) => l.price >= 0).map((l) => `${l.name}×${l.qty}`).join("、")}（{holder.status === "ready" ? "できた・渡していない" : "調理中"}）
        </p>
      )}
      <p>この札が手元にあるなら、前のお客さんにはもう渡しています。厨房で「渡した」を押し忘れているだけなので、このまま使えます。</p>
      {holder?.status === "cooking" && <Banner kind="warn">前の注文はまだ調理中です。本当に札が手元にあるか確かめてください。</Banner>}
      <div className="modal__actions modal__actions--stack">
        <Btn variant="accent" big onClick={() => { conn.send({ kind: "releaseTicket", ticket: reuseTicket }); setTicketChoice(reuseTicket); setReuseTicket(null); }}>札は手元にある。この札を使う</Btn>
        <Btn variant="ghost" onClick={() => setReuseTicket(null)}>やめる（別の札にする）</Btn>
      </div>
    </Modal>
  );

  const clearModal = confirmClear && (
    <Modal title="注文を全部消しますか？" onClose={() => setConfirmClear(false)}>
      <p>入力中の {itemCount}点（{yen(total)}）を消します。</p>
      <div className="modal__actions">
        <Btn onClick={() => setConfirmClear(false)}>やめる</Btn>
        <Btn variant="danger" onClick={() => { reset(); setConfirmClear(false); }}>全部消す</Btn>
      </div>
    </Modal>
  );

  if (wide) {
    return (
      <Page shop={shop} className="page--work page--fit">
        {appbar}
        {banners}
        <main className="register-wide register-wide--flow">
          {ticketPanel}
          <div className="register-wide__menu">
            <h2 className="step-title"><span className="step__no">2</span>注文を受ける</h2>
            {menuGrid}
          </div>
          <aside className="register-wide__side">
            <section className="order-list" aria-label="注文内容">
              <div className="order-list__head">
                <h2>注文 <span className="muted">{itemCount}点</span></h2>
                {allLines.length > 0 && <button className="link" onClick={() => setConfirmClear(true)}>全部消す</button>}
              </div>
              {allLines.length === 0 ? (
                <p className="hint">メニューを押すと追加されます。</p>
              ) : (
                <ul>
                  {lines.map((l) => (
                    <li key={l.itemId}>
                      <span className="order-list__name">{l.name}</span>
                      <span className="stepper">
                        <button onClick={() => add(l.itemId, -1)} aria-label={`${l.name}を1つ減らす`}><IconMinus size={18} /></button>
                        <b>{l.qty}</b>
                        <button onClick={() => add(l.itemId, 1)} disabled={l.soldOut || atLimit(l.itemId, l.stock)} aria-label={`${l.name}を1つ増やす`}><IconPlus size={18} /></button>
                      </span>
                      <span className="order-list__sub">{l.price < 0 ? `−${yen(-l.price * l.qty)}` : yen(l.price * l.qty)}</span>
                    </li>
                  ))}
                  {autoDiscounts.map((d) => (
                    <li key={d.itemId} className="order-list__discount">
                      <span className="order-list__name">{d.name}{d.qty > 1 && ` ×${d.qty}`}</span>
                      <span />
                      <span className="order-list__sub">−{yen(-d.price * d.qty)}</span>
                    </li>
                  ))}
                  {remoteLines.map((l) => (
                    <li key={l.itemId} className="order-list__remote">
                      <span className="order-list__name"><small className="remote-tag">配達・{l.remote!.shopName}</small>{l.name}</span>
                      <span className="stepper">
                        <button onClick={() => add(l.itemId, -1)} aria-label={`${l.name}を1つ減らす`}><IconMinus size={18} /></button>
                        <b>{l.qty}</b>
                        <button onClick={() => add(l.itemId, 1)} aria-label={`${l.name}を1つ増やす`}><IconPlus size={18} /></button>
                      </span>
                      <span className="order-list__sub">{yen(l.price * l.qty)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {remoteLines.length > 0 && <p className="remote-note">配達 <b>{yen(remoteTotal)}</b> はこの会計に入りません（届けたときに配達係に払う）</p>}
            </section>
            {pay}
          </aside>
        </main>
        {clearModal}
        {reuseModal}
        {historyModal}
      {unpaidModal}
        {unpaidModal}
      </Page>
    );
  }

  return (
    <Page shop={shop} className="page--work">
      {appbar}
      {banners}
      {step === "order" ? (
        <>
          <main className="register">
            {/* スマホ: 札は任意なので畳んでおく。使うときだけ開いて番号を押す */}
            <div className={`ticket-bar ticket-bar--compact ${showTickets ? "is-open" : ""}`}>
              <span className="ticket-bar__label">札 <b className="ticket-bar__num">{ticketText}</b>{ticket == null && <small>（受付番号で呼ぶ）</small>}</span>
              <button className="link" onClick={() => setShowTickets(!showTickets)} aria-expanded={showTickets}>{showTickets ? "閉じる" : ticket != null ? "変える" : "札を使う"}</button>
              {showTickets && <div className="tk-strip" ref={ticketListRef} role="group" aria-label="札の番号">{ticketButtons}{noTicketButton}</div>}
            </div>
            {menuGrid}
          </main>
          <div className="bottom-bar">
            <div className="bottom-bar__sum">
              <span className="bottom-bar__count">{itemCount ? `${itemCount}点` : "未選択"}</span>
              <span className="bottom-bar__total" aria-live="polite"><Money value={total} /></span>
              {discountText && <span className="bottom-bar__discount">{discountText}</span>}
              {remoteLines.length > 0 && <span className="bottom-bar__discount">＋配達 {yen(remoteTotal)}（届けたときに払う）</span>}
              {allLines.length > 0 && <button className="link" onClick={() => setConfirmClear(true)}>全部消す</button>}
            </div>
            {lines.length === 0 && remoteLines.length > 0
              ? <Btn variant="accent" big disabled={sending} onClick={() => void finish(0)}>{sending ? "頼んでいます…" : "配達を頼む"}</Btn>
              : (
                <div className="bottom-bar__btns">
                  <Btn disabled={lines.length === 0 || total < 0 || sending} onClick={() => void finish(0, true)}>先に厨房へ</Btn>
                  <Btn variant="accent" big disabled={lines.length === 0} onClick={() => setStep("pay")}>お会計へ</Btn>
                </div>
              )}
          </div>
        </>
      ) : (
        <main className="register register--pay">
          <button className="back-link" onClick={() => setStep("order")}><IconBack size={20} />注文に戻る</button>
          <p className="pay__items"><b className="pay__items-ticket">札 {ticketText}</b>{lines.map((l) => `${l.name}×${l.qty}`).join("、")}{discountText && <span className="pay__discount">{discountText}</span>}</p>
          {pay}
        </main>
      )}
      {clearModal}
      {reuseModal}
      {historyModal}
      {unpaidModal}
    </Page>
  );
}
