"""Workspace navigation, representative contacts and shared hazard editing; synthetic data only."""
import asyncio,json,os,struct,zlib
from pathlib import Path
from playwright.async_api import async_playwright
BASE=os.environ.get('BASE_URL','http://localhost:3007');OUT=Path(os.environ.get('PORTAL_ARTIFACT_DIR','work/workspace-preview'))
WS='10000000-0000-4000-8000-000000000001';CON='20000000-0000-4000-8000-000000000002';MID='30000000-0000-4000-8000-000000000003'
def png():
 def chunk(k,b):return struct.pack('!I',len(b))+k+b+struct.pack('!I',zlib.crc32(k+b))
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!IIBBBBB',1000,600,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+bytes([218,229,222])*1000)*600))+chunk(b'IEND',b'')
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 contacts=[dict(id='contact-a',name='김관리',phone='010-1111-1111',is_primary=True)]
 maps=[dict(id=MID,workspace_id=WS,title='현장 전경',storage_path='fixture.png',width=1000,height=600)]
 markers=[dict(id='marker-own',workspace_id=WS,map_id=MID,contractor_id=CON,x=.4,y=.5,storage_name='동측 위험물 저장소',marker_type='hazard',items=[dict(name='신나',quantity='20 L')],access_code='1234',content='화기 엄금'),dict(id='marker-common',workspace_id=WS,map_id=MID,contractor_id=None,x=.8,y=.8,storage_name='정문',marker_type='gate',items=[],content='')]
 writes=[];errors=[];workers=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await browser.new_page(viewport=dict(width=1440,height=1050));page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
  async def api(route):
   data=json.loads(route.request.post_data or '{}');url=route.request.url
   if 'get_contractor_portal' in url:return await route.fulfill(json=dict(workspace=dict(id=WS,name='성동자이리버뷰'),contractor=dict(id=CON,name='대한건설'),public_link=None,work_types=[dict(id='trade1',name='골조')],license=None,records=[dict(id='record1',product_name='수성도료',work_type='골조',pdf_name='수성도료.pdf')]))
   if 'get_public_reupload_requests' in url:return await route.fulfill(json=[])
   if 'get_contractor_workspace' in url:return await route.fulfill(json=dict(contacts=contacts,worker_site_code='070120'))
   if 'save_contractor_contact' in url:
    assert data['p_token']=='workspace-fixture-token' and data['p_contractor_id']==CON
    contact=next((c for c in contacts if c['id']==data.get('p_contact_id')),None)
    if data['p_action']=='delete':contacts.remove(contact)
    elif data['p_action']=='primary':
     for c in contacts:c['is_primary']=c is contact
    else:
     if not contact:contact=dict(id='contact-b',is_primary=False);contacts.append(contact)
     contact.update(name=data['p_name'],phone=data['p_phone'])
     if data['p_primary']:
      for c in contacts:c['is_primary']=c is contact
    contacts.sort(key=lambda c:not c['is_primary']);writes.append(('contact',data));return await route.fulfill(json=dict(contacts=contacts,worker_site_code='070120'))
   if 'get_contractor_workers' in url:return await route.fulfill(json=workers)
   if 'save_contractor_worker' in url:
    assert data['p_contractor_id']==CON
    worker=next((w for w in workers if w['id']==data.get('p_worker_id')),None)
    if data['p_action']=='delete':workers.remove(worker)
    else:
     if not worker:worker=dict(id='worker-1');workers.append(worker)
     worker.update(name=data['p_name'],phone_last4=data['p_phone_last4'],job=data['p_job'],registered_on=data['p_registered_on'])
    writes.append(('worker',data));return await route.fulfill(json=workers)
   if 'get_contractor_hazard_maps' in url:
    assert data['p_contractor_id']==CON
    return await route.fulfill(json=dict(maps=maps,markers=markers if data.get('p_map_id') else []))
   if '/functions/v1/contractor-map-photo' in url:
    assert data['contractor_id']==CON and data['map_id']==MID and data['token']=='workspace-fixture-token'
    return await route.fulfill(json=dict(signed_url=BASE+'/fixture-panorama.png'))
   if 'save_contractor_hazard_marker' in url:
    assert data['p_contractor_id']==CON and data['p_map_id']==MID
    row=next((m for m in markers if m['id']==data['p_marker_id']),None)
    assert not row or row['contractor_id']==CON
    if data['p_action']=='delete':markers.remove(row);return await route.fulfill(json=dict(id=row['id']))
    if row:row.update(data['p_values'])
    else:row=dict(data['p_values'],id='marker-new',contractor_id=CON);markers.append(row)
    writes.append(('marker',data));return await route.fulfill(json=row)
   return await route.fulfill(status=400,json=dict(message='Unexpected request'))
  await page.route('**/*.supabase.co/**',api)
  await page.route('**/fixture-panorama.png',lambda route:route.fulfill(content_type='image/png',body=png()))
  await page.route('https://pmx-worker-change.vercel.app/**',lambda route:route.fulfill(content_type='text/html',body='<h1>근로자 정보변경 신청</h1>'))
  await page.goto(BASE+'/upload.html?token=workspace-fixture-token')
  await page.locator('#dashboardPanel').wait_for(state='visible')
  await page.locator('#dashboardContact a').wait_for()
  assert '대한건설, 오늘 하루도 좋은 하루 되세요!' in await page.locator('#dashboardPanel').inner_text()
  assert await page.get_by_role('tablist').count()==0
  assert await page.locator('#contractorWorkspaceSidebar button[data-workspace-nav]').count()==9
  await page.screenshot(path=str(OUT/'dashboard-desktop.png'),full_page=True)
  await page.locator('#recordsTab').click();assert await page.locator('#uploadPanel').is_visible()
  await page.locator('nav [data-workspace-nav=contacts]').click()
  await page.locator('#cwContactName').fill('이관리');await page.locator('#cwContactPhone').fill('010-2222-2222');await page.locator('#cwContactPrimary').check();await page.locator('#cwContactSave').click()
  await page.wait_for_function('document.querySelectorAll(".cw-contact").length===2')
  assert '이관리' in await page.locator('.cw-contact').first.inner_text()
  await page.locator('.cw-contact').nth(1).get_by_role('button',name='대표로 설정').click()
  await page.wait_for_function('document.querySelector(".cw-contact").textContent.includes("김관리")')
  await page.wait_for_function('document.querySelectorAll("#toastWrap .toast").length===0')
  await page.screenshot(path=str(OUT/'contacts-desktop.png'),full_page=True)
  await page.locator('.cw-contact').first.get_by_role('button',name='수정',exact=True).click()
  await page.locator('#cwContactPhone').fill('02-123-4567');await page.locator('#cwContactSave').click()
  await page.locator('.cw-contact').first.get_by_role('link',name='02-123-4567').wait_for()
  await page.locator('nav [data-workspace-nav=dashboard]').click();assert '02-123-4567' in await page.locator('#dashboardContact').inner_text()
  await page.locator('nav [data-workspace-nav=hazard]').click();await page.wait_for_function('document.querySelector("#hmPhoto")?.naturalWidth>0')
  assert not await page.locator('#hmUpload').is_visible()
  assert not await page.locator('[data-action=replace-photo]').is_visible()
  assert await page.locator('.hm-storage-card').nth(1).get_by_role('button').count()==0
  await page.locator('.hm-storage-card').first.get_by_role('button',name='정보 수정').click()
  await page.locator('#hmMarkerForm [name=storage_name]').fill('수정된 우리 저장소')
  await page.locator('#hmMarkerForm [name=item_quantity]').fill('40 L')
  await page.locator('#hmMarkerForm button[type=submit]').click();await page.locator('#hmMarkerDialog').wait_for(state='hidden')
  assert markers[0]['storage_name']=='수정된 우리 저장소' and markers[0]['items'][0]['quantity']=='40 L'
  await page.wait_for_function('document.querySelectorAll("#toastWrap .toast").length===0')
  await page.screenshot(path=str(OUT/'hazard-desktop.png'),full_page=True)
  await page.locator('nav [data-workspace-nav=workers]').click()
  await page.locator('#cwWorkerName:not([disabled])').fill('홍근로')
  await page.locator('#cwWorkerPhone4').fill('4321');await page.locator('#cwWorkerJob').fill('형틀목공');await page.locator('#cwWorkerSave').click()
  await page.wait_for_function('document.querySelector("#cwWorkerList").textContent.includes("홍근로")')
  assert workers[0]['phone_last4']=='4321'
  await page.locator('#cwWorkerSearch').fill('없는이름');assert '검색 결과가 없습니다' in await page.locator('#cwWorkerList').inner_text()
  await page.locator('#cwWorkerSearch').fill('')
  await page.wait_for_function('document.querySelectorAll("#toastWrap .toast").length===0')
  await page.screenshot(path=str(OUT/'workers-desktop.png'),full_page=True)
  await page.locator('#cwWorkerList').get_by_role('button',name='수정',exact=True).click();await page.locator('#cwWorkerJob').fill('철근공');await page.locator('#cwWorkerSave').click()
  await page.wait_for_function('document.querySelector("#cwWorkerList").textContent.includes("철근공")')
  await page.locator('#cwWorkerList').get_by_role('button',name='정보변경 신청',exact=True).click()
  assert await page.locator('#cwWorkerChangeLink').get_attribute('href')=='https://pmx-worker-change.vercel.app/?site=070120'
  await page.wait_for_function('document.querySelector("#cwWorkerChangeFrame").src.endsWith("?site=070120")')
  assert 'token' not in await page.locator('#cwWorkerChangeFrame').get_attribute('src')
  for width in [390,768]:
   await page.set_viewport_size(dict(width=width,height=900))
   await page.locator('#cwMenuToggle').click();assert await page.locator('#cwMenuToggle').get_attribute('aria-expanded')=='true'
   await page.locator('nav [data-workspace-nav=dashboard]').click()
   assert await page.locator('#cwMenuToggle').get_attribute('aria-expanded')=='false'
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   if width==390:await page.screenshot(path=str(OUT/'dashboard-mobile.png'),full_page=True)
  assert not errors,errors
  assert len(writes)>=3
  await browser.close();print('PASS: sidebar/home greeting, contacts primary/edit persistence UI, shared hazard edit/read-only landmark, scoped image signing, site code external link, mobile navigation; no JS errors')
asyncio.run(main())
