import type { DaySummary } from "../../shared/types";
import { yen } from "../../shared/logic";

export function Kpis({ s }: { s: DaySummary }) {
  return (
    <div className="kpis">
      <div className="kpi kpi--main"><span>売上</span><b>{yen(s.sales)}</b></div>
      <div className="kpi"><span>注文件数</span><b>{s.orderCount}件</b></div>
      <div className="kpi"><span>客単価</span><b>{yen(s.averagePerOrder)}</b></div>
      <div className="kpi"><span>キャンセル</span><b>{s.cancelledCount}件・{yen(s.cancelledAmount)}</b></div>
      <div className="kpi"><span>あるはずの現金</span><b>{yen(s.expectedCash)}</b><small>準備金 {yen(s.floatCash)} ＋ 売上</small></div>
    </div>
  );
}

export function ItemTable({ s }: { s: DaySummary }) {
  if (s.items.length === 0) return <p className="hint">まだ売上がありません。</p>;
  return (
    <table className="table">
      <caption>商品別</caption>
      <thead><tr><th scope="col">商品</th><th scope="col" className="num">個数</th><th scope="col" className="num">金額</th></tr></thead>
      <tbody>
        {s.items.map((i) => (
          <tr key={i.itemId + i.name}><td>{i.name}</td><td className="num">{i.qty}</td><td className="num">{yen(i.amount)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export function SlotBars({ s }: { s: DaySummary }) {
  if (s.slots.length === 0) return null;
  const max = Math.max(...s.slots.map((x) => x.sales), 1);
  return (
    <figure className="bars">
      <figcaption>30分ごとの売上</figcaption>
      <ul>
        {s.slots.map((x) => (
          <li key={x.start}>
            <span className="bars__label">{x.start}〜</span>
            <span className="bars__track"><span className="bars__fill" style={{ width: `${(x.sales / max) * 100}%` }} /></span>
            <span className="bars__value">{yen(x.sales)}<small>（{x.count}件）</small></span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
