import asyncio
from playwright.async_api import async_playwright
SR = "document.getElementById('mainFrame').contentDocument.getElementById('ref-board-root').shadowRoot"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width':1440,'height':1000})
        errs=[]
        pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error','warning') and 'TUNNEL' not in m.text else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
        await pg.goto('http://localhost:8765/dist/reference-board-check.html')
        await pg.wait_for_timeout(3000)
        ev = lambda js: pg.evaluate(js)
        # drop 3 images + txt
        await pg.click('#simDrop'); await pg.wait_for_timeout(1500)
        await pg.screenshot(path='test/s2-upload.png')
        print('modal title:', await ev(SR+".querySelector('.rb-mhead h3').textContent"))
        await ev(SR+".querySelector('.rb-sugg-chip[data-tag=\"UI\"]').click()")
        await ev(SR+".querySelector('.rb-m-save').click()")
        await pg.wait_for_timeout(3000)
        print('cards after drop', await ev(SR+".querySelectorAll('.rb-card').length"), 'overlay hidden', await ev(SR+".querySelector('.rb-overlay').hidden"))
        print('atts', await ev("[...document.querySelectorAll('#atts li .n')].map(x=>x.textContent).slice(0,5)"))
        # big
        await pg.click('#simDropBig'); await pg.wait_for_timeout(1500)
        await ev(SR+".querySelector('.rb-m-save').click()"); await pg.wait_for_timeout(3000)
        print('atts2', await ev("[...document.querySelectorAll('#atts li .n')].map(x=>x.textContent).slice(0,3)"))
        # paste URL
        await pg.click('#simUrl'); await pg.wait_for_timeout(1200)
        print('url modal save disabled', await ev(SR+".querySelector('.rb-m-save').disabled"))
        await ev(SR+".querySelector('.rb-in-copy').click()")
        await ev(SR+".querySelector('.rb-m-save').click()"); await pg.wait_for_timeout(2500)
        print('cards', await ev(SR+".querySelectorAll('.rb-card').length"), 'toast', await ev(SR+".querySelector('.rb-toast').textContent"))
        # tab drag
        await pg.click('#simTab'); await pg.wait_for_timeout(1200)
        print('tab page field', await ev(SR+".querySelector('.rb-in-page').value"), await ev(SR+".querySelector('.rb-in-src').value"))
        await ev(SR+".querySelector('.rb-in-copy').checked=false")
        await ev(SR+".querySelector('.rb-m-save').click()"); await pg.wait_for_timeout(1500)
        # yt
        await pg.click('#simYt'); await pg.wait_for_timeout(1000)
        await ev(SR+".querySelector('.rb-m-save').click()"); await pg.wait_for_timeout(1500)
        print('cards', await ev(SR+".querySelectorAll('.rb-card').length"))
        await pg.screenshot(path='test/s3-board.png')
        # lightbox
        await ev(SR+".querySelectorAll('.rb-card')[1].click()"); await pg.wait_for_timeout(800)
        await pg.screenshot(path='test/s4-lb.png')
        await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(300)
        print('lb pos', await ev(SR+".querySelector('.rb-lb-pos').textContent"))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        print('lb hidden', await ev(SR+".querySelector('.rb-lb').hidden"))
        # delete attachment item (metal)
        cid = await ev("(()=>{const s="+SR+";const c=[...s.querySelectorAll('.rb-card')].find(c=>c.getAttribute('aria-label').includes('金属'));c.click();setTimeout(()=>s.querySelector('.rb-lb [data-act=del]').click(),300);return 1})()")
        await pg.wait_for_timeout(900)
        await ev(SR+".querySelector('.rb-m-ok').click()"); await pg.wait_for_timeout(2000)
        print('trash', await ev("[...document.querySelectorAll('#atts li.trash .n')].map(x=>x.textContent)"))
        # edit
        await ev("(()=>{const s="+SR+";const c=[...s.querySelectorAll('.rb-card')].find(c=>c.getAttribute('aria-label').includes('夕方'));c.click();setTimeout(()=>s.querySelector('.rb-lb [data-act=edit]').click(),300);})()")
        await pg.wait_for_timeout(900)
        await pg.screenshot(path='test/s5-edit.png')
        await ev(SR+".querySelector('.rb-in-title').value='夕方の色（編集）'")
        await ev(SR+".querySelector('.rb-m-save').click()"); await pg.wait_for_timeout(1500)
        print('edited', await ev("[..."+SR+".querySelectorAll('.rb-card')].some(x=>x.getAttribute('aria-label').includes('編集'))"))
        for e in errs[:30]: print(e)
        await b.close()
asyncio.run(main())
