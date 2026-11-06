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

/** 商品ごとの売上（多い順）。棒はお店の色1色、商品の色は名前の横の印で示す。割引は棒にせず下に文字で */
export function ItemRanking({ s, limit, colors }: { s: DaySummary; limit?: number; colors?: Map<string, string> }) {
  if (s.items.length === 0) return <p className="hint">まだ売上がありません。</p>;
  const goods = s.items.filter((i) => i.amount >= 0);
  const discounts = s.items.filter((i) => i.amount < 0);
  const items = limit ? goods.slice(0, limit) : goods;
  const max = Math.max(...items.map((i) => i.amount), 1);
  const total = goods.reduce((a, i) => a + i.amount, 0) || 1;
  return (
    <section className="panel">
      <h3 className="panel__title">商品別</h3>
      <ul className="ranking">
        {items.map((i) => (
          <li key={i.itemId + i.name}>
            <div className="ranking__row">
              <span className="ranking__name">
                {colors?.get(i.itemId) && <i className="swatch" style={{ background: colors.get(i.itemId) }} aria-hidden />}
                {i.name}
              </span>
              <span className="ranking__qty">{i.qty}個</span>
              <b className="ranking__amount">{yen(i.amount)}</b>
            </div>
            <span className="meter" title={`${i.name}: ${yen(i.amount)}（売上の${Math.round((i.amount / total) * 100)}%）`}>
              <span style={{ width: `${(i.amount / max) * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>
      {discounts.length > 0 && (
        <p className="ranking__discounts">割引: {discounts.map((d) => `${d.name} ${d.qty}回（−${yen(-d.amount)}）`).join("、")}</p>
      )}
    </section>
  );
}

/** "10:30" → 分 */
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * 時間帯ごとの売上（30分ごと）の縦棒グラフ。最初から最後の時間帯まで、売上のない時間帯も0として並べる。
 * 棒を押す・指を当てると金額と件数が出る。「表で見る」で数字の表にもできる
 */
export function SlotBars({ s }: { s: DaySummary }) {
  if (s.slots.length === 0) return null;
  const by = new Map(s.slots.map((x) => [toMin(x.start), x]));
  const first = toMin(s.slots[0].start);
  const last = toMin(s.slots[s.slots.length - 1].start);
  const slots: { start: string; sales: number; count: number }[] = [];
  for (let m = first; m <= last; m += 30) slots.push(by.get(m) ?? { start: toTime(m), sales: 0, count: 0 });
  const max = Math.max(...slots.map((x) => x.sales), 1);
  const peak = slots.reduce((a, x) => (x.sales > a.sales ? x : a), slots[0]);
  return (
    <section className="panel">
      <h3 className="panel__title">時間帯別（30分ごと）</h3>
      <p className="hint chart__note">いちばん売れた時間帯: <b>{peak.start}〜</b>（{yen(peak.sales)}・{peak.count}件）</p>
      <div className="chart" role="group" aria-label={`時間帯ごとの売上。最大は ${peak.start} からの ${yen(peak.sales)}`}>
        <span className="chart__max">{yen(max)}</span>
        <div className="chart__bars">
          {slots.map((x) => (
            <button key={x.start} type="button" className="chart__bar" aria-label={`${x.start}から ${yen(x.sales)} ${x.count}件`}>
              <span className="chart__fill" style={{ height: `${x.sales > 0 ? Math.max((x.sales / max) * 100, 2) : 0}%` }} />
              <span className="chart__tip" role="tooltip"><b>{yen(x.sales)}</b>{x.start}〜・{x.count}件</span>
            </button>
          ))}
        </div>
        <div className="chart__axis" aria-hidden>
          {slots.map((x) => <span key={x.start}>{x.start.endsWith(":00") ? `${Number(x.start.split(":")[0])}時` : ""}</span>)}
        </div>
      </div>
      <details className="chart__table">
        <summary>表で見る</summary>
        <table>
          <thead><tr><th>時間</th><th>件数</th><th>売上</th></tr></thead>
          <tbody>{slots.map((x) => <tr key={x.start}><td>{x.start}〜</td><td>{x.count}</td><td>{yen(x.sales)}</td></tr>)}</tbody>
        </table>
      </details>
    </section>
  );
}
