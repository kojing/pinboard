import pathlib
ROOT = pathlib.Path(__file__).resolve().parent
S = ROOT/'src'; D = ROOT/'dist'
js = (S/'board.js').read_text()
js = js.replace('/*@@LCSTORE@@*/', (S/'lcstore.js').read_text().rstrip())
js = js.replace('/*@@BOARD@@*/', (S/'board-ui.js').read_text().rstrip())
js = js.replace('/*@@QUICK@@*/', (S/'quick.js').read_text().rstrip())
js = js.replace('/*@@CSS@@*/', (S/'css.js').read_text().rstrip())
assert '@@' not in js
(D/'reference-board.js').write_text(js)
print(len(js.encode()))
import json
h = (S/'harness.html').read_text()
h = h.replace('/*@@LC_CSS@@*/', (S/'harness-lc.css').read_text())
src = json.dumps(js, ensure_ascii=False).replace('</', '<\\/').replace('<!--', '<\\!--')
h = h.replace('/*@@RB_SRC@@*/""', src)
assert '@@' not in h
(D/'reference-board-check.html').write_text(h)
print('harness', len(h.encode()))
