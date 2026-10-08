// npm run dev の前に、ローカル用の設定ファイル .dev.vars がなければ作る
import { copyFileSync, existsSync } from "node:fs";

if (!existsSync(".dev.vars")) {
  copyFileSync(".dev.vars.example", ".dev.vars");
  console.log(".dev.vars を作成しました（ローカル用の全体PINとデモデータの設定）");
}
