import type { MenuItem, Order, OrderLine, DaySummary, Closing } from "./types";
import { DENOMINATIONS } from "./types";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 営業日（日本時間の日付 YYYY-MM-DD） */
export function businessDay(ts: number): string {
  return new Date(ts + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 日本時間の 30 分枠の開始時刻 "HH:MM" */
export function halfHourSlot(ts: number): string {
  const d = new Date(ts + JST_OFFSET_MS);
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = d.getUTCMinutes() < 30 ? "00" : "30";
  return `${h}:${m}`;
}

export function yen(n: number): string {
  return `${n.toLocaleString("ja-JP")}円`;
}

export function ticketLabel(prefix: string, ticket: number | null): string {
  if (ticket == null) return "札なし";
  return prefix ? `${prefix}-${ticket}` : String(ticket);
}

/** お釣りの渡し方（大きいお金から）。例: 650 → [[500,1],[100,1],[50,1]] */
export function changeBreakdown(amount: number): [number, number][] {
  const out: [number, number][] = [];
  let rest = Math.max(0, Math.floor(amount));
  for (const d of DENOMINATIONS) {
    const n = Math.floor(rest / d);
    if (n > 0) {
      out.push([d, n]);
      rest -= d * n;
    }
  }
  return out;
}

export function linesTotal(lines: { price: number; qty: number }[]): number {
  return lines.reduce((s, l) => s + l.price * l.qty, 0);
}

/** 札を持っている（まだ返ってきていない）注文か */
export function holdsTicket(o: Pick<Order, "status" | "ticket" | "ticketReleased">): boolean {
  return o.ticket != null && !o.ticketReleased && (o.status === "cooking" || o.status === "ready");
}

/** 1..count のうち使用中でない最小の番号。全部使用中なら null */
export function nextFreeTicket(count: number, inUse: Iterable<number>): number | null {
  const used = new Set(inUse);
  for (let n = 1; n <= count; n++) if (!used.has(n)) return n;
  return null;
}

/** メニューをもとに明細を作る。存在しない商品・数量 0 以下は除く。 */
export function buildLines(menu: MenuItem[], input: { itemId: string; qty: number }[]): OrderLine[] {
  const byId = new Map(menu.map((m) => [m.id, m]));
  const lines: OrderLine[] = [];
  for (const { itemId, qty } of input) {
    const item = byId.get(itemId);
    if (!item || !Number.isInteger(qty) || qty <= 0) continue;
    lines.push({ itemId, name: item.name, price: item.price, qty });
  }
  return lines;
}

export function summarize(
  day: string,
  orders: Order[],
  floatCash: number,
  closing: Closing | null,
): DaySummary {
  const valid = orders.filter((o) => o.day === day && o.status !== "cancelled");
  const cancelled = orders.filter((o) => o.day === day && o.status === "cancelled");
  const sales = valid.reduce((s, o) => s + o.total, 0);

  const items = new Map<string, { itemId: string; name: string; qty: number; amount: number }>();
  for (const o of valid) {
    for (const l of o.lines) {
      const cur = items.get(l.itemId) ?? { itemId: l.itemId, name: l.name, qty: 0, amount: 0 };
      cur.qty += l.qty;
      cur.amount += l.price * l.qty;
      items.set(l.itemId, cur);
    }
  }

  const slots = new Map<string, { start: string; sales: number; count: number }>();
  for (const o of valid) {
    const start = halfHourSlot(o.createdAt);
    const cur = slots.get(start) ?? { start, sales: 0, count: 0 };
    cur.sales += o.total;
    cur.count += 1;
    slots.set(start, cur);
  }

  return {
    day,
    sales,
    orderCount: valid.length,
    averagePerOrder: valid.length ? Math.round(sales / valid.length) : 0,
    items: [...items.values()].sort((a, b) => b.amount - a.amount),
    slots: [...slots.values()].sort((a, b) => a.start.localeCompare(b.start)),
    cancelledCount: cancelled.length,
    cancelledAmount: cancelled.reduce((s, o) => s + o.total, 0),
    floatCash,
    expectedCash: floatCash + sales,
    closing,
  };
}

function csvCell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Excel で文字化けしないよう BOM 付きの CSV（明細 1 行ずつ） */
export function ordersCsv(orders: Order[], prefix: string): string {
  const header = ["注文番号", "日付", "時刻", "札", "状態", "商品", "単価", "数量", "小計", "注文合計", "預かり", "お釣り", "キャンセル理由"];
  const statusJa = { cooking: "調理中", ready: "できた", handed: "渡した", cancelled: "キャンセル" };
  const rows = [header.join(",")];
  for (const o of [...orders].sort((a, b) => a.seq - b.seq)) {
    const time = new Date(o.createdAt + JST_OFFSET_MS).toISOString().slice(11, 19);
    for (const l of o.lines) {
      rows.push(
        [o.seq, o.day, time, ticketLabel(prefix, o.ticket), statusJa[o.status], l.name, l.price, l.qty, l.price * l.qty, o.total, o.received, o.change, o.cancelReason]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return "﻿" + rows.join("\r\n") + "\r\n";
}
