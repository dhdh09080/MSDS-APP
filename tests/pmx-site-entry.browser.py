"""Creation is only reached through the workspace add button; linking never creates."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
OUT=Path('work/screenshots');OUT.mkdir(parents=True,exist_ok=True)
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await b.new_page(viewport={'width':1280,'height':1100},device_scale_factor=2,locale='ko-KR')
  created=[];linked=[];errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  ws={'id':'preview-workspace','name':'성동 안전현장','owner_id':'preview-user','code':'internal-code','pmx_prj_cd':'000012','status':'active'}
  async def api(route):
   req=route.request;url=req.url
   if '/rest/v1/workspace_members' in url and req.method=='GET':return await route.fulfill(json=[{'workspace_id':ws['id'],'role':'admin'}])
   if '/rest/v1/workspaces' in url:
    if req.method=='GET':return await route.fulfill(json=[ws])
    if req.method=='POST':
     data=req.post_data_json;created.append(data);return await route.fulfill(json={**data,'id':'created-site'})
    if req.method=='PATCH':
     data=req.post_data_json;linked.append(data);return await route.fulfill(json={**ws,**data})
   await route.fulfill(json=[])
  await page.route('https://*.supabase.co/**',api)
  await page.goto('http://localhost:3000/?preview=pmx');await page.locator('#pmxSyncBtn').wait_for()
  await page.evaluate('goWorkspaces()')
  await page.locator('#wsList .ws-card').wait_for()
  await page.locator('.ws-content').screenshot(path=str(OUT/'site-entry-list.png'),animations='disabled')
  await page.get_by_role('button',name='+ 새 현장 추가하기').click()
  await page.locator('#wsNameInput').fill('신규 플랜트 현장')
  await page.locator('#pmxManualCategory').select_option('플랜트')
  await page.locator('#pmxManualCode').fill('000099')
  await page.locator('#pmxManualStart').fill('2026-10-27')
  await page.locator('#pmxManualEnd').fill('2028-10-27')
  assert await page.locator('[data-manual-add]').count()==0
  assert await page.locator('#pmxCreateManual').is_visible()
  await page.locator('#createWSModal .modal').screenshot(path=str(OUT/'site-entry-form.png'),animations='disabled')
  await page.locator('#createWSModal').get_by_role('button',name='현장 추가',exact=True).click()
  await page.wait_for_function("!document.querySelector('#createWSModal').classList.contains('open')")
  assert len(created)==1 and created[0]['name']=='신규 플랜트 현장' and created[0]['pmx_prj_cd']=='000099'
  # Typing in an existing site's link picker cannot start another creation flow.
  await page.goto('http://localhost:3000/?preview=pmx');await page.locator('#pmxMore > summary').click()
  await page.locator('#pmxLinkBtn').click()
  search=page.locator('#pmxProjectSearch');await search.fill('목록에 없는 연결 현장')
  assert '현장을 직접 추가' not in await page.locator('#pmxPicker').inner_text()
  assert await page.locator('#pmxLinkManual').count()==0
  assert await page.locator('#pmxPicker [data-manual-add]').count()==0
  await search.press('Enter')
  assert len(created)==1 and len(linked)==0
  await search.fill('목록에 없는 연결 현장')
  await page.locator('#pmxPicker').screenshot(path=str(OUT/'site-entry-link-only.png'),animations='disabled')
  await search.fill('180080');await page.locator('#pmxLinkOptions').get_by_role('option').click()
  await page.wait_for_function("!document.querySelector('#pmxPicker').open")
  assert len(linked)==1 and linked[0]['pmx_prj_cd']=='180080' and len(created)==1
  # Creation also has name suggestions, but picking one only fills the add form.
  await page.evaluate('goWorkspaces()');await page.get_by_role('button',name='+ 새 현장 추가하기').click()
  await page.locator('#wsNameInput').fill('180080')
  await page.locator('#createWSModal .modal').screenshot(path=str(OUT/'site-entry-suggestions.png'),animations='disabled')
  await page.locator('#pmxCreateOptions').get_by_role('option').click()
  assert await page.locator('#pmxManualCode').input_value()=='180080'
  assert len(created)==1
  await page.locator('#wsNameInput').fill('수정한 새 현장')
  assert await page.locator('#pmxManualCode').input_value()==''
  assert await page.locator('#pmxManualCategory').input_value()==''
  await page.set_viewport_size({'width':390,'height':1000})
  await page.locator('#pmxManualCategory').select_option('인프라')
  assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  await page.locator('#createWSModal .modal').screenshot(path=str(OUT/'site-entry-mobile.png'),animations='disabled')
  assert not errors,errors
  print('Site entry: list add button, direct form creation, suggestion-only search, stale-code clearing, link-only picker and mobile passed')
  await b.close()
asyncio.run(main())
