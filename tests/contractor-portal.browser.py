"""Portal regressions against npm run preview -- --host 0.0.0.0 --port 3003.
Uses synthetic fixtures; never writes to production storage or customer records.
"""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright

BASE = os.environ.get('BASE_URL', 'http://localhost:3003')
OUT = Path(os.environ.get('PORTAL_ARTIFACT_DIR', 'work/portal-preview'))
WS = '10000000-0000-4000-8000-000000000001'
CON = '20000000-0000-4000-8000-000000000002'
RID = '30000000-0000-4000-8000-000000000003'
context = dict(workspace=dict(id=WS, name='서울 신축현장'), contractor=dict(id=CON, name='안전건설'),
    public_link=None, work_types=[dict(id='a', name="도장 '공종'")], license=None,
    records=[dict(id=RID, product_name='테스트 도료', work_type='도장', supplier='공급사', pdf_name='도료.pdf',
        pdf_path=f'{WS}/{RID}.pdf', signal_word='위험', h_codes='H225,H319', p_codes='P210,P280',
        pictograms='GHS02,GHS07', protective_equipment='보안경 및 안전장갑 착용',
        handling_precautions='화기에서 멀리 보관', first_aid='피부를 물로 씻으시오', emergency_response='누출 시 환기'),
        dict(id='40000000-0000-4000-8000-000000000004', product_name='<미분석 제품>', work_type='도장', pdf_name='대기.pdf')])

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = await browser.new_page(viewport=dict(width=1440,height=1000))
        errors=[]
        page.on('pageerror', lambda e: errors.append(str(e)))
        uploads=[]
        async def api(route):
            req=route.request; url=req.url
            if 'get_contractor_portal' in url:
                data=json.loads(req.post_data)
                if data['p_token']=='invalid-token-0000':
                    return await route.fulfill(status=400,json=dict(message='invalid or expired upload token'))
                if data['p_token']=='public-token-0000':
                    res={**context,'public_link':dict(allow_msds=False,allow_license=True),'records':[]}
                    if not data.get('p_contractor_id'): res={**res,'contractor':None,'contractors':[context['contractor']]}
                    return await route.fulfill(json=res)
                return await route.fulfill(json=context)
            if 'get_public_reupload_requests' in url: return await route.fulfill(json=[])
            if 'register_contractor_license' in url:
                uploads.append(json.loads(req.post_data)); return await route.fulfill(status=204,body='')
            if '/storage/v1/object/' in url: return await route.fulfill(json=dict(Key='fixture'))
            if '/rest/v1/msds_records' in url:
                uploads.append(json.loads(req.post_data)); return await route.fulfill(status=201,body='')
            await route.fulfill(status=400,json=dict(message='Unexpected request: '+url))
        await page.route('**/*.supabase.co/**', api)
        await page.goto(BASE+'/upload.html?token=individual-token-0000')
        await page.wait_for_selector('#portalView:not([hidden])')
        assert await page.title()=='서울 신축현장 안전건설 관리페이지'
        assert not await page.locator('#loadingView').is_visible()
        assert await page.locator('.document-row').count()==2
        assert await page.locator('.document-actions a').get_attribute('href')==f'https://zobflntvegpunktphauf.supabase.co/functions/v1/msds-view?id={RID}'
        await page.locator('#portalSearch').fill('존재하지않는자료')
        assert await page.locator('.document-row').count()==0
        await page.locator('#portalSearch').fill('')
        await page.screenshot(path=str(OUT/'desktop.png'),full_page=True)
        await page.locator('#warningsTab').click()
        assert await page.locator('#warningRecordList input:disabled').count()==1
        await page.locator('.select-all input').check()
        for size in ['a4','a5','a6','mini']:
            await page.select_option('#portalPrintSize',size)
            await page.locator('#printPortalWarnings').click()
            await page.locator('#__printFrame').evaluate('(f)=>f.contentWindow.print=()=>{}')
            await page.wait_for_timeout(500)
            assert await page.frames[-1].locator('.wlabel').count()==1
            assert await page.frames[-1].locator('.wl-qr svg').count()==1
            await page.locator('#__printFrame').evaluate('(f)=>f.remove()')
        await page.locator('#licenseTab').click()
        assert await page.locator('#licenseFileInput').count()==1
        await page.locator('#licenseFileInput').set_input_files(dict(name='사업자등록증.pdf',mimeType='application/pdf',buffer=b'%PDF-1.4 fixture'))
        await page.wait_for_selector('#licenseAlreadyDone',state='visible')
        assert uploads[-1]['p_contractor_id']==CON
        await page.locator('#recordsTab').click()
        await page.get_by_role('button',name='+ MSDS 업로드').click()
        await page.locator('.worktype-btn').first.click()
        await page.locator('#step1Next').click()
        file_input=page.locator('#stepView2 input[type=file]')
        await file_input.set_input_files(dict(name='새로운_MSDS.pdf',mimeType='application/pdf',buffer=b'%PDF-1.4 fixture'))
        await page.locator('#uploadBtn:not([disabled])').click()
        await page.wait_for_selector('#stepView3',state='visible')
        assert uploads[-1]['contractor']=='안전건설'
        assert uploads[-1]['work_type']=="도장 '공종'"
        for width in [360,390,768]:
            await page.set_viewport_size(dict(width=width,height=844))
            await page.locator('#recordsTab').click()
            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
            if width==390: await page.screenshot(path=str(OUT/'mobile.png'),full_page=True)
        await page.goto(BASE+'/upload.html?ptoken=public-token-0000')
        await page.wait_for_selector('#contractorPickView',state='visible')
        await page.locator('#contractorPickGrid button').click()
        await page.wait_for_selector('#licensePanel',state='visible')
        assert not await page.locator('#recordsTab').is_visible()
        assert not await page.locator('#loadingView').is_visible()
        for suffix in ['', '?token=invalid-token-0000']:
            await page.goto(BASE+'/upload.html'+suffix)
            await page.wait_for_selector('#errorView',state='visible')
            assert not await page.locator('#loadingView').is_visible()
        assert not errors, errors
        await browser.close()
        print('PASS: individual/public links, title, scoped records, search, 4 print sizes and QR, license registration, MSDS upload, mobile widths, invalid/missing tokens; no JavaScript errors')

asyncio.run(main())
