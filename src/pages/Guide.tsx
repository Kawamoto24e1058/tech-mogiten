import { SiteHeader } from "../components/SiteHeader";

const STEPS: [string, string][] = [
  ["お店をつくる", "代表者が「店舗をつくる」から、お店の名前を入れます。登録やログインはいりません。"],
  ["商品と札を設定", "商品と値段、割引（「2本で300円」など）、番号札の枚数を、順番に設定します。"],
  ["部員にリンクを配る", "部員用リンクを LINE などで送ります。部員は一度開くだけで、レジ・厨房が使えます。"],
  ["当日はそれぞれの画面を開く", "レジ係はレジ、焼く係は厨房、店先のモニターは呼び出し表示。注文はすぐに全部の画面へ届きます。"],
];

const FEATURES: [string, string][] = [
  ["レジ", "札を選ぶ → 商品を押す → お預かりを入れる → お釣りが大きく出る。割引は自動で引かれます。"],
  ["厨房", "注文が届いた順に並び、1回押すと「できた」、もう1回で「渡した」。商品の色の印で探しやすく。"],
  ["呼び出し表示", "できた番号をお客さん向けに大きく表示。チャイムと読み上げ、昼・夜の表示に対応。"],
  ["売上・締め", "日ごとの売上、商品別・時間帯別、CSV と日報（印刷・PDF）、閉店後のレジ締めまで。"],
];

const FAQ: [string, string][] = [
  ["料金はかかりますか？", "無料です。広告もありません。"],
  ["どんな端末で使えますか？", "スマホ・タブレット・パソコンのブラウザで動きます（Chrome・Safari・Edge の新しい版）。アプリのインストールはいりませんが、ホーム画面に追加するとアプリのように開けます。"],
  ["電波が切れたらどうなりますか？", "レジは、送れなかった注文を端末に取っておき、つながったときに自動で送ります。画面の右上に「オフライン・未送信◯件」と出ます。長く切れる場所では、Wi-Fi などの安定した回線を用意してください。"],
  ["ほかの店舗にデータを見られませんか？", "店舗ごとにデータを分けて保存しています。店舗の一覧は公開しておらず、共有リンク（推測できない長いキー）を持っている端末だけが開けます。"],
  ["管理用リンクをなくしたら？", "店舗をつくったときに表示される「復旧コード」があれば、新しい管理用リンクを出せます。トップの「管理用リンクをなくした方」から進んでください。"],
  ["データはいつ消えますか？", "最後に使ってから180日たつと自動で消えます。管理画面からすぐに消すこともできます。売上の控えは CSV や日報で取っておいてください。"],
  ["キャッシュレス決済には対応していますか？", "対応していません。現金での会計と、注文の受け渡しを手助けするためのアプリです。"],
  ["個人情報は入力しますか？", "入力しないでください。お客さんの名前や連絡先は不要です。"],
];

/** 使い方・よくある質問。はじめて知った人・先生・実行委員が「使ってよいか」を判断できるように */
export function Guide() {
  return (
    <div className="page page--grid guide-page">
      <SiteHeader />
      <main className="guide">
        <section className="guide__hero">
          <p className="eyebrow">Guide</p>
          <h1>文化祭の模擬店のための、<br />無料の会計アプリ</h1>
          <p className="guide__lead">レジ・厨房・呼び出し表示・売上の締めまで、ブラウザだけで。部・クラスごとにお店をつくって、リンクを配るだけで使えます。</p>
        </section>

        <section className="guide__sec">
          <h2>始め方</h2>
          <ol className="guide__steps">
            {STEPS.map(([t, d], i) => (
              <li key={t}><span className="guide__no">{String(i + 1).padStart(2, "0")}</span><b>{t}</b><span>{d}</span></li>
            ))}
          </ol>
        </section>

        <section className="guide__sec">
          <h2>できること</h2>
          <dl className="guide__grid">
            {FEATURES.map(([t, d]) => (
              <div key={t}><dt>{t}</dt><dd>{d}</dd></div>
            ))}
          </dl>
        </section>

        <section className="guide__sec">
          <h2>用意するもの</h2>
          <ul className="guide__list">
            <li><b>端末</b>　レジ用に1台以上（タブレットがおすすめ）。厨房用・呼び出しモニター用があると便利です。部員のスマホでも使えます。</li>
            <li><b>インターネット</b>　Wi-Fi かモバイル回線。</li>
            <li><b>番号札</b>　お客さんに渡す札（1〜30 など）。札を使わない会計もできます。</li>
          </ul>
        </section>

        <section className="guide__sec">
          <h2>よくある質問</h2>
          <div className="guide__faq">
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="guide__sec guide__end">
          <h2>さっそく使ってみる</h2>
          <div className="guide__end-body">
            <p>店舗をつくると、商品の登録から部員への共有まで、1つずつ案内します。</p>
            <a className="btn btn--accent btn--big guide__end-btn" href="/new">店舗をつくる</a>
          </div>
        </section>
      </main>
      <footer className="guide-foot">
        <a href="/terms">利用規約・プライバシーポリシー</a>
        <span aria-hidden>・</span>
        <a href="/recover">管理用リンクをなくした方</a>
        <span aria-hidden>・</span>
        <span>運営: 桃山学院大学 テック部（<a href="mailto:tech@andrew.ac.jp">tech@andrew.ac.jp</a>）</span>
      </footer>
    </div>
  );
}
