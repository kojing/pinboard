# pinboard

Confluence (Server / Data Center) のページに置く、Pinterest 風のリファレンスボード(画像・動画)。
リンク集 v3 と同じ仕組み(HTMLマクロ + 添付JS、Content Property 分割保存、本人のみ編集)で動きます。

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

- 情報(タイトル・タグ・メモ・URL など): ページの Content Property `ref-board-data`(索引)と `ref-board-data-00〜63`(1個 30,000 バイトまで、既定64個 ≒ 1.9MB。`SHARDS` で最大99個)
- 画像本体: ボードのページの添付 `rb-<ID>.<拡張子>`、大きい画像は一覧用の `rb-<ID>-t.webp` も
- URL で保存したもの(ブックマークレット・URL指定)は外部 URL をそのまま表示する

## 主な機能

- 一覧は画像・動画だけの石積み表示。操作はすべて詳細画面(← → で移動、Esc で閉じる)
- 追加(本人のみ): 画像ファイルのドラッグ&ドロップ / Ctrl+V / ファイル選択、URL 指定(画像・YouTube・Vimeo・mp4)、他タブの画像のドラッグ
- ブックマークレット: ページ内の画像・動画を大きい順に候補にし、選んで追加。「Confluenceにコピー」で添付保存も可(取得できない画像は URL 保存)
- 詳細からダウンロード(画像、動画はファイル形式のときのみ)
- 検索、画像/動画の切り替え、タグで絞り込み、JSON のインポート・エクスポート
- Confluence のキーボードショートカット(e 編集、/ 検索 など)は一覧では使えて、ボードの入力欄での入力中と、詳細・モーダルを開いている間は反応しない

## Pinterest からの取り込み

GitHub Actions が Pinterest(pinkojing)の ft ボードを毎週読み、`data/pinterest/pinkojing.json` を更新します。
このJSONをボードの「インポート」に読み込むと、タグなしで取り込まれます(詳しくは `data/pinterest/README.md`)。

## 構成

```
pinboard/
├─ dist/                              配布物(build.py が作る。Confluence に置くのはここだけ)
│  ├─ reference-board.js                本体(v1.1.1)
│  ├─ reference-board.embed.html        ボードのページの HTML マクロ
│  ├─ reference-board-quick-add.embed.html  追加専用ページの HTML マクロ(任意)
│  └─ reference-board-check.html        動作確認ページ(模擬 Confluence)
├─ src/                               ソース(build.py で 1 つの JS に組み立てる)
│  ├─ board.js                          設定・共通処理・添付・画像処理・ショートカットの切り分け(外枠)
│  ├─ lcstore.js                        保存モジュール(リンク集 v3 と共通、分割数を指定可)
│  ├─ board-ui.js                       ボード・詳細・各モーダル
│  ├─ quick.js                          ブックマークレットと追加画面
│  ├─ css.js                            スタイル
│  └─ harness.html, harness-lc.css      動作確認ページ
├─ data/pinterest/                    Pinterest の書き出し(Actions が更新)
│  ├─ pinkojing.json                    ft ボードのピン一覧(ボードの「インポート」用)
│  └─ last-run.log                      最後の実行ログ
├─ tools/pinterest-export.mjs         Pinterest の書き出しスクリプト
├─ .github/workflows/pinterest-export.yml  毎週月曜 3:17(日本時間)と手動で実行
├─ test/                              Playwright の操作シナリオ
└─ build.py                           src/ → dist/
```

### データの流れ

```
Web のページ ──ブックマークレット──┐
PC の画像 ──ドロップ / Ctrl+V ────┼─→ ボード(Confluence のページ)
Pinterest ft ─Actions(毎週)→ data/pinterest/pinkojing.json ─インポート─┘
                                     │
               情報: Content Property ref-board-data-00〜63
               画像: ページの添付 rb-<ID>.<拡張子>(URL 保存のものは外部 URL)
```

### テスト

リポジトリ直下で `python3 -m http.server 8765` を起動してから実行します(Playwright が必要)。

| ファイル | 確かめること |
| --- | --- |
| `test/t1.py` | 動作確認ページが開き、カードが並ぶ |
| `test/t2.py` | ドロップ・貼り付け・URL 追加・詳細・削除・編集 |
| `test/t3.py` | ブックマークレット、閲覧のみ、300件、容量いっぱい |
| `test/t4.py` | 追加画面・各モーダル・スマホ幅の画面写真 |
| `test/t5.py` | 一覧は画像だけ、詳細からのダウンロード |
| `test/t6.py` | Pinterest の JSON をインポート |
| `test/t7.py` | 64分割での取り込みと読み直し |
| `test/t8.py` | Confluence のショートカットとの共存 |

## 開発

ソースは `src/` に分けてあり、`build.py` で `dist/` を作ります。JS を変えたら `src/board.js` の `VERSION` と、埋め込み HTML の `?v=` を上げます。

```sh
python3 build.py
```
