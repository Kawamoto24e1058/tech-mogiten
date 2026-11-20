import { DurableObject } from "cloudflare:workers";
import { businessDay } from "../shared/logic";
import type { Order } from "../shared/types";
import type { Env } from "./index";

/**
 * 配達センター（テック部版だけ）。1つだけ（idFromName("main")）。
 *
 * - 参加する店（テック部・Grok など）を、その店の部員用リンクの鍵でつなぐ。注文はその鍵で各店に入れる
 * - 届け先（Grok の模擬店・屋内展示など）ごとに「配達注文用リンク」を出す。係はそれで注文する
 * - 配達係用リンク: できた配達を受け取る → 届けてお金をもらう → 各店のレジに渡す（精算）
 * - 管理: 最初につないだ店（テック部）の管理用リンクの鍵で行う（鍵は各店に確かめる。ここには保存しない）
 */

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function randomKey(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** …/{店舗ID}/join#k={鍵} の形のリンクから、店舗IDと鍵を取り出す */
function parseLink(link: unknown): { id: string; key: string } | null {
  const m = /\/([a-z0-9]{1,16})\/join#k=([A-Za-z0-9_-]+)/.exec(String(link ?? "").trim());
  return m ? { id: m[1], key: m[2] } : null;
}

type Role = "admin" | "place" | "courier";
interface HubShop { id: string; name: string; color: string; staffKey: string }
interface Place { id: string; name: string; key: string }
export interface DeliveryPart { shopId: string; shopName: string; orderId: string; total: number; lines: { name: string; qty: number }[]; settledAt: number | null; status?: string }
export interface Delivery {
  id: string; no: number; placeId: string; placeName: string; note: string; status: "open" | "picked" | "delivered" | "cancelled";
  parts: DeliveryPart[]; total: number; createdAt: number; pickedAt: number | null; deliveredAt: number | null; day: string;
}

export class DeliveryHub extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS shops (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, staff_key TEXT NOT NULL, sort INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS places (id TEXT PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL, key_hash TEXT NOT NULL, sort INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS deliveries (
          id TEXT PRIMARY KEY, no INTEGER NOT NULL, day TEXT NOT NULL, place_id TEXT NOT NULL, place_name TEXT NOT NULL, note TEXT NOT NULL,
          status TEXT NOT NULL, parts TEXT NOT NULL, total INTEGER NOT NULL, created_at INTEGER NOT NULL, picked_at INTEGER, delivered_at INTEGER
        );
      `);
    });
  }

  private get(k: string): string | null {
    return this.sql.exec<{ value: string }>("SELECT value FROM kv WHERE key = ?", k).toArray()[0]?.value ?? null;
  }
  private set(k: string, v: string) {
    this.sql.exec("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", k, v);
  }
  private shops(): HubShop[] {
    return this.sql.exec("SELECT id, name, color, staff_key FROM shops ORDER BY sort").toArray().map((r) => ({ id: r.id as string, name: r.name as string, color: r.color as string, staffKey: r.staff_key as string }));
  }
  private places(): Place[] {
    return this.sql.exec("SELECT id, name, key FROM places WHERE active = 1 ORDER BY sort").toArray().map((r) => ({ id: r.id as string, name: r.name as string, key: r.key as string }));
  }
  private row(r: Record<string, SqlStorageValue>): Delivery {
    return {
      id: r.id as string, no: r.no as number, day: r.day as string, placeId: r.place_id as string, placeName: r.place_name as string, note: r.note as string,
      status: r.status as Delivery["status"], parts: JSON.parse(r.parts as string), total: r.total as number, createdAt: r.created_at as number,
      pickedAt: (r.picked_at as number | null) ?? null, deliveredAt: (r.delivered_at as number | null) ?? null,
    };
  }
  private delivery(id: string): Delivery | null {
    const r = this.sql.exec("SELECT * FROM deliveries WHERE id = ?", id).toArray()[0];
    return r ? this.row(r) : null;
  }
  private saveParts(d: Delivery) {
    this.sql.exec("UPDATE deliveries SET parts = ? WHERE id = ?", JSON.stringify(d.parts), d.id);
  }

  /** 店の API を、その店の鍵で呼ぶ */
  private async shopCall<T>(shopId: string, key: string, path: string, body?: unknown): Promise<{ status: number; data: T & { error?: string } }> {
    const stub = this.env.SHOP.get(this.env.SHOP.idFromName(shopId));
    const res = await stub.fetch(new Request(`https://shop.internal/api/shops/${shopId}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${key}`, "x-shop-id": shopId, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    let data: any = {};
    try { data = await res.json(); } catch { /* 空 */ }
    return { status: res.status, data };
  }

  private async authorize(req: Request, allowed: Role[]): Promise<{ role: Role; place?: Place }> {
    const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!key) throw new HttpError(401, "配達用のリンクから開いてください");
    if (allowed.includes("place")) {
      const h = await sha256(`place:${key}`);
      const r = this.sql.exec("SELECT id, name, key FROM places WHERE key_hash = ? AND active = 1", h).toArray()[0];
      if (r) return { role: "place", place: { id: r.id as string, name: r.name as string, key: r.key as string } };
    }
    if (allowed.includes("courier") && this.get("courierHash") === (await sha256(`courier:${key}`))) return { role: "courier" };
    if (allowed.includes("admin")) {
      const owner = this.get("owner");
      if (owner) {
        const r = await this.shopCall<{ role: string }>(owner, "", "/auth", { code: key });
        if (r.status === 200 && (r.data.role === "admin" || r.data.role === "master")) return { role: "admin" };
      }
    }
    throw new HttpError(401, "リンクが正しくないか、作り直されて使えなくなっています");
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

  private async body<T>(req: Request): Promise<T> {
    try { return (await req.json()) as T; } catch { throw new HttpError(400, "リクエストが不正です"); }
  }

  private async route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api\/hub/, "") || "/";
    const m = req.method;
    let seg: RegExpMatchArray | null;

    // 中心の店が削除されていたら、配達センターも空に戻す（作り直せるように）
    const owner = this.get("owner");
    if (owner && (path === "/public" || path === "/setup")) {
      const r = await this.shopCall(owner, "", "/public");
      if (r.status === 404) {
        this.sql.exec("DELETE FROM kv; DELETE FROM shops; DELETE FROM places; DELETE FROM deliveries;");
      }
    }

    if (path === "/public" && m === "GET") {
      return json({ setup: !!this.get("owner"), owner: this.get("owner"), shops: this.shops().map(({ id, name, color }) => ({ id, name, color })), places: this.places().map(({ id, name }) => ({ id, name })) });
    }

    // はじめる: 中心の店（テック部）の管理用リンクで、配達センターをつくる
    if (path === "/setup" && m === "POST") {
      if (this.get("owner")) throw new HttpError(409, "配達センターはもうあります");
      const l = parseLink((await this.body<{ link: string }>(req)).link);
      if (!l) throw new HttpError(400, "中心の店の「管理用リンク」を貼り付けてください");
      const st = await this.shopCall<{ shop: { id: string; name: string; color: string }; staffKey: string | null }>(l.id, l.key, "/admin/state");
      if (st.status !== 200) throw new HttpError(403, "管理用リンクではないか、使えなくなっています");
      this.set("owner", l.id);
      this.sql.exec("INSERT OR REPLACE INTO shops (id, name, color, staff_key, sort) VALUES (?, ?, ?, ?, 1)", l.id, st.data.shop.name, st.data.shop.color, st.data.staffKey ?? l.key);
      const courier = randomKey(18);
      this.set("courierKey", courier);
      this.set("courierHash", await sha256(`courier:${courier}`));
      return json({ ok: true });
    }

    // ---------- 管理 ----------
    if (path.startsWith("/admin")) {
      await this.authorize(req, ["admin"]);
      const p = path.slice("/admin".length) || "/";
      if (p === "/" && m === "GET") {
        return json({ owner: this.get("owner"), shops: this.shops().map(({ id, name, color }) => ({ id, name, color })), places: this.places(), courierKey: this.get("courierKey") });
      }
      if (p === "/shops" && m === "POST") {
        const l = parseLink((await this.body<{ link: string }>(req)).link);
        if (!l) throw new HttpError(400, "参加する店の「部員用リンク」を貼り付けてください");
        const a = await this.shopCall<{ role: string }>(l.id, "", "/auth", { code: l.key });
        if (a.status !== 200) throw new HttpError(403, "その店のリンクが正しくないか、使えなくなっています");
        const pub = await this.shopCall<{ name: string; color: string }>(l.id, "", "/public");
        const sort = this.shops().length + 1;
        this.sql.exec("INSERT OR REPLACE INTO shops (id, name, color, staff_key, sort) VALUES (?, ?, ?, ?, ?)", l.id, pub.data.name, pub.data.color, l.key, sort);
        return json({ ok: true });
      }
      if ((seg = p.match(/^\/shops\/([a-z0-9]+)\/delete$/)) && m === "POST") {
        if (seg[1] === this.get("owner")) throw new HttpError(400, "中心の店は外せません");
        this.sql.exec("DELETE FROM shops WHERE id = ?", seg[1]);
        return json({ ok: true });
      }
      if (p === "/places" && m === "POST") {
        const name = String((await this.body<{ name: string }>(req)).name ?? "").trim().slice(0, 30);
        if (!name) throw new HttpError(400, "届け先の名前を入れてください");
        const key = randomKey(18);
        this.sql.exec("INSERT INTO places (id, name, key, key_hash, sort) VALUES (?, ?, ?, ?, ?)", crypto.randomUUID(), name, key, await sha256(`place:${key}`), this.places().length + 1);
        return json({ ok: true });
      }
      if ((seg = p.match(/^\/places\/([0-9a-f-]+)\/delete$/)) && m === "POST") {
        this.sql.exec("UPDATE places SET active = 0 WHERE id = ?", seg[1]);
        return json({ ok: true });
      }
      if (p === "/courier/rotate" && m === "POST") {
        const courier = randomKey(18);
        this.set("courierKey", courier);
        this.set("courierHash", await sha256(`courier:${courier}`));
        return json({ ok: true });
      }
      throw new HttpError(404, "見つかりません");
    }

    // ---------- 届け先の係: メニューを見て注文する ----------
    if (path === "/menu" && m === "GET") {
      const who = await this.authorize(req, ["place", "admin"]);
      const shops = await Promise.all(this.shops().map(async (s) => {
        const r = await this.shopCall<{ menu: unknown[]; discounts: unknown[] }>(s.id, s.staffKey, "/delivery/menu");
        return r.status === 200 ? { id: s.id, name: s.name, color: s.color, menu: r.data.menu, discounts: r.data.discounts } : { id: s.id, name: s.name, color: s.color, menu: [], discounts: [], error: r.data.error ?? "メニューを読めません" };
      }));
      return json({ place: who.place ? { id: who.place.id, name: who.place.name } : null, places: who.role === "admin" ? this.places().map(({ id, name }) => ({ id, name })) : undefined, shops });
    }

    if (path === "/order" && m === "POST") {
      const who = await this.authorize(req, ["place", "admin"]);
      const b = await this.body<{ id: string; placeId?: string; note?: string; lines: { shopId: string; itemId: string; qty: number }[] }>(req);
      const id = String(b.id ?? "");
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, "注文IDが不正です");
      const dup = this.delivery(id);
      if (dup) return json({ delivery: dup }); // 送り直し
      const place = who.place ?? this.places().find((x) => x.id === b.placeId);
      if (!place) throw new HttpError(400, "届け先を選んでください");
      const shops = this.shops();
      const byShop = new Map<string, { itemId: string; qty: number }[]>();
      for (const l of Array.isArray(b.lines) ? b.lines : []) {
        const qty = Math.floor(Number(l.qty));
        if (!(qty >= 1 && qty <= 99) || !shops.some((s) => s.id === l.shopId)) continue;
        byShop.set(l.shopId, [...(byShop.get(l.shopId) ?? []), { itemId: String(l.itemId), qty }]);
      }
      if (byShop.size === 0) throw new HttpError(400, "注文が空です");
      const now = Date.now();
      const day = businessDay(now);
      const no = Number(this.get(`seq:${day}`) ?? 0) + 1;
      this.set(`seq:${day}`, String(no));
      const note = String(b.note ?? "").trim().slice(0, 40);
      const parts: DeliveryPart[] = [];
      const warnings: string[] = [];
      for (const s of shops) {
        const lines = byShop.get(s.id);
        if (!lines) continue;
        const orderId = `${id}-${s.id}`;
        const r = await this.shopCall<{ order: Order; warning?: string }>(s.id, s.staffKey, "/delivery/order", { id: orderId, lines, delivery: { no, deliveryId: id, place: place.name, note } });
        if (r.status !== 200) {
          // 途中の店でだめだったら、入れた分を取り消して全体をやめる
          for (const done of parts) await this.shopCall(done.shopId, shops.find((x) => x.id === done.shopId)!.staffKey, "/delivery/cancel", { ids: [done.orderId] });
          throw new HttpError(r.status === 401 ? 502 : 400, `${s.name}: ${r.data.error ?? "注文を入れられませんでした"}`);
        }
        if (r.data.warning) warnings.push(`${s.name}: ${r.data.warning}`);
        parts.push({ shopId: s.id, shopName: s.name, orderId, total: r.data.order.total, lines: r.data.order.lines.map((l) => ({ name: l.name, qty: l.qty })), settledAt: null });
      }
      const total = parts.reduce((a, x) => a + x.total, 0);
      this.sql.exec(
        "INSERT INTO deliveries (id, no, day, place_id, place_name, note, status, parts, total, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)",
        id, no, day, place.id, place.name, note, JSON.stringify(parts), total, now,
      );
      return json({ delivery: this.delivery(id), warning: warnings.join(" / ") || undefined });
    }

    // ---------- 一覧（届け先の係・配達係・管理） ----------
    if (path === "/board" && m === "GET") {
      const who = await this.authorize(req, ["place", "courier", "admin"]);
      const day = businessDay(Date.now());
      const rows = this.sql.exec(
        "SELECT * FROM deliveries WHERE day = ? AND (status IN ('open', 'picked') OR id IN (SELECT id FROM deliveries WHERE day = ? AND status IN ('delivered', 'cancelled') ORDER BY created_at DESC LIMIT 30)) ORDER BY no",
        day, day,
      ).toArray().map((r) => this.row(r)).filter((d) => !who.place || d.placeId === who.place.id);
      // 各店の進み具合をまとめて聞く
      const shops = this.shops();
      const want = new Map<string, string[]>();
      for (const d of rows) if (d.status === "open" || d.status === "picked") for (const p of d.parts) want.set(p.shopId, [...(want.get(p.shopId) ?? []), p.orderId]);
      const status = new Map<string, string>();
      await Promise.all([...want].map(async ([shopId, ids]) => {
        const s = shops.find((x) => x.id === shopId);
        if (!s) return;
        const r = await this.shopCall<{ orders: Order[] }>(shopId, s.staffKey, "/delivery/status", { ids });
        for (const o of r.data.orders ?? []) status.set(o.id, o.status);
      }));
      for (const d of rows) for (const p of d.parts) p.status = status.get(p.orderId) ?? (d.status === "delivered" ? "handed" : d.status === "cancelled" ? "cancelled" : undefined);
      // 配達係の手元のお金（届けたが、まだ各店のレジに渡していない分）
      const cash = shops.map((s) => {
        const list = this.sql.exec("SELECT * FROM deliveries WHERE status = 'delivered'").toArray().map((r) => this.row(r))
          .flatMap((d) => d.parts.filter((p) => p.shopId === s.id && !p.settledAt));
        return { shopId: s.id, shopName: s.name, color: s.color, amount: list.reduce((a, p) => a + p.total, 0), count: list.length };
      });
      return json({ role: who.role, place: who.place ? { id: who.place.id, name: who.place.name } : null, deliveries: rows, cash });
    }

    if ((seg = path.match(/^\/deliveries\/([0-9a-f-]{36})\/(pick|delivered|cancel)$/)) && m === "POST") {
      const action = seg[2];
      const who = await this.authorize(req, action === "cancel" ? ["place", "courier", "admin"] : ["courier", "admin"]);
      const d = this.delivery(seg[1]);
      if (!d || (who.place && d.placeId !== who.place.id)) throw new HttpError(404, "配達が見つかりません");
      const shops = this.shops();
      const keyOf = (shopId: string) => shops.find((x) => x.id === shopId)?.staffKey ?? "";
      const now = Date.now();
      if (action === "pick") {
        if (d.status !== "open") throw new HttpError(409, "もう受け取っています");
        for (const p of d.parts) await this.shopCall(p.shopId, keyOf(p.shopId), "/delivery/handed", { ids: [p.orderId] });
        this.sql.exec("UPDATE deliveries SET status = 'picked', picked_at = ? WHERE id = ?", now, d.id);
      } else if (action === "delivered") {
        if (d.status !== "picked" && d.status !== "open") throw new HttpError(409, "この配達は終わっています");
        if (d.status === "open") for (const p of d.parts) await this.shopCall(p.shopId, keyOf(p.shopId), "/delivery/handed", { ids: [p.orderId] });
        this.sql.exec("UPDATE deliveries SET status = 'delivered', delivered_at = ?, picked_at = COALESCE(picked_at, ?) WHERE id = ?", now, now, d.id);
      } else {
        if (d.status === "delivered" || d.status === "cancelled") throw new HttpError(409, "この配達は終わっています");
        for (const p of d.parts) await this.shopCall(p.shopId, keyOf(p.shopId), "/delivery/cancel", { ids: [p.orderId] });
        this.sql.exec("UPDATE deliveries SET status = 'cancelled' WHERE id = ?", d.id);
      }
      return json({ delivery: this.delivery(d.id) });
    }

    // 精算: 配達係が、ある店の分のお金をその店のレジに渡した
    if (path === "/settle" && m === "POST") {
      await this.authorize(req, ["courier", "admin"]);
      const { shopId } = await this.body<{ shopId: string }>(req);
      const s = this.shops().find((x) => x.id === shopId);
      if (!s) throw new HttpError(404, "店が見つかりません");
      const list = this.sql.exec("SELECT * FROM deliveries WHERE status = 'delivered'").toArray().map((r) => this.row(r));
      const ids = list.flatMap((d) => d.parts.filter((p) => p.shopId === shopId && !p.settledAt).map((p) => p.orderId));
      if (ids.length === 0) return json({ amount: 0 });
      const r = await this.shopCall(shopId, s.staffKey, "/delivery/settle", { ids });
      if (r.status !== 200) throw new HttpError(502, `${s.name}に記録できませんでした`);
      const now = Date.now();
      let amount = 0;
      for (const d of list) {
        let changed = false;
        for (const p of d.parts) if (p.shopId === shopId && !p.settledAt) { p.settledAt = now; amount += p.total; changed = true; }
        if (changed) this.saveParts(d);
      }
      return json({ amount, count: ids.length });
    }

    throw new HttpError(404, "見つかりません");
  }
}
