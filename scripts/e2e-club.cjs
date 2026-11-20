// テック部版の通しの確認: 引っ越し → 配達センター → 届け先の係が注文 → 各店の厨房 → 配達係 → 精算 → 売上
// 使い方: npm run dev（:5173 今の公開版）と npm run dev:club（:5174 テック部版）を起動した状態で  node scripts/e2e-club.cjs
const { chromium } = require("playwright");
const OLD = process.argv[2] ?? "http://localhost:5173";
const CLUB = process.argv[3] ?? "http://localhost:5174";
let ng = 0;
const check = (c, m) => { console.log(`${c ? "OK  " : "NG  "} ${m}`); if (!c) ng++; };
async function call(base, path, key, body, method) {
  for (let i = 0; i < 2; i++) {
    const r = await fetch(base + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null; try { data = await r.json(); } catch {}
    if (r.status < 500 || i === 1) return { status: r.status, data };
  }
}
const link = (base, id, key) => `${base}/${id}/join#k=${key}`;

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const mk = async () => { const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } }); const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept()); return { ctx, p }; };
  const made = [];
  try {
    // ---------- 1. 今の公開版に、テック部と Grok の店（1日目のデータ）----------
    const t = (await call(OLD, "/api/shops", null, { name: "テック部E2E", color: "#c2410c", ticketCount: 20, password: "tech-pass-123" })).data;
    const g = (await call(OLD, "/api/shops", null, { name: "GrokE2E", color: "#15803d", ticketCount: 20, password: "grok-pass-123" })).data;
    made.push(t, g);
    await call(OLD, `/api/shops/${t.id}/admin/menu`, t.adminKey, { name: "焼き鳥", price: 150 });
    await call(OLD, `/api/shops/${t.id}/admin/menu`, t.adminKey, { name: "ジュース", price: 100 });
    let st = (await call(OLD, `/api/shops/${t.id}/admin/menu`, t.adminKey, { name: "フランク", price: 200 })).data;
    const yaki = st.menu.find((m) => m.name === "焼き鳥");
    await call(OLD, `/api/shops/${t.id}/admin/discounts`, t.adminKey, { discounts: [{ id: "", name: "2本で250円", itemIds: [yaki.id], every: 2, off: 50, enabled: true }] }, "PUT");
    await call(OLD, `/api/shops/${g.id}/admin/menu`, g.adminKey, { name: "たこ焼き", price: 300 });
    await call(OLD, `/api/shops/${t.id}/admin/float`, t.adminKey, { amount: 5000 }, "PUT");
    // 1日目の注文（レジから）
    const ws = new WebSocket(`${OLD.replace("http", "ws")}/api/shops/${t.id}/ws?screen=register&code=${t.staffKey}`);
    await new Promise((r) => (ws.onopen = r));
    ws.send(JSON.stringify({ type: "op", opId: "o1", op: { kind: "createOrder", order: { id: crypto.randomUUID(), ticket: 3, lines: [{ itemId: yaki.id, qty: 3 }], received: 1000, createdAt: Date.now() } } }));
    await new Promise((r) => setTimeout(r, 800));
    ws.close();
    const oldSum = (await call(OLD, `/api/shops/${t.id}/admin/summary`, t.adminKey)).data;
    check(oldSum.sales === 400, `今の公開版: テック部の1日目の売上 ${oldSum.sales}円`);
    check((await call(OLD, "/api/move", null, { link: link(OLD, t.id, t.adminKey) })).status === 404, "今の公開版には引っ越しの入口がない");
    check((await call(OLD, "/api/hub/public")).status === 404, "今の公開版には配達がない");

    // ---------- 2. テック部版へ引っ越し（画面から）----------
    const A = await mk();
    await A.p.goto(`${CLUB}/move`);
    await A.p.fill("#mv-link", link(OLD, g.id, g.staffKey));
    await A.p.click("button:has-text('引っ越す')");
    await A.p.locator(".banner, [role=alert]").first().waitFor();
    check((await A.p.locator("body").textContent()).includes("部員用リンクでは引っ越せません"), "部員用リンクでは引っ越せない");
    await A.p.fill("#mv-link", link(OLD, t.id, t.adminKey));
    await A.p.click("button:has-text('引っ越す')");
    await A.p.locator("text=を引っ越しました").waitFor({ timeout: 15000 });
    check((await A.p.locator("body").textContent()).includes("注文 1 件"), "引っ越し: 注文1件が移った");
    const ts = (await call(CLUB, `/api/shops/${t.id}/admin/summary`, t.adminKey)).data;
    check(ts.sales === 400 && ts.floatCash === 5000, `テック部版でも1日目の売上 ${ts.sales}円・釣り銭 ${ts.floatCash}円`);
    check((await call(CLUB, `/api/shops/${t.id}/auth`, null, { code: t.staffKey })).data?.role === "staff", "部員用リンクの鍵がそのまま使える");
    const tsState = (await call(CLUB, `/api/shops/${t.id}/admin/state`, t.adminKey)).data;
    check(tsState.discounts.length === 1 && tsState.menu.length === 3, "割引とメニューも移った");
    const mv2 = await call(CLUB, "/api/move", null, { link: link(OLD, g.id, g.adminKey) });
    check(mv2.status === 200, "Grok も引っ越せる");
    const again = await call(CLUB, "/api/move", null, { link: link(OLD, t.id, t.adminKey) });
    check(again.status === 200 && again.data.orders === 1, "もう一度引っ越すと上書き（重ならない）");

    // ---------- 3. 配達センター ----------
    await A.p.goto(`${CLUB}/hub/admin`);
    await A.p.click(`text=「テック部E2E」を中心に配達をはじめる`);
    await A.p.locator("text=参加する店").waitFor({ timeout: 10000 });
    await A.p.fill("#hub-shop", link(CLUB, g.id, g.staffKey));
    await A.p.click("form:has(#hub-shop) button[type=submit]");
    await A.p.locator(".setup-list li", { hasText: "GrokE2E" }).waitFor();
    for (const name of ["屋内展示", "Grokの模擬店"]) {
      await A.p.fill("#hub-place", name);
      await A.p.click("form:has(#hub-place) button[type=submit]");
      await A.p.locator(".link-row__title", { hasText: `${name}の配達注文用リンク` }).waitFor();
    }
    check(true, "配達センター: 店2つ・届け先2つを登録");
    const adm = (await call(CLUB, "/api/hub/admin", t.adminKey)).data;
    const placeKey = adm.places.find((p) => p.name === "屋内展示").key;
    const otherPlaceKey = adm.places.find((p) => p.name === "Grokの模擬店").key;
    const courierKey = adm.courierKey;
    check((await call(CLUB, "/api/hub/admin", placeKey)).status === 401, "届け先のリンクでは管理できない");
    check((await call(CLUB, "/api/hub/admin", t.staffKey)).status === 401, "部員用リンクでは配達センターを管理できない");
    check((await call(CLUB, "/api/hub/order", courierKey, { id: crypto.randomUUID(), lines: [] })).status === 401, "配達係のリンクでは注文できない");

    // ---------- 4. 届け先の係が注文 ----------
    const P = await mk();
    await P.p.goto(`${CLUB}/hub/order#k=${placeKey}`);
    await P.p.locator(".hub-item__main", { hasText: "焼き鳥" }).waitFor({ timeout: 10000 });
    check(!(P.p.url()).includes("#k="), "開いたあと、鍵がアドレス欄から消える");
    await P.p.locator(".hub-item__main", { hasText: "焼き鳥" }).click();
    await P.p.locator(".hub-item__main", { hasText: "焼き鳥" }).click();
    await P.p.locator(".hub-item__main", { hasText: "たこ焼き" }).click();
    await P.p.fill("#hub-note", "青い服");
    await P.p.click("text=配達を頼む");
    await P.p.locator(".hub-done__no").waitFor({ timeout: 10000 });
    const no = (await P.p.locator(".hub-done__no").textContent()).trim();
    const doneText = await P.p.locator(".hub-done").textContent();
    check(no === "配-1" && doneText.includes("550円"), `配達番号 ${no}・合計550円（焼き鳥2本250円＋たこ焼き300円）`);

    // ---------- 5. 各店の厨房 ----------
    const K = await mk();
    await K.p.addInitScript(([id, k]) => localStorage.setItem("code:" + id, k), [t.id, t.staffKey]);
    await K.p.goto(`${CLUB}/${t.id}/kitchen`);
    await K.p.locator(".kcard", { hasText: "配-1" }).waitFor({ timeout: 10000 });
    const kc = await K.p.locator(".kcard", { hasText: "配-1" }).textContent();
    check(kc.includes("屋内展示") && kc.includes("青い服") && kc.includes("焼き鳥") && !kc.includes("たこ焼き"), "テック部の厨房には、テック部の分だけ・届け先つきで届く");
    const C = await mk();
    await C.p.goto(`${CLUB}/hub/courier#k=${courierKey}`);
    await C.p.locator(".hub-card", { hasText: "配-1" }).waitFor({ timeout: 10000 });
    check(await C.p.locator(".hub-card .btn--big").first().isDisabled(), "両方の店ができるまで、配達係は受け取れない");
    await K.p.locator(".kcard", { hasText: "配-1" }).locator("button:has-text('できた')").click();
    // Grok の厨房（API で「できた」）
    const gws = new WebSocket(`${CLUB.replace("http", "ws")}/api/shops/${g.id}/ws?screen=kitchen&code=${g.staffKey}`);
    const gSnap = await new Promise((r) => { gws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "snapshot") r(m.data); }; });
    const gOrder = gSnap.orders.find((o) => o.delivery);
    check(!!gOrder && gOrder.lines.some((l) => l.name === "たこ焼き") && gOrder.total === 300, "Grok の厨房には、たこ焼きだけが届く");
    gws.send(JSON.stringify({ type: "op", opId: "g1", op: { kind: "setStatus", orderId: gOrder.id, status: "ready" } }));
    await new Promise((r) => setTimeout(r, 800));
    gws.close();
    const D = await mk();
    await D.p.goto(`${CLUB}/${t.id}/display`);
    await D.p.waitForTimeout(2000);
    check(!(await D.p.locator("body").textContent()).includes("配-1"), "配達の注文は呼び出し表示に出ない");

    // ---------- 6. 配達係 ----------
    await C.p.locator(".hub-card", { hasText: "配-1" }).locator("button:has-text('受け取った')").waitFor({ timeout: 10000 });
    await C.p.locator(".hub-card", { hasText: "配-1" }).locator("button:has-text('受け取った')").click();
    await C.p.locator(".hub-card", { hasText: "配-1" }).locator("button:has-text('もらった')").waitFor({ timeout: 10000 });
    await K.p.locator(".kcol--ready .kcard, .kcard--ready", { hasText: "配-1" }).waitFor({ state: "detached", timeout: 10000 }).then(() => check(true, "受け取ると厨房の「できた」から外れる")).catch(() => check(false, "受け取ると厨房の「できた」から外れる"));
    await C.p.locator(".hub-card", { hasText: "配-1" }).locator("button:has-text('もらった')").click();
    await C.p.locator(".hub-cash__row", { hasText: "テック部E2E" }).waitFor({ timeout: 10000 });
    const cash = await C.p.locator(".hub-cash").textContent();
    check(cash.includes("250円") && cash.includes("300円"), "手元のお金: テック部へ250円・Grokへ300円");
    let tsum = (await call(CLUB, `/api/shops/${t.id}/admin/summary`, t.adminKey)).data;
    check(tsum.sales === 650 && tsum.delivery.unsettled === 250 && tsum.expectedCash === 5000 + 400, `テック部: 売上650円・未精算250円・あるはずの現金 ${tsum.expectedCash}円（配達分はまだ入らない）`);
    await C.p.locator(".hub-cash__row", { hasText: "テック部E2E" }).locator("button").click();
    await C.p.waitForTimeout(1500);
    tsum = (await call(CLUB, `/api/shops/${t.id}/admin/summary`, t.adminKey)).data;
    check(tsum.delivery.unsettled === 0 && tsum.expectedCash === 5000 + 650, `レジに渡すと、あるはずの現金に入る（${tsum.expectedCash}円）`);
    const gsum = (await call(CLUB, `/api/shops/${g.id}/admin/summary`, g.adminKey)).data;
    check(gsum.sales === 300 && gsum.delivery.unsettled === 300, "Grok: 売上300円・未精算300円（まだ渡していない）");

    // ---------- 6b. 店のレジから「配達を頼む」----------
    const R = await mk();
    await R.p.addInitScript(([id, k]) => localStorage.setItem("code:" + id, k), [g.id, g.staffKey]);
    await R.p.goto(`${CLUB}/${g.id}/register`);
    await R.p.locator(".appbar__btn--delivery").waitFor({ timeout: 10000 });
    await R.p.locator(".appbar__btn--delivery").click();
    await R.p.locator(".hub-item__main", { hasText: "フランク" }).waitFor({ timeout: 10000 });
    check(await R.p.locator(".hub-item__main", { hasText: "たこ焼き" }).count() === 0, "Grok のレジから頼むとき、Grok 自身のメニューは出ない");
    await R.p.locator(".hub-item__main", { hasText: "フランク" }).click();
    await R.p.click(".hub-cart button:has-text('配達を頼む')");
    await R.p.locator(".hub-done__no").waitFor({ timeout: 10000 });
    check((await R.p.locator(".hub-done").textContent()).includes("200円"), `レジから配達を頼める（${(await R.p.locator(".hub-done__no").textContent()).trim()}・200円）`);
    await K.p.locator(".kcard--delivery", { hasText: "GrokE2E へ" }).waitFor({ timeout: 10000 });
    check(true, "テック部の厨房に「配達依頼 ・ GrokE2E へ」の伝票が出る");
    check((await K.p.locator(".kdelivery-alert").textContent()).includes("配達の依頼 1件"), "厨房の上に「配達の依頼 1件」のお知らせ");
    await R.p.click("text=レジに戻る");
    check(await R.p.locator(".menu-card__main", { hasText: "たこ焼き" }).count() === 1, "「レジに戻る」でいつものレジに戻る");
    const rb = (await call(CLUB, "/api/hub/board", courierKey)).data.deliveries.find((d) => d.placeName === "GrokE2E");
    check(!!rb, "配達係の画面に、届け先「GrokE2E」の配達が出る");
    if (rb) await call(CLUB, `/api/hub/deliveries/${rb.id}/cancel`, courierKey, {});

    // ---------- 7. 取り消し・ほかの届け先 ----------
    const o2 = await call(CLUB, "/api/hub/order", placeKey, { id: crypto.randomUUID(), lines: [{ shopId: t.id, itemId: yaki.id, qty: 1 }] });
    check(o2.status === 200 && o2.data.delivery.no === 3, "番号は日ごとの通し番号（配-3）");
    const seeOther = (await call(CLUB, "/api/hub/board", otherPlaceKey)).data;
    check(seeOther.deliveries.length === 0, "ほかの届け先の係には、この届け先の配達は見えない");
    check((await call(CLUB, `/api/hub/deliveries/${o2.data.delivery.id}/cancel`, otherPlaceKey, {})).status === 404, "ほかの届け先からは取り消せない");
    check((await call(CLUB, `/api/hub/deliveries/${o2.data.delivery.id}/cancel`, placeKey, {})).status === 200, "頼んだ届け先からは取り消せる");
    tsum = (await call(CLUB, `/api/shops/${t.id}/admin/summary`, t.adminKey)).data;
    check(tsum.sales === 650 && tsum.cancelledCount === 2, "取り消した配達は売上に入らない（キャンセル2件）");
    const bad = await call(CLUB, "/api/hub/order", placeKey, { id: crypto.randomUUID(), lines: [{ shopId: "zzzzzzzzzz", itemId: "x", qty: 1 }] });
    check(bad.status === 400, "参加していない店の商品は頼めない");
  } catch (e) {
    check(false, "途中で止まった: " + e.message.split("\n")[0]);
  } finally {
    for (const s of made) {
      for (const base of [OLD, CLUB]) await call(base, `/api/shops/${s.id}/admin/shop/delete`, s.adminKey, { confirm: s.id === made[0].id ? "テック部E2E" : "GrokE2E" });
    }
    check(errs.length === 0, `画面のエラーなし${errs.length ? "：" + errs.slice(0, 3).join(" / ") : ""}`);
    console.log(ng ? `\n${ng}件 失敗` : "\nすべて成功");
    await b.close();
    process.exit(ng ? 1 : 0);
  }
})();
