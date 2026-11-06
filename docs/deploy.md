# 本番に公開する手順（Cloudflare）

おすすめは **A. GitHub とつないで自動で公開**（Workers Builds）です。PC にツールを入れる必要がなく、
以後はブランチにプッシュするたびに自動で反映されます。手元の PC から公開したい場合は B を使います。

## A. GitHub とつないで自動で公開（おすすめ・ブラウザだけで完結）

所要時間の目安: 15分

1. https://dash.cloudflare.com にログインし、左のメニューから **Workers & Pages** を開く
2. **作成（Create）** →「**Git リポジトリをインポート**（Import a repository）」を選ぶ
3. GitHub を連携し、リポジトリ **kawamoto24e1058/tech-mogiten** を選ぶ
4. 設定を次のようにする

   | 項目 | 値 |
   |---|---|
   | プロジェクト名（Worker 名） | `tech-mogiten`（ `wrangler.jsonc` の `name` と同じにする） |
   | 本番ブランチ | `claude/festival-shop-pos-system-4bahjj`（ main に取り込んだ後は `main` ） |
   | ビルドコマンド | `npm run build` |
   | デプロイコマンド | `npx wrangler deploy` |
   | ルートディレクトリ | `/`（空欄のまま） |

5. 「保存してデプロイ」を押す。ビルドのログが流れ、数分で終わる
6. Worker の画面に表示される `https://tech-mogiten.<アカウント名>.workers.dev` が本番の URL

> 変数・シークレットの設定はいりません。店舗は各部・団体が「店舗をつくる」から作り、共有リンクで守られます。

ビルドやデプロイが失敗したら、ログの赤い行から最後までを共有してください。

## B. 手元の PC から公開する

### 0. 用意するもの

- Node.js 20 以上（ `node -v` で確認）と Git

### 1. コードを用意してログインする

```bash
git clone https://github.com/kawamoto24e1058/tech-mogiten.git
cd tech-mogiten
git checkout claude/festival-shop-pos-system-4bahjj   # main に取り込んだ後なら不要
npm install
npx wrangler login
```

### 2. 公開する

```bash
npm run deploy
```

### うまくいかないとき

| 表示 | 対応 |
|---|---|
| Durable Objects に関するエラー（無料プランで使えない等） | エラー全文を共有してください |
| `Authentication error` | `npx wrangler login` をやり直す |

## 最初の設定（公開後に1回だけ）

1. 本番URLのトップから、各お店の「管理」を開く
2. 「設定」で店舗名・色・札の記号・札の枚数を確かめる
3. 「メニュー」で商品・価格・残り数を登録する
4. 部員のスマホで本番URLを開き、自分の担当（レジ・厨房）を押す。ホーム画面に追加しておくと便利

## リハーサルの後（本番の前日まで）

各店舗の管理画面 →「設定」→「営業の準備」→「練習データを消す」。
メニュー・価格・合言葉は残り、注文と売上だけが消えます。

## 毎日の開店前・閉店後

- 開店前: 「営業の準備」→「札をすべて空きに戻す」、「締め」→ 釣り銭準備金を入力
- 閉店後: 「締め」で現金を数えて記録 →「売上」→「CSVで書き出す」で保存

## 修正を反映したいとき

A の場合は、本番ブランチにプッシュするだけで自動で反映されます。B の場合は、もう一度 `npm run deploy` します。どちらもデータは消えません。
