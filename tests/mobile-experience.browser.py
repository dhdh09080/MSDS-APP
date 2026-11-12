"""Mobile workflow regression with synthetic data. No production writes.
Vite dev at BASE_URL (default :3001), Python Playwright + Chromium required.
"""
import asyncio,json,os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
BASE=os.environ.get('BASE_URL','http://localhost:3001')
OUT=Path(os.environ.get('MOBILE_ARTIFACT_DIR','work/mobile-experience'));OUT.mkdir(parents=True,exist_ok=True)

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  errors=[]
  async def api(route):
   u=urlparse(route.request.url)
   if u.hostname in ['localhost','127.0.0.1']:return await route.continue_()
   if '/storage/v1/object/sign/' in u.path:return await route.fulfill(json={'signedURL':'/object/sign/msds-pdfs/fixture.pdf?token=fixture'})
   return await route.fulfill(json=[])
  for width in [360,390,768,1440]:
   mobile=width<=768
   page=await browser.new_page(viewport={'width':width,'height':844},is_mobile=mobile,has_touch=mobile)
   page.on('pageerror',lambda e:errors.append(str(e)));await page.route('**/*',api)
   await page.goto(BASE+'/?preview=msds');await page.locator('#msdsTableBody .row-check').first.wait_for()
   assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth')
   rows=page.locator('#msdsTableBody tr')
   if mobile:
    assert await rows.first.locator('.msds-product-link').evaluate('e=>e.getBoundingClientRect().top')<650
    assert await page.locator('#page-msds table').evaluate('e=>e.getBoundingClientRect().width<=innerWidth')
    assert await page.locator('#filterStatus').is_hidden()
    await page.locator('#msdsFilters > summary').click()
    await page.locator('#filterStatus').select_option('ended')
    assert '등록된 MSDS가 없습니다' in await page.locator('#msdsTableBody').inner_text()
    await page.locator('#filterStatus').select_option('')
    await page.locator('#msdsFilters > summary').click()
    await rows.first.locator('.msds-row-more > summary').click()
    await rows.first.get_by_role('button',name='상세보기',exact=True).click()
    assert await page.locator('#detailTitle').inner_text()=='실리콘 실란트'
    await page.evaluate("closeModal('msdsDetailModal')")
    # Orientation changes retain one set of controls and preserve their values.
    await page.locator('#searchInput').fill('에폭시')
    await page.set_viewport_size({'width':1440,'height':844})
    assert await page.locator('#filterStatus').is_visible()
    assert await page.locator('#msdsTableBody .msds-row-actions').is_visible()
    assert await page.locator('#msdsContractorSearch').count()==1
    await page.set_viewport_size({'width':width,'height':844})
    assert await page.locator('#searchInput').input_value()=='에폭시'
    await page.locator('#searchInput').fill('')
   else:
    assert await page.locator('#filterStatus').is_visible()
    assert await rows.first.locator('.msds-row-actions').is_visible()
   pdf=page.locator('#msdsTableBody .pdf-link').first
   await pdf.click();await page.locator('#fileViewerModal.open').wait_for()
   assert 'fixture.pdf' in await page.locator('#fileViewerFrame').get_attribute('src')
   await page.evaluate('closeFileViewer()')
   await page.locator('#msdsRegisterBtn').click();await page.wait_for_timeout(250)
   if mobile:
    assert await page.locator('#msdsCameraInput').get_attribute('capture')=='environment'
    assert await page.locator('#batchContractorSearch').evaluate("e=>parseFloat(getComputedStyle(e).fontSize)")>=16
    await page.set_viewport_size({'width':width,'height':430})
    assert (await page.locator('#msdsRegisterModal .modal').bounding_box())['height']<=430
    await page.set_viewport_size({'width':width,'height':844})
   await page.evaluate("closeModal('msdsRegisterModal');showPage('home')")
   if mobile:
    assert (await page.locator('.gs-shortcuts').bounding_box())['y']<250
    assert await page.locator('#mobileHomeWeather').get_attribute('open') is None
    await page.evaluate("showPage('contractors')")
    assert (await page.locator('#conMgrList').bounding_box())['y']<650
    assert await page.locator('#siteDirectoryCard').is_hidden()
    await page.locator('#mobileDirectoryShortcut').click()
    assert await page.locator('#siteDirectoryCard').is_visible()
   await page.goto(BASE+'/?preview=warning');await page.locator('#warnPickList .warn-check').first.wait_for()
   if mobile:
    assert await page.locator('.wb-settings').is_hidden()
    await page.locator('#mobileWarnNext').click()
    assert await page.locator('.wb-settings').is_visible()
    assert await page.locator('.warn-left').is_hidden()
    await page.locator('#warnSizeSel').select_option('a6')
    await page.locator('#mobileWarnNext').click()
    assert await page.locator('.wb-preview-panel').is_visible()
    assert await page.locator('#mobileWarnNext').inner_text()=='선택한 표지 인쇄'
    await page.locator('#mobileWarnBack').click()
    assert await page.locator('#warnSizeSel').input_value()=='a6'
    await page.locator('#mobileWarnBack').click()
    assert await page.locator('#warnPickList input:checked').count()==1
    await page.locator('#warnPickList input[value="msds-1"]').uncheck()
    assert await page.locator('#mobileWarnNext').is_disabled()
   else:
    assert await page.locator('.warn-left').is_visible()
    assert await page.locator('.wb-settings').is_visible()
    assert await page.locator('.wb-preview-panel').is_visible()
   await page.goto(BASE+'/?preview=measure');await page.locator('#measureResultModal.open').wait_for()
   if mobile:
    for height in [844,430]:
     await page.set_viewport_size({'width':width,'height':height});await page.wait_for_timeout(250)
     bounds=await page.locator('#measureResultModal .modal-footer').bounding_box()
     assert bounds['y']>=0 and bounds['y']+bounds['height']<=height+1,bounds
     assert await page.locator('#measureWordBtn').evaluate('e=>e.getBoundingClientRect().height')>=44
    await page.set_viewport_size({'width':width,'height':844})
   await page.screenshot(path=str(OUT/f'measure-{width}.png'))
   await page.close()
  assert not errors,errors
  print('PASS: cards/PDF/details, filters, orientation, font/touch targets, home/contractor ordering, warning steps, and keyboard-sized modal footer at 360/390/768/1440px')
  await browser.close()
asyncio.run(main())
