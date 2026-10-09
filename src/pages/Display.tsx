import { useEffect, useRef, useState } from "react";
import { useConnection } from "../sync";
import { chime } from "../util";
import { yen } from "../../shared/logic";
import { accentStyle, useNow, useWakeLock } from "../components/ui";
import { IconBell, IconBellOff } from "../components/icons";

/** これより長く受け取りに来ない番号は、下の「お待ちしています」に移す */
const LONG_WAIT_MS = 5 * 60 * 1000;

type Sound = "off" | "chime" | "voice";
const SOUND_LABEL: Record<Sound, string> = { off: "音なし", chime: "チャイム", voice: "チャイム＋読み上げ" };
const NEXT_SOUND: Record<Sound, Sound> = { off: "chime", chime: "voice", voice: "off" };

const LETTER: Record<string, string> = {
  A: "エー", B: "ビー", C: "シー", D: "ディー", E: "イー", F: "エフ", G: "ジー", H: "エイチ", I: "アイ", J: "ジェー", K: "ケー", L: "エル", M: "エム",
  N: "エヌ", O: "オー", P: "ピー", Q: "キュー", R: "アール", S: "エス", T: "ティー", U: "ユー", V: "ブイ", W: "ダブリュー", X: "エックス", Y: "ワイ", Z: "ゼット",
};

/** 「A-5」→「エーの5番のお客さま、お待たせしました」 */
function speak(ticket: string) {
  if (!("speechSynthesis" in window)) return;
  const m = /^(.*?)-?(\d+)$/.exec(ticket);
  const head = m ? [...m[1].toUpperCase()].map((c) => LETTER[c] ?? c).join("") : "";
  const text = m ? `${head ? `${head}の` : ""}${m[2]}番のお客さま、お待たせしました。` : `${ticket}のお客さま、お待たせしました。`;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

export function Display({ shopId }: { shopId: string }) {
  const { state } = useConnection(shopId, "display", null);
  const data = state.display;
  const now = useNow(5000);
  // 音はブラウザの決まりで、画面を1回押してからでないと鳴らせない。毎回「音なし」から始める
  const [sound, setSound] = useState<Sound>("off");
  const prev = useRef<Set<string> | null>(null);
  useWakeLock();

  useEffect(() => {
    if (!data) return;
    const cur = new Set(data.ready.map((r) => r.ticket));
    const added = prev.current ? data.ready.filter((r) => !prev.current!.has(r.ticket)) : [];
    if (added.length && sound !== "off") {
      chime();
      if (sound === "voice") setTimeout(() => added.forEach((r) => speak(r.ticket)), 700);
    }
    prev.current = cur;
  }, [data, sound]);

  const offset = data ? data.serverTime - Date.now() : 0;
  const t = now + offset;
  const fresh = (data?.ready.filter((r) => t - r.readyAt < LONG_WAIT_MS) ?? []).slice().sort((a, b) => b.readyAt - a.readyAt);
  const waiting = data?.ready.filter((r) => t - r.readyAt >= LONG_WAIT_MS) ?? [];
  const [latest, ...others] = fresh;
  const cooking = data?.cooking ?? [];
  const menu = data?.menu ?? [];
  const clock = new Date(t).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });

  return (
    <div className="dsp" style={accentStyle(data?.shop.color)}>
      <header className="dsp__head">
        <div className="dsp__shop">
          <span className="dsp__badge" aria-hidden>{data?.shop.prefix || data?.shop.name.slice(0, 1)}</span>
          <span>{data?.shop.name ?? ""}</span>
        </div>
        {data?.waitMin != null && (
          <div className="dsp__wait">ただいま <b>約{data.waitMin}分</b> 待ち<small>（目安）</small></div>
        )}
        <time className="dsp__clock">{clock}</time>
      </header>

      <main className="dsp__body">
        <section className="dsp__ready" aria-live="polite" aria-label="お呼び出し中の番号">
          <h1 className="dsp__label">お呼び出し中 <span lang="en">Now Serving</span></h1>
          {latest ? (
            <div className="dsp__spot">
              <span className="dsp__spot-tag">ただいまお呼び出し</span>
              <span className="dsp__spot-num">{latest.ticket}</span>
            </div>
          ) : (
            <p className="dsp__empty">ただいまお呼び出し中の番号はありません</p>
          )}
          {others.length > 0 && (
            <ul className="dsp__grid">
              {others.map((r) => <li key={r.ticket} className="dsp__num">{r.ticket}</li>)}
            </ul>
          )}
          {waiting.length > 0 && (
            <div className="dsp__long">
              <h2>お受け取りをお待ちしています</h2>
              <ul>{waiting.map((r) => <li key={r.ticket}>{r.ticket}</li>)}</ul>
            </div>
          )}
        </section>

        <aside className="dsp__side">
          <section className="dsp__card">
            <h2 className="dsp__card-title">準備中 <span lang="en">Preparing</span><b>{cooking.length}</b></h2>
            {cooking.length === 0 ? <p className="dsp__muted">ありません</p> : (
              <ul className="dsp__cooking">{cooking.map((c) => <li key={c}>{c}</li>)}</ul>
            )}
          </section>
          {menu.length > 0 && (
            <section className="dsp__card dsp__menu">
              <h2 className="dsp__card-title">メニュー <span lang="en">Menu</span></h2>
              <ul>
                {menu.map((m) => (
                  <li key={m.name} className={m.soldOut ? "is-soldout" : ""}>
                    <span className="dsp__menu-name">{m.name}</span>
                    {m.soldOut ? <span className="dsp__soldout">売り切れ</span> : <b className="dsp__menu-price">{yen(m.price)}</b>}
                  </li>
                ))}
              </ul>
              {(data?.deals?.length ?? 0) > 0 && (
                <ul className="dsp__deals">{data!.deals!.map((d) => <li key={d}>{d}</li>)}</ul>
              )}
            </section>
          )}
        </aside>
      </main>

      <footer className="dsp__foot">
        <span>番号札をお持ちの方は、受け取り口へお越しください</span>
        {state.status !== "online" && <span className="dsp__offline">接続中…</span>}
        <button className="dsp__sound" onClick={() => { const next = NEXT_SOUND[sound]; setSound(next); if (next !== "off") chime(); if (next === "voice") setTimeout(() => speak(`${data?.shop.prefix ?? ""}-1`), 700); }}>
          {sound === "off" ? <IconBellOff size={18} /> : <IconBell size={18} />}
          {SOUND_LABEL[sound]}
          <small>（押すと切り替え）</small>
        </button>
      </footer>
    </div>
  );
}
