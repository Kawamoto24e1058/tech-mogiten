import { useEffect, useMemo, useState } from "react";
import { changeBreakdown, discountLines, menuColor, holdsTicket, linesTotal, nextTicketAfter, quickAmounts, ticketLabel, yen } from "../../shared/logic";
import { RegisterHistory } from "../components/RegisterHistory";
import { AppBar, Banner, Btn, ConnBadge, Modal, Money, Notices, Page, useIsWide, useWakeLock } from "../components/ui";
import { IconBack, IconBackspace, IconMinus, IconPlus } from "../components/icons";
import type { CSSProperties } from "react";
import { useConnection, viewMenu, viewOrders } from "../sync";
import { api, buzz, load, save, uuid } from "../util";

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
  const wide = useIsWide();

  const draftKey = `draft:${shopId}`;
  const [cart, setCartRaw] = useState<CartLine[]>(() => load(draftKey, []));
  const [step, setStep] = useState<"order" | "pay">("order");
  const [received, setReceived] = useState("");
  const [keypad, setKeypad] = useState(false);
  const [ticketChoice, setTicketChoice] = useState<number | "none" | null>(null);
  const [pickTicket, setPickTicket] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [done, setDone] = useState<{ ticket: string; change: number; orderId: string; cart: CartLine[]; prevLast: number | null } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState("");
  // 前に渡した札。次はその次の番号を渡す（札の束の上から順に渡せるように）
  const lastKey = `lastTicket:${shopId}`;
  const [lastTicket, setLastTicketRaw] = useState<number | null>(() => load(lastKey, null));
  const setLastTicket = (t: number | null) => {
    setLastTicketRaw(t);
    save(lastKey, t);
  };
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
  const latestTicket = [...orders].filter((o) => o.ticket != null).sort((a, b) => b.createdAt - a.createdAt)[0]?.ticket ?? null;
  const suggested = nextTicketAfter(ticketCount, inUse, lastTicket ?? latestTicket);
  const ticket = ticketChoice === "none" ? null : ticketChoice ?? suggested;
  const label = (t: number | null) => ticketLabel(shop?.prefix ?? "", t);

  const lines = cart
    .map((c) => {
      const m = menu.find((x) => x.id === c.itemId);
      return m ? { ...c, name: m.name, price: m.price, soldOut: m.soldOut, stock: m.stock } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null && x.qty > 0);
  // まとめ買い割引（管理画面で設定）は自動でつける。サーバーでも同じ計算をする
  const autoDiscounts = discountLines(lines, snapshot?.discounts ?? []);
  const total = linesTotal(lines) + linesTotal(autoDiscounts);
  const discountText = autoDiscounts.map((d) => `${d.name}${d.qty > 1 ? `×${d.qty}` : ""} −${yen(-d.price * d.qty)}`).join("、");
  const receivedNum = Number(received || 0);
  const shortBy = total - receivedNum;
  const change = receivedNum - total;
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const qtyOf = (id: string) => cart.find((c) => c.itemId === id)?.qty ?? 0;
  /** 残り数があるなら、それ以上は選べない */
  const atLimit = (id: string, stock: number | null) => stock != null && qtyOf(id) >= stock;
  const cookingCount = orders.filter((o) => o.status === "cooking").length;

  const add = (itemId: string, delta: number) => {
    buzz();
    const cur = cart.find((c) => c.itemId === itemId);
    if (!cur && delta > 0) setCart([...cart, { itemId, qty: delta }]);
    else if (cur) setCart(cart.map((c) => (c.itemId === itemId ? { ...c, qty: c.qty + delta } : c)).filter((c) => c.qty > 0));
  };

  const reset = () => {
    setCart([]);
    setReceived("");
    setKeypad(false);
    setTicketChoice(null);
    setStep("order");
  };

  const ticketOk = ticket != null || ticketChoice === "none";
  const canConfirm = lines.length > 0 && total >= 0 && received !== "" && receivedNum >= total && ticketOk;

  /** 会計を確定する。お預かりの金額ボタンを押したら、そのまま確定する */
  const finish = (rec: number) => {
    if (!(lines.length > 0 && total >= 0 && rec >= total && ticketOk)) return;
    buzz();
    const id = uuid();
    conn.send({
      kind: "createOrder",
      order: { id, ticket, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })), received: rec, createdAt: Date.now() },
    });
    setDone({ ticket: label(ticket), change: rec - total, orderId: id, cart, prevLast: lastTicket });
    if (ticket != null) setLastTicket(ticket);
    setUndoError("");
    reset();
  };
  const confirm = () => canConfirm && finish(receivedNum);

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
      setLastTicket(done.prevLast);
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
          {snapshot && <button className="appbar__btn" onClick={() => setHistoryOpen(true)}>履歴</button>}
          <ConnBadge status={status} pending={outbox.length} />
        </>
      }
    />
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

  if (done) {
    return (
      <Page shop={shop} className="page--work">
        {appbar}
        <main className="done">
          <p className="done__lead">この札を渡してください</p>
          <div className="done__ticket">{done.ticket}</div>
          <div className="done__change"><span>お釣り</span><Money value={done.change} /></div>
          <Breakdown amount={done.change} />
          {status !== "online" && (
            <Banner kind="warn">オフラインのため、まだ厨房に届いていません。口頭で伝えてください（電波が戻ると自動で送られます）。</Banner>
          )}
          <Btn variant="accent" big onClick={() => setDone(null)}>次のお客さん</Btn>
          {undoError && <Banner kind="error">{undoError}</Banner>}
          <button className="link done__undo" onClick={() => void undo()} disabled={undoing}>{undoing ? "取り消しています…" : "間違えた（この会計を取り消して入力し直す）"}</button>
        </main>
        {historyModal}
      </Page>
    );
  }

  const banners = (
    <div className="banners">
      <Notices notices={state.notices} onDismiss={(id) => conn.dismiss(id)} />
      {snapshot.registerCount > 1 && <Banner kind="warn">レジが{snapshot.registerCount}台で開かれています。1台だけにしてください。</Banner>}
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
              <span className="menu-card__name">{m.name}</span>
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

  const pay = (
    <section className="pay" aria-label="お会計">
      <div className="pay__sum">
        <div className="pay__line pay__line--total"><span>合計</span><Money value={total} /></div>
        {keypad && <div className="pay__line"><span>お預かり</span>{received ? <Money value={receivedNum} /> : <b className="pay__dash">—</b>}</div>}
      </div>
      <div className="pay__ticket">
        <span className="pay__ticket-label">渡す札</span>
        <b>{ticketChoice === "none" ? "札なし" : ticket != null ? label(ticket) : "空きなし"}</b>
        <button className="link" onClick={() => setPickTicket(true)}>変更</button>
      </div>
      {keypad && (
        <>
          <div className={`pay__change ${received && shortBy <= 0 ? "is-ready" : ""} ${received && shortBy > 0 ? "is-short" : ""}`} aria-live="polite">
            <span>{received && shortBy > 0 ? "たりません" : "お釣り"}</span>
            {!received ? <b className="pay__dash">—</b> : <Money value={shortBy > 0 ? shortBy : change} />}
          </div>
          {received !== "" && shortBy <= 0 && <Breakdown amount={change} />}
        </>
      )}
      <div className="quick" role="group" aria-label="受け取った金額">
        <button className="chip chip--exact" onClick={() => finish(total)} disabled={lines.length === 0 || !ticketOk}>ちょうど</button>
        {quickAmounts(total).map((v) => (
          <button key={v} className="chip" onClick={() => finish(v)} disabled={lines.length === 0 || !ticketOk}>{v.toLocaleString()}円</button>
        ))}
        <button className={`chip ${keypad ? "is-on" : ""}`} onClick={() => { buzz(); setKeypad(!keypad); setReceived(""); }}>ほかの金額</button>
      </div>
      {keypad && (
        <div className="keypad" aria-label="金額の入力">
          {["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", "00"].map((k) => (
            <button key={k} className="key" onClick={() => { buzz(); setReceived((r) => (r + k).replace(/^0+(?=\d)/, "").slice(0, 7)); }}>{k}</button>
          ))}
          <button className="key key--sub" onClick={() => setReceived((r) => r.slice(0, -1))} aria-label="1文字消す"><IconBackspace size={24} /></button>
        </div>
      )}
      {!keypad && ticketOk && lines.length > 0 && <p className="hint pay__hint">受け取った金額を押すと、会計が終わります。</p>}
      {(keypad || !ticketOk || lines.length === 0) && (
        <Btn variant="accent" big onClick={confirm} disabled={!canConfirm}>
          {lines.length === 0 ? "商品を選んでください" : total < 0 ? "合計がマイナスです（割引を確認）" : !ticketOk ? "札を選んでください" : received === "" ? "受け取った金額を入れてください" : shortBy > 0 ? `あと ${yen(shortBy)} 必要です` : "会計を確定"}
        </Btn>
      )}
    </section>
  );

  const ticketModal = pickTicket && (
    <Modal title="渡す札を選ぶ" onClose={() => setPickTicket(false)}>
      <p className="hint">灰色の番号は使用中です。</p>
      <div className="ticket-grid">
        {Array.from({ length: ticketCount }, (_, i) => i + 1).map((n) => {
          const used = inUse.has(n);
          return (
            <button
              key={n}
              className={`ticket ${used ? "is-used" : ""} ${ticket === n ? "is-selected" : ""}`}
              disabled={used}
              onClick={() => { setTicketChoice(n); setPickTicket(false); }}
              aria-label={`${label(n)}${used ? " 使用中" : ""}`}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="modal__actions">
        <Btn variant="ghost" onClick={() => { setTicketChoice("none"); setPickTicket(false); }}>札なしで会計</Btn>
        <Btn onClick={() => { setTicketChoice(null); setPickTicket(false); }}>おすすめ（{label(suggested)}）に戻す</Btn>
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
      <Page shop={shop} className="page--work">
        {appbar}
        {banners}
        <main className="register-wide">
          <div className="register-wide__menu">{menuGrid}</div>
          <aside className="register-wide__side">
            <section className="order-list" aria-label="注文内容">
              <div className="order-list__head">
                <h2>注文 <span className="muted">{itemCount}点</span></h2>
                {lines.length > 0 && <button className="link" onClick={() => setConfirmClear(true)}>全部消す</button>}
              </div>
              {lines.length === 0 ? (
                <p className="hint">左のメニューを押すと追加されます。</p>
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
                </ul>
              )}
            </section>
            {pay}
          </aside>
        </main>
        {ticketModal}
        {clearModal}
        {historyModal}
      </Page>
    );
  }

  return (
    <Page shop={shop} className="page--work">
      {appbar}
      {banners}
      {step === "order" ? (
        <>
          <main className="register">{menuGrid}</main>
          <div className="bottom-bar">
            <div className="bottom-bar__sum">
              <span className="bottom-bar__count">{itemCount ? `${itemCount}点` : "未選択"}</span>
              <span className="bottom-bar__total" aria-live="polite"><Money value={total} /></span>
              {discountText && <span className="bottom-bar__discount">{discountText}</span>}
              {lines.length > 0 && <button className="link" onClick={() => setConfirmClear(true)}>全部消す</button>}
            </div>
            <Btn variant="accent" big disabled={lines.length === 0} onClick={() => setStep("pay")}>お会計へ</Btn>
          </div>
        </>
      ) : (
        <main className="register register--pay">
          <button className="back-link" onClick={() => setStep("order")}><IconBack size={20} />注文に戻る</button>
          <p className="pay__items">{lines.map((l) => `${l.name}×${l.qty}`).join("、")}{discountText && <span className="pay__discount">{discountText}</span>}</p>
          {pay}
        </main>
      )}
      {ticketModal}
      {clearModal}
      {historyModal}
    </Page>
  );
}
