import { useCallback, useEffect, useState } from "react";
import type { Order } from "../../shared/types";
import { ticketLabel, yen } from "../../shared/logic";
import { api, ApiError, timeOf } from "../util";
import { Banner, Btn, Modal } from "./ui";

const STATUS_JA: Record<string, string> = { cooking: "調理中", ready: "できた", handed: "渡した", cancelled: "取消済" };
const REASONS = ["入力ミス", "お客さんの都合", "品切れ", "その他"];

/** レジの会計履歴（今日の分）。会計から5分以内なら、ここから取り消せる。 */
export function RegisterHistory({
  shopId, code, prefix, pending, onClose,
}: {
  shopId: string;
  code: string;
  prefix: string;
  /** まだ送信できていない会計 */
  pending: Order[];
  onClose: () => void;
}) {
  const [data, setData] = useState<{ orders: Order[]; serverTime: number; cancelWindowMs: number } | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Order | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/shops/${encodeURIComponent(shopId)}/history`;

  const load = useCallback(async () => {
    try {
      setData(await api(base, code));
      setError("");
    } catch (e) {
      setError(e instanceof ApiError && e.status === 0 ? "オフラインのため、送信済みの履歴を読み込めません" : e instanceof Error ? e.message : "エラー");
    }
  }, [base, code]);

  useEffect(() => {
    void load();
  }, [load]);

  const label = (t: number | null) => ticketLabel(prefix, t);
  const offset = data ? data.serverTime - Date.now() : 0;
  const canCancel = (o: Order) => data != null && o.status !== "cancelled" && Date.now() + offset - o.createdAt <= data.cancelWindowMs;
  const orders = data?.orders ?? [];
  const valid = orders.filter((o) => o.status !== "cancelled");

  const cancel = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`${base}/${encodeURIComponent(selected.id)}/cancel`, code, { method: "POST", body: JSON.stringify({ reason }) });
      setSelected(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      setBusy(false);
    }
  };

  const row = (o: Order, isPending = false) => (
    <li key={o.id}>
      <button className={`order-row ${o.status === "cancelled" ? "is-cancelled" : ""}`} onClick={() => !isPending && setSelected(o)} disabled={isPending}>
        <span className="order-row__no">{isPending ? "—" : `#${o.seq}`}</span>
        <span className="order-row__main">
          <span className="order-row__items">{o.lines.map((l) => `${l.name}×${l.qty}`).join("、")}</span>
          <span className="order-row__meta">
            {timeOf(o.createdAt)} ・ {label(o.ticket)} ・ {isPending ? "未送信" : STATUS_JA[o.status]}
            {o.status === "cancelled" && o.cancelReason ? `（${o.cancelReason}）` : ""}
          </span>
        </span>
        <span className="order-row__total">{yen(o.total)}</span>
      </button>
    </li>
  );

  if (selected) {
    const ok = canCancel(selected);
    return (
      <Modal title={`会計 #${selected.seq}`} onClose={() => setSelected(null)}>
        <p className="modal__summary">
          {selected.lines.map((l) => `${l.name}×${l.qty}`).join("、")}<br />
          {timeOf(selected.createdAt)} ・ {label(selected.ticket)} ・ 合計 <b>{yen(selected.total)}</b>（預かり {yen(selected.received)} ／ お釣り {yen(selected.change)}）
        </p>
        {selected.status === "cancelled" ? (
          <Banner kind="info">この会計は取り消し済みです（{selected.cancelReason}）。</Banner>
        ) : ok ? (
          <>
            <Banner kind="warn">取り消すと、お客さんに <b>{yen(selected.total)}</b> を返します。札も回収してください。</Banner>
            <div className="reason-chips" role="group" aria-label="取り消す理由">
              {REASONS.map((r) => (
                <button key={r} className={`chip ${reason === r ? "is-on" : ""}`} onClick={() => setReason(r)} aria-pressed={reason === r}>{r}</button>
              ))}
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="modal__actions">
              <Btn variant="ghost" onClick={() => setSelected(null)}>やめる</Btn>
              <Btn variant="danger" disabled={!reason || busy} onClick={() => void cancel()}>取り消して返金する</Btn>
            </div>
          </>
        ) : (
          <Banner kind="info">会計から5分以上たっているため、取り消しは管理画面（管理PIN）から行ってください。</Banner>
        )}
      </Modal>
    );
  }

  return (
    <Modal title="今日の会計" onClose={onClose}>
      <p className="hint">
        {valid.length}件・{yen(valid.reduce((s, o) => s + o.total, 0))}
        {pending.length > 0 && `（ほかに未送信 ${pending.length}件）`}。会計から5分以内なら、押して取り消せます。
      </p>
      {error && <Banner kind="warn">{error}</Banner>}
      <ul className="order-rows history-list">
        {pending.map((o) => row(o, true))}
        {orders.map((o) => row(o))}
      </ul>
      {data && orders.length === 0 && pending.length === 0 && <p className="hint">まだ会計はありません。</p>}
      <div className="modal__actions">
        <Btn variant="ghost" onClick={() => void load()}>更新</Btn>
        <Btn onClick={onClose}>閉じる</Btn>
      </div>
    </Modal>
  );
}
