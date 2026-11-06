import type { ShopPublic } from "../shared/types";
import { adminKey, codeKey, load, save } from "./util";

/**
 * この端末で使っている店舗。全店舗の一覧はどこにも公開しないので、
 * 「作った」「リンクを開いた」店舗だけをこの端末に覚えておく
 */
export interface MyShop {
  id: string;
  name: string;
  color: string;
  prefix: string;
  organization?: string | null;
  /** リンクなしで誰でも開ける店舗（以前からあり、まだ保護していない店舗） */
  open?: boolean;
}

const KEY = "myShops";

export function myShops(): MyShop[] {
  return load<MyShop[]>(KEY, []);
}

export function rememberShop(s: Pick<ShopPublic, "id" | "name" | "color" | "prefix" | "organization" | "authRequired">) {
  const list = myShops().filter((x) => x.id !== s.id);
  save(KEY, [{ id: s.id, name: s.name, color: s.color, prefix: s.prefix, organization: s.organization ?? null, open: !s.authRequired }, ...list]);
}


export function forgetShop(id: string) {
  save(KEY, myShops().filter((x) => x.id !== id));
  localStorage.removeItem(codeKey(id));
  localStorage.removeItem(adminKey(id));
}

/** 共有リンクに入っているキー（#k=...）を取り出す。キーだけを貼り付けたときはそのまま */
export function keyFromText(text: string): string {
  const t = text.trim();
  const m = /[#&?]k=([A-Za-z0-9_-]+)/.exec(t);
  return m ? m[1] : t;
}

/** 共有リンク。キーは # の後ろに入れる（サーバーのログに残らない） */
export const joinLink = (id: string, key: string) => `${location.origin}/${id}/join#k=${key}`;
export const displayLink = (id: string) => `${location.origin}/${id}/display`;
