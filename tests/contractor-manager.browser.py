"""Contractor management table and editor. Synthetic requests only."""
import asyncio, json, os
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright
BASE=os.environ.get('BASE_URL','http://localhost:3007')
OUT=Path('work/contractor-manager')
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 companies=[dict(id='con-1',name='대한건설',manager_name='홍길동',manager_phone='010-1234-5678',is_active=True),dict(id='con-2',name='한빛전기',is_active=False),dict(id='con-3',name='성우도장',pmx_company_name='성우도장',is_active=True)]
 records=[dict(id='msds-1',contractor='대한건설',pdf_path='fixtures/msds.pdf',status='active',product_name='도료')]
 trades=[dict(id='wt-1',contractor_id='con-1',name='골조')]
 licenses=[dict(id='license-1',contractor_id='con-1',contractor=dict(name='대한건설'),file_name='등록증.pdf')]
 writes=[];errors=[];fail_contact=True;fail_state=True;fail_trade=True;fail_records=True
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await browser.new_page(viewport=dict(width=1600,height=1000),locale='ko-KR')
  page.on('pageerror',lambda e:errors.append(str(e)))
  async def api(route):
   nonlocal fail_contact,fail_state,fail_trade,fail_records
   req=route.request;u=urlparse(req.url);q=parse_qs(u.query);name=u.path.rsplit('/',1)[-1];data=json.loads(req.post_data or '{}')
   if name=='save_workspace_contractor_contact':
    assert data['p_workspace']=='preview-workspace' and data['p_contractor_id']=='con-1'
    if fail_contact:fail_contact=False;return await route.fulfill(status=400,json=dict(message='테스트 저장 실패'))
    companies[0].update(manager_name=data['p_manager_name'],manager_phone=data['p_manager_phone']);writes.append(data)
    return await route.fulfill(status=204,body='')
   if name=='set_contractor_active':
    if fail_state:fail_state=False;return await route.fulfill(status=400,json=dict(message='테스트 상태 실패'))
    next(c for c in companies if c['id']==data['p_contractor'])['is_active']=data['p_active']
    return await route.fulfill(status=204,body='')
   if name=='contractors':
    if req.method=='GET':return await route.fulfill(json=companies)
    assert q['workspace_id']==['eq.preview-workspace']
    c=next(c for c in companies if 'eq.'+c['id']==q['id'][0]);c.update(data);writes.append(data)
    return await route.fulfill(json={'id':c['id']})
   if name=='msds_records':
    if req.method=='GET':return await route.fulfill(json=records)
    assert q['workspace_id']==['eq.preview-workspace']
    if fail_records:fail_records=False;return await route.fulfill(status=400,json=dict(message='대장 반영 실패'))
    for r in records:
     if 'eq.'+r['contractor']==q['contractor'][0]:r.update(data)
    writes.append(data);return await route.fulfill(status=204,body='')
   if name=='work_types':
    if req.method=='GET':return await route.fulfill(json=trades)
    if fail_trade:fail_trade=False;return await route.fulfill(status=400,json=dict(message='공종 실패'))
    if req.method=='POST':
     assert data['workspace_id']=='preview-workspace' and data['contractor_id']=='con-1'
     w=dict(id='wt-2',**data);trades.append(w);return await route.fulfill(json={'id':w['id']})
    assert q['workspace_id']==['eq.preview-workspace'] and q['contractor_id']==['eq.con-1']
    w=next(w for w in trades if 'eq.'+w['id']==q['id'][0]);trades.remove(w);return await route.fulfill(json={'id':w['id']})
   if name=='business_licenses':
    for l in licenses:l['contractor']={'name':next(c['name'] for c in companies if c['id']==l['contractor_id'])}
    return await route.fulfill(json=licenses)
   return await route.fulfill(json=[])
  await page.route('**/*.supabase.co/**',api)
  await page.goto(BASE+'/?preview=contractors')
  await page.locator('#conMgrList .contractor-row').first.wait_for()
  await page.evaluate('refreshContractorDirectoryData()')
  assert await page.locator('#conMgrList .contractor-row').count()==3
  assert await page.locator('#conMgrList thead th').all_text_contents()==['협력사','담당자 · 연락처','공종','MSDS','사업자등록증','사용 여부','관리']
  assert not await page.locator('#siteDirectoryCard').is_visible()
  await page.locator('#conMgrSearch').fill('홍길동');assert await page.locator('#conMgrList .contractor-row').count()==1
  await page.locator('#conMgrSearch').fill('1234');assert await page.locator('#conMgrList .contractor-row').count()==1
  await page.locator('#conMgrSearch').fill('')
  for value,count in [('inactive',1),('active',2),('missing-msds',2),('missing-license',2),('all',3)]:
   await page.locator('#conMgrFilter').select_option(value);assert await page.locator('#conMgrList .contractor-row').count()==count
  await page.screenshot(path=str(OUT/'table-desktop.png'),full_page=True)
  usage=page.get_by_role('switch',name='대한건설 사용 여부')
  await usage.uncheck();await page.get_by_text('사용 여부 저장 실패: 테스트 상태 실패',exact=False).wait_for()
  assert await usage.is_checked()
  await usage.uncheck();await page.wait_for_function('document.querySelector(".con-usage input").checked===false')
  assert companies[0]['is_active']==False
  await usage.check();await page.wait_for_function('document.querySelector(".con-usage input").checked===true')
  await page.get_by_role('button',name='대한건설 정보 수정',exact=True).click()
  await page.locator('#conEditManager').fill('김관리')
  await page.locator('#conEditPhone').fill('010-9999-8888')
  await page.locator('#conProfileSave').click()
  await page.locator('#conProfileError').get_by_text('테스트 저장 실패',exact=False).wait_for()
  assert await page.locator('#conEditManager').input_value()=='김관리'
  assert companies[0]['manager_name']=='홍길동'
  await page.locator('#conProfileSave').click()
  await page.locator('#conProfileStatus').get_by_text('저장했습니다').wait_for()
  await page.locator('#conEditName').fill('대한건설 변경')
  await page.locator('#conProfileSave').click()
  await page.locator('#conProfileError').get_by_text('업체명 변경을 취소했습니다',exact=False).wait_for()
  assert companies[0]['name']=='대한건설' and records[0]['contractor']=='대한건설'
  await page.locator('#conProfileSave').click()
  await page.wait_for_function('document.querySelector("#conMgrList .con-company-name").textContent==="대한건설 변경"')
  assert records[0]['contractor']=='대한건설 변경'
  await page.locator('#conNewTrade').fill('도장')
  await page.locator('#conTradeForm button').click();await page.locator('#conTradeError').get_by_text('공종 실패',exact=False).wait_for()
  assert await page.locator('#conNewTrade').input_value()=='도장'
  await page.locator('#conTradeForm button').click()
  await page.locator('#conEditTrades').get_by_text('도장',exact=True).wait_for()
  await page.screenshot(path=str(OUT/'editor-desktop.png'),full_page=True)
  await page.get_by_role('button',name='도장 공종 삭제',exact=True).click()
  await page.locator('[data-con-trade-delete="wt-2"]').wait_for(state="detached")
  await page.locator('#conNewTrade').fill('골조');await page.locator('#conTradeForm button').click()
  await page.locator('#conTradeError').get_by_text('이미 등록된 공종입니다.',exact=True).wait_for()
  await page.keyboard.press('Escape');assert not await page.locator('#contractorEditor').is_visible()
  await page.get_by_role('button',name='대한건설 변경 추가 작업',exact=True).click()
  assert await page.get_by_role('menuitem',name='문서 이관').is_visible()
  await page.keyboard.press('Escape');assert await page.locator('.con-actions-menu').count()==0
  await page.get_by_role('button',name='대한건설 변경 추가 작업',exact=True).click()
  page.once('dialog',lambda d:d.dismiss())
  await page.get_by_role('menuitem',name='협력사 삭제').click()
  assert await page.locator('#conMgrList .contractor-row').count()==3
  await page.get_by_role('button',name='대한건설 변경 추가 작업',exact=True).click()
  await page.get_by_role('menuitem',name='문서 이관').click();assert await page.locator('#contractorTransferDialog').is_visible()
  await page.locator('#transferCancel').click()
  await page.get_by_role('button',name='대한건설 변경 사업자등록증 제출 완료',exact=True).click()
  assert await page.locator('#businessLicenseSearch').input_value()=='대한건설 변경'
  assert await page.locator('#gs-tab-licenses').get_attribute('aria-selected')=='true'
  assert await page.locator('#businessLicenseList .snapshot-item').count()==1
  await page.locator('#gs-tab-companies').click()
  await page.get_by_role('button',name='대한건설 변경 MSDS 1건 보기',exact=True).click()
  assert await page.locator('#page-msds').evaluate('e=>e.classList.contains("active")')
  assert '대한건설 변경' in await page.locator('#msdsTableBody').inner_text()
  await page.evaluate("showPage('contractors')")
  for width in [360,390,768,1440]:
   await page.set_viewport_size(dict(width=width,height=844));await page.wait_for_timeout(150)
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
   await page.get_by_role('button',name='대한건설 변경 정보 수정',exact=True).click()
   assert await page.locator('#contractorEditor').evaluate('e=>e.getBoundingClientRect().right<=innerWidth')
   if width==390:await page.screenshot(path=str(OUT/'editor-mobile.png'),full_page=True)
   await page.keyboard.press('Escape')
   if width==390:await page.screenshot(path=str(OUT/'table-mobile.png'),full_page=True)
  assert not errors,errors
  await browser.close()
  print('PASS: table, profile save/failure/name cascade, scoped trade CRUD, status rollback, filters/search, menus and navigation, 360–1440 mobile; synthetic API only')
asyncio.run(main())
