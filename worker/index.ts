export { ShopDO } from "./shop";
export { Registry } from "./registry";
export { DeliveryHub } from "./hub";
import type { Registry } from "./registry";
import { SHOP_ID_RE } from "./registry";

export interface Env {
  SHOP: DurableObjectNamespace;
  REGISTRY: DurableObjectNamespace<Registry>;
  ASSETS: Fetcher;
  /** "1" のとき、未設定の店舗にデモ用のメニューと合言葉を入れる（ローカル開発用） */
  DEV_SEED?: string;
  /** "1" のとき、レジ・厨房の合言葉と管理PINを求める。それ以外（既定）は誰でも使える */
  REQUIRE_AUTH?: string;
  /** "1" のときテック部版（配達・引っ越しを使える） */
  CLUB_MODE?: string;
  /** 引っ越し元（今の公開版）の Worker。テック部版だけ */
  OLD?: Fetcher;
  /** ローカル開発用: 引っ越し元の URL（例: http://localhost:5173）。OLD より優先 */
  MOVE_SOURCE?: string;
  HUB: DurableObjectNamespace;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function shopStub(env: Env, id: string) {
  return env.SHOP.get(env.SHOP.idFromName(id));
}

function forward(env: Env, id: string, req: Request, path: string): Promise<Response> {
  const url = new URL(req.url);
  url.pathname = `/api/shops/${id}${path}`;
  const r = new Request(url, req);
  r.headers.set("x-shop-id", id);
  // 店舗の初期化は Worker の中からだけ。外から送られてきた印は消す
  r.headers.delete("x-internal");
  return shopStub(env, id).fetch(r);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // 各部が自分の店舗をつくる。店舗ごとに別の Durable Object になり、データは混ざらない
    if (url.pathname === "/api/shops" && req.method === "POST") {
      let b: { name?: string; organization?: string; color?: string; prefix?: string; ticketCount?: number };
      try {
        b = await req.json();
      } catch {
        return json({ error: "リクエストが不正です" }, 400);
      }
      const name = String(b?.name ?? "").trim();
      if (!name) return json({ error: "店舗名を入力してください" }, 400);
      const ip = req.headers.get("cf-connecting-ip") ?? "local";
      const ipHash = await sha256(`registry:${ip}`);
      const registry = env.REGISTRY.get(env.REGISTRY.idFromName("main"));
      const r = await registry.reserve(ipHash, name);
      if (!r.ok) return json({ error: r.error }, 429);
      const init = new Request(`${url.origin}/api/shops/${r.id}/init`, { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json", "x-shop-id": r.id, "x-internal": "1" } });
      const res = await shopStub(env, r.id).fetch(init);
      if (!res.ok) {
        await registry.release(r.id);
        return new Response(res.body, { status: res.status, headers: res.headers });
      }
      const keys = (await res.json()) as { adminKey: string; staffKey: string };
      return json({ id: r.id, ...keys }, 201);
    }

    // 引っ越し（テック部版だけ）: 今の公開版の管理用リンクを受け取り、店舗のデータを丸ごとこちらへ運ぶ
    if (url.pathname === "/api/move" && req.method === "POST") {
      if (env.CLUB_MODE !== "1") return json({ error: "見つかりません" }, 404);
      return moveShop(req, env);
    }

    // 配達センター（テック部版だけ）
    if (url.pathname.startsWith("/api/hub/")) {
      if (env.CLUB_MODE !== "1") return json({ error: "見つかりません" }, 404);
      return env.HUB.get(env.HUB.idFromName("main")).fetch(req);
    }

    const m = url.pathname.match(/^\/api\/shops\/([^/]+)(\/.*)?$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      // 店舗IDの形のものだけ。作られていない店舗は ShopDO が 404 を返す
      if (!SHOP_ID_RE.test(id)) return json({ error: "店舗が見つかりません" }, 404);
      if ((m[2] ?? "") === "/init") return json({ error: "見つかりません" }, 404);
      return forward(env, id, req, m[2] ?? "/");
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "見つかりません" }, 404);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

/** 引っ越し元（今の公開版）の API を呼ぶ */
async function fromOld(env: Env, path: string, key: string): Promise<{ status: number; data: any }> {
  const init = { headers: { authorization: `Bearer ${key}` } };
  const res = env.MOVE_SOURCE
    ? await fetch(env.MOVE_SOURCE.replace(/\/$/, "") + path, init)
    : env.OLD
      ? await env.OLD.fetch(new Request("https://old.internal" + path, init))
      : null;
  if (!res) return { status: 500, data: { error: "引っ越し元が設定されていません" } };
  let data: any = null;
  try { data = await res.json(); } catch { /* 空 */ }
  return { status: res.status, data };
}

async function moveShop(req: Request, env: Env): Promise<Response> {
  let b: { link?: string };
  try { b = await req.json(); } catch { return json({ error: "リクエストが不正です" }, 400); }
  const m = /\/([a-z0-9]{1,16})\/join#k=([A-Za-z0-9_-]+)/.exec(String(b?.link ?? "").trim());
  if (!m) return json({ error: "今のURLの「管理用リンク」（…/join#k=… の形）を、まるごと貼り付けてください" }, 400);
  const [, id, key] = m;
  const base = `/api/shops/${id}/admin`;
  const first = await fromOld(env, `${base}/state`, key);
  if (first.status === 401 || first.status === 403) return json({ error: "管理用リンクではないか、作り直されて使えなくなっています（部員用リンクでは引っ越せません）" }, 403);
  if (first.status === 404) return json({ error: "今のURLにその店舗が見つかりません" }, 404);
  if (first.status !== 200) return json({ error: `今のURLからデータを読めませんでした（${first.status}）` }, 502);
  const st = first.data;
  const days: string[] = st.days ?? [];
  const orders: any[] = [];
  const floats: Record<string, number> = {};
  const closings: any[] = [];
  for (const day of days) {
    const s = await fromOld(env, `${base}/state?day=${day}`, key);
    if (s.status !== 200) return json({ error: `${day} の注文を読めませんでした` }, 502);
    orders.push(...(s.data.orders ?? []));
    const sum = await fromOld(env, `${base}/summary?day=${day}`, key);
    if (sum.status === 200) {
      if (sum.data.floatCash) floats[day] = sum.data.floatCash;
      if (sum.data.closing) closings.push({ ...sum.data.closing, day });
    }
  }
  const ids = new Set(orders.map((o) => o.id));
  for (const o of st.trash ?? []) if (!ids.has(o.id)) orders.push(o);
  const bundle = {
    adminKey: key,
    staffKey: st.staffKey ?? null,
    shop: { name: st.shop.name, color: st.shop.color, prefix: st.shop.prefix, ticketCount: st.shop.ticketCount, festivalStart: st.shop.festivalStart, organization: st.shop.organization, protected: !!st.shop.authRequired },
    menu: st.menu ?? [],
    discounts: st.discounts ?? [],
    expenses: st.expenses ?? [],
    orders,
    floats,
    closings,
  };
  const res = await shopStub(env, id).fetch(new Request(`https://shop.internal/api/shops/${id}/move-in`, {
    method: "POST", body: JSON.stringify(bundle), headers: { "content-type": "application/json", "x-shop-id": id, "x-internal": "1" },
  }));
  const out = (await res.json()) as Record<string, unknown>;
  if (!res.ok) return json(out, res.status);
  return json({ ...out, id, adminKey: key, staffKey: bundle.staffKey, days });
}
