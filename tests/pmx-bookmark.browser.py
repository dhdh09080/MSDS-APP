"""One-shot PMX favorite with real browser origins and mock API; no live PMX writes."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
BASE='http://localhost:3000'
OUT=Path('work/screenshots')

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  context=await browser.new_context(viewport={'width':1440,'height':1100},locale='ko-KR')
  await context.add_cookies([{'name':'PMX_TEST','value':'browser-only-secret','domain':'pmx.gsenc.com','path':'/','httpOnly':True,'secure':True,'sameSite':'Lax'}])
  reads=[];writes=[];app_requests=[]
  row={'prjCd':'000012','prjNm':'성동 안전현장','bizFldNm':'주택','cstrnStrtYmd':'20240701','cstrnEndYmd':'20271001','actlTProgrt':60.5}
  async def pmx_api(route):
   if '/api/' in route.request.url:
    reads.append(route.request.url)
    assert 'PMX_TEST=browser-only-secret' in route.request.headers.get('cookie','')
    assert route.request.method=='GET' and 'bizFldCd=N0' in route.request.url
    return await route.fulfill(json={'successOrNot':'Y','data':[{**row,'pmEmpNo':'private-employee','Cookie':'private-session'}]})
   await route.fulfill(content_type='text/html',headers={'Cross-Origin-Opener-Policy':'same-origin'},body='<html lang="ko"><h1>PMX 모의 로그인 화면</h1></html>')
  async def backend(route):
   if '/rpc/sync_pmx_project' in route.request.url:
    data=route.request.post_data_json;writes.append(data)
    return await route.fulfill(json={'id':'preview-workspace','name':data['p_project']['prjNm'],'owner_id':'preview-user','pmx_prj_cd':'000012','pmx_category':'주택','pmx_start_date':'2024-07-01','pmx_end_date':'2027-10-01','pmx_progress':data['p_project']['actlTProgrt'],'pmx_synced_at':data['p_fetched_at']})
   await route.fulfill(json=[])
  await context.route('https://pmx.gsenc.com/**',pmx_api)
  await context.route('https://*.supabase.co/**',backend)
  page=await context.new_page();page.on('request',lambda req:app_requests.append(req.url) if req.url.startswith(BASE) else None)
  await page.goto(BASE+'/?preview=pmx');await page.locator('#pmxSyncBtn').wait_for()
  assert '현장코드:' not in await page.locator('#pmxDashboard').inner_text()
  assert '확장 프로그램' not in await page.locator('#pmxDashboard').inner_text()
  await page.locator('#pmxSyncBtn').click();await page.locator('#pmxSyncGuide').screenshot(path=str(OUT/'pmx-bookmark-guide.png'),animations='disabled')
  favorite=await page.locator('#pmxBookmark').get_attribute('href');assert favorite.startswith('javascript:')
  async with page.expect_popup() as opened:
   await page.locator('#pmxGuideOpen').click()
  pmx=await opened.value;await pmx.wait_for_load_state()
  assert await pmx.evaluate('window.opener===null')
  # Fake app commands and the retired extension bridge must not cause reads or writes.
  await pmx.evaluate("dispatchEvent(new MessageEvent('message',{origin:'http://localhost:3000',data:{type:'FETCH',url:'/com/secret'}}))")
  await page.evaluate("postMessage({source:'gs-pmx-extension',type:'PMX_UPDATED',projects:[],fetchedAt:new Date().toISOString()},location.origin)")
  assert len(reads)==0 and len(writes)==0
  # Execute exactly the favorite's standalone script in the logged-in PMX fixture.
  await pmx.evaluate('(script)=>{void (0,eval)(script)}',favorite[len('javascript:'):])
  await pmx.wait_for_url(BASE+'/?pmx-review=1')
  assert len(reads)==1 and len(writes)==0
  assert await pmx.evaluate('window.opener===null')
  assert await pmx.evaluate('location.hash')==''
  assert all('#snapshot=' not in url and 'private-session' not in url for url in app_requests)
  # Preview supplies a synthetic app account; the real app requires its normal login.
  await pmx.goto(BASE+'/?preview=pmx&pmx-review=1')
  await pmx.locator('#pmxReviewConfirm').wait_for()
  assert len(writes)==0
  assert '성동 안전현장' in await pmx.locator('#pmxReview').inner_text()
  assert 'private-employee' not in await pmx.locator('#pmxReview').inner_text()
  await pmx.locator('#pmxReview').screenshot(path=str(OUT/'pmx-bookmark-review.png'),animations='disabled')
  await pmx.locator('#pmxReviewConfirm').click()
  await pmx.wait_for_function("document.querySelector('#pmxUpdated time') !== null")
  assert len(writes)==1 and len(reads)==1
  await pmx.locator('#pmxDashboard').screenshot(path=str(OUT/'pmx-bookmark-dashboard.png'),animations='disabled')
  await pmx.set_viewport_size({'width':1440,'height':1440})
  await pmx.evaluate("document.querySelectorAll('#appScreen *').forEach(e=>{if(e.scrollTop)e.scrollTop=0});window.scrollTo(0,0)")
  await pmx.screenshot(path=str(OUT/'pmx-bookmark-full.png'),animations='disabled')
  # File input is equally inert until confirmation, and changed scope rejects the save.
  await pmx.locator('#pmxMore > summary').click()
  await pmx.locator('#pmxSetupBtn').click()
  snapshot={'version':1,'source':'pmx-bookmark','fetchedAt':await pmx.evaluate('new Date().toISOString()'),'projects':[row]}
  await pmx.locator('#pmxSnapshotFile').set_input_files({'name':'pmx.json','mimeType':'application/json','buffer':json.dumps(snapshot).encode()})
  await pmx.locator('#pmxReviewConfirm').wait_for();assert len(writes)==1
  await pmx.evaluate('goWorkspaces()')
  await pmx.locator('#pmxReviewConfirm').click();assert len(writes)==1
  # Extra credential fields are rejected rather than displayed or stored.
  bad={**snapshot,'projects':[{**row,'Cookie':'must-not-import'}]}
  await pmx.goto(BASE+'/?preview=pmx')
  await pmx.locator('#pmxMore > summary').click()
  await pmx.locator('#pmxSetupBtn').click()
  await pmx.locator('#pmxSnapshotFile').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':json.dumps(bad).encode()})
  assert await pmx.locator('#pmxReview').count()==0
  assert len(writes)==1 and len(reads)==1
  # Forged receiver snapshots fail and the URL fragment is scrubbed.
  await pmx.goto(BASE+'/pmx-import.html#snapshot='+__import__('urllib.parse',fromlist=['quote']).quote(json.dumps(bad)))
  await pmx.locator('#pmxImportStatus').filter(has_text='허용되지').wait_for()
  assert await pmx.evaluate('location.hash')==''
  assert len(writes)==1
  await browser.close()
  print('PMX favorite browser: noopener/COOP, one same-origin read, whitelist, fragment scrubbing, explicit review, cross-workspace rejection, malicious messages/files and screenshot flow passed')

asyncio.run(main())
