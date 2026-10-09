import { useEffect, useState, useSyncExternalStore } from "react";
import type { ShopPublic } from "../../shared/types";
import { accentStyle } from "../components/ui";
import { IconNext } from "../components/icons";
import { canPromptInstall, isIOS, isStandalone, onInstallChange, promptInstall } from "../install";
import { api, load, save } from "../util";

const SCREEN_NAME: Record<string, string> = { register: "レジ", kitchen: "厨房", display: "呼び出し表示", admin: "管理" };

/** 最初の画面。「どのお店の、どの担当か」を選ぶだけにする */
export function Home() {
  const [shops, setShops] = useState<ShopPublic[]>(() => load("shops", []));
  const [error, setError] = useState("");
  const last = load<{ shopId: string; screen: string } | null>("lastScreen", null);
  useEffect(() => {
    api<ShopPublic[]>("/api/shops", null)
      .then((s) => { setShops(s); save("shops", s); })
      .catch((e: Error) => setError(e.message));
  }, []);
  const lastShop = last ? shops.find((s) => s.id === last.shopId) : undefined;

  return (
    <div className="page home-page">
      <main className="home">
        <header>
          <h1 className="home__title">模擬店レジ</h1>
          <p className="home__lead">自分のお店の、担当の画面を押してください。</p>
        </header>

        {error && shops.length === 0 && <p className="error">{error}</p>}

        {last && lastShop && SCREEN_NAME[last.screen] && (
          <a className="resume" href={`/${last.shopId}/${last.screen}`} style={accentStyle(lastShop.color)}>
            <span className="resume__label">前回の続きから</span>
            <span className="resume__target">{lastShop.name} の {SCREEN_NAME[last.screen]}</span>
            <IconNext size={24} />
          </a>
        )}

        {shops.map((s) => (
          <section key={s.id} className="home-shop" style={accentStyle(s.color)} aria-label={s.name}>
            <h2 className="home-shop__name">{s.name}</h2>
            <div className="role-grid">
              <a className="role role--main" href={`/${s.id}/register`}>
                <b>レジ</b>
                <span>注文を聞いて、会計する人</span>
              </a>
              <a className="role role--main" href={`/${s.id}/kitchen`}>
                <b>厨房</b>
                <span>作って、お客さんに渡す人</span>
              </a>
            </div>
            <div className="role-links">
              <a href={`/${s.id}/display`}>呼び出し表示<small>（店先のモニター用）</small></a>
              <a href={`/${s.id}/admin`}>管理<small>（売上・メニュー・締め）</small></a>
            </div>
          </section>
        ))}

        <InstallCard />

        <a className="home__master" href="/admin">2店舗の売上をまとめて見る（テック部）</a>
      </main>
    </div>
  );
}

/** この端末のホーム画面（PCはアプリ一覧）に追加する案内。追加済みなら出さない */
function InstallCard() {
  const canPrompt = useSyncExternalStore(onInstallChange, canPromptInstall);
  const [iosHelp, setIosHelp] = useState(false);
  if (isStandalone()) return null;
  const ios = isIOS();
  if (!canPrompt && !ios) return null;
  return (
    <section className="install" aria-label="ホーム画面に追加">
      <div className="install__text">
        <b>ホーム画面に追加</b>
        <span>アイコンから、前回の担当の画面がすぐ開きます。電波が弱くても開けます。</span>
      </div>
      {canPrompt ? (
        <button className="btn btn--accent" onClick={() => void promptInstall()}>追加する</button>
      ) : (
        <button className="btn" onClick={() => setIosHelp((v) => !v)} aria-expanded={iosHelp}>やり方</button>
      )}
      {iosHelp && (
        <ol className="install__steps">
          <li>Safari の下の <b>共有ボタン</b>（四角から矢印が出ているもの）を押す</li>
          <li><b>「ホーム画面に追加」</b>を押す（見つからなければ下にスクロール）</li>
          <li>右上の <b>「追加」</b>を押す</li>
        </ol>
      )}
    </section>
  );
}
