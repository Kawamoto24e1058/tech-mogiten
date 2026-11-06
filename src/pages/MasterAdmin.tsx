import { useCallback, useEffect, useState } from "react";
import type { DaySummary, ShopPublic } from "../../shared/types";
import { dayLabel, yen } from "../../shared/logic";
import { AppBar, Banner, Money, Page, accentStyle } from "../components/ui";
import { ItemRanking } from "../components/Summary";
import { myShops } from "../myshops";
import { adminKey, api, MASTER_KEY, todayJst } from "../util";

const CLUB = { name: "まとめて見る", color: "#374151", prefix: "全" };

/**
 * この端末で管理している店舗（管理用リンクを開いた店舗と、誰でも開ける昔からの店舗）の売上をまとめて見る。
 * サーバーには全店舗の一覧がないので、端末が覚えている店舗ごとに、その店舗の管理用キーで取りに行く
 */
export function MasterAdmin() {
  const [day, setDay] = useState(todayJst());
  const [data, setData] = useState<{ shop: ShopPublic; summary: DaySummary }[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const ids = myShops().map((m) => m.id);
    const results = await Promise.all(
      ids.map(async (id) => {
        const key = localStorage.getItem(adminKey(id)) ?? localStorage.getItem(MASTER_KEY) ?? "";
        try {
          return await api<{ shop: ShopPublic; summary: DaySummary }>(`/api/shops/${encodeURIComponent(id)}/summary?day=${day}`, key);
        } catch {
          return null; // 管理用リンクを持っていない店舗は出さない
        }
      }),
    );
    const ok = results.filter((r): r is { shop: ShopPublic; summary: DaySummary } => r != null);
    setData(ok);
    setError(ids.length > 0 && ok.length === 0 ? "まとめて見られる店舗がありません（管理用リンクを開いた店舗だけが出ます）" : "");
  }, [day]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  const total = data?.reduce((s, d) => s + d.summary.sales, 0) ?? 0;
  const count = data?.reduce((s, d) => s + d.summary.orderCount, 0) ?? 0;

  return (
    <Page shop={CLUB} className="page--work">
      <AppBar shop={CLUB} title="売上" back="/" right={<button className="appbar__btn" onClick={() => void load()}>更新</button>} />
      <main className="admin">
        <label className="day-select">
          <span>日付</span>
          <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value || todayJst())} />
          <b className="day-select__label">{dayLabel(day, data?.find((d) => d.shop.festivalStart)?.shop.festivalStart)}{day === todayJst() ? "・今日" : ""}</b>
        </label>
        {error && <Banner kind="error">{error}</Banner>}
        {!data ? <p className="hint">読み込んでいます…</p> : (
          <>
            <div className="kpis">
              <div className="kpi kpi--main"><span>{data.length}店舗の合計</span><Money value={total} /></div>
              <div className="kpi"><span>注文</span><span className="money"><span className="money__num">{count}</span><span className="money__unit">件</span></span></div>
            </div>
            <div className="shop-cards">
              {data.map(({ shop, summary }) => {
                const c = summary.closing;
                return (
                  <section key={shop.id} className="shop-card" style={accentStyle(shop.color)}>
                    <header className="shop-card__head">
                      <span className="shop-badge" aria-hidden>{shop.prefix}</span>
                      <h2>{shop.name}</h2>
                      <a className="link" href={`/${shop.id}/admin`}>詳しく ›</a>
                    </header>
                    <div className="shop-card__nums">
                      <div><span>売上</span><Money value={summary.sales} /></div>
                      <div><span>注文</span><span className="money"><span className="money__num">{summary.orderCount}</span><span className="money__unit">件</span></span></div>
                    </div>
                    <ItemRanking s={summary} limit={3} />
                    <p className={`closing-state ${c ? (c.expected !== summary.expectedCash ? "is-warn" : c.diff === 0 ? "is-ok" : "is-warn") : ""}`}>
                      {!c ? "レジ締め：まだ" : c.expected !== summary.expectedCash ? "レジ締め：締めた後に売上が変わっています" : c.diff === 0 ? "✓ レジ締め済み（差額なし）" : `レジ締め済み（差額 ${yen(c.diff)}）`}
                    </p>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </main>
    </Page>
  );
}
