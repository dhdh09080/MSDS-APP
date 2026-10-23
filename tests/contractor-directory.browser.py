"""Directory UI integration using synthetic API responses, no customer writes."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
BASE=os.environ.get('BASE_URL','http://localhost:3004')
OUT=Path(os.environ.get('DIRECTORY_ARTIFACT_DIR','work/directory-preview'))
WS='10000000-0000-4000-8000-000000000001'; CID='20000000-0000-4000-8000-000000000002'
rows=[dict(id=CID,name='안전건설',manager_name='홍길동',manager_phone='010-1234-5678',license_submitted=True,msds_count=3),dict(id='30000000-0000-4000-8000-000000000003',name='새봄전기',manager_name='',manager_phone='',license_submitted=False,msds_count=0)]
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await browser.new_page(viewport=dict(width=1440,height=1000));errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  async def api(route):
   req=route.request;args=json.loads(req.post_data or '{}')
   if 'get_contractor_directory' in req.url:
    if args.get('p_token')!='directory-fixture-token':return await route.fulfill(status=400,json=dict(message='invalid or expired'))
    return await route.fulfill(json=dict(workspace=dict(id=WS,name='서울 신축현장'),contractors=rows))
   if 'save_directory_contractor' in req.url:
    if args.get('p_contractor_id'):
     row=next(c for c in rows if c['id']==args['p_contractor_id']);row.update(manager_name=args['p_manager_name'],manager_phone=args['p_manager_phone']);rid=row['id']
    else:
     if any(c['name']==args['p_name'] for c in rows):return await route.fulfill(status=400,json=dict(message='contractor already exists'))
     rid='40000000-0000-4000-8000-000000000004';rows.append(dict(id=rid,name=args['p_name'],manager_name=args['p_manager_name'],manager_phone=args['p_manager_phone'],license_submitted=False,msds_count=0))
    return await route.fulfill(json=rid)
   if 'get_contractor_portal' in req.url:
    assert args['p_token']=='directory-fixture-token';assert any(c['id']==args['p_contractor_id'] for c in rows)
    company=next(c for c in rows if c['id']==args['p_contractor_id'])
    return await route.fulfill(json=dict(workspace=dict(id=WS,name='서울 신축현장'),contractor=dict(id=company['id'],name=company['name']),public_link=dict(allow_msds=True,allow_license=True),records=[],work_types=[],license=None))
   if 'get_public_reupload_requests' in req.url:return await route.fulfill(json=[])
   return await route.fulfill(status=400,json=dict(message='unexpected request'))
  await page.route('**/*.supabase.co/**',api)
  await page.goto(BASE+'/contractors.html?dtoken=directory-fixture-token');await page.locator('#directoryContent:not([hidden])').wait_for()
  assert await page.title()=='서울 신축현장 전체 협력사 리스트'
  assert await page.locator('#directoryList tr').count()==2
  assert '홍길동' in await page.locator('#directoryList').inner_text()
  await page.screenshot(path=str(OUT/'desktop.png'),full_page=True)
  assert await page.locator('.directory-register-license').count()==1
  assert await page.locator('.directory-add-msds').count()==2
  for name in ['안전건설','새봄전기']:
   await page.get_by_role('link',name=name+' MSDS 추가',exact=True).click()
   await page.locator('#portalView:not([hidden])').wait_for()
   assert await page.locator('#uploadPanel').is_visible()
   assert not await page.locator('#licensePanel').is_visible()
   assert name in await page.title()
   assert 'panel=upload' in page.url
   await page.locator('#directoryBackLink').click();await page.locator('#directoryContent:not([hidden])').wait_for()
  await page.get_by_role('link',name='새봄전기 사업자등록증 등록하기',exact=True).click()
  await page.locator('#portalView:not([hidden])').wait_for()
  assert await page.locator('#licensePanel').is_visible()
  assert await page.locator('#licenseTab').get_attribute('aria-selected')=='true'
  assert not await page.locator('#uploadPanel').is_visible()
  assert '새봄전기' in await page.title()
  await page.screenshot(path=str(OUT/'license-registration.png'),full_page=True)
  await page.locator('#directoryBackLink').click();await page.locator('#directoryContent:not([hidden])').wait_for()

  await page.select_option('#directoryFilter','license');assert await page.locator('#directoryList tr').count()==1
  assert '새봄전기' in await page.locator('#directoryList').inner_text()
  await page.select_option('#directoryFilter','all');await page.locator('#directorySearch').fill('홍길동');assert await page.locator('#directoryList tr').count()==1
  await page.locator('#directorySearch').fill('')
  await page.get_by_role('button',name='안전건설 연락처 수정').click();await page.locator('#directoryManager').fill('김관리');await page.locator('#directoryPhone').fill('010-9999-8888');await page.locator('#directorySave').click()
  await page.locator('#directoryDialog').wait_for(state='hidden');assert rows[0]['manager_name']=='김관리';await page.locator('#directoryList').get_by_text('김관리',exact=True).wait_for()
  await page.locator('#directoryRegister').click();await page.locator('#directoryName').fill('신규토건');await page.locator('#directoryManager').fill('이소장');await page.locator('#directoryPhone').fill('010-5555-6666');await page.locator('#directorySave').click()
  await page.locator('#directoryDialog').wait_for(state='hidden');await page.wait_for_function("document.querySelectorAll('#directoryList tr').length===3")
  assert rows[-1]['name']=='신규토건'
  await page.locator('#directoryRegister').click();await page.locator('#directoryName').fill('신규토건');await page.locator('#directorySave').click();await page.get_by_text('이미 등록된 협력사입니다.',exact=False).wait_for();await page.locator('#directoryCancel').click()
  for width in [360,390,768]:
   await page.set_viewport_size(dict(width=width,height=844));assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   if width==390:await page.screenshot(path=str(OUT/'mobile.png'),full_page=True)
  await page.get_by_role('link',name='안전건설',exact=True).click();await page.locator('#portalView:not([hidden])').wait_for()
  assert await page.title()=='서울 신축현장 안전건설 관리페이지';assert await page.locator('#directoryBackLink').is_visible()
  await page.locator('#directoryBackLink').click();await page.locator('#directoryContent:not([hidden])').wait_for()
  await page.goto(BASE+'/contractors.html?dtoken=invalid');await page.locator('#directoryError:not([hidden])').wait_for();assert not await page.locator('#directoryContent').is_visible()
  assert not errors,errors
  await browser.close();print('PASS: directory statuses, license registration link, MSDS add links for submitted/missing companies, correct company/panel, search/filter, contact edit, self registration, duplicates, individual navigation/back, mobile 360/390/768, invalid token, no JS errors')
asyncio.run(main())
