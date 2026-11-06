import { DurableObject } from "cloudflare:workers";

/**
 * 店舗の台帳（1つだけ）。店舗の一覧は公開しない。
 * 役割は (1) 作りすぎ・いたずらを防ぐ回数制限 と (2) 運営用の記録（いつ・どの店舗が作られたか）。
 * 店舗のデータそのものは店舗ごとの ShopDO にあり、ここには入らない。
 */
const PER_IP_PER_HOUR = 5;
const ALL_PER_MINUTE = 30;

export class Registry extends DurableObject {
  private sql: SqlStorage;
  /** ローカル開発（DEV_SEED=1）ではテストで何度も作るので、回数制限をゆるめる */
  private perIp: number;

  constructor(ctx: DurableObjectState, env: { DEV_SEED?: string }) {
    super(ctx, env as never);
    this.perIp = env?.DEV_SEED === "1" ? 1000 : PER_IP_PER_HOUR;
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS shops (id TEXT PRIMARY KEY, name TEXT NOT NULL, ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS shops_ip ON shops(ip_hash, created_at);
      CREATE INDEX IF NOT EXISTS shops_created ON shops(created_at);
    `);
  }

  /** 作ってよいか確かめる。よければ新しい店舗IDを予約して返す */
  async reserve(ipHash: string, name: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const now = Date.now();
    const mine = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM shops WHERE ip_hash = ? AND created_at > ?", ipHash, now - 3600_000).one().n;
    if (mine >= this.perIp) return { ok: false, error: "店舗を作れる数の上限に達しました。1時間ほどあけてください" };
    const all = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM shops WHERE created_at > ?", now - 60_000).one().n;
    if (all >= (this.perIp > PER_IP_PER_HOUR ? 1000 : ALL_PER_MINUTE)) return { ok: false, error: "混み合っています。少し待ってからもう一度ためしてください" };
    for (let i = 0; i < 5; i++) {
      const id = newShopId();
      const exists = this.sql.exec("SELECT 1 FROM shops WHERE id = ?", id).toArray().length > 0;
      if (exists) continue;
      this.sql.exec("INSERT INTO shops (id, name, ip_hash, created_at) VALUES (?, ?, ?, ?)", id, name.slice(0, 30), ipHash, now);
      return { ok: true, id };
    }
    return { ok: false, error: "店舗IDを作れませんでした。もう一度ためしてください" };
  }

  /** 作るのに失敗したときは予約を取り消す */
  async release(id: string) {
    this.sql.exec("DELETE FROM shops WHERE id = ?", id);
  }
}

/** 店舗ID: 推測しにくい10文字（数字と小文字。見間違えやすい 0 o 1 l i は使わない） */
export function newShopId(): string {
  const chars = "23456789abcdefghjkmnpqrstuvwxyz";
  const b = crypto.getRandomValues(new Uint8Array(10));
  return [...b].map((x) => chars[x % chars.length]).join("");
}

export const SHOP_ID_RE = /^[2-9a-hjkmnp-z]{10}$/;
