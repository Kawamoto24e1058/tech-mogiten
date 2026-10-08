# 本番に公開する手順（Cloudflare）

所要時間の目安: 30分。自分のPC（Mac / Windows / Linux）で行います。

## 0. 用意するもの

- Cloudflare のアカウント（無料。 https://dash.cloudflare.com/sign-up ）
- Node.js 20 以上（ `node -v` で確認）
- Git

## 1. コードを手元に用意する

```bash
git clone https://github.com/kawamoto24e1058/tech-mogiten.git
cd tech-mogiten
git checkout claude/festival-shop-pos-system-4bahjj   # main に取り込んだ後なら不要
npm install
```

## 2. Cloudflare にログインする

```bash
npx wrangler login
```

ブラウザが開くので、Cloudflare にログインして「Allow」を押します。

## 3. テック部の全体PINを設定する

```bash
npx wrangler secret put MASTER_PIN
```

聞かれたら PIN を入力します。**部員以外に推測されにくいもの（8文字以上）**にしてください。
これは「全体の売上」と、各店舗の最初の設定に使う一番強い PIN です。

> 初めて公開する前に secret を設定しようとすると、「Worker がまだない」と聞かれることがあります。
> その場合は「作成する（y）」を選ぶか、先に 4 を行ってから 3 をやり直してください。

## 4. 公開する

```bash
npm run deploy
```

最後に表示される `https://tech-mogiten.<アカウント名>.workers.dev` が本番のURLです。

### うまくいかないとき

| 表示 | 対応 |
|---|---|
| Durable Objects に関するエラー（無料プランで使えない等） | Cloudflare の管理画面で Workers の利用状況を確認してください。解決しなければエラー全文を共有してください |
| `Authentication error` | `npx wrangler login` をやり直す |
| `MASTER_PIN` が違うと言われる | `npx wrangler secret put MASTER_PIN` で入れ直す |

## 5. 最初の設定（公開後に1回だけ）

1. 本番URLの `/admin` を開き、全体PINを入力する
2. 各店舗の「詳しく」→ 管理画面 →「設定」で
   - 店舗名・色・札の記号・札の枚数
   - **レジ・厨房の合言葉**（部員に共有する）と **管理PIN**（管理する人だけ）
3. 「メニュー」で商品・価格・残り数を登録する
4. 部員のスマホで本番URLを開き、合言葉を入力する

## 6. リハーサルの後（本番の前日まで）

各店舗の管理画面 →「設定」→「営業の準備」→「練習データを消す」。
メニュー・価格・合言葉は残り、注文と売上だけが消えます。

## 7. 毎日の開店前・閉店後

- 開店前: 「営業の準備」→「札をすべて空きに戻す」、「締め」→ 釣り銭準備金を入力
- 閉店後: 「締め」で現金を数えて記録 →「売上」→「CSVで書き出す」で保存

## 修正を反映したいとき

コードを直したら、もう一度 `npm run deploy` するだけです。データは消えません。
