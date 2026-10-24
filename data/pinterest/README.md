# Pinterest の書き出し

`pinkojing.json` は GitHub Actions(`.github/workflows/pinterest-export.yml`)が毎週更新します。
すぐ更新したいときは Actions の「Pinterest を書き出す」→ Run workflow。

- 公開ボードだけが対象です(ログインしないため、秘密のボードは入りません)
- そのままボードの「インポート」に読み込めます。同じピンは2回目以降スキップされます
- タグはボード名、セクションのピンは「ボード名/セクション名」も付きます
