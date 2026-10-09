import { describe, expect, it } from "vitest";
import { businessDay, dayLabel, buildLines, changeBreakdown, halfHourSlot, linesTotal, nextFreeTicket, nextTicketAfter, ordersCsv, quickAmounts, priceLines, summarize, ticketLabel, holdsTicket } from "../shared/logic";
import type { DiscountRule, MenuItem, Order } from "../shared/types";

const order = (p: Partial<Order>): Order => ({
  id: "x", seq: 1, ticket: 1, status: "cooking", lines: [], total: 0, received: 0, change: 0,
  createdAt: 0, readyAt: null, handedAt: null, cancelledAt: null, cancelReason: null,
  ticketReleased: false, day: "2026-10-10", ...p,
});

describe("日付", () => {
  it("日本時間で営業日を決める", () => {
    expect(businessDay(Date.UTC(2026, 9, 9, 15, 0))).toBe("2026-10-10");
    expect(businessDay(Date.UTC(2026, 9, 9, 14, 59))).toBe("2026-10-09");
  });
  it("30分枠", () => {
    expect(halfHourSlot(Date.UTC(2026, 9, 10, 3, 29))).toBe("12:00");
    expect(halfHourSlot(Date.UTC(2026, 9, 10, 3, 30))).toBe("12:30");
  });
});

describe("番号札", () => {
  it("いちばん小さい空き番号", () => {
    expect(nextFreeTicket(5, [1, 2, 4])).toBe(3);
    expect(nextFreeTicket(3, [1, 2, 3])).toBeNull();
  });
  it("表記", () => {
    expect(ticketLabel("A", 5)).toBe("A-5");
    expect(ticketLabel("", 5)).toBe("5");
  });
  it("渡した・キャンセル・手動返却で札が空く", () => {
    expect(holdsTicket(order({ status: "ready" }))).toBe(true);
    expect(holdsTicket(order({ status: "handed" }))).toBe(false);
    expect(holdsTicket(order({ status: "cancelled" }))).toBe(false);
    expect(holdsTicket(order({ ticketReleased: true }))).toBe(false);
  });
});

describe("明細", () => {
  it("確定時点の名前と単価を保存し、不正な行を除く", () => {
    const menu = [{ id: "a", name: "焼きそば", price: 400, soldOut: false, sort: 0, stock: null, color: null }];
    expect(buildLines(menu, [{ itemId: "a", qty: 2 }, { itemId: "z", qty: 1 }, { itemId: "a", qty: 0 }])).toEqual([
      { itemId: "a", name: "焼きそば", price: 400, qty: 2 },
    ]);
  });
});

describe("売上集計", () => {
  const orders = [
    order({ seq: 1, total: 800, lines: [{ itemId: "a", name: "焼きそば", price: 400, qty: 2 }], createdAt: Date.UTC(2026, 9, 10, 3, 0) }),
    order({ seq: 2, total: 300, lines: [{ itemId: "b", name: "ジュース", price: 300, qty: 1 }], createdAt: Date.UTC(2026, 9, 10, 3, 40) }),
    order({ seq: 3, total: 400, status: "cancelled", lines: [{ itemId: "a", name: "焼きそば", price: 400, qty: 1 }] }),
    order({ seq: 4, total: 999, day: "2026-10-11" }),
  ];
  const s = summarize("2026-10-10", orders, 10000, null);
  it("キャンセルと別の日を除いて集計する", () => {
    expect(s.sales).toBe(1100);
    expect(s.orderCount).toBe(2);
    expect(s.averagePerOrder).toBe(550);
    expect(s.cancelledCount).toBe(1);
    expect(s.cancelledAmount).toBe(400);
    expect(s.expectedCash).toBe(11100);
    expect(s.items[0]).toEqual({ itemId: "a", name: "焼きそば", qty: 2, amount: 800 });
    expect(s.slots.map((x) => x.start)).toEqual(["12:00", "12:30"]);
  });
  it("CSV は BOM 付きで明細ごとに 1 行", () => {
    const csv = ordersCsv(orders.slice(0, 2), "A");
    expect(csv.startsWith("﻿注文番号")).toBe(true);
    expect(csv.trim().split("\r\n")).toHaveLength(3);
  });
});

describe("お釣りの内訳", () => {
  it("大きいお金から", () => {
    expect(changeBreakdown(650)).toEqual([[500, 1], [100, 1], [50, 1]]);
    expect(changeBreakdown(9350)).toEqual([[5000, 1], [1000, 4], [100, 3], [50, 1]]);
    expect(changeBreakdown(0)).toEqual([]);
  });
});

describe("まとめ買い割引", () => {
  const menu: MenuItem[] = [
    { id: "tare", name: "もも タレ", price: 200, soldOut: false, sort: 1, stock: null, color: null },
    { id: "shio", name: "もも 塩", price: 200, soldOut: false, sort: 2, stock: null, color: null },
    { id: "corn", name: "とうもろこし", price: 300, soldOut: false, sort: 3, stock: null, color: null },
  ];
  const rule: DiscountRule = { id: "r1", name: "2本割", itemIds: ["tare", "shio"], every: 2, off: 100, enabled: true };

  it("味違いも合わせて数え、2本ごとに引く", () => {
    const lines = priceLines(menu, [rule], [{ itemId: "tare", qty: 1 }, { itemId: "shio", qty: 1 }]);
    expect(linesTotal(lines)).toBe(300);
    expect(lines.at(-1)).toEqual({ itemId: "discount:r1", name: "2本割", price: -100, qty: 1 });
  });

  it("端数は割り引かない・対象外は数えない", () => {
    expect(linesTotal(priceLines(menu, [rule], [{ itemId: "tare", qty: 3 }, { itemId: "corn", qty: 1 }]))).toBe(200 * 3 - 100 + 300);
    expect(linesTotal(priceLines(menu, [rule], [{ itemId: "tare", qty: 1 }]))).toBe(200);
  });

  it("止めている割引は使わない", () => {
    expect(linesTotal(priceLines(menu, [{ ...rule, enabled: false }], [{ itemId: "tare", qty: 2 }]))).toBe(400);
  });
});

describe("札とお預かりの候補", () => {
  it("前に渡した札の次から順に、使用中を飛ばして選ぶ", () => {
    expect(nextTicketAfter(5, [], null)).toBe(1);
    expect(nextTicketAfter(5, [], 2)).toBe(3);
    expect(nextTicketAfter(5, [3, 4], 2)).toBe(5);
    expect(nextTicketAfter(5, [1], 5)).toBe(2);
    expect(nextTicketAfter(3, [1, 2, 3], 1)).toBeNull();
  });
  it("合計より大きいお札だけを候補にする", () => {
    expect(quickAmounts(300)).toEqual([500, 1000, 5000, 10000]);
    expect(quickAmounts(800)).toEqual([1000, 5000, 10000]);
    expect(quickAmounts(1200)).toEqual([2000, 5000, 10000]);
    expect(quickAmounts(1000)).toEqual([2000, 5000, 10000]);
  });
});

describe("日付の表示", () => {
  it("初日から数えて「N日目」をつける", () => {
    expect(dayLabel("2026-11-20", "2026-11-20")).toBe("1日目 11/20（金）");
    expect(dayLabel("2026-11-22", "2026-11-20")).toBe("3日目 11/22（日）");
    expect(dayLabel("2026-11-18", "2026-11-20")).toBe("11/18（水）");
    expect(dayLabel("2026-11-18", null)).toBe("11/18（水）");
  });
});
