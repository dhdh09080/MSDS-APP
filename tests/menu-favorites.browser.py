"""Exercise tabbed menu navigation against preview fixtures, without remote writes."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

BASE = 'http://localhost:3000'
KEY = 'fms_menu_favorites:preview-user:preview-workspace'
GROUPS = ['시스템', 'MSDS', '건강관리', '현장 관리', '자료 서식']
PAGES = [
    ['announcements', 'team', 'feedback', 'settings', 'admin'],
    ['msds', 'warning', 'hazard-map', 'requests'],
    ['health', 'vulnerable', 'bp', 'measure'],
    ['contractors', 'manpower', 'photos', 'weather'],
    ['library', 'binders', 'manager-signs'],
]

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        context = await browser.new_context(viewport={'width': 1440, 'height': 1000})
        await context.route('**/*.supabase.co/**', lambda route: route.fulfill(json=[]))
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.goto(BASE + '/?preview=home')
        star = page.locator('#sidebar-menu-panel-all [data-favorite-id="warning"]')
        await star.wait_for()
        assert await page.locator('#sidebar-menu-panel-all .nav-section').all_text_contents() == GROUPS
        assert await page.locator('.sidebar-nav > #nav-home').count() == 1
        for index, ids in enumerate(PAGES):
            actual = await page.locator('#sidebar-menu-panel-all .menu-group').nth(index).locator('.nav-item').evaluate_all('(els) => els.map(el => el.id.replace("nav-", ""))')
            assert actual == ids, actual
        assert not await page.locator('#nav-admin').is_visible()
        assert not await page.locator('#sidebar-menu-panel-favorites').is_visible()
        await page.locator('#sidebar-menu-tab-favorites').click()
        await page.locator('#sidebar-menu-panel-favorites .menu-browse').click()
        # Keyboard tab selection follows the ARIA tab pattern.
        await page.locator('#sidebar-menu-tab-all').focus()
        await page.keyboard.press('ArrowLeft')
        assert await page.locator('#sidebar-menu-tab-favorites').get_attribute('aria-selected') == 'true'
        await page.keyboard.press('End')
        assert await page.locator('#sidebar-menu-tab-all').get_attribute('aria-selected') == 'true'
        await star.click()
        assert await star.get_attribute('aria-pressed') == 'true'
        assert await page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', KEY) == ['warning']
        await page.locator('#sidebar-menu-tab-favorites').click()
        assert await page.locator('.sidebar-nav > #nav-home').is_visible()
        await page.locator('#sidebar-menu-panel-favorites .nav-item').click()
        assert 'active' in await page.locator('#page-warning').get_attribute('class')
        assert await page.locator('#sidebar-menu-panel-favorites .nav-item.active').count() == 1
        await page.reload()
        await star.wait_for()
        assert await star.get_attribute('aria-pressed') == 'true'
        # Verify preference isolation and resilient handling of invalid persisted values.
        await page.evaluate('''async () => {
          const {favoriteStorageKey, readFavorites} = await import('/src/lib/menu-favorites.js');
          for (const [u,w] of [['other-user','preview-workspace'],['preview-user','other-site']]) {
            if (readFavorites(localStorage, favoriteStorageKey(u,w), ['warning']).length) throw Error('Leaked preferences');
          }
        }''')
        await page.evaluate('(key) => localStorage.setItem(key, "invalid")', KEY)
        await page.reload()
        await star.wait_for()
        assert await star.get_attribute('aria-pressed') == 'false'
        await page.evaluate('(key) => localStorage.setItem(key, JSON.stringify(["warning", "warning", "admin", "home", "unknown"]))', KEY)
        await page.reload()
        await star.wait_for()
        assert await page.locator('#sidebar-menu-panel-favorites .nav-item').count() == 1
        # A 378 count (the reported regression) and the longest labels must fit fully.
        await page.evaluate('''() => {
          const badge = document.getElementById('navBadgeMsds');
          badge.textContent = '378'; badge.style.display = '';
        }''')
        async def assert_labels_fit(root):
            failures = await page.locator(root + ' .menu-item-label:visible').evaluate_all('''els => els.filter(el => {
              const range = document.createRange(); range.selectNodeContents(el);
              const rects = [...range.getClientRects()];
              return new Set(rects.map(r => Math.round(r.top))).size > 1 || el.scrollWidth > el.clientWidth + 1;
            }).map(el => el.textContent)''')
            assert not failures, failures
        await assert_labels_fit('.sidebar-nav')
        Path('work').mkdir(exist_ok=True)
        await page.screenshot(path='work/menu-tabs-desktop.png')
        # Mobile shares category order and supports all formerly missing shortcuts.
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.evaluate("openModal('moreSheet')")
        assert await page.locator('#mobile-menu-panel-all .nav-section').all_text_contents() == GROUPS
        assert await page.locator('#mobile-menu-panel-all .menu-favorite-row').count() == 19
        assert not await page.locator('#moreAdminItem').is_visible()
        await assert_labels_fit('#moreSheet')
        mobile_star = page.locator('#mobile-menu-panel-all [data-favorite-id="warning"]')
        assert await mobile_star.get_attribute('aria-pressed') == 'true'
        await page.locator('#mobile-menu-tab-favorites').click()
        await page.locator('#mobile-menu-panel-favorites .menu-favorite-toggle').click()
        await page.locator('#mobile-menu-panel-favorites .menu-browse').click()
        assert await mobile_star.get_attribute('aria-pressed') == 'false'
        await mobile_star.click()
        await page.locator('#mobile-menu-tab-favorites').click()
        await page.locator('#mobile-menu-panel-favorites .nav-item').click()
        assert 'active' in await page.locator('#page-warning').get_attribute('class')
        assert 'active' not in (await page.locator('#moreSheet').get_attribute('class') or '')
        await page.evaluate("openModal('moreSheet')")
        await page.screenshot(path='work/menu-tabs-mobile-favorites.png')
        await page.locator('#mobile-menu-tab-all').click()
        await page.locator('#moreSheet .modal-body').evaluate('(el) => el.scrollTop = 0')
        await page.wait_for_timeout(180)
        await page.screenshot(path='work/menu-tabs-mobile-all.png')
        for width in [320, 390, 768]:
            await page.set_viewport_size({'width': width, 'height': 844})
            await assert_labels_fit('#moreSheet')
            assert await page.locator('#moreSheet .modal-body').evaluate('(el) => el.scrollWidth <= el.clientWidth')
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.evaluate("() => { Storage.prototype.setItem = () => { throw new DOMException('blocked', 'SecurityError'); }; }")
        weather = page.locator('#mobile-menu-panel-all [data-favorite-id="weather"]')
        await weather.click()
        assert await weather.get_attribute('aria-pressed') == 'false'
        await page.get_by_text('즐겨찾기를 저장하지 못했습니다.', exact=False).wait_for()
        # The standalone admin console keeps its permitted navigation accessible.
        await page.set_viewport_size({'width': 1440, 'height': 1000})
        await page.evaluate("closeModal('moreSheet'); enterAdminConsole()")
        await page.locator('#nav-admin').wait_for(state='visible')
        assert not await page.locator('.sidebar-nav .menu-tabs').is_visible()
        assert not errors, errors
        print('PASS: tab order/keyboard, category order, one-line labels with counts, desktop/mobile favorites, navigation, persistence, isolation, storage failure')
        await browser.close()

asyncio.run(main())
