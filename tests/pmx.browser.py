"""PMX combobox, manual creation and sync with mock data; no production writes."""
import asyncio,json
from playwright.async_api import async_playwright

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':1440,'height':1000})
  errors=[];created=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  async def api(route):
   req=route.request
   if '/rpc/sync_pmx_project' in req.url:
    data=req.post_data_json
    assert data['p_project']['prjCd']=='000012'
    return await route.fulfill(json={'id':'preview-workspace','name':'동기화 테스트 현장','owner_id':'preview-user','pmx_prj_cd':'000012','pmx_category':'주택','pmx_progress':73.2,'pmx_synced_at':data['p_fetched_at']})
   if '/rest/v1/workspaces' in req.url and req.method=='POST':
    data=req.post_data_json;created.append(data)
    return await route.fulfill(json={**data,'id':'new-workspace'})
   await route.fulfill(json=[])
  await page.route('https://*.supabase.co/**',api)
  await page.goto('http://localhost:3000/?preview=pmx')
  panel=page.locator('#pmxDashboard')
  await panel.get_by_role('button',name='정보 가져오기').wait_for()
  assert await panel.locator('#pmxMore').get_attribute('open') is None
  assert '60.5%' in await panel.inner_text()
  assert '아직 업데이트 전' in await panel.inner_text()
  await page.evaluate('openCreateWorkspace()')
  name=page.locator('#wsNameInput')
  await name.fill('프레스 티어')
  await page.locator('#pmxCreateOptions').get_by_role('option',name='프레스티어자이(경기) 주택 · 180080').click()
  assert await name.input_value()=='프레스티어자이(경기)'
  assert await page.locator('#pmxManualCode').input_value()=='180080'
  await name.fill('목록에 없는 발전소')
  await page.evaluate('createWorkspace()')
  assert not created,'typing must invalidate the previously selected code'
  await name.press('Escape')
  assert await page.locator('#pmxCreateDropdown').is_hidden()
  await name.fill('180080');await name.press('Enter')
  assert await name.input_value()=='프레스티어자이(경기)'
  # Select explicit manual creation, retaining leading zeros in a known code.
  await name.fill('목록에 없는 발전소')
  await name.press('Tab')
  assert await page.locator('#pmxManualCategory').evaluate('(el)=>el===document.activeElement')
  await page.locator('#pmxManualCategory').select_option('플랜트')
  await page.locator('#pmxManualCode').fill('000099')
  await page.locator('#pmxManualStart').fill('2026-01-01')
  await page.locator('#pmxManualEnd').fill('2028-01-01')
  await page.evaluate('createWorkspace()')
  assert created[-1]['name']=='목록에 없는 발전소'
  assert created[-1]['pmx_prj_cd']=='000099' and created[-1]['pmx_category']=='플랜트'
  assert created[-1]['pmx_start_date']=='2026-01-01' and created[-1]['pmx_progress'] is None
  # A genuinely unknown code is kept null, never filled with a generated app code.
  await page.evaluate('openCreateWorkspace()')
  await name.fill('신규 교량 현장')
  await page.locator('#pmxManualCategory').select_option('인프라')
  await page.evaluate('createWorkspace()')
  assert created[-1]['pmx_prj_cd'] is None and created[-1]['pmx_category']=='인프라'
  snapshot={'version':1,'source':'pmx-bookmark','fetchedAt':await page.evaluate('new Date().toISOString()'),'projects':[
   {'prjCd':'000012','prjNm':'동기화 테스트 현장','bizFldNm':'주택','cstrnStrtYmd':None,'cstrnEndYmd':None,'actlTProgrt':73.2},
   {'prjCd':'000021','prjNm':'울산 발전소','bizFldNm':'플랜트','cstrnStrtYmd':None,'cstrnEndYmd':None,'actlTProgrt':None},
   {'prjCd':'000031','prjNm':'신규 도로 현장','bizFldNm':'인프라','cstrnStrtYmd':None,'cstrnEndYmd':None,'actlTProgrt':None}]}
  await page.locator('#pmxMore > summary').click()
  await page.locator('#pmxSetupBtn').click()
  await page.locator('#pmxSnapshotFile').set_input_files({'name':'pmx-projects.json','mimeType':'application/json','buffer':json.dumps(snapshot).encode()})
  assert '60.5%' in await panel.inner_text(),'import must wait for explicit review'
  await page.locator('#pmxReviewConfirm').click()
  await page.wait_for_function("document.querySelector('#pmxDashboard').innerText.includes('73.2%')")
  assert '아직 업데이트 전' not in await panel.inner_text()
  await page.evaluate('openCreateWorkspace()')
  await name.fill('플랜트')
  await page.locator('#pmxCreateOptions').get_by_role('option',name='울산 발전소 플랜트 · 000021').click()
  assert await page.locator('#pmxManualCode').input_value()=='000021'
  await name.fill('인프라')
  await page.locator('#pmxCreateOptions').get_by_role('option',name='신규 도로 현장 인프라 · 000031').click()
  assert await page.locator('#pmxManualCode').input_value()=='000031'
  await page.set_viewport_size({'width':390,'height':844})
  await name.fill('모바일 현장')
  assert await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
  assert not errors,errors
  print('PMX browser: inline search, keyboard selection, stale-code prevention, plant/infra creation, optional code, all-category synced search and mobile layout passed')
  await browser.close()

asyncio.run(main())
