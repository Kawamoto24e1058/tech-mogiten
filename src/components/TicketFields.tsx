import { dayLabel, ticketLabel } from "../../shared/logic";

/**
 * 番号札と開催日の入力（はじめの設定・管理の設定で共通）。
 * 札が何のためのものかを先に説明し、枚数・文字・初日を1つずつ聞く
 */
export function TicketFields({ count, setCount, prefix, setPrefix, start, setStart }: {
  count: string; setCount: (v: string) => void;
  prefix: string; setPrefix: (v: string) => void;
  start: string; setStart: (v: string) => void;
}) {
  const n = Number(count || 0);
  const step = (d: number) => setCount(String(Math.min(999, Math.max(1, (n || 30) + d))));
  const hasLetter = prefix !== "" || undefined;
  const shown = Array.from({ length: Math.min(n, 6) }, (_, i) => i + 1);
  return (
    <div className="qs">
      <div className="q">
        <div className="q__head"><span className="q__no" aria-hidden>1</span><label className="q__label" htmlFor="tk-count">番号札を何枚用意しますか？</label></div>
        <p className="q__help">1〜{n || "◯"} の番号が、レジのボタンになります。目安は「いちばん混む時間の行列の人数 × 1.5」です。</p>
        <div className="count-stepper">
          <button type="button" className="count-stepper__btn" onClick={() => step(-5)} aria-label="5枚へらす">−</button>
          <input id="tk-count" className="input count-stepper__input" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 3))} />
          <button type="button" className="count-stepper__btn" onClick={() => step(5)} aria-label="5枚ふやす">＋</button>
          <span className="count-stepper__unit">枚</span>
        </div>
        {n > 0 && (
          <div className="tk-preview" aria-hidden>
            {shown.map((i) => <span key={i} className="tk-preview__tk">{ticketLabel(prefix, i)}</span>)}
            {n > shown.length && <span className="tk-preview__more">… {ticketLabel(prefix, n)}</span>}
          </div>
        )}
      </div>

      <div className="q">
        <div className="q__head"><span className="q__no" aria-hidden>2</span><span className="q__label" id="tk-letter">札に、数字のほかに文字が書いてありますか？</span><span className="q__tag">ふつうは「いいえ」</span></div>
        <div className="choice" role="radiogroup" aria-labelledby="tk-letter">
          <button type="button" role="radio" aria-checked={!hasLetter} className={`choice__btn ${!hasLetter ? "is-on" : ""}`} onClick={() => setPrefix("")}>
            <b>いいえ</b><span>「5」のように数字だけ</span>
          </button>
          <button type="button" role="radio" aria-checked={!!hasLetter} className={`choice__btn ${hasLetter ? "is-on" : ""}`} onClick={() => { if (!prefix) setPrefix("A"); }}>
            <b>はい</b><span>「A-5」のように文字つき</span>
          </button>
        </div>
        {hasLetter && (
          <label className="amount-row">
            <span>札の文字</span>
            <input className="input amount-row__input" value={prefix} maxLength={3} onChange={(e) => setPrefix(e.target.value.toUpperCase())} aria-label="札の文字" />
            <span className="muted">→ レジ・呼び出しでは「{ticketLabel(prefix, 5)}」</span>
          </label>
        )}
      </div>

      <div className="q">
        <div className="q__head"><span className="q__no" aria-hidden>3</span><label className="q__label" htmlFor="tk-start">文化祭の初日はいつですか？</label><span className="q__tag">任意</span></div>
        <p className="q__help">入れると、売上が「1日目 {start ? dayLabel(start) : "11/20（金）"}」「2日目」のように日ごとに分かれて見えます。空欄なら日付だけで表示します。</p>
        <input id="tk-start" className="input input--date" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </div>
    </div>
  );
}
