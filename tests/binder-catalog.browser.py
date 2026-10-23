"""Run Vite on port 3002; set BINDER_SOURCE_XLSX to also import a supplied baseline."""
import asyncio,os
from pathlib import Path
from playwright.async_api import async_playwright
from openpyxl import load_workbook
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await b.new_page(viewport={'width':1440,'height':1000});page.on('dialog',lambda d:d.accept())
  await page.goto('http://127.0.0.1:3002/?preview=binders');await page.wait_for_selector('[data-edit="SR-E-06"]')
  if source:=os.environ.get('BINDER_SOURCE_XLSX'):
   await page.locator('#binderManageOpen').click();await page.locator('#binderImport').set_input_files(source)
   await page.wait_for_timeout(250);await page.locator('#binderManageClose').click()
  assert await page.locator('.binder-row').count()==40
  assert await page.locator('[data-width-code="SR-E-06"]').evaluate('(s)=>s.tagName')=='SELECT'
  assert await page.locator('[data-width-code="SR-E-06"] option').all_text_contents()==['선택','7cm','9cm']
  await page.locator('[data-edit="SR-E-06"]').click()
  await page.fill('#binderEditMinorNumber','06-01');await page.fill('#binderEditTitle','밀폐공간 작업')
  await page.select_option('#binderEditWidth','70');await page.fill('#binderEditLabelNumber','3');await page.fill('#binderEditFooter1','2026')
  await page.locator('#binderEditForm button[type=submit]').click();await page.wait_for_selector('[data-edit="SR-E-06-01"]')
  await page.reload();await page.wait_for_selector('[data-edit="SR-E-06-01"]')
  assert '밀폐공간 작업' in await page.locator('[data-code="SR-E-06-01"]').locator('..').inner_text()
  assert await page.locator('[data-width-code="SR-E-06-01"]').input_value()=='70'
  await page.locator('[data-code="SR-E-06-01"]').check()
  frame=page.frame_locator('#binderPreview iframe');await frame.locator('.binder-label').wait_for()
  assert await frame.locator('.binder-title-column').text_content()=='밀폐공간 작업'
  await page.select_option('[data-width-code="SR-E-06-01"]','90')
  frame=page.frame_locator('#binderPreview iframe');await frame.locator('.binder-label').wait_for()
  assert await frame.locator('.binder-label').evaluate('(e)=>e.style.width')=='90mm'
  await page.select_option('[data-width-code="SR-E-06-01"]','70')
  await page.locator('#binderManageOpen').click()
  await page.locator('#binderStandard').evaluate('(e)=>e.click()')
  async with page.expect_download() as d:await page.locator('#binderExport').evaluate('(e)=>e.click()')
  download=await d.value;dest='/workspace/work/binder-v4-export.xlsx';await download.save_as(dest)
  rows=list(load_workbook(dest).active.values);records=[dict(zip(rows[0],r)) for r in rows[1:]]
  doc=next(d for d in records if d['소분류 번호']=='06-01');assert doc['소분류 제목']=='밀폐공간 작업';assert doc['번호 라벨링']=='3';assert doc['폭(cm)']==7;assert doc['하단 1']=='2026'
  await page.locator('#binderImport').set_input_files(dest);await page.wait_for_timeout(250);await page.locator('#binderManageClose').click()
  assert await page.locator('.binder-row').count()==40
  await page.locator('#binderListNew').click()
  assert await page.locator('#binderManageTitle').inner_text()=='문서 추가'
  for key,value in [('MajorCode','SQ'),('MajorName','품질'),('MiddleCode','C'),('MiddleName','공급원승인'),('MinorNumber','01'),('Title','레미콘 공급원 승인')]:await page.fill('#binderEdit'+key,value)
  await page.select_option('#binderEditWidth','90')
  await page.locator('#binderEditForm button[type=submit]').click();await page.wait_for_selector('[data-category="SQ/C"]')
  await page.reload();await page.wait_for_selector('[data-edit="SQ-C-01"]')
  assert await page.locator('[data-width-code="SQ-C-01"]').input_value()=='90'
  await page.locator('[data-category="SQ/C"]').click();assert await page.locator('.binder-row').count()==1
  await page.locator('[data-edit="SQ-C-01"]').click();await page.locator('#binderDeleteDoc').click();await page.wait_for_timeout(100)
  await page.locator('[data-category="all"]').click();assert await page.locator('.binder-row').count()==40
  await b.close();print('PASS add/edit/reload/print title, 7cm/9cm selection and physical size, cm XLSX roundtrip, stable merge, custom category and deletion')
asyncio.run(main())
