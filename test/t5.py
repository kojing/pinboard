import asyncio
from playwright.async_api import async_playwright
SR = "document.getElementById('mainFrame').contentDocument.getElementById('ref-board-root').shadowRoot"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width':1440,'height':1000}, accept_downloads=True)
        errs=[]
        pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
        await pg.goto('http://localhost:8765/dist/reference-board-check.html'); await pg.wait_for_timeout(3000)
        ev = lambda js: pg.evaluate(js)
        print('hov', await ev(SR+".querySelectorAll('.rb-hov,.rb-badge,.rb-cap').length"))
        for title in ['金属','夕方','リザルト']:
            await ev("(()=>{const s="+SR+";[...s.querySelectorAll('.rb-card')].find(c=>c.getAttribute('aria-label').includes('"+title+"')).click()})()")
            await pg.wait_for_timeout(500)
            has = await ev(SR+".querySelector('[data-act=dl]')!==null")
            print(title,'dl button', has)
            if has:
                async with pg.expect_download(timeout=8000) as d:
                    await ev(SR+".querySelector('[data-act=dl]').click()")
                dl = await d.value
                print('  file', dl.suggested_filename)
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='test/s15.png')
        print(errs)
        await b.close()
asyncio.run(main())
