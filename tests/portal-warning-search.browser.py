"""Search and selection regression with many synthetic warning labels."""
import asyncio, os
from pathlib import Path
from playwright.async_api import async_playwright
BASE=os.environ.get('BASE_URL','http://localhost:3007')
async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        page=await browser.new_page(viewport=dict(width=1440,height=1000))
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        records=[dict(id=f'fixture-{i}',product_name=f'도료 {i:02}',work_type='도장' if i%2 else '방수',supplier=f'공급업체 {i:02}',cas_no=f'CAS-{i:02}',signal_word='위험',h_codes='H225',pictograms='GHS02',status='active') for i in range(50)]
        async def api(route):
            if 'get_contractor_portal' in route.request.url:
                return await route.fulfill(json=dict(workspace=dict(id='ws',name='시험 현장'),contractor=dict(id='con',name='시험 협력사'),records=records,work_types=[],license=None,public_link=None))
            return await route.fulfill(json=[])
        await page.route('**/*.supabase.co/**',api)
        await page.goto(BASE+'/upload.html?token=individual-token-0000&panel=warnings')
        await page.locator('#warningRecordList input').first.wait_for()
        search=page.locator('#portalWarningSearch')
        assert await page.locator('#warningRecordList input').count()==50
        for query in ['도료 01','공급업체 01','CAS-01']:
            await search.fill(query)
            assert await page.locator('#warningRecordList input').count()==1
        await page.locator('#warningRecordList input').check()
        await search.fill('방수')
        assert await page.locator('#warningRecordList input').count()==25
        await page.locator('#portalWarningsAll').check()
        assert await page.locator('#printPortalWarnings').inner_text()=='선택한 26종 인쇄'
        await page.locator('#portalWarningsAll').uncheck()
        assert await page.locator('#printPortalWarnings').inner_text()=='선택한 1종 인쇄'
        await search.fill('CAS-02')
        await page.locator('#warningRecordList input').check()
        await search.fill('없는물질')
        assert '검색 결과가 없습니다' in await page.locator('#warningRecordList').inner_text()
        assert await page.locator('#printPortalWarnings').inner_text()=='선택한 2종 인쇄'
        await page.locator('#portalWarningSearchClear').click()
        assert await page.locator('#warningRecordList input:checked').count()==2
        await page.evaluate('refreshPortalRecords()')
        assert await page.locator('#warningRecordList input:checked').count()==2
        Path('work/warning-search').mkdir(parents=True,exist_ok=True)
        for width in [360,390,768,1440]:
            await page.set_viewport_size(dict(width=width,height=1000))
            await page.wait_for_timeout(200)
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
            assert await page.locator('.print-settings').evaluate('e=>e.getBoundingClientRect().bottom<=document.querySelector(".portal-preview").getBoundingClientRect().top')
            if width==390:
                assert await page.locator('#portalPrintSize').evaluate('e=>e.getBoundingClientRect().height>=44')
                await page.screenshot(path='work/warning-search/mobile.png',full_page=True)
        assert not errors,errors
        await browser.close()
        print('PASS: 50 materials, product/supplier/CAS/trade search, visible select-all, hidden selections, refresh, mobile order and width')
asyncio.run(main())
