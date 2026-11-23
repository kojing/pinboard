import asyncio
from playwright.async_api import async_playwright
SR = "document.getElementById('mainFrame').contentDocument.getElementById('ref-board-root').shadowRoot"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1440,'height':1000})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/dist/reference-board-check.html'); await pg.wait_for_timeout(3000)
        ev = lambda js: pg.evaluate(js)
        cnt = lambda: ev(SR+".querySelector('.rb-count').textContent")
        dot = lambda: ev(SR+".querySelector('.rb-b-pin').getAttribute('data-state')")
        log = lambda: ev("[...document.querySelectorAll('#log li')].slice(-3).map(l=>l.textContent).join(' / ')")
        print('start', await cnt(), 'dot', await dot(), 'pin hidden', await ev(SR+".querySelector('.rb-b-pin').hidden"))
        async def setup(tok):
            await ev(SR+".querySelector('.rb-b-pin').click()"); await pg.wait_for_timeout(300)
            await ev(f"(()=>{{const s={SR};s.querySelector('.rb-pin-token').value='{tok}';s.querySelector('.rb-pin-token').dispatchEvent(new Event('input'));s.querySelector('.rb-m-save').click()}})()")
            await pg.wait_for_timeout(3000)
        await setup('github_pat_bad_xxxxxxxxxxxxxxxxxxxxxx')
        print('bad:', await ev(SR+".querySelector('.rb-merr') && "+SR+".querySelector('.rb-merr').textContent"), 'dot', await dot())
        await ev(SR+".querySelector('.rb-m-cancel').click()")
        await setup('github_pat_11ABCDEFG0123456789abcdefghij')
        print('good:', await cnt(), '| toast', await ev(SR+".querySelector('.rb-toast').textContent"), 'dot', await dot())
        await pg.click('#bOpen'); await pg.wait_for_timeout(3500)
        print('reopen within 10min:', await cnt(), '|', await log())
        await ev(SR+".querySelector('.rb-b-pin').click()"); await pg.wait_for_timeout(300)
        await pg.locator('#mainFrame').screenshot(path='test/s17-pin.png')
        await ev(SR+".querySelector('.rb-m-save').click()"); await pg.wait_for_timeout(2500)
        print('check now (no change):', await cnt(), '| toast', await ev(SR+".querySelector('.rb-toast').textContent"), '|', await log())
        await pg.click('#simPin')
        await ev(SR+".querySelector('.rb-b-pin').click()"); await pg.wait_for_timeout(300)
        await ev(SR+".querySelector('.rb-m-save').click()"); await pg.wait_for_timeout(3500)
        print('after 3 new pins:', await cnt(), '| toast', await ev(SR+".querySelector('.rb-toast').textContent"))
        # 期限切れで開き直したら自動で取り込むか
        await pg.click('#simPin')
        await pg.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('rb-pin-checked')).forEach(k=>localStorage.removeItem(k))")
        await pg.click('#bOpen'); await pg.wait_for_timeout(5000)
        print('auto on open:', await cnt(), '| toast', await ev(SR+".querySelector('.rb-toast').textContent"))
        print('meta', await ev("JSON.stringify((()=>{for(const [k,v] of window.__props||[]){}})())"))
        # viewer: no button, no fetch
        await pg.select_option('#selUser','someone'); await pg.wait_for_timeout(3000)
        print('viewer pin hidden', await ev(SR+".querySelector('.rb-b-pin').hidden"))
        print(errs)
        await b.close()
asyncio.run(main())
