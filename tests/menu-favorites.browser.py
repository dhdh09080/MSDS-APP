"""Menu preferences use local fixtures and browser storage; no remote writes."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

BASE = 'http://localhost:3000'
KEY = 'fms_menu_favorites:preview-user:preview-workspace'

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        context = await browser.new_context(viewport={'width': 1440, 'height': 1000})
        await context.route('**/*.supabase.co/**', lambda route: route.fulfill(json=[]))
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.goto(BASE + '/?preview=home')
        star = page.locator('.sidebar-nav > .menu-favorite-row > [data-favorite-id="warning"]')
        await star.wait_for()
        await star.click()
        assert await star.get_attribute('aria-pressed') == 'true'
        assert await page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', KEY) == ['warning']
        await page.locator('.sidebar-nav .menu-favorites .nav-item').click()
        assert 'active' in await page.locator('#page-warning').get_attribute('class')
        assert await page.locator('.sidebar-nav .menu-favorites .nav-item.active').count() == 1
        await page.reload()
        await star.wait_for()
        assert await star.get_attribute('aria-pressed') == 'true'
        # A different account or site must not inherit these preferences.
        await page.evaluate('''async () => {
          const {favoriteStorageKey, readFavorites} = await import('/src/lib/menu-favorites.js');
          for (const [u,w] of [['other-user','preview-workspace'],['preview-user','other-site']]) {
            if (readFavorites(localStorage, favoriteStorageKey(u,w), ['warning']).length) throw Error('Leaked preferences');
          }
        }''')
        # Malformed data recovers, and unknown/privileged IDs never become links.
        await page.evaluate('(key) => localStorage.setItem(key, "invalid")', KEY)
        await page.reload()
        await star.wait_for()
        assert await star.get_attribute('aria-pressed') == 'false'
        await page.evaluate('(key) => localStorage.setItem(key, JSON.stringify(["warning", "warning", "admin", "unknown"]))', KEY)
        await page.reload()
        await star.wait_for()
        assert await page.locator('.sidebar-nav .menu-favorites .nav-item').count() == 1
        Path('work').mkdir(exist_ok=True)
        await page.screenshot(path='work/menu-favorites-desktop.png')
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.evaluate("openModal('moreSheet')")
        mobile_star = page.locator('#moreSheet .menu-favorite-tile [data-favorite-id="warning"]')
        assert await mobile_star.get_attribute('aria-pressed') == 'true'
        await page.locator('#moreSheet .menu-favorites .menu-favorite-toggle').click()
        assert await mobile_star.get_attribute('aria-pressed') == 'false'
        await mobile_star.click()
        await page.locator('#moreSheet .menu-favorites .nav-item').click()
        assert 'active' in await page.locator('#page-warning').get_attribute('class')
        assert 'active' not in (await page.locator('#moreSheet').get_attribute('class') or '')
        await page.evaluate("openModal('moreSheet')")
        assert await page.locator('#moreSheet .modal-body').evaluate('(el) => el.scrollWidth <= el.clientWidth')
        Path('work').mkdir(exist_ok=True)
        await page.screenshot(path='work/menu-favorites-mobile.png')
        # Failed persistence gives feedback without falsely marking a new favorite.
        await page.evaluate("() => { Storage.prototype.setItem = () => { throw new DOMException('blocked', 'SecurityError'); }; }")
        weather = page.locator('#moreSheet .menu-favorite-tile [data-favorite-id="weather"]')
        await weather.click()
        assert await weather.get_attribute('aria-pressed') == 'false'
        await page.get_by_text('즐겨찾기를 저장하지 못했습니다.', exact=False).wait_for()
        assert not errors, errors
        print('PASS: desktop/mobile add, remove, navigation, reload, isolation, malformed data, storage failure')
        await browser.close()

asyncio.run(main())
