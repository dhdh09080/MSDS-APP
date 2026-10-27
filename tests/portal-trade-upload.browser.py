"""Trade drops, reassignment and partial-failure retry using synthetic API responses."""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright
BASE=os.environ.get('BASE_URL','http://localhost:3006')
OUT=Path(os.environ.get('PORTAL_ARTIFACT_DIR','work/trade-upload'))
WS='10000000-0000-4000-8000-000000000001'; CON='20000000-0000-4000-8000-000000000002'
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await browser.new_page(viewport=dict(width=1440,height=1100)); errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  trades=[]; records=[dict(id='30000000-0000-4000-8000-000000000003',product_name='수성 도료',work_type='도장',pdf_name='수성도료.pdf',pdf_path='fixture.pdf')]
  saved=[];failed=set()
  async def api(route):
   nonlocal failed
   req=route.request; data=json.loads(req.post_data or '{}') if '/storage/' not in req.url else {}
   if 'get_contractor_portal' in req.url:return await route.fulfill(json=dict(workspace=dict(id=WS,name='서울 신축현장'),contractor=dict(id=CON,name='안전건설'),work_types=trades,records=records,license=None,public_link=None))
   if 'get_public_reupload_requests' in req.url:return await route.fulfill(json=[])
   if 'register_contractor_work_type' in req.url:
    assert data['p_token']=='trade-fixture-token' and data['p_contractor_id']==CON
    if data['p_name']=='실패':return await route.fulfill(status=400,json=dict(message='연결 오류'))
    row=next((t for t in trades if t['name']==data['p_name']),None)
    if not row: row=dict(id=str(len(trades)+1),name=data['p_name']);trades.append(row)
    return await route.fulfill(json=row)
   if '/storage/v1/object/' in req.url:
    await asyncio.sleep(.15)
    return await route.fulfill(json=dict(Key='fixture'))
   if '/rest/v1/msds_records' in req.url:
    if data['pdf_name'] in ['retry.pdf','allfail.pdf'] and data['pdf_name'] not in failed:
     failed.add(data['pdf_name']);return await route.fulfill(status=400,json=dict(message='일시적 저장 실패'))
    saved.append(data);records.insert(0,data);return await route.fulfill(status=201,body='')
   return await route.fulfill(status=400,json=dict(message='Unexpected request'))
  await page.route('**/*.supabase.co/**',api)
  async def drop(index,name,mime='application/pdf'):
   await page.locator(f'[data-trade-index="{index}"]').evaluate('''(zone,args)=>{const dt=new DataTransfer();dt.items.add(new File(['fixture'],args.name,{type:args.mime}));zone.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));}''',dict(name=name,mime=mime))
  await page.goto(BASE+'/upload.html?token=trade-fixture-token&panel=upload')
  await page.locator('#uploadPanel').wait_for(state='visible')
  assert await page.locator('.trade-drop-zone').count()==1
  assert '미지정' in await page.locator('.trade-drop-zone').inner_text()
  for name in ['도장','전기']:
   await page.locator('#portalWorkTypeName').fill(name);await page.locator('#portalWorkTypeAdd').click()
   await page.wait_for_function('(n)=>document.querySelector("#selectedWorktypeLabel").textContent===n',arg=name)
  await page.locator('#portalWorkTypeName').fill('실패');await page.locator('#portalWorkTypeAdd').click()
  await page.locator('#portalWorkTypeError').get_by_text('공종 추가 실패:',exact=False).wait_for()
  assert await page.locator('.trade-drop-zone').count()==2
  await page.reload();await page.locator('#uploadPanel').wait_for(state='visible')
  assert await page.locator('.trade-drop-zone').count()==2
  left=await page.locator('.upload-existing-records').bounding_box();right=await page.locator('#uploadViewHost').bounding_box()
  assert left['x']+left['width']<=right['x']
  await drop(0,'도장자료.pdf');await drop(1,'전기자료.pdf');await drop(1,'retry.pdf')
  await page.wait_for_function('!document.querySelector("#uploadBtn").disabled')
  assert await page.locator('.file-item').count()==3
  await page.locator('.file-item').first.drag_to(page.locator('[data-trade-index="1"]'))
  assert '전기' in await page.locator('.file-item .fi-trade').first.inner_text()
  await drop(0,'추가도료.pdf')
  await drop(0,'제외.txt','text/plain')
  assert await page.locator('.file-item').count()==4
  await page.locator('#toastWrap .toast').wait_for(state='detached')
  await page.evaluate('window.scrollTo(0,0)')
  await page.screenshot(path=str(OUT/'desktop.png'),full_page=True)
  for width in [390,768]:
   await page.set_viewport_size(dict(width=width,height=1000));assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   if width==390: await page.screenshot(path=str(OUT/'mobile.png'),full_page=True)
  await page.set_viewport_size(dict(width=1440,height=1100))
  await page.locator('#uploadBtn').click()
  await page.wait_for_selector('.file-item.uploading')
  await drop(0,'업로드중차단.pdf')
  assert await page.locator('.file-item').count()==4
  await page.locator('#stepView3').wait_for(state='visible')
  assert len(saved)==3
  assert [r['work_type'] for r in saved]==['전기','전기','도장']
  assert await page.locator('#uploadExistingList .document-row').count()==4
  assert await page.locator('#retryFailedBtn').is_visible()
  await page.locator('#retryFailedBtn').click()
  assert await page.locator('.file-item').count()==1
  assert '전기' in await page.locator('.file-item .fi-trade').inner_text()
  await page.locator('#uploadBtn').click();await page.locator('#stepView3').wait_for(state='visible')
  assert len(saved)==4 and saved[-1]['pdf_name']=='retry.pdf' and saved[-1]['work_type']=='전기'
  assert all(r['contractor']=='안전건설' for r in saved)
  await page.get_by_role('button',name='추가 파일 업로드',exact=False).click()
  assert await page.locator('#stepView1').is_visible() and await page.locator('#stepView2').is_visible()
  assert await page.locator('.file-item').count()==0
  await drop(0,'allfail.pdf')
  await page.locator('#uploadBtn:not([disabled])').click()
  await page.locator('.file-item.error').wait_for()
  await page.get_by_role('button',name='재시도',exact=True).click()
  await page.locator('#uploadBtn:not([disabled])').click()
  await page.locator('#stepView3').wait_for(state='visible')
  assert saved[-1]['pdf_name']=='allfail.pdf' and saved[-1]['work_type']=='도장'
  assert not errors,errors
  await browser.close();print('PASS: left/right layout, persisted trade additions, failure message, no-trade fallback, drops per trade, reassignment, invalid type, busy guard, partial retry, refreshed list, mobile and reset')
asyncio.run(main())
