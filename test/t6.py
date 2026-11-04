import asyncio
from playwright.async_api import async_playwright
SR = "document.getElementById('mainFrame').contentDocument.getElementById('ref-board-root').shadowRoot"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1440,'height':1000})
        await pg.goto('http://localhost:8765/dist/reference-board-check.html'); await pg.wait_for_timeout(3000)
        ev = lambda js: pg.evaluate(js)
        txt = open('data/pinterest/pinkojing.json').read()
        await ev(SR+".querySelector('.rb-b-import').click()"); await pg.wait_for_timeout(300)
        await pg.evaluate("(t)=>{const s="+SR+";s.querySelector('.rb-imp-text').value=t;s.querySelector('.rb-m-save').click()}", txt)
        await pg.wait_for_timeout(15000)
        print('count', await ev(SR+".querySelector('.rb-count').textContent"))
        print('status', await ev(SR+".querySelector('.rb-status').textContent"), '| toast', await ev(SR+".querySelector('.rb-toast').textContent"))
        print('foot', await ev(SR+".querySelector('.rb-foot').textContent"))
        print('tags', await ev("[..."+SR+".querySelectorAll('.rb-chip')].map(c=>c.textContent).slice(0,5)"))
        print('thumb sample', await ev(SR+".querySelector('.rb-card img').getAttribute('data-ext')"))
        await b.close()
asyncio.run(main())
