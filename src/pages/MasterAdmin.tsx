import { useCallback, useEffect, useState } from "react";
import type { DaySummary, ShopPublic } from "../../shared/types";
import { dayLabel, yen } from "../../shared/logic";
import { AppBar, Banner, Money, Page, accentStyle } from "../components/ui";
import { ItemRanking } from "../components/Summary";
import { api, ApiError, todayJst } from "../util";

const CLUB = { name: "テック部", color: "#374151", prefix: "T" };

export function MasterAdmin({ code, onAuthError }: { code: string; onAuthError: () => void }) {
  const [day, setDay] = useState(todayJst());
  const [data, setData] = useState<{ shop: ShopPublic; summary: DaySummary }[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/master/summary?day=${day}`, code));
      setError("");
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) onAuthError();
      setError(e instanceof Error ? e.message : "エラー");
    }
  }, [code, day, onAuthError]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  const total = data?.reduce((s, d) => s + d.summary.sales, 0) ?? 0;
  const count = data?.reduce((s, d) => s + d.summary.orderCount, 0) ?? 0;

  return (
    <Page shop={CLUB} className="page--work">
      <AppBar shop={CLUB} title="全体の売上" back="/" right={<button className="appbar__btn" onClick={() => void load()}>更新</button>} />
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
              <div className="kpi kpi--main"><span>2店舗の合計</span><Money value={total} /></div>
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
                    {shop.authRequired && !shop.configured && <Banner kind="warn">合言葉が未設定です</Banner>}
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
