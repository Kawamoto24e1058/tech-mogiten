import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { DisplaySnapshot, Op, Order, ServerMessage, ShopSnapshot } from "../shared/types";
import { linesTotal, priceLines } from "../shared/logic";
import { load, save, uuid } from "./util";

export type ConnStatus = "connecting" | "online" | "offline" | "auth";

interface Pending {
  opId: string;
  op: Op;
}

interface State {
  status: ConnStatus;
  snapshot: ShopSnapshot | null;
  display: DisplaySnapshot | null;
  outbox: Pending[];
  notices: { id: string; text: string; kind: "error" | "warn" }[];
}

const PING_MS = 15_000;
const PONG_TIMEOUT_MS = 8_000;

/**
 * 店舗との接続。切断中の操作は端末内の送信待ちリストに保存し、再接続したら送り直す。
 * サーバー側の操作はすべて冪等なので、同じ操作を何度送っても結果は変わらない。
 */
export class ShopConnection {
  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private retry = 0;
  private timer: number | undefined;
  private pingTimer: number | undefined;
  private pongTimer: number | undefined;
  private closed = false;
  state: State;

  constructor(
    readonly shopId: string,
    readonly screen: "register" | "kitchen" | "display",
    private code: string | null,
  ) {
    this.state = {
      status: "connecting",
      snapshot: load<ShopSnapshot | null>(`snap:${shopId}`, null),
      display: null,
      outbox: load<Pending[]>(this.outboxKey, []),
      notices: [],
    };
    this.connect();
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
  }

  private get outboxKey() {
    return `outbox:${this.shopId}:${this.screen}`;
  }

  private onOnline = () => {
    if (this.state.status !== "online") this.reconnectNow();
  };

  /** 端末が電波を失ったと分かった時点で切断扱いにする（WebSocket はすぐには閉じないことがあるため） */
  private onOffline = () => {
    this.ws?.close();
  };

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = () => this.state;

  private update(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    if (patch.outbox) save(this.outboxKey, patch.outbox);
    if (patch.snapshot) save(`snap:${this.shopId}`, patch.snapshot);
    this.listeners.forEach((l) => l());
  }

  notify(text: string, kind: "error" | "warn" = "error") {
    const id = uuid();
    this.update({ notices: [...this.state.notices, { id, text, kind }] });
  }

  dismiss(id: string) {
    this.update({ notices: this.state.notices.filter((n) => n.id !== id) });
  }

  private connect() {
    if (this.closed) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const q = new URLSearchParams({ screen: this.screen });
    if (this.code) q.set("code", this.code);
    const ws = new WebSocket(`${proto}//${location.host}/api/shops/${encodeURIComponent(this.shopId)}/ws?${q}`);
    this.ws = ws;
    if (this.state.status !== "connecting" && this.state.status !== "offline") this.update({ status: "connecting" });

    ws.onopen = () => {
      this.retry = 0;
      this.update({ status: "online" });
      for (const p of this.state.outbox) ws.send(JSON.stringify({ type: "op", opId: p.opId, op: p.op }));
      this.schedulePing();
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "pong") {
        clearTimeout(this.pongTimer);
      } else if (msg.type === "snapshot") {
        this.update({ snapshot: msg.data });
      } else if (msg.type === "display") {
        this.update({ display: msg.data });
      } else if (msg.type === "ack") {
        const outbox = this.state.outbox.filter((p) => p.opId !== msg.opId);
        if (outbox.length !== this.state.outbox.length) this.update({ outbox });
        if (!msg.ok) this.notify(`送信できなかった操作があります: ${msg.error ?? "不明なエラー"}`);
        else if (msg.error) this.notify(msg.error, "warn");
      }
    };
    ws.onclose = () => {
      clearTimeout(this.pingTimer);
      clearTimeout(this.pongTimer);
      if (this.ws !== ws || this.closed) return;
      this.ws = null;
      void this.afterClose();
    };
  }

  /** 切断の理由が合言葉の間違いかどうかを確かめてから再接続する */
  private async afterClose() {
    if (this.code && navigator.onLine) {
      try {
        const res = await fetch(`/api/shops/${encodeURIComponent(this.shopId)}/auth`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: this.code }),
        });
        if (res.status === 401) {
          this.update({ status: "auth" });
          return;
        }
      } catch {
        // 通信できない＝オフライン
      }
    }
    this.update({ status: "offline" });
    const delay = Math.min(10_000, 1000 * 2 ** this.retry++);
    this.timer = window.setTimeout(() => this.connect(), delay);
  }

  private schedulePing() {
    clearTimeout(this.pingTimer);
    this.pingTimer = window.setTimeout(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "ping" }));
      // 応答がなければ回線が切れたとみなしてつなぎ直す（スマホで切断に気づけないことがあるため）
      this.pongTimer = window.setTimeout(() => ws.close(), PONG_TIMEOUT_MS);
      this.schedulePing();
    }, PING_MS);
  }

  reconnectNow() {
    clearTimeout(this.timer);
    this.retry = 0;
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      old.onclose = null;
      old.close();
    }
    this.connect();
  }

  send(op: Op) {
    const p = { opId: uuid(), op };
    this.update({ outbox: [...this.state.outbox, p] });
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "op", ...p }));
  }

  /** まだ送れていない注文を取り下げる。取り下げられたら true（送信済みなら false） */
  retract(orderId: string): boolean {
    const outbox = this.state.outbox.filter((p) => !(p.op.kind === "createOrder" && p.op.order.id === orderId));
    if (outbox.length === this.state.outbox.length) return false;
    this.update({ outbox });
    return true;
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.pingTimer);
    clearTimeout(this.pongTimer);
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    this.ws?.close();
  }
}

