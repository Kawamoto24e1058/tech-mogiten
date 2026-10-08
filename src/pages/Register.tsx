import { useEffect, useMemo, useState } from "react";
import { holdsTicket, linesTotal, nextFreeTicket, ticketLabel, yen } from "../../shared/logic";
import { Btn, ConnBadge, Modal, Notices, ShopHeader, useWakeLock } from "../components/ui";
import { useConnection, viewMenu, viewOrders } from "../sync";
import { load, save, uuid } from "../util";

type CartLine = { itemId: string; qty: number };
const LOW_TICKETS = 3;

function useIsWide() {
  const q = "(min-width: 900px)";
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export function Register({ shopId, code, onAuthError }: { shopId: string; code: string; onAuthError: () => void }) {
  const { conn, state } = useConnection(shopId, "register", code);
  const { snapshot, outbox, status } = state;
  useWakeLock();
  const wide = useIsWide();

  const draftKey = `draft:${shopId}`;
  const [cart, setCartRaw] = useState<CartLine[]>(() => load(draftKey, []));
  const [history, setHistory] = useState<CartLine[][]>([]);
  const [step, setStep] = useState<"order" | "pay">("order");
  const [received, setReceived] = useState("");
  const [ticketChoice, setTicketChoice] = useState<number | "none" | null>(null);
  const [pickTicket, setPickTicket] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [done, setDone] = useState<{ ticket: string; change: number; total: number } | null>(null);

  useEffect(() => {
    if (status === "auth") onAuthError();
  }, [status, onAuthError]);

  const setCart = (next: CartLine[]) => {
    setHistory((h) => [...h.slice(-30), cart]);
    setCartRaw(next);
    save(draftKey, next);
  };

  const menu = viewMenu(snapshot, outbox);
  const shop = snapshot?.shop ?? null;
  const orders = viewOrders(snapshot, outbox);
  const inUse = useMemo(() => new Set(orders.filter(holdsTicket).map((o) => o.ticket!)), [orders]);
  const ticketCount = shop?.ticketCount ?? 0;
  const freeCount = Math.max(0, ticketCount - [...inUse].filter((t) => t <= ticketCount).length);
  const suggested = nextFreeTicket(ticketCount, inUse);
  const ticket = ticketChoice === "none" ? null : ticketChoice ?? suggested;

  const lines = cart
    .map((c) => {
      const m = menu.find((x) => x.id === c.itemId);
      return m ? { ...c, name: m.name, price: m.price, soldOut: m.soldOut } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null && x.qty > 0);
  const total = linesTotal(lines);
  const receivedNum = Number(received || 0);
  const shortBy = total - receivedNum;
  const change = receivedNum - total;
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);

  const add = (itemId: string, delta: number) => {
    const cur = cart.find((c) => c.itemId === itemId);
    if (!cur && delta > 0) setCart([...cart, { itemId, qty: delta }]);
    else if (cur) setCart(cart.map((c) => (c.itemId === itemId ? { ...c, qty: c.qty + delta } : c)).filter((c) => c.qty > 0));
  };

  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory(history.slice(0, -1));
    setCartRaw(prev);
    save(draftKey, prev);
  };

  const reset = () => {
    setCartRaw([]);
    save(draftKey, []);
    setHistory([]);
    setReceived("");
    setTicketChoice(null);
    setStep("order");
  };

  const canConfirm = lines.length > 0 && receivedNum >= total && (ticket != null || ticketChoice === "none");

  const confirm = () => {
    if (!canConfirm) return;
    conn.send({
      kind: "createOrder",
      order: { id: uuid(), ticket, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })), received: receivedNum, createdAt: Date.now() },
    });
    setDone({ ticket: ticketLabel(shop?.prefix ?? "", ticket), change, total });
    reset();
  };

  const header = (
    <ShopHeader shop={shop} title="レジ" right={<ConnBadge status={status} pending={outbox.length} />} />
  );

  if (!snapshot) {
    return (
      <div className="page">
        {header}
        <main className="center-message">
          <p>お店の情報を読み込んでいます…</p>
          <p className="hint">初めて開くときは電波が必要です。</p>
        </main>
      </div>
    );
  }

  if (done) {
    return (
      <div className="page">
        {header}
        <main className="done">
          <p className="done__label">番号札を渡してください</p>
          <p className="done__ticket" style={{ borderColor: shop?.color }}>{done.ticket}</p>
          <dl className="done__money">
            <div><dt>合計</dt><dd>{yen(done.total)}</dd></div>
            <div><dt>お釣り</dt><dd className="done__change">{yen(done.change)}</dd></div>
          </dl>
          {status !== "online" && <p className="warn-box">オフラインです。注文は端末に保存され、電波が戻ると自動で厨房に送られます。急ぎの場合は口頭で厨房に伝えてください。</p>}
          <Btn variant="primary" big onClick={() => setDone(null)}>次のお客さん</Btn>
        </main>
      </div>
    );
  }

  const banners = (
    <>
      <Notices notices={state.notices} onDismiss={(id) => conn.dismiss(id)} />
      {snapshot.registerCount > 1 && (
        <div className="warn-box" role="alert">レジが {snapshot.registerCount} 台で開かれています。札番号が重なるおそれがあるため、レジは1台だけにしてください。</div>
      )}
      {freeCount === 0 ? (
        <div className="error-box" role="alert">番号札がすべて使用中です。渡し終わった札を「渡した」にしてください。</div>
      ) : freeCount <= LOW_TICKETS ? (
        <div className="warn-box" role="status">空いている番号札が残り {freeCount} 枚です。</div>
      ) : null}
    </>
  );

  const totalBar = (
    <div className="total-bar">
      <div>
        <span className="total-bar__label">合計</span>
        <span className="total-bar__amount" aria-live="polite">{yen(total)}</span>
      </div>
      <div className="total-bar__ticket">
        次の札 <b>{ticket != null ? ticketLabel(shop!.prefix, ticket) : "なし"}</b>
        <span className="hint">空き {freeCount}/{ticketCount}</span>
      </div>
    </div>
  );

  const menuGrid = (
    <section className="menu-grid" aria-label="メニュー">
      {menu.length === 0 && <p className="hint">メニューがありません。管理画面で登録してください。</p>}
      {menu.map((m) => {
        const qty = cart.find((c) => c.itemId === m.id)?.qty ?? 0;
        return (
          <button
            key={m.id}
            className={`menu-btn ${m.soldOut ? "menu-btn--soldout" : ""} ${qty ? "menu-btn--in-cart" : ""}`}
            disabled={m.soldOut}
            onClick={() => {
              navigator.vibrate?.(15);
              add(m.id, 1);
            }}
            aria-label={`${m.name} ${yen(m.price)}${m.soldOut ? " 売り切れ" : ""}${qty ? ` 現在${qty}個` : ""}`}
          >
            <span className="menu-btn__name">{m.name}</span>
            <span className="menu-btn__price">{m.soldOut ? "売り切れ" : yen(m.price)}</span>
            {qty > 0 && <span className="menu-btn__qty" aria-hidden>×{qty}</span>}
          </button>
        );
      })}
    </section>
  );

  const cartList = (
    <section className="cart" aria-label="注文内容">
      {lines.length === 0 ? (
        <p className="hint cart__empty">メニューを押すと、ここに追加されます。</p>
      ) : (
        <ul className="cart__list">
          {lines.map((l) => (
            <li key={l.itemId} className="cart__line">
              <span className="cart__name">{l.name}{l.soldOut && <span className="tag">売り切れ</span>}</span>
              <span className="cart__sub">{yen(l.price * l.qty)}</span>
              <span className="stepper">
                <Btn ariaLabel={`${l.name}を1つ減らす`} onClick={() => add(l.itemId, -1)}>−</Btn>
                <span className="stepper__qty" aria-label={`${l.qty}個`}>{l.qty}</span>
                <Btn ariaLabel={`${l.name}を1つ増やす`} onClick={() => add(l.itemId, 1)} disabled={l.soldOut}>＋</Btn>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="cart__actions">
        <Btn variant="ghost" onClick={undo} disabled={history.length === 0}>1つ戻す</Btn>
        <Btn variant="ghost" onClick={() => setConfirmClear(true)} disabled={lines.length === 0}>全部消す</Btn>
      </div>
    </section>
  );

  const pay = (
    <section className="pay" aria-label="お会計">
      <div className="pay__rows">
        <div className="pay__row"><span>合計</span><b>{yen(total)}</b></div>
        <div className="pay__row"><span>預かり</span><b>{received ? yen(receivedNum) : "—"}</b></div>
        <div className={`pay__row pay__change ${received && shortBy <= 0 ? "" : "pay__change--empty"}`} aria-live="polite">
          <span>お釣り</span>
          <b>{received && shortBy <= 0 ? yen(change) : "—"}</b>
        </div>
        {received && shortBy > 0 && <p className="error" role="alert">預かり金が {yen(shortBy)} たりません</p>}
      </div>
      <div className="quick">
        <Btn onClick={() => setReceived(String(total))} disabled={total === 0}>ちょうど</Btn>
        {[1000, 5000, 10000].map((v) => (
          <Btn key={v} onClick={() => setReceived(String(v))}>{v.toLocaleString()}円</Btn>
        ))}
      </div>
      <div className="keypad" aria-label="預かり金の入力">
        {["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", "00"].map((k) => (
          <Btn key={k} onClick={() => setReceived((r) => (r + k).replace(/^0+(?=\d)/, "").slice(0, 7))}>{k}</Btn>
        ))}
        <Btn variant="ghost" onClick={() => setReceived("")}>クリア</Btn>
      </div>
      <div className="pay__ticket">
        <span>渡す札</span>
        <b className="pay__ticket-label">{ticketChoice === "none" ? "札なし" : ticket != null ? ticketLabel(shop!.prefix, ticket) : "空きなし"}</b>
        <Btn variant="ghost" onClick={() => setPickTicket(true)}>変更</Btn>
      </div>
      <Btn variant="primary" big onClick={confirm} disabled={!canConfirm}>
        {lines.length === 0 ? "商品を選んでください" : !received ? "預かり金を入力してください" : shortBy > 0 ? `あと ${yen(shortBy)}` : ticket == null && ticketChoice !== "none" ? "札を選んでください" : "会計を確定"}
      </Btn>
    </section>
  );

  return (
    <div className="page">
      {header}
      {banners}
      {(wide || step === "order") && totalBar}
      {wide ? (
        <main className="register register--wide">
          <div className="register__menu">{menuGrid}</div>
          <div className="register__side">
            {cartList}
            {pay}
          </div>
        </main>
      ) : step === "order" ? (
        <main className="register">
          {menuGrid}
          {cartList}
          <Btn variant="primary" big className="sticky-action" disabled={lines.length === 0} onClick={() => setStep("pay")}>
            {lines.length === 0 ? "商品を選んでください" : `お会計へ（${itemCount}点）`}
          </Btn>
        </main>
      ) : (
        <main className="register">
          <Btn variant="ghost" onClick={() => setStep("order")}>← 注文に戻る</Btn>
          {pay}
        </main>
      )}

      {pickTicket && (
        <Modal title="渡す札を選ぶ" onClose={() => setPickTicket(false)}>
          <p className="hint">色の付いた番号は使用中です。</p>
          <div className="ticket-grid">
            {Array.from({ length: ticketCount }, (_, i) => i + 1).map((n) => {
              const used = inUse.has(n);
              return (
                <button
                  key={n}
                  className={`ticket-cell ${used ? "ticket-cell--used" : ""} ${ticket === n ? "ticket-cell--selected" : ""}`}
                  disabled={used}
                  onClick={() => {
                    setTicketChoice(n);
                    setPickTicket(false);
                  }}
                  aria-label={`${ticketLabel(shop!.prefix, n)}${used ? " 使用中" : ""}`}
                >
                  {n}
                  {used && <small>使用中</small>}
                </button>
              );
            })}
          </div>
          <div className="modal__actions">
            <Btn onClick={() => { setTicketChoice(null); setPickTicket(false); }}>おすすめに戻す</Btn>
            <Btn onClick={() => { setTicketChoice("none"); setPickTicket(false); }}>札なしで会計</Btn>
          </div>
        </Modal>
      )}
      {confirmClear && (
        <Modal title="注文を全部消しますか？" onClose={() => setConfirmClear(false)}>
          <p>入力中の注文（{itemCount}点・{yen(total)}）を消します。</p>
          <div className="modal__actions">
            <Btn onClick={() => setConfirmClear(false)}>やめる</Btn>
            <Btn variant="danger" onClick={() => { reset(); setConfirmClear(false); }}>全部消す</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
