import { useEffect, useState } from "react";
import type { ShopPublic } from "../../shared/types";
import { api, load, save } from "../util";

const SCREENS: [string, string, string][] = [
  ["register", "レジ", "注文を入力して会計する"],
  ["kitchen", "厨房・受け渡し", "作る・できた・渡した"],
  ["display", "呼び出し表示", "店先のモニター用"],
  ["admin", "管理", "メニュー・売上・レジ締め"],
];

export function Home() {
  const [shops, setShops] = useState<ShopPublic[]>(() => load("shops", []));
  const [error, setError] = useState("");
  useEffect(() => {
    api<ShopPublic[]>("/api/shops", null)
      .then((s) => { setShops(s); save("shops", s); })
      .catch((e: Error) => setError(e.message));
  }, []);
  return (
    <div className="page">
      <header className="shop-header" style={{ background: "#0f172a" }}>
        <div className="shop-header__name">模擬店 会計システム</div>
      </header>
      <main className="home">
        {error && shops.length === 0 && <p className="error-box">{error}</p>}
        {shops.map((s) => (
          <section key={s.id} className="home__shop" style={{ borderColor: s.color }}>
            <h2 style={{ background: s.color }}><span className="shop-header__prefix">{s.prefix}</span>{s.name}</h2>
            <ul className="home__links">
              {SCREENS.map(([path, label, desc]) => (
                <li key={path}>
                  <a className="home__link" href={`/${s.id}/${path}`}>
                    <b>{label}</b>
                    <span>{desc}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <a className="home__master" href="/admin">テック部：全体の売上を見る</a>
      </main>
    </div>
  );
}
