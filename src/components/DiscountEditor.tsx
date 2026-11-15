import { useEffect, useState } from "react";
import type { DiscountRule, MenuItem } from "../../shared/types";
import { yen } from "../../shared/logic";
import { Btn } from "./ui";

/** 選んだ商品の値段がそろっていれば、その値段（「N個で◯円」と聞ける）。ばらばらなら null（「N個ごとに◯円引き」と聞く） */
function samePrice(items: MenuItem[]): number | null {
  const prices = new Set(items.map((m) => m.price));
  return prices.size === 1 ? items[0].price : null;
}

/** 割引を、ふだんの言葉の1文にする。例: 「ねぎま・もも を 2個で 250円（50円お得）」 */
export function describeRule(r: DiscountRule, menu: MenuItem[]): string {
  const targets = menu.filter((m) => r.itemIds.includes(m.id));
  const names = targets.map((m) => m.name).join("・") || "（商品が見つかりません）";
  const p = samePrice(targets);
  return p != null
    ? `${names} を ${r.every}個で ${yen(p * r.every - r.off)}（${yen(r.off)}お得）`
    : `${names} を 合わせて${r.every}個ごとに ${yen(r.off)}引き`;
}

/**
 * まとめ買い割引の入力。「どの商品を・何個まとめると・いくらにするか」を順に聞き、
 * レジでの値段の例をその場で見せる。保存する形（N個ごとに◯円引き）への変換はここで行う
 */
