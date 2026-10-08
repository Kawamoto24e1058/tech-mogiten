import { useEffect, useRef, useState } from "react";
import { useConnection } from "../sync";
import { accentStyle, useNow, useWakeLock } from "../components/ui";

const LONG_WAIT_MS = 5 * 60 * 1000;

function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1175].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g).connect(ctx.destination);
      const t = ctx.currentTime + i * 0.25;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.start(t);
      o.stop(t + 0.55);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    // 音が出せない環境
  }
}

export function Display({ shopId }: { shopId: string }) {
  const { state } = useConnection(shopId, "display", null);
  const data = state.display;
  const now = useNow(5000);
  const [sound, setSound] = useState(false);
  const prev = useRef<Set<string>>(new Set());
  useWakeLock();

  useEffect(() => {
    if (!data) return;
    const cur = new Set(data.ready.map((r) => r.ticket));
    if (sound && [...cur].some((t) => !prev.current.has(t))) chime();
    prev.current = cur;
  }, [data, sound]);

  const offset = data ? data.serverTime - Date.now() : 0;
  const fresh = data?.ready.filter((r) => now + offset - r.readyAt < LONG_WAIT_MS) ?? [];
  const waiting = data?.ready.filter((r) => now + offset - r.readyAt >= LONG_WAIT_MS) ?? [];

  return (
    <div className="display" style={accentStyle(data?.shop.color)}>
      <header className="display__header">
        <span className="display__shop">{data?.shop.name ?? ""}</span>
        <h1 className="display__title">できあがり <span lang="en">Ready</span></h1>
      </header>
      <main className="display__main" aria-live="polite">
        {fresh.length === 0 && waiting.length === 0 ? (
          <p className="display__empty">ただいまお呼び出し中の番号はありません</p>
        ) : (
          <ul className="display__list">
            {fresh.map((r) => <li key={r.ticket} className="display__num">{r.ticket}</li>)}
          </ul>
        )}
        {waiting.length > 0 && (
          <section className="display__waiting">
            <h2>お受け取りをお待ちしています</h2>
            <ul>{waiting.map((r) => <li key={r.ticket}>{r.ticket}</li>)}</ul>
          </section>
        )}
      </main>
      <footer className="display__footer">
        <span>番号札をお持ちの方は、受け取り口へお越しください</span>
        {state.status !== "online" && <span className="display__offline">接続中…</span>}
        <button className="display__sound" onClick={() => { setSound(!sound); if (!sound) chime(); }}>
          {sound ? "音あり" : "音なし（押すと音あり）"}
        </button>
      </footer>
    </div>
  );
}
