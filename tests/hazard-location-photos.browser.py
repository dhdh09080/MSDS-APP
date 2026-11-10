"""Phone uploads, issue assignment and review UI with synthetic API responses."""
import asyncio, json, os, struct, zlib
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright
BASE=os.environ.get('BASE_URL','http://localhost:3000')
OUT=Path('work/location-photo-preview')
def png(w=1200,h=700):
 def c(k,b):return struct.pack('!I',len(b))+k+b+struct.pack('!I',zlib.crc32(k+b))
 return b'\x89PNG\r\n\x1a\n'+c(b'IHDR',struct.pack('!IIBBBBB',w,h,8,2,0,0,0))+c(b'IDAT',zlib.compress((b'\0'+bytes([215,225,235])*w)*h))+c(b'IEND',b'')
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 maps=[dict(id='map',workspace_id='preview-workspace',title='PIT층 도면',storage_path='fixture.png',width=1200,height=700)]
 markers=[]; photos=[]; errors=[]; calls=[]; failed=False
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':390,'height':844},has_touch=True)
  page.on('pageerror',lambda error:errors.append(str(error)))
  page.on('dialog',lambda d:d.accept())
  async def api(route):
   nonlocal failed
   req=route.request; u=urlparse(req.url); q=parse_qs(u.query)
   if '/storage/v1/object/sign/' in u.path:
    if req.method=='POST':return await route.fulfill(json={'signedURL':u.path.replace('/storage/v1','')+'?token=fixture'})
    return await route.fulfill(content_type='image/png',body=png())
   if '/storage/v1/object/hazard-location-photos/' in u.path:
    calls.append(req.post_data_buffer)
    return await route.fulfill(json={'Key':u.path})
   if u.path.endswith('/storage/v1/object/hazard-location-photos'):return await route.fulfill(json=[])
   body=json.loads(req.post_data or '{}')
   if u.path.endswith('/rpc/review_hazard_marker'):
    marker=markers[0]
    assert body['p_photo_revision']==marker['photo_revision']
    if not photos:return await route.fulfill(status=400,json={'message':'조치 사진을 먼저 등록해 주세요.'})
    marker.update(review_status=body['p_status'],review_note=body['p_note'],reviewed_by='preview-user',reviewed_at='2026-11-10T01:00:00Z')
    return await route.fulfill(json=marker)
   if u.path.endswith('/hazard_maps'):return await route.fulfill(json=maps)
   if u.path.endswith('/hazard_markers'):
    if req.method=='GET':return await route.fulfill(json=markers)
    if req.method=='POST':
     marker=dict(body,id=f'marker-{len(markers)}',photo_revision=0,review_status='open');markers.append(marker);return await route.fulfill(json=marker)
    marker=next(m for m in markers if q['id'][0]=='eq.'+m['id']);marker.update(body);return await route.fulfill(json=marker)
   if u.path.endswith('/hazard_location_photos'):
    if req.method=='GET':return await route.fulfill(json=[r for r in photos if q.get('marker_id',['eq.'+r['marker_id']])[0]=='eq.'+r['marker_id']])
    if req.method=='POST':
     if body['note']=='fail-once' and not failed:
      failed=True;return await route.fulfill(status=500,json={'message':'일시적인 저장 실패'})
     photo=dict(body,id=f'photo-{len(photos)}',created_at='2026-11-10T01:00:00Z');photos.append(photo)
     marker=next(m for m in markers if m['id']==photo['marker_id']);marker.update(photo_revision=marker['photo_revision']+1,review_status='pending' if photo['kind']=='remedy' else 'open',reviewed_at=None)
     return await route.fulfill(json=photo)
   return await route.fulfill(json=[])
  await page.route('**/*.supabase.co/**',api)
  await page.goto(BASE+'/?preview=hazard-map')
  await page.locator('#hmPhoto').wait_for()
  await page.locator('[data-action=add]').click()
  form=page.locator('#hmMarkerForm')
  await form.locator('[name=marker_type]').select_option('issue')
  assert await form.locator('[name=contractor_id]').is_visible()
  assert not await page.locator('#hmStorageFields').is_visible()
  name='PIT층 동측 자재 반입 통로 적치물 정리 및 추락 위험 구간 안전난간 보완 필요'
  await form.locator('[name=storage_name]').fill(name)
  await form.locator('[name=contractor_id]').select_option('con-3')
  await form.locator('[name=content]').fill('위치별 발견 사진과 조치 사진을 확인해 주세요.')
  assert await form.locator('[name=add_photos]').count()==0
  assert await form.locator('[data-draft-camera-input]').get_attribute('capture')=='environment'
  await form.locator('[data-draft-note]').fill('발견 현장 기록')
  await form.locator('[data-draft-album-input]').set_input_files([{'name':'inline.png','mimeType':'image/png','buffer':png()},{'name':'remove.png','mimeType':'image/png','buffer':png()}])
  assert len(photos)==0 and len(calls)==0, 'Selection uploaded before the sticker was saved'
  await form.locator('[data-remove-photo]').nth(1).click()
  assert await form.locator('[data-draft-previews] figure').count()==1
  await form.locator('[data-draft-note]').fill('fail-once')
  await form.locator('[data-draft-camera-input]').set_input_files({'name':'retry.png','mimeType':'image/png','buffer':png()})
  assert await form.locator('[data-draft-previews] figure').count()==2
  await page.screenshot(path=str(OUT/'inline-photos-mobile.png'))
  await form.locator('button[type=submit]').click()
  await form.locator('.hm-form-error').get_by_text('실패한 사진만 남아 있습니다.',exact=False).wait_for()
  assert len(markers)==1 and len(photos)==1
  assert await form.locator('[data-draft-previews] figure').count()==1
  assert 'retry.png' in await form.locator('[data-draft-previews]').inner_text()
  await form.locator('button[type=submit]').click()
  await page.locator('#hmMarkerDialog').wait_for(state='hidden')
  assert len(markers)==1 and len(photos)==2, 'Retry duplicated sticker or successful photos'
  assert markers[0]['marker_type']=='issue' and markers[0]['contractor_id']=='con-3'
  pin=page.locator('.hm-pin span')
  assert await pin.inner_text()==name
  assert await pin.evaluate("e=>getComputedStyle(e).textOverflow!=='ellipsis' && e.scrollHeight<=e.clientHeight+1")
  assert await page.locator('.lp-dialog').count()==0
  await page.locator('[data-action=photos]').click()
  modal=page.locator('.lp-dialog')
  await modal.locator('[data-camera]:not([disabled])').wait_for()
  assert await modal.locator('[data-camera-input]').get_attribute('capture')=='environment'
  assert await modal.locator('[data-album-input]').get_attribute('multiple') is not None
  assert await modal.locator('[data-review=verified]').is_disabled()
  assert '조치 사진이 등록되면' in await modal.locator('[data-review-hint]').inner_text()
  await modal.locator('[data-kind]').select_option('finding')
  await modal.locator('[data-note]').fill('<img src=x onerror=alert(1)> 발견 사진')
  await modal.locator('[data-album-input]').set_input_files([{'name':'finding.png','mimeType':'image/png','buffer':png(4000,2200)},{'name':'bad.txt','mimeType':'text/plain','buffer':b'bad'}])
  await modal.locator('[data-message]').get_by_text('1장 저장 완료',exact=False).wait_for()
  assert len(photos)==3 and len(calls)==4
  assert await modal.locator('[data-message]').get_by_text('실패 1장',exact=False).is_visible()
  assert await modal.locator('figcaption img').count()==0
  await modal.locator('[data-kind]').select_option('remedy')
  await modal.locator('[data-note]').fill('조치 완료')
  await modal.locator('[data-album-input]').set_input_files([{'name':'after1.png','mimeType':'image/png','buffer':png()},{'name':'after2.png','mimeType':'image/png','buffer':png()}])
  await modal.locator('[data-message]').get_by_text('2장 저장 완료',exact=False).wait_for()
  await modal.locator('[data-camera]:not([disabled])').wait_for()
  await modal.locator('[data-photo-filter=remedy]').click()
  assert await modal.locator('.lp-gallery figure').count()==2
  await modal.locator('[data-photo-filter=finding]').click()
  assert await modal.locator('.lp-gallery figure').count()==3
  await modal.locator('[data-photo-filter=all]').click()
  await page.screenshot(path=str(OUT/'photo-dialog-mobile.png'))
  assert markers[0]['review_status']=='pending'
  await modal.locator('[data-review-note]').fill('안전팀 현장 확인 완료')
  await modal.locator('[data-review=verified]').click()
  await modal.locator('[data-message]').get_by_text('관리자 확인 상태를 저장했습니다.',exact=True).wait_for()
  assert markers[0]['review_status']=='verified'
  await modal.locator('[data-review-note]').fill('PIT 통로 추가 정리 필요')
  await modal.locator('[data-review=open]').click()
  await page.wait_for_function("document.querySelector('.hm-review-status')?.textContent.includes('조치 전')")
  assert markers[0]['review_note']=='PIT 통로 추가 정리 필요'
  # Camera input uses exactly the same preparation/storage path as the album.
  await modal.locator('[data-camera-input]').set_input_files({'name':'camera.png','mimeType':'image/png','buffer':png()})
  await modal.locator('[data-message]').get_by_text('1장 저장 완료',exact=False).wait_for()
  await modal.locator('[data-close]:not([disabled])').click()
  await page.reload();await page.locator('[data-action=photos]').click()
  await modal.locator('[data-camera]:not([disabled])').wait_for()
  assert await modal.locator('.lp-gallery figure').count()==6
  await modal.locator('[data-close]').click()
  await page.locator('[data-action=add]').click()
  await form.locator('[data-draft-album-input]').set_input_files({'name':'cancel.png','mimeType':'image/png','buffer':png()})
  before=len(calls)
  await form.locator('[data-close]').click()
  await page.locator('[data-action=add]').click()
  assert await form.locator('[data-draft-previews] figure').count()==0
  assert len(calls)==before
  await form.locator('[data-close]').click()
  for width in [360,390,768,1440]:
   await page.set_viewport_size({'width':width,'height':960})
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
   await page.screenshot(path=str(OUT/f'location-{width}.png'),full_page=True)
  # Verify the actual encoder bounds large phone photos before network upload.
  import base64
  b64=base64.b64encode(png(4000,2200)).decode()
  dims=await page.evaluate('''async b64=>{const {prepareLocationPhoto}=await import('/src/lib/location-photos.js');const file=new File([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],'large.png',{type:'image/png'});const blob=await prepareLocationPhoto(file);const image=await createImageBitmap(blob);return [image.width,image.height,blob.type]}''',b64)
  assert dims==[2000,1100,'image/jpeg'],dims
  assert not errors,errors
  await browser.close()
 print('PASS: PIT issue/contractor assignment, complete long labels, camera and multi-photo uploads, compression, partial failure, XSS escaping, review/rework persistence and 360/390/768/1440px')
asyncio.run(main())
