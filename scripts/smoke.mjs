// 開発サーバーに対する通し確認。注文がまだない状態で実行する。
//   rm -rf .wrangler/state && npm run dev   （別のターミナルで）
//   npm run smoke
const BASE = process.argv[2] ?? "http://localhost:5173";
const MASTER = process.env.MASTER_PIN ?? "0000";
let failed = 0;
const check = (cond, msg) => { console.log(`${cond ? "OK  " : "NG  "} ${msg}`); if (!cond) failed++; };

async function req(path, { code, method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(code ? { authorization: `Bearer ${code}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function socket(shop, screen, code) {
  const q = new URLSearchParams({ screen, ...(code ? { code } : {}) });
  const ws = new WebSocket(`${BASE.replace("http", "ws")}/api/shops/${shop}/ws?${q}`);
  const msgs = [];
  const waiters = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); msgs.push(m); waiters.splice(0).forEach((w) => w()); };
  const until = (pred, ms = 3000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    const test = () => { const m = msgs.find(pred); if (m) { clearTimeout(t); resolve(m); } else waiters.push(test); };
    test();
  });
  const opened = new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  return { ws, msgs, until, opened };
}

// 合言葉・PIN を使う設定（REQUIRE_AUTH=1）かどうかで、確かめる内容を変える
const AUTH = (await req("/api/shops")).data[0].authRequired;
console.log(AUTH ? "合言葉・PIN あり の設定で確認します" : "合言葉・PIN なし（既定）の設定で確認します");
async function authCheck(fn, msg) {
  if (!AUTH) { console.log(`SKIP ${msg}（合言葉・PIN なしの設定）`); return; }
  check(await fn(), msg);
}

const A = "/api/shops/a";
const B = "/api/shops/b";

await authCheck(async () => (await req(`${A}/admin/state`)).status === 401, "認証なしでは管理APIを使えない");
check((await req(`${A}/codes`.replace("/codes", "/admin/codes"), { code: MASTER, method: "PUT", body: { staffCode: "yakisoba", adminPin: "1234" } })).status === 200, "全体PINでA店の合言葉と管理PINを設定");
await req(`${B}/admin/codes`, { code: MASTER, method: "PUT", body: { staffCode: "crepe", adminPin: "5678" } });
await authCheck(async () => (await req(`${A}/auth`, { method: "POST", body: { code: "yakisoba" } })).data.role === "staff", "合言葉でスタッフとして認証");
await authCheck(async () => (await req(`${B}/admin/state`, { code: "1234" })).status === 401, "A店の管理PINではB店を管理できない");
await authCheck(async () => (await req(`${A}/admin/state`, { code: "yakisoba" })).status === 403, "合言葉だけでは管理画面を使えない");

const before = (await req(`${A}/admin/state`, { code: "1234" })).data.menu.length;
if (!AUTH) {
  check((await req(`${A}/admin/state`)).status === 200, "合言葉・PIN なしで管理画面を使える");
  check((await req(`/api/master/summary`)).status === 200, "合言葉・PIN なしで全体の売上を見られる");
}
let st = (await req(`${A}/admin/menu`, { code: "1234", method: "POST", body: { name: "テスト焼きそば", price: 400 } })).data;
st = (await req(`${A}/admin/menu`, { code: "1234", method: "POST", body: { name: "テストジュース", price: 150 } })).data;
check(st.menu.length === before + 2, "メニューを2件登録");
const yakisoba = st.menu.findLast((m) => m.name === "テスト焼きそば");
const juice = st.menu.findLast((m) => m.name === "テストジュース");
await req(`${A}/admin/settings`, { code: "1234", method: "PUT", body: { ticketCount: 3 } });

const reg = socket("a", "register", "yakisoba");
const kit = socket("a", "kitchen", "yakisoba");
const disp = socket("a", "display");
await Promise.all([reg.opened, kit.opened, disp.opened]);
await reg.until((m) => m.type === "snapshot");
check((await disp.until((m) => m.type === "display")).data.ready.length === 0, "呼び出し表示は空");

const bad = socket("a", "register", "wrong");
const badOpened = await bad.opened.then(() => true, () => false);
await authCheck(async () => !badOpened, "合言葉が違うとWebSocketに接続できない");

const order1 = { id: crypto.randomUUID(), ticket: 1, lines: [{ itemId: yakisoba.id, qty: 2 }, { itemId: juice.id, qty: 1 }], received: 1000, createdAt: Date.now() };
reg.ws.send(JSON.stringify({ type: "op", opId: "op1", op: { kind: "createOrder", order: order1 } }));
check((await reg.until((m) => m.type === "ack" && m.opId === "op1")).ok, "注文を作成");
reg.ws.send(JSON.stringify({ type: "op", opId: "op1b", op: { kind: "createOrder", order: order1 } }));
await reg.until((m) => m.type === "ack" && m.opId === "op1b");
const snap = await kit.until((m) => m.type === "snapshot" && m.data.orders.length > 0);
check(snap.data.orders.length === 1, "同じ注文を再送しても1件のまま（冪等）");
const o = snap.data.orders[0];
check(o.total === 950 && o.change === 50 && o.seq === 1, "合計950円・お釣り50円・注文番号1");

const short = { ...order1, id: crypto.randomUUID(), received: 100 };
reg.ws.send(JSON.stringify({ type: "op", opId: "op2", op: { kind: "createOrder", order: short } }));
check(!(await reg.until((m) => m.type === "ack" && m.opId === "op2")).ok, "預かり金不足は拒否");

const dup = { ...order1, id: crypto.randomUUID() };
reg.ws.send(JSON.stringify({ type: "op", opId: "op3", op: { kind: "createOrder", order: dup } }));
const dupAck = await reg.until((m) => m.type === "ack" && m.opId === "op3");
check(dupAck.ok && /重複/.test(dupAck.error ?? ""), "使用中の札で会計すると警告付きで受け付ける");

kit.ws.send(JSON.stringify({ type: "op", opId: "k1", op: { kind: "setStatus", orderId: o.id, status: "ready" } }));
await kit.until((m) => m.type === "ack" && m.opId === "k1");
const d = await disp.until((m) => m.type === "display" && m.data.ready.length > 0);
check(d.data.ready[0].ticket === "A-1", "「できた」で呼び出し表示に A-1 が出る");
check(!JSON.stringify(d).includes("テスト焼きそば"), "呼び出し表示には注文内容を送らない");

kit.ws.send(JSON.stringify({ type: "op", opId: "k2", op: { kind: "setStatus", orderId: o.id, status: "handed" } }));
await kit.until((m) => m.type === "ack" && m.opId === "k2");
st = (await req(`${A}/admin/state`, { code: "1234" })).data;
check(st.tickets.length === 1 && st.tickets[0].seq === 2, "渡したら札1は空き、重複注文の札だけ残る");

kit.ws.send(JSON.stringify({ type: "op", opId: "k3", op: { kind: "setSoldOut", itemId: juice.id, soldOut: true } }));
const soldSnap = await reg.until((m) => m.type === "snapshot" && m.data.menu.some((x) => x.id === juice.id && x.soldOut));
check(soldSnap.data.menu.find((x) => x.id === juice.id).soldOut, "厨房の売り切れがレジに反映");

await req(`${A}/admin/menu/${yakisoba.id}`, { code: "1234", method: "PUT", body: { price: 500 } });
st = (await req(`${A}/admin/state`, { code: "1234" })).data;
check(st.orders[0].total === 950, "価格を変えても過去の注文金額は変わらない");

st = (await req(`${A}/admin/orders/${dup.id}/cancel`, { code: "1234", method: "POST", body: { reason: "テスト" } })).data;
check(st.orders.find((x) => x.id === dup.id).status === "cancelled" && st.tickets.length === 0, "キャンセルで札が空く");

await req(`${A}/admin/float`, { code: "1234", method: "PUT", body: { amount: 10000 } });
const sum = (await req(`${A}/admin/summary`, { code: "1234" })).data;
check(sum.sales === 950 && sum.orderCount === 1 && sum.cancelledCount === 1 && sum.expectedCash === 10950, "売上950円・理論現金10,950円");
const closing = (await req(`${A}/admin/closing`, { code: "1234", method: "POST", body: { denominations: { 10000: 1, 500: 1, 100: 4, 50: 1 } } })).data;
check(closing.closing.diff === 0, "レジ締めの差額0円");

const csvBytes = new Uint8Array(await fetch(`${BASE}${A}/admin/csv`, { headers: { authorization: "Bearer 1234" } }).then((r) => r.arrayBuffer()));
const csv = new TextDecoder().decode(csvBytes);
check(csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf && csv.startsWith("注文番号") && csv.includes("テスト焼きそば"), "CSVを書き出せる（BOM付き）");

const master = await req(`/api/master/summary`, { code: MASTER });
check(master.status === 200 && master.data.length === 2 && master.data[0].summary.sales === 950 && master.data[1].summary.sales === 0, "全体の売上で2店舗を別々に集計");
await authCheck(async () => (await req(`/api/master/summary`, { code: "1234" })).status === 401, "店舗の管理PINでは全体の売上を見られない");

// ---- 残り数・割引・レジからの取り消し ----
st = (await req(`${A}/admin/menu`, { code: "1234", method: "POST", body: { name: "限定品", price: 200, stock: 2 } })).data;
const limited = st.menu.findLast((x) => x.name === "限定品");
check(limited.stock === 2, "残り数を設定して商品を登録");
const lim1 = { id: crypto.randomUUID(), ticket: null, lines: [{ itemId: limited.id, qty: 2 }], received: 400, createdAt: Date.now() };
reg.ws.send(JSON.stringify({ type: "op", opId: "s1", op: { kind: "createOrder", order: lim1 } }));
await reg.until((m) => m.type === "ack" && m.opId === "s1");
let lim = (await req(`${A}/admin/state`, { code: "1234" })).data.menu.find((x) => x.id === limited.id);
check(lim.stock === 0 && lim.soldOut, "残り数が0になると自動で売り切れ");
const hist = (await req(`${A}/history`, { code: "yakisoba" })).data;
check(hist.orders[0].id === lim1.id, "レジの履歴に直前の会計が出る（合言葉で見られる）");
check((await req(`${A}/history/${lim1.id}/cancel`, { code: "yakisoba", method: "POST", body: { reason: "入力ミス" } })).status === 200, "会計から5分以内ならレジ（合言葉）で取り消せる");
lim = (await req(`${A}/admin/state`, { code: "1234" })).data.menu.find((x) => x.id === limited.id);
check(lim.stock === 2 && !lim.soldOut, "取り消すと残り数が戻り、販売が再開する");
const old = { id: crypto.randomUUID(), ticket: null, lines: [{ itemId: yakisoba.id, qty: 1 }], received: 500, createdAt: Date.now() - 6 * 60 * 1000 };
reg.ws.send(JSON.stringify({ type: "op", opId: "o1", op: { kind: "createOrder", order: old } }));
await reg.until((m) => m.type === "ack" && m.opId === "o1");
await authCheck(async () => (await req(`${A}/history/${old.id}/cancel`, { code: "yakisoba", method: "POST", body: { reason: "入力ミス" } })).status === 403, "会計から5分以上たつと、レジ（合言葉）では取り消せない");
const adminCancel = await req(`${A}/history/${old.id}/cancel`, { code: "1234", method: "POST", body: { reason: "入力ミス" } });
check(adminCancel.status === 200, `管理PINなら5分以上たっていても取り消せる (${adminCancel.status} ${JSON.stringify(adminCancel.data)})`);
st = (await req(`${A}/admin/menu`, { code: "1234", method: "POST", body: { name: "セット割", price: -100 } })).data;
const disc = st.menu.findLast((x) => x.name === "セット割");
check(disc.price === -100, "割引（マイナスの価格）を登録できる");
const neg = { id: crypto.randomUUID(), ticket: null, lines: [{ itemId: disc.id, qty: 1 }], received: 0, createdAt: Date.now() };
reg.ws.send(JSON.stringify({ type: "op", opId: "n1", op: { kind: "createOrder", order: neg } }));
check(!(await reg.until((m) => m.type === "ack" && m.opId === "n1")).ok, "合計がマイナスになる会計は拒否");
const withDisc = { id: crypto.randomUUID(), ticket: null, lines: [{ itemId: yakisoba.id, qty: 1 }, { itemId: disc.id, qty: 1 }], received: 400, createdAt: Date.now() };
reg.ws.send(JSON.stringify({ type: "op", opId: "n2", op: { kind: "createOrder", order: withDisc } }));
await reg.until((m) => m.type === "ack" && m.opId === "n2");
const wd = (await req(`${A}/history`, { code: "yakisoba" })).data.orders.find((x) => x.id === withDisc.id);
check(wd.total === 400 && wd.change === 0, "割引込みの合計（500 − 100 = 400円）");

// ---- まとめ買い割引（自動） ----
st = (await req(`${A}/admin/discounts`, { code: "1234", method: "PUT", body: { discounts: [{ name: "テスト2個割", itemIds: [yakisoba.id, juice.id], every: 2, off: 100 }] } })).data;
check(st.discounts.length === 1 && st.discounts[0].enabled, "まとめ買い割引を登録");
const priceOf = (id) => st.menu.find((x) => x.id === id).price;
const bundleTotal = priceOf(yakisoba.id) + priceOf(juice.id) * 2 - 100;
check((await req(`${A}/admin/discounts`, { code: "1234", method: "PUT", body: { discounts: [{ name: "空", itemIds: [], every: 2, off: 100 }] } })).status === 400, "対象のない割引は登録できない");
const bundle = { id: crypto.randomUUID(), ticket: null, lines: [{ itemId: yakisoba.id, qty: 1 }, { itemId: juice.id, qty: 2 }], received: 2000, createdAt: Date.now() };
reg.ws.send(JSON.stringify({ type: "op", opId: "d1", op: { kind: "createOrder", order: bundle } }));
await reg.until((m) => m.type === "ack" && m.opId === "d1");
const bo = (await req(`${A}/history`, { code: "yakisoba" })).data.orders.find((x) => x.id === bundle.id);
check(bo.total === bundleTotal && bo.lines.some((l) => l.name === "テスト2個割" && l.price === -100 && l.qty === 1), "対象の商品を合わせて数え、自動で割り引く（3個 → 1回）");
check((await kit.until((m) => m.type === "snapshot" && m.data.discounts?.length === 1, 8000)).data.discounts[0].name === "テスト2個割", "割引の設定が端末に届く");
st = (await req(`${A}/admin/discounts`, { code: "1234", method: "PUT", body: { discounts: [] } })).data;
check(st.discounts.length === 0, "まとめ買い割引を削除");

// ---- 使用中の札が手元に戻っているとき（渡したの押し忘れ） ----
const ru = { id: crypto.randomUUID(), ticket: 3, lines: [{ itemId: yakisoba.id, qty: 1 }], received: 2000, createdAt: Date.now() };
reg.ws.send(JSON.stringify({ type: "op", opId: "u1", op: { kind: "createOrder", order: ru } }));
await reg.until((m) => m.type === "ack" && m.opId === "u1");
kit.ws.send(JSON.stringify({ type: "op", opId: "u2", op: { kind: "setStatus", orderId: ru.id, status: "ready" } }));
await kit.until((m) => m.type === "ack" && m.opId === "u2");
reg.ws.send(JSON.stringify({ type: "op", opId: "u3", op: { kind: "releaseTicket", ticket: 3 } }));
check((await reg.until((m) => m.type === "ack" && m.opId === "u3")).ok, "使用中の札を使い直す操作を受け付ける");
const ruo = (await req(`${A}/history`, { code: "yakisoba" })).data.orders.find((x) => x.id === ru.id);
check(ruo.status === "handed" && ruo.ticketReleased, "札を持っていた「できた」の注文は渡したになり、札が空く");

// ---- 開店前の準備 ----
const t1 = { id: crypto.randomUUID(), ticket: 2, lines: [{ itemId: yakisoba.id, qty: 1 }], received: 500, createdAt: Date.now() };
reg.ws.send(JSON.stringify({ type: "op", opId: "r1", op: { kind: "createOrder", order: t1 } }));
await reg.until((m) => m.type === "ack" && m.opId === "r1");
check((await req(`${A}/admin/state`, { code: "1234" })).data.tickets.length > 0, "（準備）使用中の札がある");
st = (await req(`${A}/admin/tickets/release-all`, { code: "1234", method: "POST", body: {} })).data;
check(st.tickets.length === 0, "札をすべて空きに戻せる");
const sold = { id: crypto.randomUUID(), ticket: null, lines: [{ itemId: limited.id, qty: 1 }], received: 200, createdAt: Date.now() };
reg.ws.send(JSON.stringify({ type: "op", opId: "r2", op: { kind: "createOrder", order: sold } }));
await reg.until((m) => m.type === "ack" && m.opId === "r2");
check((await req(`${A}/admin/reset`, { code: "1234", method: "POST", body: { confirm: "けす" } })).status === 400, "練習データの消去は「消去」と入力しないとできない");
await authCheck(async () => (await req(`${A}/admin/reset`, { code: "yakisoba", method: "POST", body: { confirm: "消去" } })).status === 403, "練習データの消去は合言葉ではできない");
st = (await req(`${A}/admin/reset`, { code: "1234", method: "POST", body: { confirm: "消去" } })).data;
check(st.orders.length === 0 && st.days.length === 0, "練習データを消すと注文がなくなる");
check(st.menu.find((x) => x.id === limited.id).stock === 2, "練習で売れた分の残り数が戻る");
check(st.menu.length > 0 && (!AUTH || (await req(`${A}/auth`, { method: "POST", body: { code: "yakisoba" } })).data.role === "staff"), "メニュー（と合言葉）は残る");
check((await req(`/api/master/summary`, { code: MASTER })).data[0].summary.sales === 0, "全体の売上からも消える");

[reg, kit, disp].forEach((s) => s.ws.close());
console.log(failed ? `\n${failed}件 失敗` : "\nすべて成功");
process.exit(failed ? 1 : 0);
