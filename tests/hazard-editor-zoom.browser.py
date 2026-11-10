"""Real wheel, mouse and CDP pinch/tap gestures over the editable drawing."""
import asyncio,json,os,struct,zlib
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from playwright.async_api import async_playwright
BASE=os.environ.get('BASE_URL','http://localhost:3000');OUT=Path('work/editor-zoom-preview')
def png(w=1800,h=1200):
 def c(k,b):return struct.pack('!I',len(b))+k+b+struct.pack('!I',zlib.crc32(k+b))
 return b'\x89PNG\r\n\x1a\n'+c(b'IHDR',struct.pack('!IIBBBBB',w,h,8,2,0,0,0))+c(b'IDAT',zlib.compress((b'\0'+bytes([215,225,230])*w)*h))+c(b'IEND',b'')
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 markers=[dict(id='pin1',workspace_id='preview-workspace',map_id='drawing',x=.3,y=.3,storage_name='103동',marker_type='building',content='',items=[],review_status='none')]
 maps=[dict(id='drawing',workspace_id='preview-workspace',title='편집 가능한 PIT 도면',storage_path='plan.png',width=1800,height=1200)]
 writes=[];errors=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await browser.new_page(viewport=dict(width=1440,height=1100),has_touch=True)
  page.on('pageerror',lambda e:errors.append(str(e)))
  async def api(route):
   req=route.request;u=urlparse(req.url);q=parse_qs(u.query)
   if '/storage/v1/object/sign/' in u.path:
    if req.method=='POST':return await route.fulfill(json={'signedURL':'/object/sign/hazard-map-photos/plan.png?token=fixture'})
    return await route.fulfill(content_type='image/png',body=png())
   if u.path.endswith('/hazard_maps'):return await route.fulfill(json=maps)
   if u.path.endswith('/hazard_markers'):
    if req.method=='GET':return await route.fulfill(json=markers)
    body=req.post_data_json;writes.append((req.method,body))
    if req.method=='POST':
     row=dict(body,id=f'pin{len(markers)+1}',review_status='none');markers.append(row)
    else:row=next(m for m in markers if q['id'][0]=='eq.'+m['id']);row.update(body)
    return await route.fulfill(json=row)
   return await route.fulfill(json=[])
  await page.route('**/*.supabase.co/**',api)
  await page.goto(BASE+'/?preview=hazard-map')
  await page.wait_for_function('document.querySelector("#hmPhoto")?.naturalWidth>0')
  vp=page.locator('.hm-editor-viewport');photo=page.locator('#hmPhoto')
  async def vpbox():await vp.evaluate("e=>e.scrollIntoView({block:'center'})");return await vp.bounding_box()
  async def ratio():return await photo.evaluate('e=>e.getBoundingClientRect().width/e.offsetWidth')
  async def add_at(client_x,client_y,text,touch=False):
   box=await photo.bounding_box();expected=((client_x-box['x'])/box['width'],(client_y-box['y'])/box['height'])
   if touch:await page.touchscreen.tap(client_x,client_y)
   else:await page.mouse.click(client_x,client_y)
   form=page.locator('#hmMarkerForm');await form.wait_for(state='visible')
   await form.locator('[name=marker_type]').select_option('memo');await form.locator('[name=content]').fill(text)
   await form.locator('button[type=submit]').click();await form.wait_for(state='hidden')
   assert abs(markers[-1]['x']-expected[0])<.003 and abs(markers[-1]['y']-expected[1])<.003,(markers[-1],expected)
  box=await vpbox();await page.mouse.move(box['x']+box['width']*.6,box['y']+box['height']*.55);await page.mouse.wheel(0,-350)
  await page.wait_for_function('Number(document.querySelector("[data-editor-zoom-value]").textContent.replace("%",""))>150')
  assert await ratio()>1.8
  pin=await page.locator('.hm-pin[data-id=pin1]').bounding_box();image=await photo.bounding_box()
  assert abs(pin['x']+pin['width']/2-image['x']-image['width']*.3)<2
  assert abs(pin['y']+pin['height']/2-image['y']-image['height']*.3)<2
  await add_at(box['x']+box['width']*.62,box['y']+box['height']*.54,'휠 확대 후 정확한 위치에 붙인 메모')
  assert await ratio()>1.8,'Saving lost the zoom level'
  box=await vpbox();old=await photo.bounding_box();before=len(writes)
  await page.mouse.move(box['x']+box['width']*.8,box['y']+box['height']*.8);await page.mouse.down(button='middle');await page.mouse.move(box['x']+box['width']*.8+50,box['y']+box['height']*.8+40,steps=6);await page.mouse.up(button='middle')
  moved=await photo.bounding_box();assert abs(moved['x']-old['x']-50)<2
  assert len(writes)==before and not await page.locator('#hmMarkerDialog').is_visible()
  # Move a sticker at the current zoom: screen deltas must be divided by scaled image size.
  pin=await page.locator('.hm-pin[data-id=pin2]').bounding_box();image=await photo.bounding_box();old=dict(markers[1])
  await page.mouse.move(pin['x']+pin['width']/2,pin['y']+pin['height']/2);await page.mouse.down();await page.mouse.move(pin['x']+pin['width']/2+30,pin['y']+pin['height']/2+20,steps=6);await page.mouse.up()
  await page.wait_for_function('!document.querySelector(".hm-pin.is-dragging")')
  assert abs(markers[1]['x']-old['x']-30/image['width'])<.004
  assert abs(markers[1]['y']-old['y']-20/image['height'])<.004
  await page.locator('[data-editor-zoom=fit]').click();await page.set_viewport_size(dict(width=390,height=1000))
  await page.wait_for_function('Math.abs(document.querySelector(".hm-editor-viewport").clientHeight-document.querySelector("#hmPhoto").offsetHeight)<2')
  if await page.locator('#toastWrap .toast').count():await page.locator('#toastWrap .toast').last.wait_for(state='detached')
  box=await vpbox();cdp=await page.context.new_cdp_session(page)
  cx=box['x']+box['width']*.55;cy=box['y']+box['height']*.6;before=len(writes)
  def pts(dist,dx=0,dy=0):return [dict(id=1,x=cx+dist/2+dx,y=cy+dy),dict(id=2,x=cx-dist/2+dx,y=cy+dy)]
  await cdp.send('Input.dispatchTouchEvent',dict(type='touchStart',touchPoints=pts(45)))
  await cdp.send('Input.dispatchTouchEvent',dict(type='touchMove',touchPoints=pts(110)))
  await cdp.send('Input.dispatchTouchEvent',dict(type='touchEnd',touchPoints=[]))
  await page.wait_for_function('Number(document.querySelector("[data-editor-zoom-value]").textContent.replace("%",""))>200')
  assert await ratio()>2
  assert len(writes)==before and not await page.locator('#hmMarkerDialog').is_visible(),'Pinching created/moved a sticker'
  old_image=await photo.bounding_box()
  await cdp.send('Input.dispatchTouchEvent',dict(type='touchStart',touchPoints=pts(60)))
  await cdp.send('Input.dispatchTouchEvent',dict(type='touchMove',touchPoints=pts(60,20,10)))
  await cdp.send('Input.dispatchTouchEvent',dict(type='touchEnd',touchPoints=[]))
  await page.wait_for_function('(old)=>document.querySelector("#hmPhoto").getBoundingClientRect().left>old+15',arg=old_image['x'])
  assert len(writes)==before and not await page.locator('#hmMarkerDialog').is_visible()
  box=await vpbox();await add_at(box['x']+box['width']*.2,box['y']+box['height']*.85,'두 손가락 확대 후 터치로 등록',touch=True)
  assert await ratio()>2
  await page.screenshot(path=str(OUT/'mobile-edit-zoom.png'))
  await page.reload();await page.wait_for_function('document.querySelector("#hmPhoto")?.naturalWidth>0')
  assert await page.locator('.hm-pin').count()==3
  assert not errors,errors
  await browser.close()
 print('PASS: editable wheel zoom, scaled image/sticker alignment, middle-button panning without writes, accurate add/drag at zoom, CDP pinch without ghost stickers, touch placement, zoom retention and reload')
asyncio.run(main())
