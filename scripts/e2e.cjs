// 使い方: npm run dev を起動した状態で  npm run e2e   （Playwright と Chromium が必要。本番には使わない）
// 通しの動作確認: 店舗をつくる → 設定 → 部員の端末 → レジ → 厨房 → 呼び出し → 売上 → 締め → 削除・復元 → 復旧 → 店舗削除
const { chromium } = require("playwright");
const BASE = process.argv[2] ?? "http://localhost:5173";
const proxy = process.env.HTTPS_PROXY && BASE.startsWith("https") ? { server: process.env.HTTPS_PROXY } : undefined;
let ng = 0;
const check = (c, m) => { console.log(`${c ? "OK  " : "NG  "} ${m}`); if (!c) ng++; };
const api = async (path, key, init = {}) => {
  const r1 = await api1(path, key, init);
  if (r1.status >= 500) { console.log(`     （${path} が ${r1.status}。1回だけ再試行）`); return api1(path, key, init); }
  return r1;
};
const api1 = async (path, key, init = {}) => {
  const r = await fetch(BASE + path, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(key ? { authorization: `Bearer ${key}` } : {}) } });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch(proxy ? { proxy } : {});
  const errs = [];
  const mk = async (vp = { width: 1280, height: 800 }) => {
    const ctx = await b.newContext({ viewport: vp });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("dialog", (d) => d.accept());
    return { ctx, p };
  };
  let id, adminKey, staffKey, recovery;
  try {
    // ---------- 1. 店舗をつくる ----------
    const A = await mk();
    await A.p.goto(BASE + "/new");
    await A.p.fill("#shop-name", "E2E確認部");
    await A.p.click('button[aria-label="オレンジ"]');
    await A.p.fill("#shop-count", "10");
    check(await A.p.locator("button[type=submit]").isDisabled(), "同意しないと店舗をつくれない");
    await A.p.check(".check input");
    await A.p.click("button[type=submit]");
    await A.p.waitForURL(/\/setup\?step=1/, { timeout: 15000 });
    id = new URL(A.p.url()).pathname.split("/")[1];
    adminKey = await A.p.evaluate((id) => localStorage.getItem("admin:" + id), id);
    check(/^[2-9a-z]{10}$/.test(id) && !!adminKey, `店舗ができた（ID ${id.length}文字・管理キーを端末に保存）`);

    // ---------- 2. はじめの設定 ----------
    for (const [n, price] of [["焼き鳥", "150"], ["ジュース", "100"]]) {
      await A.p.fill("#setup-item-name", n);
      await A.p.fill('input[placeholder="300"]', price);
      await A.p.click("text=＋ 追加");
      await A.p.locator(".setup-list li", { hasText: n }).waitFor();
    }
    check(await A.p.locator(".setup-list li").count() === 2, "商品を2つ登録できた");
    await A.p.click("text=2品で次へ");
    await A.p.click('.pick-chip:has-text("焼き鳥")');
    await A.p.fill("#disc-amount", "250");
    const prev = await A.p.locator(".disc-preview").textContent();
    check(prev.includes("250円") && prev.includes("400円"), "割引のプレビュー: 2本 250円・3本 400円");
    // 「追加」を押さずに次へ → 追加してから進む（入れた割引が消えない）
    await A.p.click(".setup-nav >> text=この割引を追加して次へ");
    await A.p.locator("text=番号札を何枚用意しますか？").waitFor();
    const ds = (await api(`/api/shops/${id}/admin/state`, adminKey)).data.discounts;
    check(ds.length === 1 && ds[0].every === 2 && ds[0].off === 50 && ds[0].name === "2個で250円", "割引（焼き鳥2個で250円＝50円引き）が保存された");
    check(await A.p.inputValue("#tk-count") === "10", "札の枚数（10枚）が引き継がれている");
    await A.p.click(".setup-nav >> text=次へ");
    await A.p.locator("text=リンクを配りましょう").waitFor();
    const links = await A.p.locator(".link-row__url, .link-row input").allTextContents();
    const staffUrl = await A.p.evaluate(() => [...document.querySelectorAll("input, .link-row__url")].map((e) => e.value || e.textContent).find((t) => t && t.includes("/join#k=") && !t.includes(localStorage.getItem("admin:" + location.pathname.split("/")[1]))));
    staffKey = staffUrl ? new URL(staffUrl).hash.replace("#k=", "") : null;
    check(!!staffKey && staffKey !== adminKey, "部員用リンクが出ていて、管理用とは別のキー");
    recovery = await A.p.locator(".recovery__code").textContent().catch(() => null);
    check(!!recovery && /[A-Z0-9]{4}-/.test(recovery), "復旧コードが表示される");
    check(await A.p.locator(".setup-nav .btn--accent").isDisabled(), "復旧コードを保存したと答えるまで先へ進めない");
    await A.p.check(".recovery .check input, .check input >> nth=-1");
    await A.p.click(".setup-nav .btn--accent");
    await A.p.locator("text=準備ができました").waitFor();
    check(true, "はじめの設定を最後まで進められた");

    // ---------- 3. 権限の分離（API） ----------
    check((await api(`/api/shops/${id}/admin/state`)).status === 401, "キーなしでは管理APIを使えない");
    check((await api(`/api/shops/${id}/admin/state`, staffKey)).status === 403, "部員用キーでは管理APIを使えない");
    check((await api(`/api/shops/${id}/admin/state`, "x".repeat(32))).status === 401, "でたらめなキーでは使えない");
    const pub = await api(`/api/shops/${id}/public`);
    check(pub.status === 200 && !JSON.stringify(pub.data).includes(staffKey) && !JSON.stringify(pub.data).includes(adminKey), "公開情報にキーが含まれない");
    check((await api(`/api/shops`)).status >= 400 || !Array.isArray((await api(`/api/shops`)).data), "店舗の一覧は取れない");

    // ---------- 4. 部員の端末: リンクを開く → レジ ----------
    const S = await mk();
    await S.p.goto(`${BASE}/${id}/join#k=${staffKey}`);
    await S.p.waitForTimeout(2500);
    check(!(await S.p.url()).includes("#k="), "開いたあと、キーがアドレス欄から消える");
    await S.p.goto(`${BASE}/${id}/register`);
    await S.p.locator('.tk-grid--pick button[aria-label^="1"]').first().click();
    await S.p.locator('.menu-card__main[aria-label^="焼き鳥"]').click();
    await S.p.locator('.menu-card__main[aria-label^="焼き鳥"]').click();
    await S.p.locator('.menu-card__main[aria-label^="焼き鳥"]').click();
    await S.p.locator('.menu-card__main[aria-label^="ジュース"]').click();
    const totalText = await S.p.locator(".pay").textContent();
    check(totalText.includes("500"), `合計 = 150×3 − 50 + 100 = 500円（画面: ${totalText.match(/合計[^円]*円/)?.[0] ?? "?"}）`);
    await S.p.keyboard.type("1000");
    await S.p.keyboard.press("Enter");
    await S.p.locator(".done__change").waitFor({ timeout: 8000 });
    const change = await S.p.locator(".done__change").textContent();
    check(change.includes("500"), `お釣り 500円（画面: ${change}）`);
    check((await S.p.locator(".done__ticket").textContent()).trim() === "1", "渡す札は 1");

    // ---------- 5. 厨房 → 呼び出し表示 ----------
    const D = await mk({ width: 1280, height: 720 });
    await D.p.goto(`${BASE}/${id}/display`);
    const K = await mk();
    await K.p.addInitScript(([id, k]) => localStorage.setItem("code:" + id, k), [id, staffKey]);
    await K.p.goto(`${BASE}/${id}/kitchen`);
    await K.p.locator(".kcard", { hasText: "焼き鳥" }).waitFor({ timeout: 8000 });
    const kc = await K.p.locator(".kcard").first().textContent();
    check(kc.includes("焼き鳥") && kc.includes("3") && kc.includes("ジュース"), "厨房に注文（焼き鳥×3・ジュース×1）が届く");
    await K.p.locator(".kcard button:has-text('できた')").first().click();
    await D.p.locator(".dsp__spot-num", { hasText: "1" }).waitFor({ timeout: 8000 });
    check(true, "「できた」で呼び出し表示に札 1 が出る");
    const dspText = await D.p.locator("body").textContent();
    check(!dspText.includes("ジュース×") && !dspText.includes("E2E確認部の売上"), "呼び出し表示に注文内容・売上は出ない");
    await K.p.locator(".kcard button:has-text('札を受け取って渡した')").first().click();
    await sleep(1500);
    check(await D.p.locator(".dsp__spot-num").count() === 0, "「渡した」で呼び出し表示から消える");

    // ---------- 6. 売上・管理 ----------
    const st = (await api(`/api/shops/${id}/admin/state`, adminKey)).data;
    const sum = (await api(`/api/shops/${id}/admin/summary`, adminKey)).data;
    check(sum.sales === 500 && sum.orderCount === 1, `売上 500円・1件（API: ${sum.sales}円・${sum.orderCount}件）`);
    const yaki = sum.items.find((i) => i.name === "焼き鳥");
    check(yaki && yaki.qty === 3 && yaki.amount === 450, "商品別: 焼き鳥 3本 450円");
    check(sum.items.some((i) => i.amount === -50), "割引 −50円が別に記録される");
    await A.p.goto(`${BASE}/${id}/admin`);
    await A.p.locator(".kpi--main").waitFor();
    check((await A.p.locator(".kpi--main").textContent()).includes("500"), "管理画面の売上に 500円 が出る");

    // CSV
    const csvRes = await fetch(`${BASE}/api/shops/${id}/admin/csv?day=${sum.day}`, { headers: { authorization: `Bearer ${adminKey}` } });
    const csv = await csvRes.text();
    check(csvRes.ok && csv.includes("焼き鳥") && csv.includes("1000"), "CSV に注文（焼き鳥・お預かり1000）が出る");

    // ---------- 7. 注文の削除と復元 ----------
    const orderId = st.orders?.[0]?.id ?? sum.orders?.[0]?.id;
    if (orderId) {
      await api(`/api/shops/${id}/admin/orders/${orderId}/delete`, adminKey, { method: "POST", body: JSON.stringify({}) });
      const s2 = (await api(`/api/shops/${id}/admin/summary`, adminKey)).data;
      check(s2.sales === 0, "注文を削除すると売上から外れる");
      await api(`/api/shops/${id}/admin/orders/${orderId}/restore`, adminKey, { method: "POST", body: JSON.stringify({}) });
      const s3 = (await api(`/api/shops/${id}/admin/summary`, adminKey)).data;
      check(s3.sales === 500, "ゴミ箱から戻すと売上も戻る");
    } else check(false, "注文IDを取得できない");

    // ---------- 8. レジ締め ----------
    await api(`/api/shops/${id}/admin/float`, adminKey, { method: "PUT", body: JSON.stringify({ day: sum.day, amount: 3000 }) });
    const s4 = (await api(`/api/shops/${id}/admin/summary?day=${sum.day}`, adminKey)).data;
    check(s4.expectedCash === 3500, `あるはずの現金 = 釣り銭3000 + 売上500 = 3500円（API: ${s4.expectedCash}）`);

    // ---------- 9. 日報 ----------
    await A.p.goto(`${BASE}/${id}/report?day=${sum.day}`);
    await A.p.waitForTimeout(1500);
    check((await A.p.locator("body").textContent()).includes("500円"), "日報に売上 500円 が出る");

    // ---------- 10. 別の店舗から見えない ----------
    const o2 = await api(`/api/shops`, null, { method: "POST", body: JSON.stringify({ name: "E2E別店", color: "#15803d", ticketCount: 5 }) });
    if (o2.status === 201 || o2.status === 200) {
      const cross1 = await api(`/api/shops/${o2.data.id}/admin/state`, adminKey);
      const cross2 = await api(`/api/shops/${id}/admin/state`, o2.data.adminKey);
      const cross3 = await api(`/api/shops/${o2.data.id}/admin/state`, staffKey);
      check(cross1.status === 401 && cross2.status === 401 && cross3.status === 401, `店舗Aのキーで店舗Bは管理できない・逆も同じ（${cross1.status}/${cross2.status}/${cross3.status}）`);
      const s5 = (await api(`/api/shops/${o2.data.id}/admin/summary`, o2.data.adminKey)).data;
      check(s5.sales === 0 && s5.orderCount === 0, "店舗Bに店舗Aの売上は混ざらない");
      await api(`/api/shops/${o2.data.id}/admin/shop/delete`, o2.data.adminKey, { method: "POST", body: JSON.stringify({ confirm: "E2E別店" }) });
    } else check(false, "2つ目の店舗を作れない: " + o2.status);

    // ---------- 11. 復旧コード ----------
    const rec = await api(`/api/shops/${id}/recover`, null, { method: "POST", body: JSON.stringify({ code: recovery.toLowerCase().replace(/-/g, " ") }) });
    check(rec.status === 200 && rec.data.adminKey, "復旧コードで新しい管理キーが出る");
    check((await api(`/api/shops/${id}/admin/state`, adminKey)).status === 401, "古い管理キーは使えなくなる");
    adminKey = rec.data.adminKey;
    check((await api(`/api/shops/${id}/admin/state`, adminKey)).status === 200, "新しい管理キーで管理できる");
    check((await api(`/api/shops/${id}/recover`, null, { method: "POST", body: JSON.stringify({ code: recovery }) })).status >= 400, "同じ復旧コードは2回使えない");
  } catch (e) {
    check(false, "途中で止まった: " + e.message.split("\n")[0]);
  } finally {
    // ---------- 12. 店舗の削除 ----------
    if (id && adminKey) {
      const name = (await api(`/api/shops/${id}/public`)).data?.name;
      const del = await api(`/api/shops/${id}/admin/shop/delete`, adminKey, { method: "POST", body: JSON.stringify({ confirm: name }) });
      check(del.status === 200, "店舗を削除できる");
      check((await api(`/api/shops/${id}/public`)).status === 404, "削除した店舗は開けない（404）");
    }
    check(errs.length === 0, `画面のエラーなし${errs.length ? "：" + errs.slice(0, 3).join(" / ") : ""}`);
    console.log(ng ? `\n${ng}件 失敗` : "\nすべて成功");
    await b.close();
    process.exit(ng ? 1 : 0);
  }
})();
