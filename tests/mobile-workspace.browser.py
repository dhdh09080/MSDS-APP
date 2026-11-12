"""Authenticated mobile workspace regression. Synthetic API only; no production writes.
Run Vite on 3001, then python tests/mobile-workspace.browser.py.
"""
import asyncio,json,base64,time,os,subprocess
from urllib.parse import urlparse
from pathlib import Path
from playwright.async_api import async_playwright
U={'id':'11111111-1111-4111-8111-111111111111','email':'test@example.com','user_metadata':{'name':'테스트'},'app_metadata':{},'aud':'authenticated','created_at':'2026-01-01T00:00:00Z'}
W={'id':'22222222-2222-4222-8222-222222222222','name':'모바일 시험 현장','owner_id':U['id']}
BASE=os.environ.get('BASE_URL','http://localhost:3001')
OUT=Path(os.environ.get('MOBILE_ARTIFACT_DIR','work/mobile-workspace'));OUT.mkdir(parents=True,exist_ok=True)
records=[{'id':str(i),'contractor':'시험업체','product_name':f'제품 {i}','status':'active','receipt_status':'received','has_pdf':True} for i in range(389)]
records[2]['contractor']=None
records[3]['product_name']=None
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await b.new_page(viewport={'width':360,'height':740},is_mobile=True,has_touch=True)
  errors=[];health_release=asyncio.Event();fail_msds=False;page.on('pageerror',lambda e:errors.append(e.stack))
  async def api(r):
   u=urlparse(r.request.url)
   if u.hostname in ['localhost','127.0.0.1']:return await r.continue_()
   if not u.hostname.endswith('.supabase.co'):return await r.fulfill(body='')
   name=u.path.rsplit('/',1)[-1]
   if name=='token':
    token='.'.join(base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip('=') for x in [{'alg':'HS256'}, {'sub':U['id'],'exp':int(time.time())+3600},{}])
    return await r.fulfill(json={'access_token':token,'refresh_token':'fixture','expires_in':3600,'token_type':'bearer','user':U})
   if name=='user':return await r.fulfill(json=U)
   if name=='workspace_members':return await r.fulfill(json=[{'workspace_id':W['id'],'user_id':U['id'],'role':'admin'}])
   if name=='workspaces':return await r.fulfill(json=[W])
   if name=='contractors':return await r.fulfill(json=[{'id':'c1','name':'시험업체'}])
   if name=='health_records':
    await health_release.wait()
    return await r.fulfill(json=[])
   if name=='msds_records':
    if fail_msds:return await r.fulfill(status=503,json={'message':'Synthetic unavailable'})
    await asyncio.sleep(0.5)
    return await r.fulfill(json=records)
   if name=='site-weather':return await r.fulfill(status=503,json={'message':'fixture unavailable'})
   if name in ['is_system_admin','is_current_user_system_admin']:return await r.fulfill(json=False)
   return await r.fulfill(json=[])
  await page.route('**/*',api)
  await page.goto(BASE)
  await page.locator('#loginEmail').fill(U['email']);await page.locator('#loginPassword').fill('test-password')
  await page.locator('#loginBtn').click()
  await page.locator('#homeTitle').filter(has_text=W['name']).wait_for()
  await page.wait_for_function("document.getElementById('loadingScreen').style.display === 'none'")
  assert await page.locator('#gsGreeting').is_visible()
  assert await page.locator('#workspaceLoadStatus').is_visible()
  assert await page.locator('#msdsTableBody .row-check').count()==0
  assert await page.locator('#warnPickList .warn-pick-item').count()==0
  assert await page.locator('#page-home .page-header').evaluate("e => getComputedStyle(e).backdropFilter")=='none'
  print('Home renders before pending health data; hidden document lists stay unrendered; mobile blur disabled')
  await page.wait_for_function("document.getElementById('mBadgeMsds').textContent === '389'")
  await page.locator('#mtab-msds').click()
  assert await page.locator('#msdsTableBody .row-check').count()==30
  assert '389' in await page.locator('#msdsResultSummary').inner_text()
  assert (await page.locator('#page-msds').bounding_box())['height'] < 10000
  health_release.set()
  await page.locator('#workspaceLoadStatus').wait_for(state='hidden')
  assert await page.locator('#page-msds').evaluate("e=>e.classList.contains('active')")
  await page.evaluate('changeMsdsPage(1)')
  assert '2 / 13' in await page.locator('#msdsPageStatus').inner_text()
  await page.evaluate('changeMsdsPage(100)')
  assert await page.locator('#msdsTableBody .row-check').count()==29
  assert await page.locator('#msdsNextPage').is_disabled()
  # All matching rows remain in exports, including rows outside the visible page.
  async with page.expect_download() as download:
   await page.evaluate('exportMsdsExcel()')
  exported=OUT/'all-msds.xlsx';await (await download.value).save_as(exported)
  count=subprocess.check_output(['node','--input-type=module','-e',"import * as X from 'xlsx'; import fs from 'node:fs'; const w=X.read(fs.readFileSync(process.argv[1]),{type:'buffer'}); console.log(X.utils.sheet_to_json(w.Sheets[w.SheetNames[0]]).length);",str(exported.resolve())]).decode().strip()
  assert count=='389',count
  await page.locator('#searchInput').fill('제품 388')
  assert await page.locator('#msdsTableBody .row-check').count()==1
  assert await page.locator('#msdsPagination').is_hidden()
  await page.locator('#searchInput').fill('')
  assert '1 / 13' in await page.locator('#msdsPageStatus').inner_text()
  for width in [360,390,768]:
   await page.set_viewport_size({'width':width,'height':844})
   assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth')
   await page.locator('#mtab-home').click()
   assert await page.locator('#homeTitle').is_visible()
   await page.locator('#mtab-msds').click()
   assert await page.locator('#msdsTableBody .row-check').count()==30
  await page.screenshot(path=str(OUT/'msds-mobile.png'))
  print('389 records including null labels: 30 rows per page, complete export, last page, search and menu switching verified at 360/390/768px')
  fail_msds=True
  await page.reload()
  await page.locator('#workspaceLoadStatus').filter(has_text='일부 자료').wait_for()
  assert await page.locator('#homeTitle').is_visible()
  assert await page.locator('#mtab-msds').is_visible()
  await page.locator('#mtab-msds').click()
  await page.locator('#searchInput').fill('제품 388')
  fail_msds=False
  await page.locator('#workspaceRetryButton').click()
  await page.locator('#workspaceLoadStatus').wait_for(state='hidden')
  assert await page.locator('#searchInput').input_value()=='제품 388'
  assert await page.locator('#msdsTableBody .row-check').count()==1
  assert await page.locator('#page-msds').evaluate("e=>e.classList.contains('active')")
  assert not errors,errors
  print('A failing MSDS request leaves a visible home; in-page retry preserves active menu and search; no uncaught JavaScript errors')
  await b.close()
asyncio.run(main())
