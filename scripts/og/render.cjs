// SNS で共有したときの画像（public/og.png, 1200×630）を作り直す。
// 使い方: npm ci のあと  node scripts/og/render.cjs   （Playwright と Chromium が必要）
const path = require("node:path");
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await p.goto("file://" + path.join(__dirname, "og.html"));
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(__dirname, "../../public/og.png") });
  await b.close();
})();
