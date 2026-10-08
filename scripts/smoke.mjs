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

const A = "/api/shops/a";
const B = "/api/shops/b";

check((await req(`${A}/admin/state`)).status === 401, "認証なしでは管理APIを使えない");
check((await req(`${A}/codes`.replace("/codes", "/admin/codes"), { code: MASTER, method: "PUT", body: { staffCode: "yakisoba", adminPin: "1234" } })).status === 200, "全体PINでA店の合言葉と管理PINを設定");
await req(`${B}/admin/codes`, { code: MASTER, method: "PUT", body: { staffCode: "crepe", adminPin: "5678" } });
check((await req(`${A}/auth`, { method: "POST", body: { code: "yakisoba" } })).data.role === "staff", "合言葉でスタッフとして認証");
check((await req(`${B}/admin/state`, { code: "1234" })).status === 401, "A店の管理PINではB店を管理できない");
check((await req(`${A}/admin/state`, { code: "yakisoba" })).status === 403, "合言葉だけでは管理画面を使えない");

const before = (await req(`${A}/admin/state`, { code: "1234" })).data.menu.length;
let st = (await req(`${A}/admin/menu`, { code: "1234", method: "POST", body: { name: "テスト焼きそば", price: 400 } })).data;
st = (await req(`${A}/admin/menu`, { code: "1234", method: "POST", body: { name: "テストジュース", price: 150 } })).data;
check(st.menu.length === before + 2, "メニューを2件登録");
const yakisoba = st.menu.find((m) => m.name === "テスト焼きそば");
const juice = st.menu.find((m) => m.name === "テストジュース");
await req(`${A}/admin/settings`, { code: "1234", method: "PUT", body: { ticketCount: 3 } });

const reg = socket("a", "register", "yakisoba");
const kit = socket("a", "kitchen", "yakisoba");
const disp = socket("a", "display");
await Promise.all([reg.opened, kit.opened, disp.opened]);
await reg.until((m) => m.type === "snapshot");
check((await disp.until((m) => m.type === "display")).data.ready.length === 0, "呼び出し表示は空");

const bad = socket("a", "register", "wrong");
const badOpened = await bad.opened.then(() => true, () => false);
check(!badOpened, "合言葉が違うとWebSocketに接続できない");

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
const soldSnap = await reg.until((m) => m.type === "snapshot" && m.data.menu.some((x) => x.soldOut));
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
check((await req(`/api/master/summary`, { code: "1234" })).status === 401, "店舗の管理PINでは全体の売上を見られない");

[reg, kit, disp].forEach((s) => s.ws.close());
console.log(failed ? `\n${failed}件 失敗` : "\nすべて成功");
process.exit(failed ? 1 : 0);
