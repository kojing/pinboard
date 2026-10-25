import asyncio, sys
from playwright.async_api import async_playwright
PAGE = sys.argv[1] if len(sys.argv) > 1 else 'dist/reference-board-check.html'
FR = "document.getElementById('mainFrame')"
SR = FR + ".contentDocument.getElementById('ref-board-root').shadowRoot"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1440,'height':1000})
        await pg.goto('http://localhost:8766/' + PAGE); await pg.wait_for_timeout(3000)
        ev = lambda js: pg.evaluate(js)
        fr = pg.frame_locator('#mainFrame')
        async def fired(label, action):
            await ev("window.__lastShortcut=null")
            await action()
            await pg.wait_for_timeout(200)
            k = await ev("window.__lastShortcut")
            print(f'{label}: ' + (f'ショートカット「{k}」が動いた' if k else 'ショートカットは動かない'))
        frame = pg.frames[1]
        async def body_key(k):
            await pg.click('#mainFrame', position={'x': 5, 'y': 5})
            await frame.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur()")
            await pg.keyboard.press(k)
        await fired('一覧を見ているときに e', lambda: body_key('e'))
        async def typing():
            await frame.evaluate("document.getElementById('ref-board-root').shadowRoot.querySelector('.rb-search input').focus()")
            await pg.keyboard.type('effect')
        await fired('検索欄に effect と入力', typing)
        print('  検索欄の中身:', await ev(SR+".querySelector('.rb-search input').value"))
        await pg.keyboard.press('Control+a'); await pg.keyboard.press('Backspace'); await pg.wait_for_timeout(400)
        await ev(SR+".querySelectorAll('.rb-card')[0].click()"); await pg.wait_for_timeout(500)
        await fired('詳細を開いて e', lambda: pg.keyboard.press('e'))
        await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(200)
        print('  → で次へ:', await ev(SR+".querySelector('.rb-lb-pos').textContent"))
        await frame.evaluate("document.activeElement && document.activeElement.blur(); document.body.focus()")
        await fired('詳細を開いたままページ側にフォーカスして s', lambda: pg.keyboard.press('s'))
        await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(200)
        print('  → で次へ:', await ev(SR+".querySelector('.rb-lb-pos').textContent"))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        print('  Esc で閉じた:', await ev(SR+".querySelector('.rb-lb').hidden"))
        await ev(SR+".querySelector('.rb-b-add').click()"); await ev(SR+".querySelector('[data-add=url]').click()"); await pg.wait_for_timeout(400)
        async def modal_typing():
            await frame.evaluate("document.getElementById('ref-board-root').shadowRoot.querySelector('.rb-in-title').focus()")
            await pg.keyboard.type('cube')
        await fired('URLで追加のタイトル欄に cube と入力', modal_typing)
        print('  タイトル欄:', await ev(SR+".querySelector('.rb-in-title').value"))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        print('  Esc で閉じた:', await ev(SR+".querySelector('.rb-overlay').hidden"))
        await fired('閉じたあと一覧で [', lambda: body_key('['))
        await b.close()
asyncio.run(main())
