import { DurableObject } from "cloudflare:workers";
import {
  businessDay, holdsTicket, linesTotal, ordersCsv, priceLines, summarize, ticketLabel,
} from "../shared/logic";
import type {
  ClientMessage, Closing, DiscountRule, DisplaySnapshot, MenuItem, NewOrderInput, Op, Order, OrderStatus,
  Role, ServerMessage, ShopPublic, ShopSnapshot,
} from "../shared/types";
import { DENOMINATIONS, MENU_COLORS, STAFF_CANCEL_WINDOW_MS } from "../shared/types";
import type { Env } from "./index";

const DEFAULT_SHOPS: Record<string, { name: string; color: string; prefix: string }> = {
  a: { name: "焼き鳥", color: "#1565c0", prefix: "A" },
  b: { name: "とうもろこし", color: "#c2410c", prefix: "B" },
};
// [商品名, 価格, 残り数（null なら数えない）]
const DEMO_MENUS: Record<string, [string, number, number | null][]> = {
  a: [["ねぎま", 150, null], ["もも", 150, null], ["つくね", 150, 30], ["皮", 150, null], ["3本セット割", -50, null]],
  b: [["焼きとうもろこし", 300, 40], ["バター醤油", 350, null], ["ハーフ", 200, null]],
};
/** 渡した後も厨房画面に残す時間（取り消し用） */
const RECENT_HANDED_MS = 10 * 60 * 1000;
const AUTH_FAIL_WINDOW_MS = 60 * 1000;
const AUTH_FAIL_LIMIT = 10;

type Attachment = { role: Role; screen: string };

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 商品の色。空・未知の値は「自動」 */
function parseColor(v: unknown): string | null {
  return typeof v === "string" && v in MENU_COLORS ? v : null;
}

