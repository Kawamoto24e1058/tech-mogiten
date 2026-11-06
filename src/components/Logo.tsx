/**
 * 模擬店レジのロゴ。黒い角丸の中に、白い「番号札」（左右に切り欠き・ミシン目）と ¥ の印。
 * 文字（フォント）を使わず線で描くので、どの端末でも同じ形になる。public/icon.svg も同じ形
 */
export function Logo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`logo ${className}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="15" fill="#18181b" /><rect x="10" y="18" width="44" height="28" rx="3.5" fill="#fff" /><circle cx="10" cy="32" r="4.6" fill="#18181b" /><circle cx="54" cy="32" r="4.6" fill="#18181b" /><path d="M41.5 21v22" stroke="#18181b" strokeWidth="1.6" strokeDasharray="2.2 2.4" /><path d="M20.5 23.5l5.5 7.5 5.5-7.5M26 31v9.5M21 33h10M21 37h10" fill="none" stroke="#18181b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
