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
  /** 原価（1個あたり・任意）。利益の計算に使う */
  cost?: number | null;
  /** 配達メニュー（テック部版）: ほかの店の商品。レジで押すと、その店に配達を頼む（この店の売上・会計には入らない） */
  remote?: { shopId: string; itemId: string; shopName: string } | null;
}

/** 機材のレンタル代など、売れた数に関係なくかかる費用 */
export interface Expense {
  name: string;
  amount: number;
}

/** 店舗の設定の書き出し（来年の店舗に写す・予備） */
export interface ShopExport {
  format: "mogiten-shop";
  version: 1;
  exportedAt: string;
  shop: { name: string; organization: string | null; color: string; prefix: string; ticketCount: number };
  menu: { name: string; price: number; stock: number | null; color: string | null; cost: number | null }[];
  discounts: { name: string; itemNames: string[]; every: number; off: number; enabled: boolean }[];
  expenses: Expense[];
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
  /** 削除（ゴミ箱）した時刻。null なら通常 */
  deletedAt?: number | null;
  /** 配達の注文（テック部版）。お金は届けたときに配達係が受け取る */
  delivery?: DeliveryInfo | null;
  /** 先に厨房へ送って、まだ会計していない注文 */
  unpaid?: boolean;
}

/** 配達の注文の印 */
export interface DeliveryInfo {
  /** 配達番号（例: 12 → 画面では「配-12」） */
  no: number;
  /** 配達の注文の ID（配達センター側） */
  deliveryId: string;
  /** 届け先の名前（例: 屋内展示） */
  place: string;
  /** 受け取る人の目印（任意） */
  note?: string;
  /** 配達係からこの店のレジにお金を受け取った時刻。null なら未精算 */
  settledAt?: number | null;
}

export interface ShopPublic {
  id: string;
  name: string;
  color: string;
  prefix: string;
  ticketCount: number;
  /** 文化祭の初日（YYYY-MM-DD）。日付を「1日目」などと表示する */
  festivalStart?: string | null;
  /** 部・団体名（任意） */
  organization?: string | null;
  configured: boolean;
  /** 合言葉・PIN を使うか（環境変数 REQUIRE_AUTH=1 のときだけ） */
  authRequired: boolean;
  /** 管理用パスワードが設定されているか（パスワードで管理画面に入れるか） */
  hasPassword?: boolean;
}

/** 店舗の現在の状態。変更があるたびにサーバーから全員に配信される。 */
export interface ShopSnapshot {
  shop: ShopPublic;
  menu: MenuItem[];
  discounts: DiscountRule[];
  /** 調理中・できた・直近に渡した注文 */
  orders: Order[];
  /** 今日の、まだ会計していない注文（先に厨房へ送ったもの） */
  unpaid?: Order[];
  registerCount: number;
  serverTime: number;
}

export interface DisplaySnapshot {
  shop: ShopPublic;
  ready: { ticket: string; readyAt: number }[];
  /** 準備中（調理中）の札 */
  cooking?: string[];
  /** 店先に出すメニュー（割引の行は除く） */
  menu?: { name: string; price: number; soldOut: boolean }[];
  /** まとめ買い割引の説明（例: 「2本割」 2個ごとに100円引き） */
  deals?: string[];
  /** 待ち時間の目安（分）。データが少ないときは null */
  waitMin?: number | null;
  serverTime: number;
}

export interface NewOrderInput {
  id: string;
  ticket: number | null;
  lines: { itemId: string; qty: number }[];
  received: number;
  createdAt: number;
  /** true なら「先に厨房へ送る」（会計はあとで）。received は使わない */
  unpaid?: boolean;
}

/** 端末から送る操作。すべて同じものを何度送っても結果が変わらない（冪等）。 */
export type Op =
  | { kind: "createOrder"; order: NewOrderInput }
  | { kind: "setStatus"; orderId: string; status: "cooking" | "ready" | "handed" }
  | { kind: "setSoldOut"; itemId: string; soldOut: boolean }
  /** 手元に戻っている札をもう一度使う。その札を持っていた注文は、できた→渡した にし、札を空きにする */
  | { kind: "releaseTicket"; ticket: number }
  /** 先に厨房へ送った注文の会計 */
  | { kind: "payOrder"; orderId: string; received: number };

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
  /** 配達の注文（テック部版）。売上には入れるが、配達係から受け取るまではレジの現金に入っていない */
  delivery?: { count: number; sales: number; unsettled: number };
  /** 先に厨房へ送って、まだ会計していない注文。あるはずの現金には入らない */
  unpaid?: { count: number; amount: number };
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

/** 引っ越し（今の公開版 → テック部版）で運ぶ、店舗のすべてのデータ */
export interface MoveBundle {
  adminKey: string;
  staffKey: string | null;
  shop: { name: string; color: string; prefix: string; ticketCount: number; festivalStart?: string | null; organization?: string | null; protected: boolean };
  menu: (MenuItem & { soldOut?: boolean; sort?: number })[];
  discounts: DiscountRule[];
  expenses: Expense[];
  orders: Order[];
  floats: Record<string, number>;
  closings: Closing[];
}