/** 残り数の入力。空欄・null は「数えない」 */
function parseStock(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Math.floor(Number(v));
  if (!(n >= 0 && n <= 100000)) throw new HttpError(400, "残り数は0以上の数にしてください");
  return n;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const ROLE_RANK: Record<Role, number> = { display: 0, staff: 1, admin: 2, master: 3 };

export class ShopDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS menu (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL,
        sold_out INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, ticket INTEGER, status TEXT NOT NULL,
        lines TEXT NOT NULL, total INTEGER NOT NULL, received INTEGER NOT NULL, change INTEGER NOT NULL,
        created_at INTEGER NOT NULL, ready_at INTEGER, handed_at INTEGER, cancelled_at INTEGER,
        cancel_reason TEXT, ticket_released INTEGER NOT NULL DEFAULT 0, day TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS orders_day ON orders(day);
      CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, day TEXT NOT NULL,
        action TEXT NOT NULL, order_id TEXT, detail TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS closings (
        day TEXT PRIMARY KEY, at INTEGER NOT NULL, counted INTEGER NOT NULL, expected INTEGER NOT NULL,
        diff INTEGER NOT NULL, denominations TEXT NOT NULL, memo TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_fail (at INTEGER NOT NULL);
    `);
    // 後から追加した列
    const menuCols = this.sql.exec<{ name: string }>("PRAGMA table_info(menu)").toArray().map((r) => r.name);
    if (!menuCols.includes("stock")) this.sql.exec("ALTER TABLE menu ADD COLUMN stock INTEGER");
    if (!menuCols.includes("color")) this.sql.exec("ALTER TABLE menu ADD COLUMN color TEXT");
  }

  // ---------- 設定 ----------

  private get(key: string): string | null {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM kv WHERE key = ?", key).toArray()[0];
    return row ? row.value : null;
  }

  private set(key: string, value: string | null) {
    if (value == null) this.sql.exec("DELETE FROM kv WHERE key = ?", key);
    else this.sql.exec("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  }

  private discounts(): DiscountRule[] {
    try {
      return JSON.parse(this.get("discounts") ?? "[]") as DiscountRule[];
    } catch {
      return [];
    }
  }

  private async ensureShopId(id: string) {
    if (!this.get("shopId")) {
      const d = DEFAULT_SHOPS[id] ?? { name: `${id.toUpperCase()}店`, color: "#334155", prefix: id.toUpperCase() };
      this.set("shopId", id);
      this.set("name", d.name);
      this.set("color", d.color);
      this.set("prefix", d.prefix);
      this.set("ticketCount", "30");
      if (this.env.DEV_SEED === "1") await this.seedDemo(id);
    }
  }

  /** ローカル開発用のデモデータ。合言葉 1111 / 管理PIN 9999 */
  private async seedDemo(id: string) {
    this.set("staffHash", await sha256(`${id}:1111`));
    this.set("adminHash", await sha256(`${id}:9999`));
    const items = DEMO_MENUS[id] ?? DEMO_MENUS.a;
    items.forEach(([name, price, stock], i) =>
      this.sql.exec("INSERT INTO menu (id, name, price, sort, stock) VALUES (?, ?, ?, ?, ?)", crypto.randomUUID(), name, price, i + 1, stock),
    );
  }

  private shopPublic(): ShopPublic {
    return {
      id: this.get("shopId") ?? "",
      name: this.get("name") ?? "",
      color: this.get("color") ?? "#334155",
      prefix: this.get("prefix") ?? "",
      ticketCount: Number(this.get("ticketCount") ?? 30),
      configured: this.get("staffHash") != null,
      authRequired: this.authRequired,
    };
  }

  // ---------- 認証 ----------

  private async roleFor(code: string | null): Promise<Role | null> {
    if (!code) return null;
    if (this.env.MASTER_PIN && timingSafeEqual(code, this.env.MASTER_PIN)) return "master";
    const h = await sha256(`${this.get("shopId")}:${code}`);
    if (this.get("adminHash") === h) return "admin";
    if (this.get("staffHash") === h) return "staff";
    return null;
  }

  private get authRequired() {
    return this.env.REQUIRE_AUTH === "1";
  }

  private async authorize(req: Request, min: Role, code?: string | null): Promise<Role> {
    if (min === "display") return "display";
    // 合言葉・PIN を使わない設定（既定）では、誰でもすべての操作ができる
    if (!this.authRequired) return "master";
    const now = Date.now();
    this.sql.exec("DELETE FROM auth_fail WHERE at < ?", now - AUTH_FAIL_WINDOW_MS);
    const fails = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM auth_fail").one().n;
    if (fails >= AUTH_FAIL_LIMIT) throw new HttpError(429, "間違いが続いたため、1分ほど待ってからもう一度入力してください");
    const given = code ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    const role = await this.roleFor(given);
    if (!role) {
      if (given) this.sql.exec("INSERT INTO auth_fail (at) VALUES (?)", now);
      throw new HttpError(401, "合言葉が違います");
    }
    if (ROLE_RANK[role] < ROLE_RANK[min]) throw new HttpError(403, "この操作には管理PINが必要です");
    return role;
  }

  // ---------- データ取得 ----------

  private rowToOrder(r: Record<string, SqlStorageValue>): Order {
    return {
      id: r.id as string,
      seq: r.seq as number,
      ticket: (r.ticket as number | null) ?? null,
      status: r.status as OrderStatus,
      lines: JSON.parse(r.lines as string),
      total: r.total as number,
      received: r.received as number,
      change: r.change as number,
      createdAt: r.created_at as number,
      readyAt: (r.ready_at as number | null) ?? null,
      handedAt: (r.handed_at as number | null) ?? null,
      cancelledAt: (r.cancelled_at as number | null) ?? null,
      cancelReason: (r.cancel_reason as string | null) ?? null,
      ticketReleased: r.ticket_released === 1,
      day: r.day as string,
    };
  }

  private menu(): MenuItem[] {
    return this.sql
      .exec("SELECT id, name, price, sold_out, sort, stock, color FROM menu WHERE active = 1 ORDER BY sort, rowid")
      .toArray()
      .map((r) => ({
        id: r.id as string, name: r.name as string, price: r.price as number, soldOut: r.sold_out === 1, sort: r.sort as number,
        stock: (r.stock as number | null) ?? null,
        color: (r.color as string | null) ?? null,
      }));
  }

  private order(id: string): Order | null {
    const r = this.sql.exec("SELECT * FROM orders WHERE id = ?", id).toArray()[0];
    return r ? this.rowToOrder(r) : null;
  }

  private activeOrders(): Order[] {
    return this.sql
      .exec("SELECT * FROM orders WHERE status IN ('cooking','ready') OR (status = 'handed' AND handed_at >= ?) ORDER BY seq", Date.now() - RECENT_HANDED_MS)
      .toArray()
      .map((r) => this.rowToOrder(r));
  }

  private ordersOfDay(day: string): Order[] {
    return this.sql.exec("SELECT * FROM orders WHERE day = ? ORDER BY seq", day).toArray().map((r) => this.rowToOrder(r));
  }

  private snapshot(): ShopSnapshot {
    return {
      shop: this.shopPublic(),
      menu: this.menu(),
      discounts: this.discounts(),
      orders: this.activeOrders(),
      registerCount: this.ctx.getWebSockets("register").length,
      serverTime: Date.now(),
    };
  }

  private displaySnapshot(): DisplaySnapshot {
    const shop = this.shopPublic();
    const ready = this.sql
      .exec<{ ticket: number; ready_at: number }>("SELECT ticket, ready_at FROM orders WHERE status = 'ready' AND ticket IS NOT NULL ORDER BY ready_at")
      .toArray()
      .map((r) => ({ ticket: ticketLabel(shop.prefix, r.ticket), readyAt: r.ready_at }));
    return { shop, ready, serverTime: Date.now() };
  }

  private audit(action: string, orderId: string | null, detail: unknown) {
    const now = Date.now();
    this.sql.exec("INSERT INTO audit (at, day, action, order_id, detail) VALUES (?, ?, ?, ?, ?)", now, businessDay(now), action, orderId, JSON.stringify(detail));
  }

  private broadcast() {
    const staffMsg = JSON.stringify({ type: "snapshot", data: this.snapshot() } satisfies ServerMessage);
    const displayMsg = JSON.stringify({ type: "display", data: this.displaySnapshot() } satisfies ServerMessage);
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      try {
        ws.send(att?.role === "display" ? displayMsg : staffMsg);
      } catch {
        // 切断済みのソケットは無視する
      }
    }
  }

  // ---------- 操作（レジ・厨房） ----------

  private applyOp(op: Op): string | undefined {
    switch (op.kind) {
      case "createOrder":
        return this.createOrder(op.order);
      case "setStatus":
        this.setStatus(op.orderId, op.status);
        return;
      case "setSoldOut":
        this.sql.exec("UPDATE menu SET sold_out = ? WHERE id = ?", op.soldOut ? 1 : 0, op.itemId);
        return;
      default:
        throw new HttpError(400, "不明な操作です");
    }
  }

  /** 戻り値は注意メッセージ（札番号の重複など） */
  private createOrder(input: NewOrderInput): string | undefined {
    if (typeof input?.id !== "string" || input.id.length < 8 || input.id.length > 64) throw new HttpError(400, "注文IDが不正です");
    if (this.order(input.id)) return; // 再送された注文は無視する
    const lines = priceLines(this.menu(), this.discounts(), Array.isArray(input.lines) ? input.lines : []);
    if (lines.length === 0) throw new HttpError(400, "注文が空です");
    const total = linesTotal(lines);
    if (total < 0) throw new HttpError(400, "合計がマイナスです。割引の数を確認してください");
    const received = Math.floor(Number(input.received));
    if (!Number.isFinite(received) || received < total) throw new HttpError(400, "預かり金が足りません");

    const count = this.shopPublic().ticketCount;
    let ticket: number | null = input.ticket == null ? null : Math.floor(Number(input.ticket));
    if (ticket != null && !(ticket >= 1 && ticket <= count)) ticket = null;

    const now = Date.now();
    let createdAt = Math.floor(Number(input.createdAt));
    if (!Number.isFinite(createdAt) || createdAt < now - 24 * 3600_000 || createdAt > now + 5 * 60_000) createdAt = now;
    const seq = (this.sql.exec<{ m: number | null }>("SELECT MAX(seq) AS m FROM orders").one().m ?? 0) + 1;

    let warning: string | undefined;
    if (ticket != null) {
      const clash = this.activeOrders().some((o) => holdsTicket(o) && o.ticket === ticket);
      if (clash) warning = `札 ${ticketLabel(this.shopPublic().prefix, ticket)} が重複しています。厨房で確認してください`;
    }

    this.sql.exec(
      `INSERT INTO orders (id, seq, ticket, status, lines, total, received, change, created_at, day)
       VALUES (?, ?, ?, 'cooking', ?, ?, ?, ?, ?, ?)`,
      input.id, seq, ticket, JSON.stringify(lines), total, received, received - total, createdAt, businessDay(createdAt),
    );
    // 残り数を減らし、なくなったら売り切れにする
    const over: string[] = [];
    for (const l of lines) {
      const r = this.sql.exec<{ stock: number | null }>("SELECT stock FROM menu WHERE id = ?", l.itemId).toArray()[0];
      if (!r || r.stock == null) continue;
      const left = r.stock - l.qty;
      if (left < 0) over.push(l.name);
      this.sql.exec("UPDATE menu SET stock = ?, sold_out = CASE WHEN ? <= 0 THEN 1 ELSE sold_out END WHERE id = ?", Math.max(0, left), left, l.itemId);
    }
    if (over.length) warning = [warning, `${over.join("、")}は残り数を超えて売れています。厨房で確認してください`].filter(Boolean).join(" / ");

    this.audit("create", input.id, { seq, ticket, total, received, warning });
    return warning;
  }

  /** 注文の取り消し。残り数を戻す */
  private cancelOrder(o: Order, reason: string, by: "staff" | "admin") {
    this.sql.exec("UPDATE orders SET status = 'cancelled', cancelled_at = ?, cancel_reason = ? WHERE id = ?", Date.now(), reason, o.id);
    for (const l of o.lines) {
      const r = this.sql.exec<{ stock: number | null }>("SELECT stock FROM menu WHERE id = ?", l.itemId).toArray()[0];
      if (!r || r.stock == null) continue;
      // 残り数が 0 で自動的に売り切れになっていたものは、戻ったら販売を再開する
      this.sql.exec("UPDATE menu SET stock = stock + ?, sold_out = CASE WHEN stock = 0 THEN 0 ELSE sold_out END WHERE id = ?", l.qty, l.itemId);
    }
    this.audit("cancel", o.id, { seq: o.seq, total: o.total, previousStatus: o.status, reason, by });
  }

  private setStatus(orderId: string, status: "cooking" | "ready" | "handed") {
    const o = this.order(orderId);
    if (!o) throw new HttpError(404, "注文が見つかりません");
    if (o.status === "cancelled") throw new HttpError(409, "キャンセル済みの注文です");
    if (!["cooking", "ready", "handed"].includes(status)) throw new HttpError(400, "状態が不正です");
    if (o.status === status) return;
    const now = Date.now();
    const readyAt = status === "cooking" ? null : (o.readyAt ?? now);
    const handedAt = status === "handed" ? now : null;
    this.sql.exec("UPDATE orders SET status = ?, ready_at = ?, handed_at = ? WHERE id = ?", status, readyAt, handedAt, orderId);
  }

  // ---------- WebSocket ----------

  private async handleWebSocket(req: Request, url: URL): Promise<Response> {
    if (req.headers.get("upgrade") !== "websocket") throw new HttpError(426, "WebSocket が必要です");
    const screen = url.searchParams.get("screen") ?? "";
    const role = screen === "display" ? "display" : await this.authorize(req, "staff", url.searchParams.get("code"));
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const tags = [role === "display" ? "display" : "staff"];
    if (screen === "register") tags.push("register");
    this.ctx.acceptWebSocket(server, tags);
    server.serializeAttachment({ role, screen } satisfies Attachment);
    if (screen === "register") this.broadcast();
    else server.send(JSON.stringify(role === "display" ? { type: "display", data: this.displaySnapshot() } : { type: "snapshot", data: this.snapshot() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" } satisfies ServerMessage));
      return;
    }
    if (msg.type !== "op") return;
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || ROLE_RANK[att.role] < ROLE_RANK.staff) {
      ws.send(JSON.stringify({ type: "ack", opId: msg.opId, ok: false, error: "権限がありません" } satisfies ServerMessage));
      return;
    }
    try {
      const warning = this.applyOp(msg.op);
      ws.send(JSON.stringify({ type: "ack", opId: msg.opId, ok: true, error: warning } satisfies ServerMessage));
      this.broadcast();
    } catch (e) {
      ws.send(JSON.stringify({ type: "ack", opId: msg.opId, ok: false, error: e instanceof Error ? e.message : "エラー" } satisfies ServerMessage));
    }
  }

  async webSocketClose(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att?.screen === "register") this.broadcast();
  }

  // ---------- 管理（HTTP） ----------

  private adminState(day: string) {
    const shop = this.shopPublic();
    const orders = this.ordersOfDay(day);
    const days = this.sql.exec<{ day: string }>("SELECT DISTINCT day FROM orders ORDER BY day DESC").toArray().map((r) => r.day);
    const audit = this.sql
      .exec("SELECT at, action, order_id, detail FROM audit WHERE day = ? AND action != 'create' ORDER BY id DESC LIMIT 200", day)
      .toArray()
      .map((r) => ({ at: r.at as number, action: r.action as string, orderId: r.order_id as string | null, detail: JSON.parse(r.detail as string) }));
    return {
      shop,
      hasAdminPin: this.get("adminHash") != null,
      menu: this.menu(),
      discounts: this.discounts(),
      orders,
      tickets: this.activeOrders().filter(holdsTicket).map((o) => ({ ticket: o.ticket!, orderId: o.id, seq: o.seq, status: o.status })),
      days,
      audit,
    };
  }

  private daySummary(day: string) {
    const floatCash = Number(this.get(`float:${day}`) ?? 0);
    const c = this.sql.exec("SELECT * FROM closings WHERE day = ?", day).toArray()[0];
    const closing: Closing | null = c
      ? { day, at: c.at as number, counted: c.counted as number, expected: c.expected as number, diff: c.diff as number, denominations: JSON.parse(c.denominations as string), memo: c.memo as string }
      : null;
    return summarize(day, this.ordersOfDay(day), floatCash, closing);
  }

  private async body<T>(req: Request): Promise<T> {
    try {
      return (await req.json()) as T;
    } catch {
      throw new HttpError(400, "リクエストが不正です");
    }
  }

  async fetch(req: Request): Promise<Response> {
    try {
      return await this.route(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "サーバーでエラーが起きました" }, 500);
    }
  }

  private async route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const shopId = req.headers.get("x-shop-id");
    if (!shopId) throw new HttpError(400, "店舗IDがありません");
    await this.ensureShopId(shopId);
    const path = url.pathname.replace(/^\/api\/shops\/[^/]+/, "") || "/";
    const m = req.method;
    const today = businessDay(Date.now());
    const day = url.searchParams.get("day") || today;

    if (path === "/ws") return this.handleWebSocket(req, url);
    if (path === "/public" && m === "GET") return json(this.shopPublic());
    if (path === "/auth" && m === "POST") {
      const { code } = await this.body<{ code: string }>(req);
      return json({ role: await this.authorize(req, "staff", String(code ?? "")) });
    }
    if (path === "/summary" && m === "GET") {
      await this.authorize(req, "admin");
      return json({ shop: this.shopPublic(), summary: this.daySummary(day) });
    }

    // レジの履歴（スタッフ用）
    if (path === "/history" && m === "GET") {
      await this.authorize(req, "staff");
      const orders = this.sql.exec("SELECT * FROM orders WHERE day = ? ORDER BY seq DESC LIMIT 300", today).toArray().map((r) => this.rowToOrder(r));
      return json({ orders, serverTime: Date.now(), cancelWindowMs: STAFF_CANCEL_WINDOW_MS });
    }
    let hs: RegExpMatchArray | null;
    if ((hs = path.match(/^\/history\/([^/]+)\/cancel$/)) && m === "POST") {
      const role = await this.authorize(req, "staff");
      const o = this.order(decodeURIComponent(hs[1]));
      if (!o) throw new HttpError(404, "注文が見つかりません");
      if (o.status === "cancelled") throw new HttpError(409, "すでに取り消されています");
      if (role === "staff" && Date.now() - o.createdAt > STAFF_CANCEL_WINDOW_MS) {
        throw new HttpError(403, "会計から5分以上たった注文は、管理画面から取り消してください");
      }
      const { reason } = await this.body<{ reason: string }>(req);
      const r = String(reason ?? "").trim().slice(0, 200);
      if (!r) throw new HttpError(400, "理由を選んでください");
      this.cancelOrder(o, r, role === "staff" ? "staff" : "admin");
      this.broadcast();
      return json({ ok: true });
    }

    if (!path.startsWith("/admin")) throw new HttpError(404, "見つかりません");
    const role = await this.authorize(req, "admin");
    const p = path.slice("/admin".length);
    let seg: RegExpMatchArray | null;

    if (p === "/state" && m === "GET") return json(this.adminState(day));
    if (p === "/csv" && m === "GET") {
      return new Response(ordersCsv(this.ordersOfDay(day), this.shopPublic().prefix), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="sales-${this.get("shopId")}-${day}.csv"`,
          "cache-control": "no-store",
        },
      });
    }

    if (p === "/settings" && m === "PUT") {
      const b = await this.body<Partial<{ name: string; color: string; prefix: string; ticketCount: number }>>(req);
      if (b.name != null) {
        const name = String(b.name).trim().slice(0, 30);
        if (!name) throw new HttpError(400, "店舗名を入力してください");
        this.set("name", name);
      }
      if (b.color != null) {
        if (!/^#[0-9a-fA-F]{6}$/.test(b.color)) throw new HttpError(400, "色の形式が不正です");
        this.set("color", b.color);
      }
      if (b.prefix != null) this.set("prefix", String(b.prefix).trim().slice(0, 3));
      if (b.ticketCount != null) {
        const n = Math.floor(Number(b.ticketCount));
        if (!(n >= 1 && n <= 999)) throw new HttpError(400, "札の枚数は1〜999にしてください");
        this.set("ticketCount", String(n));
      }
      this.audit("settings", null, b);
      this.broadcast();
      return json(this.adminState(day));
    }

    if (p === "/codes" && m === "PUT") {
      const b = await this.body<{ staffCode?: string; adminPin?: string }>(req);
      const sid = this.get("shopId");
      if (b.staffCode != null) {
        if (String(b.staffCode).length < 4) throw new HttpError(400, "合言葉は4文字以上にしてください");
        this.set("staffHash", await sha256(`${sid}:${b.staffCode}`));
      }
      if (b.adminPin != null) {
        if (String(b.adminPin).length < 4) throw new HttpError(400, "管理PINは4文字以上にしてください");
        if (role !== "master" && this.get("adminHash") == null) throw new HttpError(403, "最初の管理PINはテック部の全体PINで設定してください");
        this.set("adminHash", await sha256(`${sid}:${b.adminPin}`));
      }
      if (this.get("staffHash") != null && this.get("staffHash") === this.get("adminHash")) {
        throw new HttpError(400, "合言葉と管理PINは別のものにしてください");
      }
      this.audit("codes", null, { staffCode: b.staffCode != null, adminPin: b.adminPin != null });
      this.broadcast();
      return json(this.adminState(day));
    }

    if (p === "/discounts" && m === "PUT") {
      const b = await this.body<{ discounts: DiscountRule[] }>(req);
      if (!Array.isArray(b.discounts) || b.discounts.length > 20) throw new HttpError(400, "割引は20件までです");
      const ids = new Set(this.menu().map((x) => x.id));
      const rules = b.discounts.map((r): DiscountRule => {
        const name = String(r?.name ?? "").trim().slice(0, 30);
        const every = Math.floor(Number(r?.every));
        const off = Math.floor(Number(r?.off));
        const itemIds = Array.isArray(r?.itemIds) ? [...new Set(r.itemIds.map(String))].filter((id) => ids.has(id)) : [];
        if (!name) throw new HttpError(400, "割引の名前を入力してください");
        if (!(every >= 1 && every <= 99)) throw new HttpError(400, "「何個ごと」は1〜99にしてください");
        if (!(off >= 1 && off <= 100000)) throw new HttpError(400, "引く金額は1円以上にしてください");
        if (itemIds.length === 0) throw new HttpError(400, `「${name}」の対象の商品を選んでください`);
        const id = typeof r?.id === "string" && /^[\w-]{1,64}$/.test(r.id) ? r.id : crypto.randomUUID();
        return { id, name, itemIds, every, off, enabled: r?.enabled !== false };
      });
      this.set("discounts", JSON.stringify(rules));
      this.audit("discounts", null, rules);
      this.broadcast();
      return json(this.adminState(day));
    }

    if (p === "/menu" && m === "POST") {
      const b = await this.body<{ name: string; price: number; stock?: number | null; color?: string | null }>(req);
      const name = String(b.name ?? "").trim().slice(0, 30);
      const price = Math.floor(Number(b.price));
      if (!name) throw new HttpError(400, "商品名を入力してください");
      if (!(price >= -100000 && price <= 100000)) throw new HttpError(400, "価格が不正です");
      const stock = parseStock(b.stock);
      const sort = (this.sql.exec<{ m: number | null }>("SELECT MAX(sort) AS m FROM menu").one().m ?? 0) + 1;
      const id = crypto.randomUUID();
      const color = parseColor(b.color);
      this.sql.exec("INSERT INTO menu (id, name, price, sort, stock, color) VALUES (?, ?, ?, ?, ?, ?)", id, name, price, sort, stock, color);
      this.audit("menu.add", null, { id, name, price, stock });
      this.broadcast();
      return json(this.adminState(day));
    }
    if ((seg = p.match(/^\/menu\/([^/]+)$/))) {
      const id = decodeURIComponent(seg[1]);
      if (m === "PUT") {
        const b = await this.body<Partial<{ name: string; price: number; soldOut: boolean; sort: number; stock: number | null; color: string | null }>>(req);
        if (b.color !== undefined) this.sql.exec("UPDATE menu SET color = ? WHERE id = ?", parseColor(b.color), id);
        if (b.name != null) {
          const name = String(b.name).trim().slice(0, 30);
          if (!name) throw new HttpError(400, "商品名を入力してください");
          this.sql.exec("UPDATE menu SET name = ? WHERE id = ?", name, id);
        }
        if (b.price != null) {
          const price = Math.floor(Number(b.price));
          if (!(price >= -100000 && price <= 100000)) throw new HttpError(400, "価格が不正です");
          this.sql.exec("UPDATE menu SET price = ? WHERE id = ?", price, id);
        }
        if (b.stock !== undefined) {
          const stock = parseStock(b.stock);
          // 残り数を入れ直したら販売を再開する（0 なら売り切れ）
          this.sql.exec("UPDATE menu SET stock = ?, sold_out = CASE WHEN ? IS NULL THEN sold_out WHEN ? <= 0 THEN 1 ELSE 0 END WHERE id = ?", stock, stock, stock, id);
        }
        if (b.soldOut != null) this.sql.exec("UPDATE menu SET sold_out = ? WHERE id = ?", b.soldOut ? 1 : 0, id);
        if (b.sort != null) this.sql.exec("UPDATE menu SET sort = ? WHERE id = ?", Math.floor(Number(b.sort)), id);
        this.audit("menu.edit", null, { id, ...b });
      } else if (m === "DELETE") {
        this.sql.exec("UPDATE menu SET active = 0 WHERE id = ?", id);
        this.audit("menu.delete", null, { id });
      } else throw new HttpError(405, "許可されていない操作です");
      this.broadcast();
      return json(this.adminState(day));
    }

    if ((seg = p.match(/^\/orders\/([^/]+)\/cancel$/)) && m === "POST") {
      const id = decodeURIComponent(seg[1]);
      const { reason } = await this.body<{ reason: string }>(req);
      const r = String(reason ?? "").trim().slice(0, 200);
      if (!r) throw new HttpError(400, "キャンセルの理由を入力してください");
      const o = this.order(id);
      if (!o) throw new HttpError(404, "注文が見つかりません");
      if (o.status === "cancelled") throw new HttpError(409, "すでにキャンセルされています");
      this.cancelOrder(o, r, "admin");
      this.broadcast();
      return json(this.adminState(day));
    }
    if ((seg = p.match(/^\/orders\/([^/]+)\/ticket$/)) && m === "POST") {
      const id = decodeURIComponent(seg[1]);
      const { ticket } = await this.body<{ ticket: number | null }>(req);
      const o = this.order(id);
      if (!o) throw new HttpError(404, "注文が見つかりません");
      const t = ticket == null ? null : Math.floor(Number(ticket));
      if (t != null && !(t >= 1 && t <= this.shopPublic().ticketCount)) throw new HttpError(400, "札番号が範囲外です");
      this.sql.exec("UPDATE orders SET ticket = ?, ticket_released = 0 WHERE id = ?", t, id);
      this.audit("ticket.change", id, { seq: o.seq, from: o.ticket, to: t });
      this.broadcast();
      return json(this.adminState(day));
    }
    if ((seg = p.match(/^\/tickets\/(\d+)\/release$/)) && m === "POST") {
      const t = Number(seg[1]);
      const holders = this.activeOrders().filter((o) => holdsTicket(o) && o.ticket === t);
      for (const o of holders) this.sql.exec("UPDATE orders SET ticket_released = 1 WHERE id = ?", o.id);
      this.audit("ticket.release", holders[0]?.id ?? null, { ticket: t, orders: holders.map((o) => o.seq) });
      this.broadcast();
      return json(this.adminState(day));
    }
    // 開店前に、前日の渡し忘れなどで使用中のままの札をまとめて空きに戻す
    if (p === "/tickets/release-all" && m === "POST") {
      const holders = this.activeOrders().filter(holdsTicket);
      for (const o of holders) this.sql.exec("UPDATE orders SET ticket_released = 1 WHERE id = ?", o.id);
      this.audit("ticket.release-all", null, { count: holders.length, orders: holders.map((o) => o.seq) });
      this.broadcast();
      return json(this.adminState(day));
    }
    // リハーサルの注文を消す。メニュー・設定・合言葉は残す。残り数は練習で売れた分を戻す
    if (p === "/reset" && m === "POST") {
      const { confirm } = await this.body<{ confirm: string }>(req);
      if (confirm !== "消去") throw new HttpError(400, "確認のため「消去」と入力してください");
      const sold = this.sql
        .exec<{ lines: string }>("SELECT lines FROM orders WHERE status != 'cancelled'")
        .toArray()
        .flatMap((r) => JSON.parse(r.lines) as { itemId: string; qty: number }[]);
      for (const l of sold) {
        this.sql.exec("UPDATE menu SET stock = stock + ?, sold_out = CASE WHEN stock = 0 THEN 0 ELSE sold_out END WHERE id = ? AND stock IS NOT NULL", l.qty, l.itemId);
      }
      const n = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM orders").one().n;
      this.sql.exec("DELETE FROM orders");
      this.sql.exec("DELETE FROM closings");
      this.sql.exec("DELETE FROM audit");
      this.sql.exec("DELETE FROM kv WHERE key LIKE 'float:%'");
      this.audit("reset", null, { orders: n, by: role });
      this.broadcast();
      return json(this.adminState(today));
    }

    if (p === "/summary" && m === "GET") return json(this.daySummary(day));
    if (p === "/float" && m === "PUT") {
      const { amount } = await this.body<{ amount: number }>(req);
      const a = Math.floor(Number(amount));
      if (!(a >= 0 && a <= 10_000_000)) throw new HttpError(400, "金額が不正です");
      this.set(`float:${day}`, String(a));
      this.audit("float", null, { day, amount: a });
      return json(this.daySummary(day));
    }
    if (p === "/closing" && m === "POST") {
      const b = await this.body<{ denominations: Record<string, number>; memo?: string }>(req);
      const den: Record<string, number> = {};
      let counted = 0;
      for (const d of DENOMINATIONS) {
        const n = Math.floor(Number(b.denominations?.[d] ?? 0));
        if (!(n >= 0 && n <= 100000)) throw new HttpError(400, "枚数が不正です");
        den[d] = n;
        counted += d * n;
      }
      const s = this.daySummary(day);
      const memo = String(b.memo ?? "").slice(0, 500);
      this.sql.exec(
        "INSERT OR REPLACE INTO closings (day, at, counted, expected, diff, denominations, memo) VALUES (?, ?, ?, ?, ?, ?, ?)",
        day, Date.now(), counted, s.expectedCash, counted - s.expectedCash, JSON.stringify(den), memo,
      );
      this.audit("closing", null, { day, counted, expected: s.expectedCash, diff: counted - s.expectedCash });
      return json(this.daySummary(day));
    }

    throw new HttpError(404, "見つかりません");
  }
}
