// 使い方: npm run dev を起動した状態で  npm run e2e   （Playwright と Chromium が必要。本番には使わない）
// 電波が切れたとき: レジで会計 → 未送信として残る → つながったら自動で送られ、厨房に届く（重ならない）
const { chromium } = require("playwright");
const BASE = "http://localhost:5173";
let ng = 0; const check = (c, m) => { console.log(`${c ? "OK  " : "NG  "} ${m}`); if (!c) ng++; };
(async () => {
  const r = await fetch(BASE + "/api/shops", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "電波確認部", color: "#1565c0", ticketCount: 5 }) });
  const { id, adminKey, staffKey } = await r.json();
  const H = { "content-type": "application/json", authorization: "Bearer " + adminKey };
  await fetch(`${BASE}/api/shops/${id}/admin/menu`, { method: "POST", headers: H, body: JSON.stringify({ name: "たこ焼き", price: 300 }) });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(([id, k]) => localStorage.setItem("code:" + id, k), [id, staffKey]);
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${BASE}/${id}/register`); await p.locator(".tk-grid--pick button").first().waitFor();
  await ctx.setOffline(true);
  await p.waitForTimeout(1500);
  await p.locator('.tk-grid--pick button[aria-label^="2"]').click();
  await p.locator('.menu-card__main[aria-label^="たこ焼き"]').click();
  await p.keyboard.type("500"); await p.keyboard.press("Enter");
  await p.locator(".done__change").waitFor({ timeout: 8000 });
  check((await p.locator(".done__change").textContent()).includes("200"), "電波がなくても会計でき、お釣り200円が出る");
  await p.waitForTimeout(1000);
  const badge = await p.locator(".conn").textContent();
  check(/オフライン|未送信/.test(badge), `未送信が分かる表示が出る（${badge.trim()}）`);
  const before = await (await fetch(`${BASE}/api/shops/${id}/admin/summary`, { headers: H })).json();
  check(before.orderCount === 0, "電波がない間はサーバーに届いていない");
  await ctx.setOffline(false);
  let after;
  for (let i = 0; i < 20; i++) { await p.waitForTimeout(1000); after = await (await fetch(`${BASE}/api/shops/${id}/admin/summary`, { headers: H })).json(); if (after.orderCount) break; }
  check(after.orderCount === 1 && after.sales === 300, `つながったら自動で送られる（${after.orderCount}件・${after.sales}円）`);
  await p.waitForTimeout(3000);
  const again = await (await fetch(`${BASE}/api/shops/${id}/admin/summary`, { headers: H })).json();
  check(again.orderCount === 1, "同じ注文が2回入らない");
  check(errs.length === 0, "画面のエラーなし " + errs.join(" / "));
  await fetch(`${BASE}/api/shops/${id}/admin/shop/delete`, { method: "POST", headers: H, body: JSON.stringify({ confirm: "電波確認部" }) });
  await b.close(); console.log(ng ? `${ng}件 失敗` : "すべて成功"); process.exit(ng ? 1 : 0);
})();
