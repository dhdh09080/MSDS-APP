"""Admin usage switch persistence feedback using synthetic API writes only."""
import asyncio,json,os
from urllib.parse import urlparse,parse_qs
from playwright.async_api import async_playwright
BASE=os.environ.get('BASE_URL','http://localhost:3007')
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await b.new_page(viewport={'width':1440,'height':1000});errors=[];writes=[];fail_next=False
  page.on('pageerror',lambda e:errors.append(str(e)))
  async def api(route):
   nonlocal fail_next
   req=route.request;u=urlparse(req.url)
   if u.hostname in ['localhost','127.0.0.1']:return await route.continue_()
   if '/rest/v1/msds_records' in req.url and req.method=='PATCH':
    args=json.loads(req.post_data);writes.append(args)
    if fail_next:fail_next=False;return await route.fulfill(status=400,json={'message':'fixture update rejected'})
    q=parse_qs(u.query);assert 'workspace_id' in q
    return await route.fulfill(json={'id':q['id'][0].removeprefix('eq.'),'status':args['status']})
   return await route.fulfill(json=[])
  await page.route('**/*',api)
  await page.goto(BASE+'/?preview=msds');switch=page.locator('#msdsTableBody [role=switch]').first
  await switch.wait_for();assert await switch.get_attribute('aria-checked')=='true'
  await switch.click();await page.wait_for_function('document.querySelector(\"#msdsTableBody [role=switch]\").getAttribute(\"aria-checked\")===\"false\"')
  assert writes[-1]['status']=='ended';assert '미사용중' in await switch.inner_text()
  await switch.click();await page.wait_for_function('document.querySelector(\"#msdsTableBody [role=switch]\").getAttribute(\"aria-checked\")===\"true\"')
  assert writes[-1]['status']=='active'
  fail_next=True;await switch.click();await page.get_by_text('fixture update rejected',exact=False).wait_for()
  assert await switch.get_attribute('aria-checked')=='true'
  assert not errors,errors
  await b.close();print('PASS: administrator switch saves ended/active, scopes workspace, and retains state after failure')
asyncio.run(main())
