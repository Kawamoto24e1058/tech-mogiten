import { useEffect, useState, type ReactNode } from "react";
import { IconChart, IconDisplay, IconKitchen, IconNext, IconRegister } from "../components/icons";
import type { ShopPublic } from "../../shared/types";
import { accentStyle } from "../components/ui";
import { api, load, save } from "../util";

const SCREENS: { path: string; label: string; desc: string; icon: ReactNode }[] = [
  { path: "register", label: "レジ", desc: "注文と会計", icon: <IconRegister size={26} /> },
  { path: "kitchen", label: "厨房", desc: "作る・渡す", icon: <IconKitchen size={26} /> },
  { path: "display", label: "呼び出し", desc: "店先のモニター", icon: <IconDisplay size={26} /> },
  { path: "admin", label: "管理", desc: "売上・メニュー", icon: <IconChart size={26} /> },
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
        <p className="home__eyebrow">テック部 ・ 文化祭</p>
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
                    <span className="tile__icon">{sc.icon}</span>
                    <b>{sc.label}</b>
                    <span>{sc.desc}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <a className="home__master" href="/admin"><IconChart size={20} />テック部：全体の売上<IconNext size={18} /></a>
      </main>
    </div>
  );
}
