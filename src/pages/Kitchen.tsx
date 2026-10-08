import { useEffect, useState } from "react";
import type { Order } from "../../shared/types";
import { ticketLabel, yen } from "../../shared/logic";
import { AppBar, Btn, Banner, ConnBadge, Modal, Notices, Page, useIsWide, useNow, useWakeLock } from "../components/ui";
import type { CSSProperties } from "react";
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
  const wide = useIsWide();
  const [tab, setTab] = useState<Tab>("cooking");
  const [handing, setHanding] = useState<View | null>(null);
  const [soldOutOpen, setSoldOutOpen] = useState(false);

  useEffect(() => {
    if (status === "auth") onAuthError();
  }, [status, onAuthError]);

  const shop = snapshot?.shop ?? null;
  const orders = viewOrders(snapshot, outbox);
  const cooking = orders.filter((o) => o.status === "cooking").sort((a, b) => a.createdAt - b.createdAt);
  const ready = orders.filter((o) => o.status === "ready").sort((a, b) => (a.readyAt ?? 0) - (b.readyAt ?? 0));
  const handed = orders.filter((o) => o.status === "handed").sort((a, b) => (b.handedAt ?? 0) - (a.handedAt ?? 0));
  const lists: Record<Tab, View[]> = { cooking, ready, handed };
  const label = (o: View) => ticketLabel(shop?.prefix ?? "", o.ticket);
  const set = (o: View, s: Tab) => conn.send({ kind: "setStatus", orderId: o.id, status: s });

  const dup = new Set(
    [...cooking, ...ready].filter((o) => o.ticket != null && !o.ticketReleased).map((o) => o.ticket!).filter((t, i, a) => a.indexOf(t) !== i),
  );

  const card = (o: View, i: number) => {
    const mins = minutesSince(o.status === "ready" && o.readyAt ? o.readyAt : o.createdAt, now);
    return (
      <article key={o.id} className={`kcard kcard--${o.status}`} style={{ "--i": i } as CSSProperties} aria-label={`${label(o)} ${TAB_LABEL[o.status as Tab]}`}>
        <div className="kcard__head">
          <span className="kcard__ticket">{label(o)}</span>
          <div className="kcard__side">
            <span className={`pill pill--${o.status}`}>{TAB_LABEL[o.status as Tab]}</span>
            <span className={`kcard__time ${mins >= 10 ? "is-late" : ""}`}>{mins === 0 ? "たった今" : `${mins}分前`}</span>
          </div>
        </div>
        {(o.pending || (o.ticket != null && dup.has(o.ticket))) && (
          <div className="kcard__tags">
            {o.pending && <span className="tag">未送信</span>}
            {o.ticket != null && dup.has(o.ticket) && <span className="tag tag--danger">札が重複</span>}
          </div>
        )}
        <ul className="kcard__lines">
          {o.lines.map((l) => (
            <li key={l.itemId}><span>{l.name}</span><b>×{l.qty}</b></li>
          ))}
        </ul>
        {o.status === "cooking" && <Btn variant="ok" big onClick={() => set(o, "ready")}>できた</Btn>}
        {o.status === "ready" && (
          <div className="kcard__actions">
            <Btn variant="accent" big onClick={() => setHanding(o)}>渡す</Btn>
            <button className="link" onClick={() => set(o, "cooking")}>調理中に戻す</button>
          </div>
        )}
      </article>
    );
  };

  const handedList = (
    <ul className="handed">
      {handed.map((o) => (
        <li key={o.id}>
          <b>{label(o)}</b>
          <span className="handed__items">{o.lines.map((l) => `${l.name}×${l.qty}`).join("、")}</span>
          <button className="link" onClick={() => set(o, "ready")}>戻す</button>
        </li>
      ))}
    </ul>
  );

  const column = (t: Tab) => (
    <section key={t} className={`kcol kcol--${t}`} aria-label={TAB_LABEL[t]}>
      {wide && <h2 className="kcol__title">{TAB_LABEL[t]}<span className="count">{lists[t].length}</span></h2>}
      {lists[t].length === 0 ? (
        <p className="kcol__empty">{t === "cooking" ? "新しい注文はありません" : t === "ready" ? "できた注文はありません" : "最近渡した注文はありません"}</p>
      ) : t === "handed" ? handedList : lists[t].map(card)}
    </section>
  );

  const menu = viewMenu(snapshot, outbox);
  const soldOutCount = menu.filter((m) => m.soldOut).length;

  return (
    <Page shop={shop} className="page--work">
      <AppBar
        shop={shop}
        title="厨房"
        back="/"
        right={
          <>
            <button className="appbar__btn" onClick={() => setSoldOutOpen(true)}>売り切れ{soldOutCount ? `（${soldOutCount}）` : ""}</button>
            <ConnBadge status={status} pending={outbox.length} />
          </>
        }
      />
      <div className="banners">
        <Notices notices={state.notices} onDismiss={(id) => conn.dismiss(id)} />
        {status === "offline" && <Banner kind="warn">オフラインです。新しい注文が届かないことがあります。レジと口頭で確認してください。</Banner>}
      </div>
      {!snapshot ? (
        <main className="empty-state"><p>読み込んでいます…</p></main>
      ) : wide ? (
        <main className="kitchen-wide">{(["cooking", "ready", "handed"] as Tab[]).map(column)}</main>
      ) : (
        <>
          <nav className="segmented" aria-label="表示の切り替え">
            {(["cooking", "ready", "handed"] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? "is-on" : ""} aria-pressed={tab === t} onClick={() => setTab(t)}>
                {TAB_LABEL[t]}<span className="count">{lists[t].length}</span>
              </button>
            ))}
          </nav>
          <main className="kitchen">{column(tab)}</main>
        </>
      )}

      {handing && (
        <Modal title="お客さんの札と同じですか？" onClose={() => setHanding(null)}>
          <p className="handover__ticket">{label(handing)}</p>
          <ul className="handover__lines">
            {handing.lines.map((l) => (
              <li key={l.itemId}><span>{l.name}</span><b>×{l.qty}</b></li>
            ))}
          </ul>
          <div className="modal__actions modal__actions--stack">
            <Btn variant="accent" big onClick={() => { set(handing, "handed"); setHanding(null); }}>札を受け取って渡した</Btn>
            <Btn variant="ghost" onClick={() => setHanding(null)}>やめる</Btn>
          </div>
        </Modal>
      )}

      {soldOutOpen && (
        <Modal title="売り切れ" onClose={() => setSoldOutOpen(false)}>
          <p className="hint">押すと切り替わり、レジにすぐ反映されます。</p>
          <ul className="toggle-list">
            {menu.map((m) => (
              <li key={m.id}>
                <span>{m.name}<small className="muted">{yen(m.price)}</small></span>
                <button
                  className={`switch ${m.soldOut ? "is-off" : "is-on"}`}
                  role="switch"
                  aria-checked={!m.soldOut}
                  onClick={() => conn.send({ kind: "setSoldOut", itemId: m.id, soldOut: !m.soldOut })}
                >
                  {m.soldOut ? "売り切れ" : "販売中"}
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </Page>
  );
}
