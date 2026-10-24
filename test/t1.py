import asyncio, sys
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width':1440,'height':1000})
        errs=[]
        pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error','warning') else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
        await pg.goto('http://localhost:8765/dist/reference-board-check.html')
        await pg.wait_for_timeout(3500)
        await pg.screenshot(path='test/s1.png')
        fr = pg.frame_locator('#mainFrame')
        n = await pg.evaluate("document.getElementById('mainFrame').contentDocument.getElementById('ref-board-root').shadowRoot.querySelectorAll('.rb-card').length")
        print('cards', n)
        for e in errs[:30]: print(e)
        await b.close()
asyncio.run(main())
