import { useState } from "react";

/** パスワードの入力。「表示」で中身を確かめられる（打ち間違いで入れなくなるのを防ぐ） */
export function PasswordInput({ id, value, onChange, autoComplete, placeholder, describedBy, autoFocus }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete: "new-password" | "current-password"; placeholder?: string; describedBy?: string; autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <span className="pass">
      <input id={id} className="input pass__input" type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} placeholder={placeholder} aria-describedby={describedBy} autoFocus={autoFocus} maxLength={64} />
      <button type="button" className="pass__toggle" onClick={() => setShow(!show)} aria-pressed={show}>{show ? "かくす" : "表示"}</button>
    </span>
  );
}
