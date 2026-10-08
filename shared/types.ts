export type OrderStatus = "cooking" | "ready" | "handed" | "cancelled";

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  soldOut: boolean;
  sort: number;
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
}

/** 店舗の現在の状態。変更があるたびにサーバーから全員に配信される。 */
export interface ShopSnapshot {
  shop: ShopPublic;
  menu: MenuItem[];
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
