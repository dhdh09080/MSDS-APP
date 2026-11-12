"""Mobile partner upload priority and camera picker; synthetic APIs only."""
import asyncio,os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
BASE=os.environ.get('BASE_URL','http://localhost:3001')
OUT=Path(os.environ.get('PORTAL_ARTIFACT_DIR','work/mobile-portal'));OUT.mkdir(parents=True,exist_ok=True)
WS='10000000-0000-4000-8000-000000000001';CON='20000000-0000-4000-8000-000000000002'
DATA={'workspace':{'id':WS,'name':'모바일 시험 현장'},'contractor':{'id':CON,'name':'시험업체'},'public_link':None,'license':None,'work_types':[{'id':'trade1','name':'도장'},{'id':'trade2','name':'전기'}],'records':[{'id':f'fixture-{i}','product_name':f'등록 자료 {i}','work_type':'도장','pdf_name':f'자료{i}.pdf','pdf_path':f'{WS}/fixture-{i}.pdf'} for i in range(50)]}
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);errors=[]
  for width in [360,390,768,1440]:
   page=await b.new_page(viewport={'width':width,'height':844},is_mobile=width<=768,has_touch=width<=768)
   page.on('pageerror',lambda e:errors.append(str(e)))
   async def api(r):
    if urlparse(r.request.url).hostname in ['localhost','127.0.0.1']:return await r.continue_()
    if 'get_contractor_portal' in r.request.url:return await r.fulfill(json=DATA)
    return await r.fulfill(json=[])
   await page.route('**/*',api)
   await page.goto(BASE+'/upload.html?token=mobile-fixture-token&panel=upload')
   await page.locator('#uploadPanel').wait_for(state='visible')
   assert await page.locator('#uploadExistingList .document-row').count()==50
   if width<=768:
    assert await page.locator('#uploadExistingList').is_hidden()
    assert await page.locator('#uploadPanel .portal-compliance').is_hidden()
    assert (await page.locator('.worktype-btn').first.bounding_box())['y']<550
    assert await page.locator('#portalCameraInput').get_attribute('capture')=='environment'
    async with page.expect_file_chooser() as picker:
     await page.locator('[data-upload-input=portalCameraInput]').click()
    await (await picker.value).set_files({'name':'촬영사진.png','mimeType':'image/png','buffer':b'synthetic-image'})
    assert await page.locator('.file-item').count()==1
    assert '촬영사진.png' in await page.locator('.file-item').inner_text()
    await page.locator('#portalExistingDetails > summary').click()
    await page.locator('#uploadExistingSearch').fill('등록 자료 49')
    assert await page.locator('#uploadExistingList .document-row').count()==1
    await page.evaluate('refreshPortalRecords()')
    assert await page.locator('.file-item').count()==1
    assert await page.locator('#uploadExistingSearch').input_value()=='등록 자료 49'
    await page.locator('#portalLegalDetails > summary').click()
    assert '1차 100만원' in await page.locator('#uploadPanel .portal-compliance').inner_text()
    await page.set_viewport_size({'width':1440,'height':844})
    await page.locator('#uploadPanel .portal-compliance').wait_for(state='visible')
    assert await page.locator('.file-item').count()==1
    assert await page.locator('#fileInput').count()==1
    await page.set_viewport_size({'width':width,'height':844})
   else:
    assert await page.locator('#uploadExistingList').is_visible()
    assert await page.locator('#uploadPanel .portal-compliance').is_visible()
   assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
   await page.screenshot(path=str(OUT/f'upload-{width}.png'))
   await page.close()
  assert not errors,errors
  await b.close();print('PASS: 50-record mobile upload first, disclosure search/legal information, camera picker, queue and input retention, 360/390/768/1440px')
asyncio.run(main())
