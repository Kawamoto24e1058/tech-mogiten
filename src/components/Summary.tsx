import type { DaySummary } from "../../shared/types";
import { yen } from "../../shared/logic";
import { Money } from "./ui";

export function Kpis({ s, compact }: { s: DaySummary; compact?: boolean }) {
  return (
    <div className={`kpis ${compact ? "kpis--compact" : ""}`}>
      <div className="kpi kpi--main"><span>売上</span><Money value={s.sales} /></div>
      <div className="kpi"><span>注文</span><span className="money"><span className="money__num">{s.orderCount}</span><span className="money__unit">件</span></span></div>
      {!compact && <div className="kpi"><span>あるはずの現金</span><Money value={s.expectedCash} /></div>}
    </div>
  );
}

export function SubStats({ s }: { s: DaySummary }) {
  return (
    <p className="substats">
      客単価 <b>{yen(s.averagePerOrder)}</b>
      <span aria-hidden>・</span>
      キャンセル <b>{s.cancelledCount}件</b>{s.cancelledCount > 0 && `（${yen(s.cancelledAmount)}）`}
    </p>
  );
}

export function ItemRanking({ s, limit }: { s: DaySummary; limit?: number }) {
  if (s.items.length === 0) return <p className="hint">まだ売上がありません。</p>;
  const items = limit ? s.items.slice(0, limit) : s.items;
  const max = Math.max(...items.map((i) => i.amount), 1);
  return (
    <section className="panel">
      <h3 className="panel__title">商品別</h3>
      <ul className="ranking">
        {items.map((i) => (
          <li key={i.itemId + i.name}>
            <div className="ranking__row">
              <span className="ranking__name">{i.name}</span>
              <span className="ranking__qty">{i.qty}個</span>
              <b className="ranking__amount">{yen(i.amount)}</b>
            </div>
            <span className="meter"><span style={{ width: `${(i.amount / max) * 100}%` }} /></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SlotBars({ s }: { s: DaySummary }) {
  if (s.slots.length === 0) return null;
  const max = Math.max(...s.slots.map((x) => x.sales), 1);
  return (
    <section className="panel">
      <h3 className="panel__title">時間帯別（30分ごと）</h3>
      <ul className="slots">
        {s.slots.map((x) => (
          <li key={x.start}>
            <span className="slots__time">{x.start}</span>
            <span className="meter"><span style={{ width: `${(x.sales / max) * 100}%` }} /></span>
            <span className="slots__value">{yen(x.sales)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
