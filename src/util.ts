export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return crypto.randomUUID();
    } catch {
      // http（非セキュアコンテキスト）では使えないため下で代替する
    }
  }
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できなくても動作は続ける
  }
}

export function buzz() {
  try {
    navigator.vibrate?.(15);
  } catch {
    // 振動に対応していない端末
  }
}

export function minutesSince(ts: number, now: number): number {
  return Math.max(0, Math.floor((now - ts) / 60000));
}

export function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

export function todayJst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

export const codeKey = (shopId: string) => `code:${shopId}`;
export const adminKey = (shopId: string) => `admin:${shopId}`;
export const MASTER_KEY = "code:master";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, code: string | null, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(code ? { authorization: `Bearer ${code}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, "通信できません。電波を確認してください");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `エラー (${res.status})`);
  }
  return (await res.json()) as T;
}
