import { useEffect, useState, type ReactNode } from "react";
import type { ShopPublic } from "../../shared/types";
import { accentStyle } from "../components/ui";
import { api, load, save } from "../util";

const Icon = ({ children }: { children: ReactNode }) => (
  <svg className="tile__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

const SCREENS: { path: string; label: string; desc: string; icon: ReactNode }[] = [
  { path: "register", label: "レジ", desc: "注文と会計", icon: <Icon><rect x="3" y="10" width="18" height="10" rx="2" /><path d="M7 10V5h10v5M7 14h2M11 14h2M15 14h2" /></Icon> },
  { path: "kitchen", label: "厨房", desc: "作る・渡す", icon: <Icon><path d="M4 11h16v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z" /><path d="M2 11h20M9 4c0 2 1 2 1 4M13 4c0 2 1 2 1 4" /></Icon> },
  { path: "display", label: "呼び出し", desc: "店先のモニター", icon: <Icon><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></Icon> },
  { path: "admin", label: "管理", desc: "売上・メニュー", icon: <Icon><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Icon> },
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
        <h1 className="home__title">模擬店レジ</h1>
        <p className="home__lead">使うお店と画面を選んでください</p>
        {error && shops.length === 0 && <p className="error">{error}</p>}
        {shops.map((s) => (
          <section key={s.id} className="home-shop" style={accentStyle(s.color)}>
            <h2 className="home-shop__name"><span className="shop-badge" aria-hidden>{s.prefix}</span>{s.name}</h2>
            <ul className="tiles">
              {SCREENS.map((sc) => (
                <li key={sc.path}>
                  <a className="tile" href={`/${s.id}/${sc.path}`}>
                    {sc.icon}
                    <b>{sc.label}</b>
                    <span>{sc.desc}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <a className="home__master" href="/admin">テック部：全体の売上 ›</a>
      </main>
    </div>
  );
}
