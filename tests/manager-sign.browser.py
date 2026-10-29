"""Run against the Vite dev server; requires Playwright, Chromium and PyMuPDF."""
import asyncio
import os
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await b.new_page(viewport={'width':1600,'height':1100}); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(os.environ.get('BASE_URL', 'http://localhost:3002') + '/?preview=manager-signs')
  await page.wait_for_selector('#managerSignPrint:not([disabled])')
  await page.select_option('#managerCompany','con-1')
  for key,value in [('primaryName','홍길동'),('primaryPhone','010-1234-5678'),('deputyName','김철수'),('deputyPhone','010-9876-5432')]:
   await page.fill('#manager-'+key,value)
  await page.locator('#manager-phrase').click()
  assert await page.locator('#managerPhraseMatches [role="option"]').count()==3
  assert await page.locator('#managerPhraseAdd').is_hidden()
  await page.fill('#manager-phrase','추가 문구/안전 제일')
  assert await page.locator('#managerPhraseAdd').inner_text()=='+ 추가 문구/안전 제일 추가'
  await page.click('#managerPhraseAdd')
  await page.locator('#manager-phrase').click()
  assert await page.locator('#managerPhraseMatches [role="option"]').count()==4
  assert await page.locator('#managerPhraseAdd').is_hidden()
  await page.fill('#manager-phrase','정리')
  assert await page.locator('#managerPhraseMatches [role="option"]').count()==1
  await page.locator('#manager-phrase').press('ArrowDown')
  await page.locator('#manager-phrase').press('Enter')
  assert await page.input_value('#manager-phrase')=='내부 정리 철저'
  await page.fill('#manager-phrase','추가 문구/안전 제일')
  await page.locator('#manager-phrase').press('Escape')
  await page.select_option('#managerCompany','con-2')
  assert await page.input_value('#manager-primaryName')==''
  await page.select_option('#managerCompany','con-1')
  assert await page.input_value('#manager-primaryName')=='홍길동'
  await page.reload();await page.wait_for_selector('#managerSignPrint:not([disabled])')
  assert await page.input_value('#manager-primaryPhone')=='010-1234-5678'
  assert await page.input_value('#manager-phrase')=='추가 문구/안전 제일'
  await page.fill('#manager-phrase','화기주의/주변 흡연금지')
  await page.wait_for_timeout(300)
  frame=page.frame_locator('#managerSignPreview iframe')
  await frame.locator('svg').wait_for();await frame.locator('svg').screenshot(path='/tmp/manager-sign.png')
  assert '010-1234-5678' in await frame.locator('svg').text_content()
  await page.fill('#managerCopies','2')
  import fitz
  for paper,width_mm,height_mm in [('A4',297,210),('A3',420,297)]:
   await page.select_option('#managerPaper',paper)
   assert paper in await page.locator('#managerPaperNotice').inner_text()
   await page.click('#managerSignPrint')
   await page.wait_for_selector('#__printFrame',state='attached')
   await page.locator('#__printFrame').evaluate('(f)=>f.contentWindow.print=()=>{}')
   html=await page.locator('#__printFrame').evaluate('(f)=>f.contentDocument.documentElement.outerHTML')
   pdfpage=await b.new_page();await pdfpage.set_content(html)
   await pdfpage.evaluate('document.fonts.ready');await pdfpage.wait_for_timeout(300)
   path=f'/tmp/manager-sign-{paper}.pdf'
   await pdfpage.pdf(path=path,prefer_css_page_size=True,print_background=True)
   doc=fitz.open(path);assert len(doc)==2,len(doc)
   assert abs(doc[0].rect.width*25.4/72-width_mm)<.5
   assert abs(doc[0].rect.height*25.4/72-height_mm)<.5
   assert '010-1234-5678' in doc[0].get_text()
   assert any('H2gtrE' in x[3] for x in doc[0].get_fonts())
   print(paper, len(doc), 'pages',doc[0].rect)
   await pdfpage.close()
  await page.reload();await page.wait_for_selector('#managerSignPrint:not([disabled])')
  assert await page.input_value('#managerPaper')=='A3'
  await page.set_viewport_size({'width':390,'height':844})
  assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert not errors,errors
  await b.close();print('PASS manager selection, contacts, phrases, persistence, preview, embedded font, A3/A4 landscape PDF dimensions, dropdown add/filter/keyboard, paper persistence and mobile')
asyncio.run(main())
