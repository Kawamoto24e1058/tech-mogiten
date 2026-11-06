import { useEffect, useState } from "react";
import type { DaySummary, Order, ShopPublic } from "../../shared/types";
import { dayLabel, ticketLabel, yen } from "../../shared/logic";
import { api, timeOf, todayJst } from "../util";

interface State {
  shop: ShopPublic;
  orders: Order[];
}

/** 日報。1日の売上・商品ごとの数・時間帯・取り消し・レジ締めを1枚にまとめる（印刷・PDF保存用） */
export function Report({ shopId, code }: { shopId: string; code: string }) {
  const day = new URLSearchParams(location.search).get("day") || todayJst();
  const [sum, setSum] = useState<DaySummary | null>(null);
  const [st, setSt] = useState<State | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const base = `/api/shops/${encodeURIComponent(shopId)}/admin`;
    Promise.all([api<DaySummary>(`${base}/summary?day=${day}`, code), api<State>(`${base}/state?day=${day}`, code)])
      .then(([s, a]) => { setSum(s); setSt(a); document.title = `日報 ${a.shop.name} ${day}`; })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込めませんでした"));
  }, [shopId, code, day]);

  if (error) return <main className="report"><p className="error">{error}</p></main>;
  if (!sum || !st) return <main className="report"><p>読み込んでいます…</p></main>;
  const c = sum.closing;
  const cancelled = st.orders.filter((o) => o.status === "cancelled");
  const discounts = sum.items.filter((i) => i.amount < 0);
  const goods = sum.items.filter((i) => i.amount >= 0);
  const qty = goods.reduce((a, i) => a + i.qty, 0);

  return (
    <main className="report">
      <div className="report__tools no-print">
        <a className="btn" href={`/${shopId}/admin`}>管理画面に戻る</a>
        <button className="btn btn--accent" onClick={() => window.print()}>印刷・PDFに保存</button>
      </div>
      <header className="report__head">
        <h1>日報</h1>
        <p><b>{st.shop.name}</b>{st.shop.organization && `（${st.shop.organization}）`}　{dayLabel(day, st.shop.festivalStart)}</p>
        <p className="report__muted">作成 {new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</p>
      </header>

      <section>
        <h2>売上</h2>
        <table className="report__table">
          <tbody>
            <tr><th>売上（取り消しを除く）</th><td className="num big">{yen(sum.sales)}</td></tr>
            <tr><th>会計の件数</th><td className="num">{sum.orderCount}件</td></tr>
            <tr><th>売れた商品の数</th><td className="num">{qty}個</td></tr>
            <tr><th>1件あたり</th><td className="num">{yen(sum.averagePerOrder)}</td></tr>
            <tr><th>取り消し</th><td className="num">{sum.cancelledCount}件（{yen(sum.cancelledAmount)}）</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>商品ごと</h2>
        <table className="report__table">
          <thead><tr><th>商品</th><th className="num">数</th><th className="num">金額</th></tr></thead>
          <tbody>
            {goods.map((i) => <tr key={i.itemId}><td>{i.name}</td><td className="num">{i.qty}</td><td className="num">{yen(i.amount)}</td></tr>)}
            {discounts.map((i) => <tr key={i.itemId}><td>{i.name}（割引）</td><td className="num">{i.qty}</td><td className="num">−{yen(-i.amount)}</td></tr>)}
            {sum.items.length === 0 && <tr><td colSpan={3}>この日の売上はありません</td></tr>}
          </tbody>
        </table>
      </section>

      {sum.slots.length > 0 && (
        <section>
          <h2>時間帯（30分ごと）</h2>
          <table className="report__table">
            <thead><tr><th>時間</th><th className="num">件数</th><th className="num">売上</th></tr></thead>
            <tbody>{sum.slots.map((s) => <tr key={s.start}><td>{s.start}〜</td><td className="num">{s.count}</td><td className="num">{yen(s.sales)}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      <section>
        <h2>現金・レジ締め</h2>
        <table className="report__table">
          <tbody>
            <tr><th>釣り銭準備金</th><td className="num">{yen(sum.floatCash)}</td></tr>
            <tr><th>あるはずの現金</th><td className="num">{yen(sum.expectedCash)}</td></tr>
            <tr><th>数えた現金</th><td className="num">{c ? yen(c.counted) : "まだ締めていません"}</td></tr>
            <tr><th>差額</th><td className="num">{c ? (c.diff === 0 ? "0円（ぴったり）" : `${c.diff > 0 ? "多い" : "足りない"} ${yen(Math.abs(c.diff))}`) : "—"}</td></tr>
            {c?.memo && <tr><th>メモ</th><td>{c.memo}</td></tr>}
            {c && c.expected !== sum.expectedCash && <tr><th>注意</th><td>締めた後に売上が変わっています</td></tr>}
          </tbody>
        </table>
      </section>

      {cancelled.length > 0 && (
        <section>
          <h2>取り消した会計</h2>
          <table className="report__table">
            <thead><tr><th>時刻</th><th>札</th><th>内容</th><th className="num">金額</th><th>理由</th></tr></thead>
            <tbody>
              {cancelled.map((o) => (
                <tr key={o.id}>
                  <td>{timeOf(o.createdAt)}</td>
                  <td>{ticketLabel(st.shop.prefix, o.ticket)}</td>
                  <td>{o.lines.filter((l) => l.price >= 0).map((l) => `${l.name}×${l.qty}`).join("、")}</td>
                  <td className="num">{yen(o.total)}</td>
                  <td>{o.cancelReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <footer className="report__sign">
        <span>確認者</span><span className="report__line" />
        <span>責任者</span><span className="report__line" />
      </footer>
    </main>
  );
}
