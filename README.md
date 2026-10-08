# 模擬店 会計システム

文化祭の模擬店（2店舗）向けの会計システムです。要件は [docs/requirements.md](docs/requirements.md) にあります。

- レジ・厨房・呼び出し表示・管理の4画面。スマホでもPCでも、URLを開くだけで使えます
- 店舗ごとにデータを完全に分けています（1店舗＝1つの Durable Object）
- 電波が切れてもレジは会計を続けられます。回線が戻ると自動で送信します

## 画面のURL

| URL | 画面 | 必要なもの |
|---|---|---|
| `/` | 入口（店舗と画面の一覧） | なし |
| `/a/register` | A店のレジ | A店の合言葉 |
| `/a/kitchen` | A店の厨房・受け渡し | A店の合言葉 |
| `/a/display` | A店の呼び出し表示 | なし |
| `/a/admin` | A店の管理（売上・メニュー・札・レジ締め・設定） | A店の管理PIN または全体PIN |
| `/admin` | テック部用：2店舗の売上 | 全体PIN |

B店は `/b/...` です。

## 構成

| 場所 | 中身 |
|---|---|
| `src/` | 画面（React + TypeScript、PWA） |
| `src/sync.ts` | サーバーとの接続、オフライン時の送信待ちリスト |
| `worker/index.ts` | Cloudflare Worker の入口（API の振り分け、静的ファイル配信） |
| `worker/shop.ts` | 店舗ごとの Durable Object（SQLite に保存、WebSocket で配信） |
| `shared/` | 画面とサーバーで共通の型・計算（札の割り当て、売上集計、CSV） |

## 開発

```bash
npm install
cp .dev.vars.example .dev.vars   # ローカル用の全体PINを設定
npm run dev                      # ビルドして http://localhost:8787 で起動
```

画面だけを素早く直したいときは、別のターミナルで `npm run dev:client` を動かすと Vite（http://localhost:5173）から API を wrangler dev に中継します。

### 確認

```bash
npm run typecheck
npm test                      # 計算ロジックの単体テスト
node scripts/smoke.mjs        # wrangler dev を起動した状態で、API の通し確認（データが作られます）
```

## 本番に公開する（Cloudflare）

```bash
npx wrangler login
npx wrangler secret put MASTER_PIN   # テック部の全体PIN（部外者に推測されにくいものに）
npm run deploy
```

`https://tech-mogiten.<アカウント名>.workers.dev` で公開されます。

### 最初の設定

1. `/admin` を開き、全体PINを入力する
2. 各店舗の「管理画面へ」→「設定」で、店舗名・色・札の記号・札の枚数を決める
3. 同じ画面で **レジ・厨房の合言葉** と **管理PIN** を設定する（合言葉を設定するまで、レジと厨房は使えません）
4. 「メニュー」で商品と価格を登録する
5. 部員のスマホで `/a/register` などを開き、合言葉を入力する。ホーム画面に追加しておくと、電波がなくても開けます

## 当日の運用メモ

- レジは各店舗1台だけで開いてください。2台開くと画面に警告が出ます
- オフラインの間、レジの上部に「オフライン・未送信◯件」と出ます。厨房には届いていないので、口頭で伝えてください
- オフラインの間は、端末の再起動やブラウザのデータ削除をしないでください（未送信の注文が消えます）
- 閉店後は「管理 → レジ締め」で現金を数えて記録し、「売上 → CSVで書き出す」で保存してください