export function useConnection(shopId: string, screen: "register" | "kitchen" | "display", code: string | null) {
  const conn = useMemo(() => new ShopConnection(shopId, screen, code), [shopId, screen, code]);
  useEffect(() => () => conn.close(), [conn]);
  const state = useSyncExternalStore(conn.subscribe, conn.getState);
  return { conn, state };
}

/** 送信待ちの操作を反映した注文一覧（オフラインでも画面が操作どおりに見えるように） */
export function viewOrders(snapshot: ShopSnapshot | null, outbox: Pending[]): (Order & { pending: boolean })[] {
  if (!snapshot) return [];
  const list = snapshot.orders.map((o) => ({ ...o, pending: false }));
  const byId = new Map(list.map((o) => [o.id, o]));
  let tempSeq = 0;
  for (const { op } of outbox) {
    if (op.kind === "createOrder" && !byId.has(op.order.id)) {
      const lines = priceLines(snapshot.menu, snapshot.discounts ?? [], op.order.lines);
      const total = linesTotal(lines);
      const o = {
        id: op.order.id, seq: --tempSeq, ticket: op.order.ticket, status: "cooking" as const, lines, total,
        received: op.order.received, change: op.order.received - total, createdAt: op.order.createdAt,
        readyAt: null, handedAt: null, cancelledAt: null, cancelReason: null, ticketReleased: false, day: "", pending: true,
      };
      list.push(o);
      byId.set(o.id, o);
    } else if (op.kind === "releaseTicket") {
      for (const o of list) {
        if (o.ticket !== op.ticket || o.ticketReleased || (o.status !== "cooking" && o.status !== "ready")) continue;
        if (o.status === "ready") {
          o.status = "handed";
          o.handedAt = Date.now();
        }
        o.ticketReleased = true;
        o.pending = true;
      }
    } else if (op.kind === "setStatus") {
      const o = byId.get(op.orderId);
      if (o && o.status !== "cancelled") {
        o.status = op.status;
        o.pending = true;
        if (op.status === "ready" && !o.readyAt) o.readyAt = Date.now();
        if (op.status === "handed") o.handedAt = Date.now();
        if (op.status === "cooking") o.readyAt = null;
      }
    }
  }
  return list;
}

export function viewMenu(snapshot: ShopSnapshot | null, outbox: Pending[]) {
  if (!snapshot) return [];
  const menu = snapshot.menu.map((m) => ({ ...m }));
  const known = new Set(snapshot.orders.map((o) => o.id));
  for (const { op } of outbox) {
    if (op.kind === "setSoldOut") {
      const m = menu.find((x) => x.id === op.itemId);
      if (m) m.soldOut = op.soldOut;
    } else if (op.kind === "createOrder" && !known.has(op.order.id)) {
      // 送信待ちの注文の分だけ残り数を減らして見せる
      for (const l of op.order.lines) {
        const m = menu.find((x) => x.id === l.itemId);
        if (m && m.stock != null) {
          m.stock = Math.max(0, m.stock - l.qty);
          if (m.stock === 0) m.soldOut = true;
        }
      }
    }
  }
  return menu;
}
