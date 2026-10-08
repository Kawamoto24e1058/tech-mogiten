export { ShopDO } from "./shop";

export interface Env {
  SHOP: DurableObjectNamespace;
  ASSETS: Fetcher;
  /** カンマ区切りの店舗ID（例: "a,b"） */
  SHOPS: string;
  /** テック部全体の管理PIN（wrangler secret put MASTER_PIN で設定） */
  MASTER_PIN?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function shopIds(env: Env): string[] {
  return env.SHOPS.split(",").map((s) => s.trim()).filter(Boolean);
}

function shopStub(env: Env, id: string) {
  return env.SHOP.get(env.SHOP.idFromName(id));
}

function forward(env: Env, id: string, req: Request, path: string): Promise<Response> {
  const url = new URL(req.url);
  url.pathname = `/api/shops/${id}${path}`;
  const r = new Request(url, req);
  r.headers.set("x-shop-id", id);
  return shopStub(env, id).fetch(r);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const ids = shopIds(env);

    if (url.pathname === "/api/shops" && req.method === "GET") {
      const shops = await Promise.all(ids.map(async (id) => (await forward(env, id, new Request(url), "/public")).json()));
      return json(shops);
    }

    const m = url.pathname.match(/^\/api\/shops\/([^/]+)(\/.*)?$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (!ids.includes(id)) return json({ error: "店舗が見つかりません" }, 404);
      return forward(env, id, req, m[2] ?? "/");
    }

    if (url.pathname === "/api/master/summary" && req.method === "GET") {
      const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
      if (!env.MASTER_PIN || given !== env.MASTER_PIN) return json({ error: "テック部の全体PINが違います" }, 401);
      const day = url.searchParams.get("day") ?? "";
      const results = await Promise.all(
        ids.map(async (id) => {
          const sub = new Request(`${url.origin}/api/shops/${id}/summary?day=${encodeURIComponent(day)}`, { headers: req.headers });
          const res = await forward(env, id, sub, "/summary");
          return { status: res.status, body: (await res.json()) as Record<string, unknown> };
        }),
      );
      const failed = results.find((r) => r.status !== 200);
      if (failed) return json(failed.body, failed.status);
      return json(results.map((r) => r.body));
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "見つかりません" }, 404);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
