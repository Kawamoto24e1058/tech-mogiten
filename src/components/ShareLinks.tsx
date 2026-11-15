import { useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { Banner, Btn } from "./ui";

function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  return <div className="qr" role="img" aria-label="QRコード" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * リンク1つ分。「誰に・何ができるか」を先に書き、送る・コピー・QR を並べる。
 * URL そのものは長くて分かりにくいので、必要なときだけ開いて見せる
 */
export function LinkRow({ who, title, note, url, warn, openHere, tone = "default" }: {
  who: string; title: string; note: string; url: string; warn?: string; openHere?: boolean; tone?: "default" | "private";
}) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState(false);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt("コピーしてください", url);
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title, url });
    } catch {
      // 共有をやめたとき
    }
  };
  return (
    <div className={`link-row link-row--${tone}`}>
      <div className="link-row__head">
        <span className="link-row__who">{who}</span>
        <b className="link-row__title">{title}</b>
        <span className="link-row__note">{note}</span>
      </div>
      {warn && <Banner kind="warn">{warn}</Banner>}
      <div className="row link-row__actions">
        {canShare && tone !== "private" && <Btn variant="accent" onClick={() => void share()}>LINE などで送る</Btn>}
        <Btn variant={!canShare && tone !== "private" ? "accent" : "default"} onClick={() => void copy()}>{copied ? "✓ コピーしました" : "リンクをコピー"}</Btn>
        {openHere && <a className="btn" href={url} target="_blank" rel="noreferrer">この端末で開く</a>}
        <Btn variant="ghost" onClick={() => setQr(!qr)} ariaLabel={`${title}のQRコードを${qr ? "閉じる" : "表示"}`}>{qr ? "QRを閉じる" : "QRコード"}</Btn>
      </div>
      {qr && (
        <div className="link-row__qr">
          <Qr text={url} />
          <span className="hint">相手のスマホのカメラで読み取ると開けます。</span>
        </div>
      )}
      <details className="link-row__raw">
        <summary>リンクの文字を見る</summary>
        <input className="input link-row__url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={`${title}のURL`} />
      </details>
    </div>
  );
}

/** 復旧コード。見られるのはこの1回だけなので、保存してもらう */
export function RecoveryCodeBox({ code, shopName, onSaved }: { code: string; shopName: string; onSaved?: (saved: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const text = `模擬店レジ「${shopName}」の復旧コード\n${code}\n管理用リンクをなくしたら ${location.origin}/recover で使います。`;
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = `復旧コード-${shopName}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="recovery">
      <div className="link-row__head">
        <span className="link-row__who">代表者だけが保存</span>
        <b className="link-row__title">復旧コード</b>
        <span className="link-row__note">管理用リンクをなくしたときに、新しい管理用リンクを出すためのコードです。<b>この画面でしか表示されません。</b></span>
      </div>
      <p className="recovery__code" aria-label="復旧コード">{code}</p>
      <div className="row">
        <Btn onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { prompt("コピーしてください", code); } }}>{copied ? "コピーしました" : "コピー"}</Btn>
        <Btn onClick={download}>ファイルに保存</Btn>
      </div>
      {onSaved && (
        <label className="check">
          <input type="checkbox" checked={saved} onChange={(e) => { setSaved(e.target.checked); onSaved(e.target.checked); }} />
          <span>復旧コードを保存した（スクリーンショット・メモ・ファイルなど）</span>
        </label>
      )}
    </div>
  );
}
