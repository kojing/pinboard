# pinboard

Confluence (Server / Data Center) のページに置く、Pinterest 風のリファレンスボード(画像・動画)。
リンク集 v3 と同じ仕組み(HTMLマクロ + 添付JS、Content Property 16分割、本人のみ編集)で動きます。

## 配布ファイル(`dist/`)

| ファイル | 用途 |
| --- | --- |
| `reference-board.js` | 本体。Confluenceの部品ページに添付する |
| `reference-board.embed.html` | ボードを置くページの HTML マクロに貼る |
| `reference-board-quick-add.embed.html` | 任意。ブックマークレットの追加画面を軽い別ページにする場合 |
| `reference-board-check.html` | 模擬Confluence上で本体を動かす動作確認ページ |

## 導入

1. `reference-board.js` を部品ページ(例:「リンク集の部品」)に添付する
2. `reference-board.embed.html` の `ASSET_PAGE_ID` をそのページのIDに、`OWNER_USERNAME` を自分のユーザー名に書き換える
3. ボードにするページに HTML マクロを置き、2 の内容を貼る
4. ボードの「ブックマークレット」からブックマークを登録する
5. JS を更新したら添付を上書きし、`?v=` の数字を上げる

## 保存先

- 情報(タイトル・タグ・メモ・URL など): ページの Content Property `ref-board-data`(索引)と `ref-board-data-00〜15`(1個 30,000 バイトまで)
- 画像本体: ボードのページの添付 `rb-<ID>.<拡張子>`、大きい画像は一覧用の `rb-<ID>-t.webp` も
- URL で保存したもの(ブックマークレット・URL指定)は外部 URL をそのまま表示する

## 主な機能

- 一覧は画像・動画だけの石積み表示。操作はすべて詳細画面(← → で移動、Esc で閉じる)
- 追加(本人のみ): 画像ファイルのドラッグ&ドロップ / Ctrl+V / ファイル選択、URL 指定(画像・YouTube・Vimeo・mp4)、他タブの画像のドラッグ
- ブックマークレット: ページ内の画像・動画を大きい順に候補にし、選んで追加。「Confluenceにコピー」で添付保存も可(取得できない画像は URL 保存)
- 詳細からダウンロード(画像、動画はファイル形式のときのみ)
- 検索、画像/動画の切り替え、タグで絞り込み、JSON のインポート・エクスポート

## 開発

ソースは `src/` に分けてあり、`build.py` で `dist/` を作ります。

```sh
python3 build.py
```

- `src/board.js` … 設定・共通処理・添付・画像処理(ここに他のファイルを差し込む)
- `src/lcstore.js` … リンク集 v3 と共通の保存モジュール(16分割)
- `src/board-ui.js` … ボード・詳細・各モーダル
- `src/quick.js` … ブックマークレットと追加画面
- `src/css.js` … スタイル
- `src/harness.html`, `src/harness-lc.css` … 動作確認ページ

`test/` は Playwright のシナリオ。リポジトリ直下で `python3 -m http.server 8765` を起動してから実行します。
