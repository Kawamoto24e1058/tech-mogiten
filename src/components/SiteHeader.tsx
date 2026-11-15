import { Logo } from "./Logo";

/** 店舗の外の画面（ホーム・使い方・規約など）の上のバー。ロゴでトップへ、右に「店舗をつくる」 */
export function SiteHeader({ cta = true }: { cta?: boolean }) {
  return (
    <header className="guide-top">
      <a className="guide-top__brand" href="/"><Logo size={26} /><span>模擬店レジ</span></a>
      {cta && <a className="btn guide-top__cta" href="/new">店舗をつくる</a>}
    </header>
  );
}
