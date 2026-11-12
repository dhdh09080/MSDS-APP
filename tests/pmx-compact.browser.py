"""Compact PMX card, overflow accessibility, first-use guidance and screenshots."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
OUT=Path('work/screenshots');OUT.mkdir(exist_ok=True,parents=True)
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  ctx=await b.new_context(viewport={'width':1440,'height':1100},locale='ko-KR',device_scale_factor=2)
  await ctx.route('https://*.supabase.co/**',lambda r:r.fulfill(json=[]))
  await ctx.route('https://pmx.gsenc.com/**',lambda r:r.fulfill(content_type='text/html',body='<h1>PMX fixture</h1>'))
  page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto('http://localhost:3000/?preview=pmx')
  card=page.locator('#pmxDashboard');await card.locator('#pmxSyncBtn').wait_for()
  assert await card.locator('#pmxSyncBtn').inner_text()=='업데이트하기'
  assert await card.get_by_role('button').count()==1, await card.get_by_role('button').all_text_contents()
  assert not await card.locator('#pmxSetupBtn').is_visible()
  assert not await card.locator('#pmxFileBtn').is_visible()
  assert not await card.get_by_role('link',name='PMX 사이트 열기 ↗').is_visible()
  assert await card.locator('.pmx-care-details').get_attribute('open') is None
  box=await card.bounding_box();assert box['height']<300,box
  await card.screenshot(path=str(OUT/'pmx-compact-desktop.png'),animations='disabled')
  # The overflow is keyboard-operable; Escape closes it and restores focus.
  more=card.locator('#pmxMore > summary');await more.focus();await page.keyboard.press('Enter')
  await card.locator('#pmxFileBtn').wait_for()
  await page.screenshot(path=str(OUT/'pmx-compact-menu.png'),animations='disabled')
  await page.keyboard.press('Escape')
  assert not await card.locator('#pmxFileBtn').is_visible()
  assert await more.evaluate('(e)=>document.activeElement===e')
  # Every update opens a compact guide, with the close button outside its scroll region.
  count=len(ctx.pages);await card.locator('#pmxSyncBtn').click()
  await page.locator('#pmxSyncGuide').wait_for()
  assert len(ctx.pages)==count
  guide=page.locator('#pmxSyncGuide')
  assert await guide.get_by_role('heading',name='공정률 업데이트',exact=True).count()==1
  box=await guide.bounding_box();assert box['width']<=480 and box['height']<=600,box
  close=guide.locator('#pmxGuideClose');close_before=await close.bounding_box()
  await guide.locator('.pmx-guide-content').evaluate('(e)=>e.scrollTop=e.scrollHeight')
  assert await guide.locator('.pmx-guide-content').evaluate('(e)=>e.scrollTop>0')
  assert await close.bounding_box()==close_before
  assert await close.evaluate('(e)=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e}')
  await close.click()
  assert not await guide.is_visible()
  await card.locator('#pmxSyncBtn').click()
  assert await guide.locator('.pmx-guide-content').evaluate('(e)=>e.scrollTop')==0
  assert await guide.locator('.pmx-guide-steps > li').count()==4
  assert await guide.locator('#pmxBookmark').get_attribute('draggable')=='true'
  assert 'Ctrl' in await guide.inner_text() and '확인하고 현장에 반영' in await guide.inner_text()
  await guide.screenshot(path=str(OUT/'pmx-bookmark-guide-desktop.png'),animations='disabled')
  await guide.get_by_text('끌어다 놓기가 안 되나요? 직접 등록하기',exact=True).click()
  assert (await guide.locator('#pmxBookmarkCode').input_value()).startswith('javascript:void ')
  assert '우클릭' in await guide.inner_text()
  await guide.get_by_text('끌어다 놓기가 안 되나요? 직접 등록하기',exact=True).click()
  async with page.expect_popup() as pop:
   await page.locator('#pmxGuideOpen').click()
  pmx=await pop.value;await pmx.wait_for_load_state();assert await pmx.evaluate('opener===null')
  await pmx.close()
  await card.locator('#pmxSyncBtn').click()
  assert await guide.is_visible() and len(ctx.pages)==count
  async with page.expect_popup() as again:
   await guide.locator('#pmxGuideOpen').click()
  second=await again.value;await second.close()
  assert not await page.locator('#pmxSyncGuide').is_visible()
  assert await card.locator('#pmxSyncBtn').inner_text()=='업데이트하기'
  await page.set_viewport_size({'width':390,'height':1000})
  await card.scroll_into_view_if_needed()
  assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  await card.screenshot(path=str(OUT/'pmx-compact-mobile.png'),animations='disabled')
  await more.click();await card.locator('#pmxSetupBtn').click()
  await page.locator('#pmxSyncGuide').wait_for()
  assert await guide.evaluate('(e)=>e.scrollWidth<=e.clientWidth')
  box=await guide.bounding_box();assert box['width']<=390-24 and box['height']<=600,box
  close_before=await close.bounding_box()
  await guide.locator('.pmx-guide-content').evaluate('(e)=>e.scrollTop=e.scrollHeight')
  assert await close.bounding_box()==close_before
  await close.click()
  await card.locator('#pmxSyncBtn').click()
  await guide.screenshot(path=str(OUT/'pmx-bookmark-guide-mobile.png'),animations='disabled')
  await guide.get_by_text('휴대폰에서 보거나, 정보가 안 들어올 때',exact=True).click()
  assert await guide.get_by_text('위 등록 방법은 PC Chrome / Edge 기준입니다.',exact=False).is_visible()
  await page.locator('#pmxGuideClose').click()
  await page.set_viewport_size({'width':1440,'height':1440})
  await page.evaluate("document.querySelectorAll('#appScreen *').forEach(e=>{if(e.scrollTop)e.scrollTop=0});window.scrollTo(0,0)")
  await page.screenshot(path=str(OUT/'pmx-compact-full.png'),animations='disabled')
  # Regular staff get a read-only card with a clear empty state and no setup actions.
  await page.goto('http://localhost:3000/?preview=home')
  await card.locator('h2').wait_for()
  assert await card.get_by_role('button').count()==0
  assert '담당자가 현장 정보를 반영하면' in await card.inner_text()
  assert not errors,errors
  print('Compact UI: update label, compact guide, fixed clickable close after desktop/mobile scroll, repeat opening, menu, import and employee state passed')
  await b.close()
asyncio.run(main())
