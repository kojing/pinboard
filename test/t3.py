import asyncio
from playwright.async_api import async_playwright
SR = "document.getElementById('mainFrame').contentDocument.getElementById('ref-board-root').shadowRoot"
PR = "document.getElementById('popupFrame').contentDocument.getElementById('ref-board-root').shadowRoot"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width':1440,'height':1100})
        errs=[]
        pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error','warning') and 'TUNNEL' not in m.text else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
        await pg.goto('http://localhost:8765/dist/reference-board-check.html')
        await pg.wait_for_timeout(3000)
        ev = lambda js: pg.evaluate(js)
        await pg.click('.tab[data-tab=web]')
        await pg.wait_for_timeout(500)
        await pg.click('#bBm'); await pg.wait_for_timeout(2500)
        cands = await ev("[..."+PR+".querySelectorAll('.rb-qa-c')].map(c=>c.querySelector('.rb-qa-lab').textContent+(c.classList.contains('is-on')?'*':''))")
        print('cands', cands)
        print('target', await ev(PR+".querySelector('.rb-qa-target').textContent"))
        print('src', await ev(PR+".querySelector('.rb-qa-src').textContent"))
        # select all, copy on
        await ev(PR+".querySelector('.rb-qa-all').click()")
        await ev(PR+".querySelector('.rb-in-copy').click()")
        print('warn hidden', await ev(PR+".querySelector('.rb-qa-warn').hidden"))
        await ev(PR+".querySelector('.rb-in-copy').click()")
        print('warn hidden after copy', await ev(PR+".querySelector('.rb-qa-warn').hidden"))
        await ev(PR+".querySelector('.rb-sugg-chip[data-tag=\"モーション\"]').click()")
        await pg.locator('#popupFrame').screenshot(path='test/s6-popup.png')
        await ev(PR+".querySelector('.rb-qa-save').click()")
        await pg.wait_for_timeout(5000)
        st = await ev("(()=>{try{return "+PR+".querySelector('.rb-qa-status').textContent}catch(e){return 'closed: '+document.getElementById('popupFrame').contentDocument.body.textContent.slice(0,40)}})()")
        print('status', st)
        await pg.wait_for_timeout(1500)
        print('board count', await ev(SR+".querySelector('.rb-count').textContent"))
        print('atts', await ev("[...document.querySelectorAll('#atts li .n')].map(x=>x.textContent).slice(0,6)"))
        # second time -> already added
        await pg.click('#bBm'); await pg.wait_for_timeout(2500)
        print('done flags', await ev("[..."+PR+".querySelectorAll('.rb-qa-c')].map(c=>c.classList.contains('is-done')?1:0).join('')"))
        await pg.screenshot(path='test/s7.png')
        # viewer
        await pg.select_option('#selUser','someone'); await pg.wait_for_timeout(2500)
        print('viewer actions hidden', await ev(SR+".querySelector('.rb-actions').hidden"), 'edit btns', await ev(SR+".querySelectorAll('[data-act=edit]').length"))
        await pg.click('.tab[data-tab=add]'); await pg.click('#simDrop'); await pg.wait_for_timeout(1500)
        print('viewer modal hidden', await ev(SR+".querySelector('.rb-overlay').hidden"))
        await pg.select_option('#selUser','kojing'); await pg.select_option('#selSpace','PUBLICWIKI'); await pg.wait_for_timeout(2500)
        print('space actions hidden', await ev(SR+".querySelector('.rb-actions').hidden"))
        await pg.select_option('#selSpace',''); 
        # 300
        await pg.click('#b300'); await pg.wait_for_timeout(2500)
        print('300 shown', await ev(SR+".querySelectorAll('.rb-card').length"), await ev(SR+".querySelector('.rb-count').textContent"))
        await ev("document.getElementById('mainFrame').contentWindow.scrollTo(0, 1e6)"); await pg.wait_for_timeout(800)
        await ev("document.getElementById('mainFrame').contentWindow.scrollTo(0, 1e6)"); await pg.wait_for_timeout(800)
        print('after scroll', await ev(SR+".querySelectorAll('.rb-card').length"))
        # full
        await pg.click('#bFull'); await pg.wait_for_timeout(2500)
        await pg.click('#simUrl'); await pg.wait_for_timeout(1200)
        await ev(SR+".querySelector('.rb-m-save').click()"); await pg.wait_for_timeout(2500)
        print('full status', await ev(SR+".querySelector('.rb-status').textContent"))
        print('foot', await ev(SR+".querySelector('.rb-foot').textContent"))
        for e in errs[:30]: print(e)
        await b.close()
asyncio.run(main())
