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
- ブックマークレット: このボードのページを `?rb_add=1` 付きのポップアップで開き、ヘッダー・サイドバーを隠した登録用の見た目にする。ページ本文の主要な画像・動画(大きいもの。header・nav・aside・footer の中は除く)を最初から選んだ状態で、選び直して追加。「Confluenceにコピー」で添付保存も可(取得できない画像は URL 保存)
- 詳細からダウンロード(画像、動画はファイル形式のときのみ)
- 検索、画像/動画の切り替え、タグで絞り込み、JSON のインポート・エクスポート
- Confluence のキーボードショートカット(e 編集、/ 検索 など)は一覧では使えて、ボードの入力欄での入力中と、詳細・モーダルを開いている間は反応しない

## Pinterest からの取り込み

GitHub Actions が Pinterest(pinkojing)の ft ボードを毎日 3:17(日本時間)に読み、`data/pinterest/pinkojing.json` を更新します。

ボードは本人が開いたときにこの JSON を GitHub から読み、増えたピンだけを自動で追加します(ETag で変化がなければ読み込まない。同じブラウザでの確認は10分おき)。

- 最初に一度、ボードの「Pinterest」で GitHub のトークンを設定する(Fine-grained token、対象は `kojing/pinboard` のみ、Contents: Read-only)。トークンは本人のブラウザの localStorage にだけ保存
- 取り込みの状態(ETag・最後に確認した時刻・件数)はボードの Content Property `ref-board-data` の `pinterest` に保存
- Pinterest で削除したピンはボードからは消さない
- 設定は埋め込み HTML の `PINTEREST_SYNC`(null で無効)と `PINTEREST_CHECK_MINUTES`

手動で入れるときは、JSON をボードの「インポート」に読み込みます(詳しくは `data/pinterest/README.md`)。

## 構成

```
pinboard/
├─ dist/                              配布物(build.py が作る。Confluence に置くのはここだけ)
│  ├─ reference-board.js                本体(v1.3.0)
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
├─ .github/workflows/pinterest-export.yml  毎日 3:17(日本時間)と手動で実行
├─ test/                              Playwright の操作シナリオ
└─ build.py                           src/ → dist/
```

### データの流れ

```
Web のページ ──ブックマークレット──┐
PC の画像 ──ドロップ / Ctrl+V ────┼─→ ボード(Confluence のページ)
Pinterest ft ─Actions(毎日)→ data/pinterest/pinkojing.json ─開いたとき自動─┘
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
| `test/t9.py` | 追加画面の見た目(ヘッダー等を隠す)と主要画像の選択 |
| `test/t10.py` | Pinterest の自動取り込み(トークン、変化なし、増分、閲覧のみ) |

## 開発

ソースは `src/` に分けてあり、`build.py` で `dist/` を作ります。JS を変えたら `src/board.js` の `VERSION` と、埋め込み HTML の `?v=` を上げます。

```sh
python3 build.py
```
