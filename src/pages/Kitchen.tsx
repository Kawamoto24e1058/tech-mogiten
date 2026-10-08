import { useEffect, useState } from "react";
import type { Order } from "../../shared/types";
import { ticketLabel, yen } from "../../shared/logic";
import { Btn, ConnBadge, Modal, Notices, ShopHeader, useNow, useWakeLock } from "../components/ui";
import { useConnection, viewMenu, viewOrders } from "../sync";
import { minutesSince } from "../util";

type View = Order & { pending: boolean };
type Tab = "cooking" | "ready" | "handed";

const TAB_LABEL: Record<Tab, string> = { cooking: "調理中", ready: "できた", handed: "渡した" };

export function Kitchen({ shopId, code, onAuthError }: { shopId: string; code: string; onAuthError: () => void }) {
  const { conn, state } = useConnection(shopId, "kitchen", code);
  const { snapshot, outbox, status } = state;
  useWakeLock();
  const now = useNow();
  const [tab, setTab] = useState<Tab>("cooking");
  const [handing, setHanding] = useState<View | null>(null);
  const [soldOutOpen, setSoldOutOpen] = useState(false);

  useEffect(() => {
    if (status === "auth") onAuthError();
  }, [status, onAuthError]);

  const shop = snapshot?.shop ?? null;
  const orders = viewOrders(snapshot, outbox);
  const by = (s: Tab) => orders.filter((o) => o.status === s);
  const cooking = by("cooking").sort((a, b) => a.createdAt - b.createdAt);
  const ready = by("ready").sort((a, b) => (a.readyAt ?? 0) - (b.readyAt ?? 0));
  const handed = by("handed").sort((a, b) => (b.handedAt ?? 0) - (a.handedAt ?? 0));
  const lists: Record<Tab, View[]> = { cooking, ready, handed };
  const label = (o: View) => ticketLabel(shop?.prefix ?? "", o.ticket);

  const dupTickets = new Set(
    [...cooking, ...ready]
      .filter((o) => o.ticket != null && !o.ticketReleased)
      .map((o) => o.ticket!)
      .filter((t, i, arr) => arr.indexOf(t) !== i),
  );

  const card = (o: View) => (
    <article key={o.id} className={`order-card order-card--${o.status}`} aria-label={`${label(o)} ${TAB_LABEL[o.status as Tab]}`}>
      <div className="order-card__head">
        <span className="order-card__ticket">{label(o)}</span>
        <span className={`status-chip status-chip--${o.status}`}>
          <span aria-hidden>{o.status === "cooking" ? "○" : o.status === "ready" ? "✓" : "—"}</span> {TAB_LABEL[o.status as Tab]}
        </span>
      </div>
      <div className="order-card__meta">
        {o.seq > 0 ? `注文 ${o.seq}` : "送信待ち"} ・ {o.status === "ready" && o.readyAt ? `できてから ${minutesSince(o.readyAt, now)}分` : `受付から ${minutesSince(o.createdAt, now)}分`}
        {o.pending && <span className="tag">未送信</span>}
        {o.ticket != null && dupTickets.has(o.ticket) && <span className="tag tag--danger">札が重複</span>}
      </div>
      <ul className="order-card__lines">
        {o.lines.map((l) => (
          <li key={l.itemId}><span>{l.name}</span><b>×{l.qty}</b></li>
        ))}
      </ul>
      <div className="order-card__actions">
        {o.status === "cooking" && (
          <Btn variant="ok" big onClick={() => conn.send({ kind: "setStatus", orderId: o.id, status: "ready" })}>できた</Btn>
        )}
        {o.status === "ready" && (
          <>
            <Btn variant="primary" big onClick={() => setHanding(o)}>渡した</Btn>
            <Btn variant="ghost" onClick={() => conn.send({ kind: "setStatus", orderId: o.id, status: "cooking" })}>調理中に戻す</Btn>
          </>
        )}
        {o.status === "handed" && (
          <Btn variant="ghost" onClick={() => conn.send({ kind: "setStatus", orderId: o.id, status: "ready" })}>「できた」に戻す</Btn>
        )}
      </div>
    </article>
  );

  const menu = viewMenu(snapshot, outbox);

  return (
    <div className="page">
      <ShopHeader
        shop={shop}
        title="厨房・受け渡し"
        right={
          <>
            <ConnBadge status={status} pending={outbox.length} />
            <Btn variant="ghost" className="btn--on-color" onClick={() => setSoldOutOpen(true)}>売り切れ設定</Btn>
          </>
        }
      />
      <Notices notices={state.notices} onDismiss={(id) => conn.dismiss(id)} />
      {status === "offline" && (
        <div className="warn-box" role="status">オフラインです。新しい注文が届かない可能性があります。レジと口頭で確認してください。</div>
      )}
      {!snapshot ? (
        <main className="center-message"><p>読み込んでいます…</p></main>
      ) : (
        <>
          <nav className="tabs" aria-label="表示の切り替え">
            {(["cooking", "ready", "handed"] as Tab[]).map((t) => (
              <button key={t} className={`tab tab--${t} ${tab === t ? "tab--active" : ""}`} aria-pressed={tab === t} onClick={() => setTab(t)}>
                {TAB_LABEL[t]} <span className="tab__count">{lists[t].length}</span>
              </button>
            ))}
          </nav>
          <main className={`kitchen kitchen--tab-${tab}`}>
            {(["cooking", "ready", "handed"] as Tab[]).map((t) => (
              <section key={t} className={`kitchen__col kitchen__col--${t}`} aria-label={TAB_LABEL[t]}>
                <h2 className="kitchen__heading">{TAB_LABEL[t]}（{lists[t].length}）</h2>
                {lists[t].length === 0 ? <p className="hint">ありません</p> : lists[t].map(card)}
              </section>
            ))}
          </main>
        </>
      )}

      {handing && (
        <Modal title="この注文を渡しますか？" onClose={() => setHanding(null)}>
          <p className="handover__ticket" style={{ borderColor: shop?.color }}>{label(handing)}</p>
          <p className="hint">お客さんの札の番号と同じか確認してください。</p>
          <ul className="handover__lines">
            {handing.lines.map((l) => (
              <li key={l.itemId}><span>{l.name}</span><b>×{l.qty}</b></li>
            ))}
          </ul>
          <div className="modal__actions">
            <Btn onClick={() => setHanding(null)}>やめる</Btn>
            <Btn variant="primary" big onClick={() => { conn.send({ kind: "setStatus", orderId: handing.id, status: "handed" }); setHanding(null); }}>
              札を受け取って渡した
            </Btn>
          </div>
        </Modal>
      )}

      {soldOutOpen && (
        <Modal title="売り切れ設定" onClose={() => setSoldOutOpen(false)}>
          <p className="hint">押すと「販売中」と「売り切れ」が切り替わります。レジにすぐ反映されます。</p>
          <ul className="soldout-list">
            {menu.map((m) => (
              <li key={m.id}>
                <span>{m.name}<small className="hint"> {yen(m.price)}</small></span>
                <Btn variant={m.soldOut ? "danger" : "default"} onClick={() => conn.send({ kind: "setSoldOut", itemId: m.id, soldOut: !m.soldOut })}>
                  {m.soldOut ? "売り切れ中" : "販売中"}
                </Btn>
              </li>
            ))}
          </ul>
          <div className="modal__actions"><Btn onClick={() => setSoldOutOpen(false)}>閉じる</Btn></div>
        </Modal>
      )}
    </div>
  );
}
