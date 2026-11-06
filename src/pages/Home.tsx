import { useEffect, useState, useSyncExternalStore } from "react";
import { accentStyle } from "../components/ui";
import { IconNext } from "../components/icons";
import { canPromptInstall, isIOS, isStandalone, onInstallChange, promptInstall } from "../install";
import { forgetShop, migrateOldShops, myShops, type MyShop } from "../myshops";
import { adminKey, codeKey, load } from "../util";

const SCREEN_NAME: Record<string, string> = { register: "レジ", kitchen: "厨房", display: "呼び出し表示", admin: "管理" };


/**
 * 最初の画面。この端末で使っている店舗だけを出す（ほかの店舗の一覧は出さない）。
 * 「どのお店の、どの担当か」を選ぶ。新しい店舗もここからつくる
 */
export function Home() {
  const [mine, setMine] = useState(() => { migrateOldShops(); return myShops(); });
  const last = load<{ shopId: string; screen: string } | null>("lastScreen", null);
  const joined = new URLSearchParams(location.search).get("joined");
  useEffect(() => {
    if (joined) history.replaceState(null, "", "/");
  }, [joined]);

  const entries: MyShop[] = mine;
  const lastShop = last ? entries.find((s) => s.id === last.shopId) : undefined;
  const canAdminAny = entries.some((e) => e.open || localStorage.getItem(adminKey(e.id)));

  return (
    <div className="page home-page">
      <main className="home">
        <header>
          <h1 className="home__title">模擬店レジ</h1>
          <p className="home__lead">自分のお店の、担当の画面を押してください。</p>
        </header>

        {joined && entries.some((e) => e.id === joined) && (
          <p className="home__joined" role="status">「{entries.find((e) => e.id === joined)?.name}」をこの端末で使えるようにしました。</p>
        )}

        {last && lastShop && SCREEN_NAME[last.screen] && (
          <a className="resume" href={`/${last.shopId}/${last.screen}`} style={accentStyle(lastShop.color)}>
            <span className="resume__label">前回の続きから</span>
            <span className="resume__target">{lastShop.name} の {SCREEN_NAME[last.screen]}</span>
            <IconNext size={24} />
          </a>
        )}

        {entries.length === 0 && (
          <section className="home-empty">
            <h2>まだ店舗がありません</h2>
            <p>部員の人は、代表者から届いた<b>「部員用リンク」</b>をこの端末で開いてください。お店がここに出てきます。</p>
            <p>代表者の人は、下の「新しい店舗をつくる」から始めてください。</p>
          </section>
        )}

        {entries.map((s) => {
          const staff = s.open || !!localStorage.getItem(codeKey(s.id)) || !!localStorage.getItem(adminKey(s.id));
          const admin = s.open || !!localStorage.getItem(adminKey(s.id));
          return (
            <section key={s.id} className="home-shop" style={accentStyle(s.color)} aria-label={s.name}>
              <h2 className="home-shop__name">{s.name}{s.organization && <small className="home-shop__org">{s.organization}</small>}</h2>
              {staff ? (
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
              ) : (
                <p className="home-shop__locked">この端末では、まだ使えません。代表者から「部員用リンク」をもらって開いてください。</p>
              )}
              <div className="role-links">
                <a href={`/${s.id}/display`}>呼び出し表示<small>（店先のモニター用）</small></a>
                {admin && <a href={`/${s.id}/admin`}>管理<small>（売上・メニュー・共有リンク）</small></a>}
                {!s.open && (
                  <button className="link home-shop__forget" onClick={() => { if (confirm(`「${s.name}」をこの端末から外しますか？（お店のデータは消えません。もう一度使うにはリンクを開き直します）`)) { forgetShop(s.id); setMine(myShops()); } }}>
                    この端末から外す
                  </button>
                )}
              </div>
            </section>
          );
        })}

        <a className="home-new" href="/new">
          <b>＋ 新しい店舗をつくる</b>
          <span>部・クラス・団体の代表者向け。数分で始められます</span>
        </a>

        <InstallCard />

        {canAdminAny && entries.length > 1 && <a className="home__master" href="/admin">この端末で管理している店舗の売上をまとめて見る</a>}
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
