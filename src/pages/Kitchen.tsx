import { useEffect, useRef, useState } from "react";
import type { Order } from "../../shared/types";
import { menuColor, ticketLabel, yen } from "../../shared/logic";
import { AppBar, Btn, Banner, ConnBadge, Modal, Notices, Page, useIsWide, useNow, useWakeLock } from "../components/ui";
import type { CSSProperties } from "react";
import { useConnection, viewMenu, viewOrders } from "../sync";
import { chime, load, minutesSince, save } from "../util";

type View = Order & { pending: boolean };
type Tab = "cooking" | "ready" | "handed";

const TAB_LABEL: Record<Tab, string> = { cooking: "調理中", ready: "できた", handed: "渡した" };

export function Kitchen({ shopId, code, onAuthError }: { shopId: string; code: string; onAuthError: () => void }) {
  const { conn, state } = useConnection(shopId, "kitchen", code);
  const { snapshot, outbox, status } = state;
  useWakeLock();
  const now = useNow();
  const wide = useIsWide();
  // スマホは「できた（渡す）」と「調理中」を1つの一覧にまとめ、切り替えの手間をなくす
  const [tab, setTab] = useState<"active" | "handed">("active");
  // 渡したあと数秒だけ「戻す」を出す（確認の画面をなくして、押す回数を減らすかわりに）
  const [justHanded, setJustHanded] = useState<View | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [soldOutOpen, setSoldOutOpen] = useState(false);
  // 新しい注文が来たら音で知らせる（厨房は画面を見ていないことが多いため）
  const [sound, setSound] = useState(() => load("kitchenSound", false));
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (status === "auth") onAuthError();
  }, [status, onAuthError]);

  const shop = snapshot?.shop ?? null;
  const orders = viewOrders(snapshot, outbox);
  const cooking = orders.filter((o) => o.status === "cooking").sort((a, b) => a.createdAt - b.createdAt);
  const ready = orders.filter((o) => o.status === "ready").sort((a, b) => (a.readyAt ?? 0) - (b.readyAt ?? 0));
  const handed = orders.filter((o) => o.status === "handed").sort((a, b) => (b.handedAt ?? 0) - (a.handedAt ?? 0));
  const lists: Record<Tab, View[]> = { cooking, ready, handed };
  const cookingIds = cooking.map((o) => o.id).join(",");
  useEffect(() => {
    const ids = new Set(cookingIds ? cookingIds.split(",") : []);
    if (seen.current && sound && [...ids].some((id) => !seen.current!.has(id))) {
      chime();
      navigator.vibrate?.([120, 60, 120]);
    }
    if (snapshot) seen.current = ids;
  }, [cookingIds, sound, snapshot]);
  const label = (o: View) => ticketLabel(shop?.prefix ?? "", o.ticket);
  const set = (o: View, s: Tab) => conn.send({ kind: "setStatus", orderId: o.id, status: s });
  const handOver = (o: View) => {
    set(o, "handed");
    setJustHanded(o);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setJustHanded(null), 8000);
  };
  useEffect(() => () => clearTimeout(undoTimer.current), []);
  const menuIndex = new Map((snapshot?.menu ?? []).map((m, i) => [m.id, menuColor(m, i).solid]));
  const colorOf = (itemId: string) => menuIndex.get(itemId) ?? "#c7cbd1";

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
          {o.lines.filter((l) => l.price >= 0).map((l) => (
            <li key={l.itemId}>
              <span><i className="swatch" style={{ background: colorOf(l.itemId) }} aria-hidden />{l.name}</span>
              <b>×{l.qty}</b>
            </li>
          ))}
        </ul>
        {o.status === "cooking" && <Btn variant="ok" big onClick={() => set(o, "ready")}>できた</Btn>}
        {o.status === "ready" && (
          <div className="kcard__actions">
            <Btn variant="accent" big onClick={() => handOver(o)}>札を受け取って渡した</Btn>
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
          <span className="handed__items">{o.lines.filter((l) => l.price >= 0).map((l) => `${l.name}×${l.qty}`).join("、")}</span>
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
            <button
              className="appbar__btn"
              aria-pressed={sound}
              onClick={() => { const next = !sound; setSound(next); save("kitchenSound", next); if (next) chime(); }}
            >
              {sound ? "音あり" : "音なし"}
            </button>
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
          <nav className="segmented segmented--2" aria-label="表示の切り替え">
            <button className={tab === "active" ? "is-on" : ""} aria-pressed={tab === "active"} onClick={() => setTab("active")}>
              できた・調理中<span className="count">{ready.length + cooking.length}</span>
            </button>
            <button className={tab === "handed" ? "is-on" : ""} aria-pressed={tab === "handed"} onClick={() => setTab("handed")}>
              渡した<span className="count">{handed.length}</span>
            </button>
          </nav>
          <main className="kitchen">
            {tab === "handed" ? column("handed") : (
              <>
                {ready.length > 0 && <h2 className="kcol__title kitchen__sub">できた（渡す）<span className="count">{ready.length}</span></h2>}
                {ready.length > 0 && <div className="kcol">{ready.map(card)}</div>}
                <h2 className="kcol__title kitchen__sub">調理中<span className="count">{cooking.length}</span></h2>
                {cooking.length === 0 ? <p className="kcol__empty">新しい注文はありません</p> : <div className="kcol">{cooking.map(card)}</div>}
              </>
            )}
          </main>
        </>
      )}

      {justHanded && (
        <div className="toast toast--action" role="status">
          <span><b>{label(justHanded)}</b> を渡しました</span>
          <button onClick={() => { set(justHanded, "ready"); setJustHanded(null); }}>戻す</button>
        </div>
      )}

      {soldOutOpen && (
        <Modal title="売り切れ" onClose={() => setSoldOutOpen(false)}>
          <p className="hint">押すと切り替わり、レジにすぐ反映されます。</p>
          <ul className="toggle-list">
            {menu.map((m) => (
              <li key={m.id}>
                <span>{m.name}<small className="muted">{yen(m.price)}{m.stock != null && ` ・ 残り${m.stock}`}</small></span>
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
