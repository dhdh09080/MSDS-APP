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
  # First use shows setup without opening another tab. Repeat use opens PMX directly.
  count=len(ctx.pages);await card.locator('#pmxSyncBtn').click()
  await page.locator('#pmxSyncGuide').wait_for()
  assert len(ctx.pages)==count
  async with page.expect_popup() as pop:
   await page.locator('#pmxGuideOpen').click()
  pmx=await pop.value;await pmx.wait_for_load_state();assert await pmx.evaluate('opener===null')
  await pmx.close()
  async with page.expect_popup() as again:
   await card.locator('#pmxSyncBtn').click()
  second=await again.value;await second.close()
  assert not await page.locator('#pmxSyncGuide').is_visible()
  await page.set_viewport_size({'width':390,'height':1000})
  await card.scroll_into_view_if_needed()
  assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  await card.screenshot(path=str(OUT/'pmx-compact-mobile.png'),animations='disabled')
  await more.click();await card.locator('#pmxSetupBtn').click()
  await page.locator('#pmxSyncGuide').wait_for();await page.locator('#pmxGuideClose').click()
  await page.set_viewport_size({'width':1440,'height':1440})
  await page.evaluate("document.querySelectorAll('#appScreen *').forEach(e=>{if(e.scrollTop)e.scrollTop=0});window.scrollTo(0,0)")
  await page.screenshot(path=str(OUT/'pmx-compact-full.png'),animations='disabled')
  # Regular staff get a read-only card with a clear empty state and no setup actions.
  await page.goto('http://localhost:3000/?preview=home')
  await card.locator('h2').wait_for()
  assert await card.get_by_role('button').count()==0
  assert '담당자가 현장 정보를 반영하면' in await card.inner_text()
  assert not errors,errors
  print('Compact UI: desktop height, one primary action, hidden controls, keyboard menu, first/repeat sync, mobile and employee state passed')
  await b.close()
asyncio.run(main())
