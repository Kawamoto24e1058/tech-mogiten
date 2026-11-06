import { useEffect, useState, useSyncExternalStore } from "react";
import { accentStyle } from "../components/ui";
import { IconDisplay, IconNext, IconOffline, IconTicket } from "../components/icons";
import { Logo } from "../components/Logo";
import { canPromptInstall, isIOS, isStandalone, onInstallChange, promptInstall } from "../install";
import { forgetShop, myShops, type MyShop } from "../myshops";
import { adminKey, api, ApiError, codeKey, load } from "../util";

const SCREEN_NAME: Record<string, string> = { register: "レジ", kitchen: "厨房", display: "呼び出し表示", admin: "管理" };


/**
 * 最初の画面。この端末で使っている店舗だけを出す（ほかの店舗の一覧は出さない）。
 * 「どのお店の、どの担当か」を選ぶ。新しい店舗もここからつくる
 */
export function Home() {
  const [mine, setMine] = useState(myShops);
  const last = load<{ shopId: string; screen: string } | null>("lastScreen", null);
  const joined = new URLSearchParams(location.search).get("joined");
  useEffect(() => {
    if (joined) history.replaceState(null, "", "/");
  }, [joined]);
  // 削除された店舗は一覧から外す（電波がないときは何もしない）
  useEffect(() => {
    for (const m of myShops()) {
      api(`/api/shops/${encodeURIComponent(m.id)}/public`, null).catch((e) => {
        if (e instanceof ApiError && e.status === 404) {
          forgetShop(m.id);
          setMine(myShops());
        }
      });
    }
  }, []);

  const entries: MyShop[] = mine;
  // まだ店舗がない端末には、最初の案内（スタート画面）を出す
  if (entries.length === 0) return <Start />;
  const lastShop = last ? entries.find((s) => s.id === last.shopId) : undefined;
  const canAdminAny = entries.some((e) => e.open || localStorage.getItem(adminKey(e.id)));

  return (
    <div className="page home-page">
      <main className="home">
        <header className="home__head">
          <Logo size={44} />
          <div>
            <h1 className="home__title">模擬店レジ</h1>
            <p className="home__lead">自分のお店の、担当の画面を押してください。</p>
          </div>
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

        <div className="home-more">
          <a className="home-new" href="/new">
            <b>＋ 新しい店舗をつくる</b>
            <span>部・クラス・団体の代表者向け</span>
          </a>
          <JoinByLink compact />
        </div>

        <InstallCard />

        {canAdminAny && entries.length > 1 && <a className="home__master" href="/admin">この端末で管理している店舗の売上をまとめて見る</a>}
        <p className="home__terms"><a href="/terms">利用規約・プライバシーポリシー</a>　<a href="/recover">管理用リンクをなくした方</a></p>
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

/** はじめて開いた端末のスタート画面 */
function Start() {
  return (
    <div className="page home-page">
      <main className="start">
        <header className="start__hero">
          <Logo size={72} />
          <h1 className="start__title">模擬店レジ</h1>
          <p className="start__lead">文化祭・学園祭の模擬店のための、かんたん会計アプリ。<br />スマホだけで、レジ・厨房・呼び出し表示がつながります。</p>
        </header>

        <FlowPreview />

        <section className="start__choices" aria-label="はじめかた">
          <a className="start-card start-card--primary" href="/new">
            <span className="start-card__who">代表者の方</span>
            <b className="start-card__title">店舗をつくる</b>
            <span className="start-card__desc">店舗名を入れるだけで、数分で始められます。部員に配るリンクができます。</span>
          </a>
          <div className="start-card">
            <span className="start-card__who">部員の方</span>
            <b className="start-card__title">リンクを開く</b>
            <span className="start-card__desc">代表者からLINEなどで届いた「部員用リンク」を、この端末で開いてください。貼り付けても開けます。</span>
            <JoinByLink />
          </div>
        </section>

        <section className="start__features" aria-label="特長">
          <div><IconDisplay size={22} /><b>インストール不要</b><span>URLを開くだけ。ホーム画面に追加すればアプリのように使えます</span></div>
          <div><IconOffline size={22} /><b>電波が切れても会計できる</b><span>つながったら自動で送ります</span></div>
          <div><IconTicket size={22} /><b>お店ごとに分かれたデータ</b><span>売上やメニューは、ほかのお店からは見えません</span></div>
        </section>

        <section className="start__steps" aria-label="使い方">
          <h2>使い方</h2>
          <ol>
            <li><b>店舗をつくる</b>（代表者）: 店舗名・色を決める</li>
            <li><b>メニューを登録</b>: 商品と値段、まとめ買い割引など</li>
            <li><b>部員用リンクを配る</b>: 部員は一度開くだけで、レジ・厨房が使えます</li>
            <li><b>営業する</b>: 札を渡して会計 → 厨房で作る → 呼び出し表示で番号を出す</li>
          </ol>
        </section>

        <p className="start__foot">お客さんの名前や連絡先などの個人情報は入力しないでください。<br /><a href="/terms">利用規約・プライバシーポリシー</a>　<a href="/recover">管理用リンクをなくした方</a></p>
      </main>
    </div>
  );
}

/** 届いたリンク（またはキー）を貼り付けて開く */
function JoinByLink({ compact }: { compact?: boolean }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const open = () => {
    const m = /\/([a-z0-9]{1,16})\/join#k=([A-Za-z0-9_-]+)/.exec(text.trim());
    if (!m) {
      setError("リンク全体を貼り付けてください（…/join#k=… の形）");
      return;
    }
    location.href = `/${m[1]}/join#k=${m[2]}`;
  };
  return (
    <form className={`join-link ${compact ? "join-link--compact" : ""}`} onSubmit={(e) => { e.preventDefault(); open(); }}>
      {compact && <b>届いたリンクを開く</b>}
      <div className="join-link__row">
        <input className="input" value={text} onChange={(e) => { setText(e.target.value); setError(""); }} placeholder="リンクを貼り付け" aria-label="部員用・管理用リンク" />
        <button className="btn" type="submit" disabled={!text.trim()}>開く</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

/** スタート画面の図: 札を渡す → 会計 → 呼び出し の流れを、実際の画面に似せた小さな見本で見せる（飾り） */
function FlowPreview() {
  return (
    <figure className="flow" aria-label="使い方の流れ: 札を渡す、会計する、番号で呼び出す">
      <div className="flow__step">
        <div className="flow__card flow__card--ticket" aria-hidden>
          <span className="flow__label">札</span>
          <span className="flow__ticket">A-5</span>
        </div>
        <figcaption><b>1</b>札を渡す</figcaption>
      </div>
      <span className="flow__arrow" aria-hidden>→</span>
      <div className="flow__step">
        <div className="flow__card" aria-hidden>
          <div className="flow__items">
            <span><i style={{ background: "#e5484d" }} />焼きそば</span><b>×2</b>
            <span><i style={{ background: "#0090ff" }} />ラムネ</span><b>×1</b>
          </div>
          <div className="flow__total"><span>合計</span><b>750<small>円</small></b></div>
        </div>
        <figcaption><b>2</b>会計する</figcaption>
      </div>
      <span className="flow__arrow" aria-hidden>→</span>
      <div className="flow__step">
        <div className="flow__card flow__card--call" aria-hidden>
          <span className="flow__label">お呼び出し</span>
          <span className="flow__call">A-5</span>
        </div>
        <figcaption><b>3</b>番号で呼ぶ</figcaption>
      </div>
    </figure>
  );
}
