import { useCallback, useEffect, useState } from "react";
import type { DaySummary, ShopPublic } from "../../shared/types";
import { yen } from "../../shared/logic";
import { Btn, ShopHeader } from "../components/ui";
import { ItemTable, Kpis, SlotBars } from "../components/Summary";
import { api, ApiError, todayJst } from "../util";

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
  const cash = data?.reduce((s, d) => s + d.summary.expectedCash, 0) ?? 0;

  return (
    <div className="page">
      <ShopHeader shop={{ name: "テック部", color: "#0f172a", prefix: "" }} title="全体の売上" right={<Btn variant="ghost" className="btn--on-color" onClick={() => void load()}>更新</Btn>} />
      <div className="admin-bar">
        <label>日付 <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value || todayJst())} /></label>
      </div>
      {error && <div className="error-box" role="alert">{error}</div>}
      <main className="admin">
        {!data ? <p>読み込んでいます…</p> : (
          <>
            <div className="kpis">
              <div className="kpi kpi--main"><span>2店舗の売上合計</span><b>{yen(total)}</b></div>
              <div className="kpi"><span>注文件数</span><b>{count}件</b></div>
              <div className="kpi"><span>あるはずの現金（合計）</span><b>{yen(cash)}</b></div>
            </div>
            <div className="shop-columns">
              {data.map(({ shop, summary }) => (
                <section key={shop.id} className="shop-col" style={{ borderTopColor: shop.color }}>
                  <h2><span className="shop-dot" style={{ background: shop.color }} aria-hidden />{shop.name}</h2>
                  {!shop.configured && <p className="warn-box">合言葉が未設定です。店舗の管理画面の「設定」から設定してください。</p>}
                  <Kpis s={summary} />
                  <ItemTable s={summary} />
                  <SlotBars s={summary} />
                  {summary.closing ? (
                    summary.closing.expected !== summary.expectedCash ? (
                      <p className="warn-box">レジ締めの後に売上が変わっています。締め直してください。</p>
                    ) : (
                      <p className={summary.closing.diff === 0 ? "ok-box" : "warn-box"}>レジ締め済み・差額 {yen(summary.closing.diff)}</p>
                    )
                  ) : <p className="hint">レジ締めはまだです。</p>}
                  <a className="btn btn--default" href={`/${shop.id}/admin`}>{shop.name}の管理画面へ</a>
                </section>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
