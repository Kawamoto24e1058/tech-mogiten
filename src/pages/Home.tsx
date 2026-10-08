import { useEffect, useState, type CSSProperties } from "react";
import type { ShopPublic } from "../../shared/types";
import { accentStyle } from "../components/ui";
import { api, load, save } from "../util";

const SCREENS: { path: string; label: string; desc: string }[] = [
  { path: "register", label: "レジ", desc: "注文と会計" },
  { path: "kitchen", label: "厨房", desc: "作る・渡す" },
  { path: "display", label: "呼出", desc: "店先のモニター" },
  { path: "admin", label: "管理", desc: "売上・メニュー" },
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
    <div className="page home-page">
      <main className="home">
        <header className="home__head">
          <p className="home__eyebrow">テック部 文化祭</p>
          <h1 className="home__title">模擬店レジ</h1>
          <p className="home__lead">使うお店と画面を選んでください</p>
        </header>
        {error && shops.length === 0 && <p className="error">{error}</p>}
        {shops.map((s) => (
          <section key={s.id} className="home-shop" style={accentStyle(s.color)}>
            <h2 className="home-shop__name"><span className="shop-badge" aria-hidden>{s.prefix}</span>{s.name}</h2>
            <ul className="tiles">
              {SCREENS.map((sc, i) => (
                <li key={sc.path} style={{ "--i": i } as CSSProperties}>
                  <a className="tile" href={`/${s.id}/${sc.path}`}>
                    <b>{sc.label}</b>
                    <span>{sc.desc}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <a className="home__master" href="/admin">テック部：全体の売上 →</a>
      </main>
    </div>
  );
}
