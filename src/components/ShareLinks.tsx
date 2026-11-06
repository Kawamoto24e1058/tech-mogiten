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

/** リンク1つ分: コピー・QRコード */
export function LinkRow({ title, note, url, warn }: { title: string; note: string; url: string; warn?: string }) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState(false);
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
    <div className="link-row">
      <div className="link-row__head">
        <b>{title}</b>
        <span className="hint">{note}</span>
      </div>
      {warn && <Banner kind="warn">{warn}</Banner>}
      <input className="input link-row__url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={`${title}のURL`} />
      <div className="row">
        <Btn onClick={() => void copy()}>{copied ? "コピーしました" : "コピー"}</Btn>
        {"share" in navigator && <Btn onClick={() => void share()}>送る（LINEなど）</Btn>}
        <Btn variant="ghost" onClick={() => setQr(!qr)} ariaLabel={`${title}のQRコードを${qr ? "閉じる" : "表示"}`}>{qr ? "QRを閉じる" : "QRコード"}</Btn>
      </div>
      {qr && <Qr text={url} />}
    </div>
  );
}
