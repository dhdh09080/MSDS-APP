"""Partner-link manager signs; synthetic RPC fixtures, no production writes."""
import asyncio, json, os
from playwright.async_api import async_playwright

BASE = os.environ.get('BASE_URL', 'http://localhost:3004')
WS = '10000000-0000-4000-8000-000000000001'

async def main():
 async with async_playwright() as p:
  browser = await p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
  page = await browser.new_page(viewport={'width':1600,'height':1100})
  errors=[]; requests=[]
  page.on('pageerror', lambda e: errors.append(str(e)))
  async def api(route):
   name = route.request.url.rsplit('/',1)[-1]
   data = json.loads(route.request.post_data or '{}');requests.append((name,data))
   if name == 'get_contractor_portal':
    if data['p_token']=='invalid':return await route.fulfill(status=400,json={'message':'invalid or expired upload token'})
    company = 'b' if data['p_token']=='partner-b' else 'a'
    return await route.fulfill(json={'workspace':{'id':WS,'name':'테스트 현장'},'contractor':{'id':company,'name':'대한건설' if company=='a' else '한빛전기'},'public_link':{'allow_msds':False,'allow_license':True},'records':[],'work_types':[],'license':None})
   if name == 'get_contractor_workspace': return await route.fulfill(json={'contacts':[],'worker_site_code':''})
   return await route.fulfill(status=400,json={'message':'Unexpected request'})
  await page.route('**/*.supabase.co/**',api)
  await page.goto(BASE+'/upload.html?token=partner-a&panel=manager-signs')
  await page.wait_for_selector('#managerSignPrint:not([disabled])')
  assert await page.locator('#managerCompany').is_disabled()
  assert await page.input_value('#managerCompany')=='a'
  assert await page.locator('#managerCompany option').count()==2
  assert await page.locator('#warningsTab').is_hidden()
  for key,value in [('primaryName','홍길동'),('primaryPhone','010-1234-5678'),('deputyName','김철수'),('deputyPhone','010-9876-5432')]: await page.fill('#manager-'+key,value)
  await page.fill('#manager-phrase','출입 주의')
  assert await page.locator('#managerPhraseAdd').inner_text()=='+ 출입 주의 추가'
  await page.click('#managerPhraseAdd')
  for paper in ['A4','A3']:
   await page.select_option('#managerPaper',paper)
   await page.click('#managerSignPrint')
   await page.wait_for_selector('#__printFrame',state='attached')
   await page.locator('#__printFrame').evaluate('(f)=>f.contentWindow.print=()=>{}')
   frame=page.frame_locator('#__printFrame')
   assert '대한건설' in await frame.locator('svg').text_content()
   css=await frame.locator('style').text_content()
   assert 'size:'+paper+' landscape' in css
  await page.locator('nav [data-workspace-nav="dashboard"]').click()
  await page.locator('.cw-shortcuts [data-workspace-nav="manager-signs"]').click()
  assert await page.input_value('#manager-primaryName')=='홍길동'
  await page.reload();await page.wait_for_selector('#managerSignPrint:not([disabled])')
  assert await page.input_value('#manager-primaryName')=='홍길동'
  await page.set_viewport_size({'width':390,'height':844})
  assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  await page.click('#cwMenuToggle')
  await page.locator('nav [data-workspace-nav="manager-signs"]').click()
  assert await page.locator('#managerSignsPanel').is_visible()
  assert await page.locator('#cwOverlay').is_hidden()
  await page.screenshot(path='/tmp/manager-sign-portal-mobile.png',full_page=True)
  await page.goto(BASE+'/upload.html?token=partner-b&panel=manager-signs')
  await page.wait_for_selector('#managerSignPrint:not([disabled])')
  assert await page.input_value('#managerCompany')=='b'
  assert await page.input_value('#manager-primaryName')==''
  assert await page.input_value('#manager-phrase')=='화기주의/주변 흡연금지'
  await page.goto(BASE+'/upload.html?token=invalid&panel=manager-signs')
  await page.locator('#errorView').wait_for(state='visible')
  assert await page.locator('#managerSignForm').count()==0
  assert not errors, errors
  assert all(name in ['get_contractor_portal','get_contractor_workspace'] for name,_ in requests),requests
  await browser.close()
  print('PASS partner-link menu, shortcut, deep link, fixed company, A3/A4 print, phrase add, drafts, company isolation, mobile and invalid link')

asyncio.run(main())
