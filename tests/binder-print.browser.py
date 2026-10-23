import asyncio
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await b.new_page(viewport={'width':1500,'height':1100});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto('http://127.0.0.1:3002/?preview=binders');await page.wait_for_selector('[data-code="SR-A-03"]')
  assert await page.locator('.binder-row').count()==40
  assert await page.locator('#binderCategories button').count()==9
  await page.fill('#binderSearch','위험성평가');assert await page.locator('.binder-row').count()==1
  await page.fill('#binderSearch','')
  for code,width in [('SR-B-02','70'),('SR-B-06','90')]:
   await page.select_option(f'[data-width-code="{code}"]',width);await page.locator('#binderSearch').focus();await page.locator(f'[data-code="{code}"]').check()
  assert await page.locator('#binderFontNotice').count()==0
  assert (await page.locator('#nav-binders').inner_text()).strip().endswith('바인더 표지')
  assert await page.locator('.more-item-label',has_text='바인더 표지').count()==1
  assert await page.locator('#page-binders .page-title').inner_text()=='바인더 표지'
  await page.wait_for_selector('#binderPrint:not([disabled])')
  assert not await page.locator('#binderPrint').is_disabled()
  await page.locator('#binderNumbersOpen').click();await page.fill('#binderSequenceCount','3');await page.locator('#binderSequenceNext').click()
  assert await page.locator('[data-batch-id="SR-B-02"]').input_value()=='1-3'
  await page.fill('[data-batch-id="SR-B-02"]','14-16,20');await page.fill('[data-batch-id="SR-B-06"]','3,5')
  await page.locator('#binderNumbersForm button[type="submit"]').click();await page.wait_for_function("!document.getElementById('binderNumbers').open")
  assert '2종 · 6개 라벨' in await page.locator('#binderStatus').inner_text()
  frame=page.frame_locator('#binderPreview iframe');await frame.locator('.binder-label').first.wait_for()
  assert await frame.locator('.binder-label').count()==6
  assert await frame.locator('.binder-label').evaluate_all('(els)=>els.map(e=>e.style.width)')==['67mm']*4+['87mm']*2
  await page.emulate_media(media='print')
  widths=await frame.locator('.binder-label').evaluate_all('(els)=>els.map(e=>e.getBoundingClientRect().width*25.4/96)')
  assert all(abs(a-b)<.05 for a,b in zip(widths,[67]*4+[87]*2)),widths
  await page.emulate_media(media='screen')
  assert await frame.locator('.binder-title-column').count()==6
  assert await frame.locator('.binder-cut-frame').count()==6
  titles=await frame.locator('.binder-title-column').all_text_contents()
  assert titles[:4]==['안전및보건에관한 협의체 회의록']*4,titles
  assert titles[4:]==['작업허가서(Permit to Work)']*2,titles
  assert await frame.locator('.binder-title-latin').count()==2
  centering=await frame.locator('.binder-label').evaluate_all("els=>els.map(e=>{const label=e.getBoundingClientRect(),footer=e.querySelector('.binder-footer').getBoundingClientRect(),img=e.querySelector('.binder-logo img').getBoundingClientRect();return {dx:Math.abs((img.left+img.right-label.left-label.right)/2),dy:Math.abs((img.top+img.bottom-footer.bottom-label.bottom)/2),fit:getComputedStyle(e.querySelector('.binder-logo img')).objectFit};})")
  assert all(v['dx']<.2 and v['dy']<.2 and v['fit']=='contain' for v in centering),centering
  await page.locator('#binderPrint').click();await page.locator('#__printFrame').wait_for(state='attached')
  await page.locator('#__printFrame').evaluate('(f)=>f.contentWindow.print=()=>{}')
  await page.reload();await page.wait_for_selector('[data-next-code="SR-B-02"]')
  assert await page.locator('[data-next-code="SR-B-02"]').inner_text()=='다음 21'
  assert '14–16, 20' in await page.locator('[data-code="SR-B-02"]').locator('..').inner_text()
  await page.locator('#binderHistoryPanel').evaluate('(e)=>e.open=true');assert '3, 5' in await page.locator('#binderHistory').inner_text()
  await page.locator('[data-status="confirmed"]').click();await page.reload();await page.wait_for_selector('[data-code="SR-B-02"]')
  assert '최근 출력 완료' in await page.locator('[data-code="SR-B-02"]').locator('..').inner_text()
  await page.locator('[data-code="SR-B-02"]').check();await page.locator('[data-code="SR-B-06"]').check();await page.locator('#binderNumbersOpen').click()
  await page.fill('#binderSequenceCount','3');await page.locator('#binderSequenceNext').click()
  assert await page.locator('[data-batch-id="SR-B-02"]').input_value()=='21-23'
  assert await page.locator('[data-batch-id="SR-B-06"]').input_value()=='6-8'
  await page.fill('[data-batch-id="SR-B-02"]','14,14');await page.locator('#binderNumbersForm button[type="submit"]').click();assert '중복' in await page.locator('#binderNumbersError').inner_text()
  await page.locator('#binderNumbersClose').click();await page.fill('#binderCopies','2');assert '12개 라벨' in await page.locator('#binderStatus').inner_text()
  await page.set_viewport_size({'width':390,'height':844});assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert not errors,errors
  await b.close();print('PASS actual HY font, original full titles, vertical Latin, range/list batch, 6 labels, remembered all numbers, next by maximum, copy distinction, duplicate prevention, mobile')
asyncio.run(main())
