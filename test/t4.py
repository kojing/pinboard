import asyncio
from playwright.async_api import async_playwright
SR = "document.getElementById('mainFrame').contentDocument.getElementById('ref-board-root').shadowRoot"
PR = "document.getElementById('popupFrame').contentDocument.getElementById('ref-board-root').shadowRoot"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width':1440,'height':1100})
        await pg.goto('http://localhost:8765/dist/reference-board-check.html')
        await pg.wait_for_timeout(3000)
        ev = lambda js: pg.evaluate(js)
        await pg.click('.tab[data-tab=web]'); await pg.wait_for_timeout(300)
        await pg.click('#bBm'); await pg.wait_for_timeout(2500)
        await ev("(()=>{const f=document.getElementById('popupFrame');f.style.cssText='position:fixed;left:0;top:0;width:1040px;height:800px;z-index:99;background:#fff'})()")
        await pg.wait_for_timeout(600)
        await ev(PR+".querySelectorAll('.rb-qa-c')[3].click()")
        await pg.screenshot(path='test/s8-popup-real.png', clip={'x':0,'y':0,'width':1040,'height':800})
        await ev("document.getElementById('popupFrame').style.cssText=''")
        # board: url modal + upload modal + bookmarklet modal
        await pg.click('.tab[data-tab=add]'); await pg.click('#simDrop'); await pg.wait_for_timeout(1800)
        await pg.locator('#mainFrame').screenshot(path='test/s9-upload.png')
        await ev(SR+".querySelector('.rb-m-cancel').click()")
        await pg.click('#simTab'); await pg.wait_for_timeout(1200)
        await pg.locator('#mainFrame').screenshot(path='test/s10-url.png')
        await ev(SR+".querySelector('.rb-m-cancel').click()")
        await ev(SR+".querySelector('.rb-b-bm').click()"); await pg.wait_for_timeout(400)
        await pg.locator('#mainFrame').screenshot(path='test/s11-bm.png')
        await ev(SR+".querySelector('.rb-m-cancel').click()")
        # youtube lightbox
        await ev("(()=>{const s="+SR+";[...s.querySelectorAll('.rb-card')].find(c=>c.textContent.includes('リザルト')).click()})()"); await pg.wait_for_timeout(800)
        await pg.locator('#mainFrame').screenshot(path='test/s12-yt.png')
        # hover card
        await pg.keyboard.press('Escape')
        await ev("document.getElementById('mainFrame').style.width='390px'"); await pg.wait_for_timeout(800)
        await pg.locator('#mainFrame').screenshot(path='test/s13-mobile.png')
        await ev(SR+".querySelectorAll('.rb-card')[2].click()"); await pg.wait_for_timeout(700)
        await pg.locator('#mainFrame').screenshot(path='test/s14-mobile-lb.png')
        await b.close()
asyncio.run(main())
