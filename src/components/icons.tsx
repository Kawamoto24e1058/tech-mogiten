import type { ReactNode } from "react";

/** 線のアイコン（24×24、currentColor）。文字だけのボタンを作らないよう、必ず文字と一緒に使う。 */
function Svg({ children, size = 20, className = "" }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

type P = { size?: number; className?: string };
export const IconBack = (p: P) => <Svg {...p}><path d="M15 18l-6-6 6-6" /></Svg>;
export const IconNext = (p: P) => <Svg {...p}><path d="M9 18l6-6-6-6" /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><path d="M18 6L6 18M6 6l12 12" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="M20 6L9 17l-5-5" /></Svg>;
export const IconMinus = (p: P) => <Svg {...p}><path d="M5 12h14" /></Svg>;
export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconRefresh = (p: P) => <Svg {...p}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></Svg>;
export const IconClock = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
export const IconBackspace = (p: P) => <Svg {...p}><path d="M21 5H8l-6 7 6 7h13a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" /><path d="M17 9l-6 6M11 9l6 6" /></Svg>;
export const IconOffline = (p: P) => <Svg {...p}><path d="M2 2l20 20" /><path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.2-1.6M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8A15 15 0 0 0 10.7 5" /><path d="M12 20h.01" /></Svg>;
export const IconAlert = (p: P) => <Svg {...p}><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 18h.01" /></Svg>;
export const IconInfo = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>;
export const IconTicket = (p: P) => <Svg {...p}><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v8a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2z" /><path d="M13 6v12" strokeDasharray="2 2" /></Svg>;
export const IconRegister = (p: P) => <Svg {...p}><rect x="3" y="10" width="18" height="10" rx="2" /><path d="M7 10V5h10v5M7 14h2M11 14h2M15 14h2" /></Svg>;
export const IconKitchen = (p: P) => <Svg {...p}><path d="M4 11h16v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z" /><path d="M2 11h20M9 4c0 2 1 2 1 4M13 4c0 2 1 2 1 4" /></Svg>;
export const IconDisplay = (p: P) => <Svg {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></Svg>;
export const IconChart = (p: P) => <Svg {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Svg>;
export const IconBell = (p: P) => <Svg {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></Svg>;
export const IconBellOff = (p: P) => <Svg {...p}><path d="M2 2l20 20M8.7 3.4A6 6 0 0 1 18 8c0 3.2.6 5.4 1.3 6.8M17 17H3s3-2 3-9c0-.8.1-1.5.4-2.2" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></Svg>;
export const IconBox = (p: P) => <Svg {...p}><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8M12 13v8" /></Svg>;
