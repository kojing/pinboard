import asyncio
from playwright.async_api import async_playwright
PR = "document.getElementById('popupFrame').contentDocument.getElementById('ref-board-root').shadowRoot"
PD = "document.getElementById('popupFrame').contentDocument"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1440,'height':1100})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/dist/reference-board-check.html'); await pg.wait_for_timeout(3000)
        ev = lambda js: pg.evaluate(js)
        await pg.click('.tab[data-tab=web]'); await pg.wait_for_timeout(300)
        await pg.click('#bBm'); await pg.wait_for_timeout(3000)
        print('chrome visible:', await ev("['#header','.ia-splitter-left','#main','#footer'].map(s=>{const e="+PD+".querySelector(s);return s+':'+(e?getComputedStyle(e).display:'none?')}).join(' ')"))
        print('host parent:', await ev(PD+".getElementById('ref-board-root').parentNode.tagName"), 'title:', await ev(PD+".title"))
        print('hint:', await ev(PR+".querySelector('.rb-qa-hint').textContent"))
        print('shown:', await ev("[..."+PR+".querySelectorAll('.rb-qa-c')].map(c=>c.querySelector('.rb-qa-lab').textContent+(c.classList.contains('is-on')?'*':'')).join(' | ')"))
        print('scope btn:', await ev(PR+".querySelector('.rb-qa-scope').textContent"))
        await ev("(()=>{const f=document.getElementById('popupFrame');f.style.cssText='position:fixed;left:0;top:0;width:980px;height:760px;z-index:99;background:#fff'})()")
        await pg.wait_for_timeout(500)
        await pg.screenshot(path='test/s16-quick.png', clip={'x':0,'y':0,'width':980,'height':760})
        await ev(PR+".querySelector('.rb-qa-scope').click()"); await pg.wait_for_timeout(300)
        print('all shown:', await ev(PR+".querySelectorAll('.rb-qa-c').length"), 'selected', await ev(PR+".querySelectorAll('.rb-qa-c.is-on').length"))
        print(errs)
        await b.close()
asyncio.run(main())
