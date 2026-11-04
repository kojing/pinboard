import asyncio
from playwright.async_api import async_playwright
SR = "document.getElementById('mainFrame').contentDocument.getElementById('ref-board-root').shadowRoot"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1440,'height':1000})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/dist/reference-board-check.html'); await pg.wait_for_timeout(3000)
        ev = lambda js: pg.evaluate(js)
        await ev(SR+".querySelector('.rb-b-import').click()"); await pg.wait_for_timeout(300)
        await pg.evaluate("(t)=>{const s="+SR+";s.querySelector('.rb-imp-text').value=t;s.querySelector('.rb-m-save').click()}", open('data/pinterest/pinkojing.json').read())
        await pg.wait_for_timeout(20000)
        print('count', await ev(SR+".querySelector('.rb-count').textContent"), '| toast', await ev(SR+".querySelector('.rb-toast').textContent"))
        print('foot', await ev(SR+".querySelector('.rb-foot').textContent"))
        print('total', await ev("document.getElementById('propTotal').textContent"))
        # reload: does it read back all?
        await pg.click('#bOpen'); await pg.wait_for_timeout(4000)
        print('after reload', await ev(SR+".querySelector('.rb-count').textContent"))
        await pg.click('#bFull'); await pg.wait_for_timeout(8000)
        print('full foot', await ev(SR+".querySelector('.rb-foot').textContent"))
        print(errs)
        await b.close()
asyncio.run(main())
