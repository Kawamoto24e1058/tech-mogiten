export { ShopDO } from "./shop";
export { Registry } from "./registry";
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
