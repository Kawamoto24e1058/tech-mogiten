export type OrderStatus = "cooking" | "ready" | "handed" | "cancelled";

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  soldOut: boolean;
  sort: number;
  /** 残り数。null なら数えない */
  stock: number | null;
  /** 商品の色（MENU_COLORS のキー）。null なら並び順で自動 */
  color: string | null;
}

/**
 * まとめ買い割引。対象の商品が合わせて every 個になるごとに off 円引く。
 * 例: ももタレ・もも塩を対象に「2個ごとに100円引き」→ 1本200円・2本300円
 */
export interface DiscountRule {
  id: string;
  name: string;
  itemIds: string[];
  every: number;
  off: number;
  enabled: boolean;
}

export interface OrderLine {
  itemId: string;
  name: string;
  price: number;
  qty: number;
}

export interface Order {
  id: string;
  seq: number;
  ticket: number | null;
  status: OrderStatus;
  lines: OrderLine[];
  total: number;
  received: number;
  change: number;
  createdAt: number;
  readyAt: number | null;
  handedAt: number | null;
  cancelledAt: number | null;
  cancelReason: string | null;
  ticketReleased: boolean;
  day: string;
}

export interface ShopPublic {
  id: string;
  name: string;
  color: string;
  prefix: string;
  ticketCount: number;
  configured: boolean;
  /** 合言葉・PIN を使うか（環境変数 REQUIRE_AUTH=1 のときだけ） */
  authRequired: boolean;
}

/** 店舗の現在の状態。変更があるたびにサーバーから全員に配信される。 */
export interface ShopSnapshot {
  shop: ShopPublic;
  menu: MenuItem[];
  discounts: DiscountRule[];
  /** 調理中・できた・直近に渡した注文 */
  orders: Order[];
  registerCount: number;
  serverTime: number;
}

export interface DisplaySnapshot {
  shop: ShopPublic;
  ready: { ticket: string; readyAt: number }[];
  serverTime: number;
}

export interface NewOrderInput {
  id: string;
  ticket: number | null;
  lines: { itemId: string; qty: number }[];
  received: number;
  createdAt: number;
}

/** 端末から送る操作。すべて同じものを何度送っても結果が変わらない（冪等）。 */
export type Op =
  | { kind: "createOrder"; order: NewOrderInput }
  | { kind: "setStatus"; orderId: string; status: "cooking" | "ready" | "handed" }
  | { kind: "setSoldOut"; itemId: string; soldOut: boolean };

export type ClientMessage = { type: "op"; opId: string; op: Op } | { type: "ping" };

export type ServerMessage =
  | { type: "snapshot"; data: ShopSnapshot }
  | { type: "display"; data: DisplaySnapshot }
  | { type: "ack"; opId: string; ok: boolean; error?: string }
  | { type: "pong" };

export type Role = "display" | "staff" | "admin" | "master";

export interface DaySummary {
  day: string;
  sales: number;
  orderCount: number;
  averagePerOrder: number;
  items: { itemId: string; name: string; qty: number; amount: number }[];
  slots: { start: string; sales: number; count: number }[];
  cancelledCount: number;
  cancelledAmount: number;
  floatCash: number;
  expectedCash: number;
  closing: Closing | null;
}

export interface Closing {
  day: string;
  at: number;
  counted: number;
  expected: number;
  diff: number;
  denominations: Record<string, number>;
  memo: string;
}

export const DENOMINATIONS = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1] as const;

/**
 * 商品の色。レジのボタンと厨房の伝票で同じ色を使い、目で探しやすくする。
 * 文字は濃い色のまま、背景はうすい色（tint）にするので、どの色でも文字は読める。
 */
export const MENU_COLORS: Record<string, { label: string; solid: string; tint: string }> = {
  red: { label: "赤", solid: "#e5484d", tint: "#feebec" },
  orange: { label: "オレンジ", solid: "#f76b15", tint: "#ffefd6" },
  yellow: { label: "黄", solid: "#e2a400", tint: "#fff7c2" },
  green: { label: "緑", solid: "#30a46c", tint: "#e6f6eb" },
  teal: { label: "青緑", solid: "#12a594", tint: "#e0f8f3" },
  blue: { label: "青", solid: "#0090ff", tint: "#e6f4fe" },
  purple: { label: "紫", solid: "#8e4ec6", tint: "#f7edfe" },
  pink: { label: "ピンク", solid: "#d6409f", tint: "#fee9f5" },
  brown: { label: "茶", solid: "#ad7f58", tint: "#f8efe6" },
  gray: { label: "灰", solid: "#8b8d98", tint: "#f0f0f3" },
};
export const MENU_COLOR_KEYS = Object.keys(MENU_COLORS);

/** レジから取り消せる時間（これを過ぎたら管理画面から） */
export const STAFF_CANCEL_WINDOW_MS = 5 * 60 * 1000;