export function DiscountEditor({ items, initial, saveLabel, onSave, extra, onDraft }: {
  items: MenuItem[];
  initial?: DiscountRule;
  saveLabel: string;
  onSave: (rule: DiscountRule) => Promise<unknown> | void;
  extra?: React.ReactNode;
  /** 入力が完成している割引（まだ保存していない）を親に知らせる。「次へ」で保存し忘れないように */
  onDraft?: (rule: DiscountRule | null) => void;
}) {
  const [ids, setIds] = useState<string[]>(initial?.itemIds ?? []);
  const [n, setN] = useState(initial?.every ?? 2);
  const initialSame = initial ? samePrice(items.filter((m) => initial.itemIds.includes(m.id))) : null;
  const [setPrice, setSetPrice] = useState(initial && initialSame != null ? String(initialSame * initial.every - initial.off) : "");
  const [offText, setOffText] = useState(initial ? String(initial.off) : "");
  const [name, setName] = useState(initial?.name ?? "");
  const [busy, setBusy] = useState(false);

  const selected = items.filter((m) => ids.includes(m.id));
  const p = selected.length ? samePrice(selected) : null;
  const normal = p != null ? p * n : 0;
  const off = p != null ? (setPrice ? normal - Number(setPrice) : 0) : Number(offText || 0);
  const priceError = p != null && setPrice !== "" && !(Number(setPrice) > 0 && Number(setPrice) < normal)
    ? `${n}個のふつうの値段（${yen(normal)}）より安く、0円より高くしてください`
    : "";
  const autoName = p != null ? `${n}個で${yen(Number(setPrice || 0))}` : `${n}個ごとに${yen(off)}引き`;
  const ok = selected.length > 0 && n >= 1 && off > 0 && !priceError;
  const sample = selected[0];
  const counts = [...new Set([1, n, n + 1, n * 2])].filter((k) => k >= 1).sort((a, b) => a - b);
  const draft: DiscountRule | null = ok ? { id: initial?.id ?? "", name: name.trim() || autoName, itemIds: ids, every: n, off, enabled: initial?.enabled ?? true } : null;
  const draftKey = draft ? JSON.stringify(draft) : "";
  useEffect(() => { onDraft?.(draft); }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  const save = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      if (draft) await onSave(draft);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="disc">
      <div className="qs">
        <div className="q">
          <div className="q__head"><span className="q__no" aria-hidden>1</span><span className="q__label" id="disc-items">どの商品をまとめ買いにしますか？</span></div>
          <p className="q__help">2つ以上選ぶと、合わせて数えます（例: ももタレ1本＋もも塩1本で「2本」）。</p>
          <div className="pick-chips" role="group" aria-labelledby="disc-items">
            {items.map((m) => (
              <button key={m.id} type="button" className={`pick-chip ${ids.includes(m.id) ? "is-on" : ""}`} aria-pressed={ids.includes(m.id)} onClick={() => toggle(m.id)}>
                {ids.includes(m.id) ? "✓ " : ""}{m.name}<small className="pick-chip__price">{yen(m.price)}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="q">
          <div className="q__head"><span className="q__no" aria-hidden>2</span><label className="q__label" htmlFor="disc-n">何個まとめると安くなりますか？</label></div>
          <div className="count-stepper">
            <button type="button" className="count-stepper__btn" onClick={() => setN(Math.max(1, n - 1))} aria-label="1つへらす">−</button>
            <input id="disc-n" className="input count-stepper__input" inputMode="numeric" value={n} onChange={(e) => setN(Math.min(20, Math.max(1, Number(e.target.value.replace(/\D/g, "") || 1))))} />
            <button type="button" className="count-stepper__btn" onClick={() => setN(Math.min(20, n + 1))} aria-label="1つふやす">＋</button>
            <span className="count-stepper__unit">個</span>
          </div>
        </div>

        <div className="q">
          <div className="q__head"><span className="q__no" aria-hidden>3</span>
            <label className="q__label" htmlFor="disc-amount">{p != null || selected.length === 0 ? `${n}個でいくらにしますか？` : `${n}個ごとに、いくら引きますか？`}</label>
          </div>
          {selected.length === 0 ? (
            <p className="q__help">先に、1 で商品を選んでください。</p>
          ) : p != null ? (
            <>
              <p className="q__help">ふつうは {n}個で <b>{yen(normal)}</b> です。</p>
              <div className="amount-row">
                <span>{n}個で</span>
                <input id="disc-amount" className="input amount-row__input" inputMode="numeric" value={setPrice} placeholder={String(Math.max(normal - 50, 1))} onChange={(e) => setSetPrice(e.target.value.replace(/\D/g, "").slice(0, 6))} aria-invalid={!!priceError} />
                <span>円</span>
                {off > 0 && !priceError && <span className="amount-row__save">{yen(off)}お得</span>}
              </div>
              {priceError && <p className="field-error" role="alert">{priceError}</p>}
            </>
          ) : (
            <>
              <p className="q__help">値段の違う商品を選んでいるので、「引く金額」で決めます。</p>
              <div className="amount-row">
                <span>{n}個ごとに</span>
                <input id="disc-amount" className="input amount-row__input" inputMode="numeric" value={offText} placeholder="50" onChange={(e) => setOffText(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                <span>円引き</span>
              </div>
            </>
          )}
        </div>
      </div>

      {sample && off > 0 && !priceError && (
        <div className="disc-preview" aria-live="polite">
          <p className="disc-preview__title">レジではこうなります<small>{p == null ? `（${sample.name}だけを買ったとき）` : selected.length > 1 ? `（${selected.map((m) => m.name).join("・")}を合わせた数。組み合わせは自由）` : ""}</small></p>
          <table>
            <tbody>
              {counts.map((k) => {
                const before = sample.price * k;
                const after = before - Math.floor(k / n) * off;
                return (
                  <tr key={k} className={after < before ? "is-off" : ""}>
                    <th>{p != null && selected.length > 1 ? "" : `${sample.name} `}{k}個</th>
                    <td>{after < before && <s>{yen(before)}</s>}</td>
                    <td><b>{yen(after)}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <label className="field disc__name">レジの明細に出る名前<small className="muted">空欄なら「{autoName}」</small>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder={autoName} />
      </label>

      <div className="disc__actions">
        {extra}
        <Btn variant="accent" onClick={() => void save()} disabled={!ok || busy}>{saveLabel}</Btn>
      </div>
    </div>
  );
}
