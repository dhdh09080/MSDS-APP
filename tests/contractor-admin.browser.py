"""Administrator tabs, dedicated license workflow and shared-directory entry. Synthetic API only."""
import asyncio,json,os,io,zipfile
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
BASE=os.environ.get('BASE_URL','http://localhost:3003')
OUT=Path(os.environ.get('ADMIN_ARTIFACT_DIR','work/contractor-admin'))
companies=[dict(id='con-1',name='대한건설'),dict(id='con-2',name='한빛전기'),dict(id='con-3',name='성우도장'),dict(id='con-4',name='새길설비')]
licenses=[dict(id='license-1',contractor_id='con-1',contractor=companies[0],file_name='대한건설.pdf',file_path='fixtures/license.pdf',uploaded_by='manager',uploaded_at='2026-10-27T00:00:00Z')]
async def main():
 OUT.mkdir(parents=True,exist_ok=True);errors=[];writes=[];link=None;fail_next=True
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  context=await browser.new_context(viewport=dict(width=1440,height=1080),locale='ko-KR',permissions=['clipboard-read','clipboard-write'])
  async def api(route):
   nonlocal link,fail_next
   req=route.request;u=urlparse(req.url)
   if u.hostname in ['localhost','127.0.0.1']:return await route.continue_()
   if not u.hostname.endswith('.supabase.co'):return await route.abort()
   if '/storage/' in u.path:
    if req.method=='GET':return await route.fulfill(content_type='application/pdf',body=b'%PDF-1.4 example')
    return await route.fulfill(json=dict(Key='example'))
   data=json.loads(req.post_data or '{}');name=u.path.rsplit('/',1)[-1]
   if name=='manage_contractor_directory_link':
    link=None if data.get('p_revoke') else dict(token='directory-example-token',expires_at='2099-12-31T00:00:00Z');return await route.fulfill(json=link or {})
   if name=='contractor_directory_links':return await route.fulfill(json=link)
   if name=='contractors':return await route.fulfill(json=companies)
   if name=='msds_records':return await route.fulfill(json=[dict(id='msds-1',contractor='성우도장',pdf_path='fixture.pdf')])
   if name=='business_licenses':
    if req.method=='GET':return await route.fulfill(json=licenses)
    if req.method=='POST':
     if fail_next:fail_next=False;return await route.fulfill(status=400,json=dict(message='example temporary save failure'))
     writes.append(data);licenses[:]=[l for l in licenses if l['contractor_id']!=data['contractor_id']]
     licenses.append(dict(data,id='license-2',contractor=next(c for c in companies if c['id']==data['contractor_id']),uploaded_at='2026-10-27T00:00:00Z'))
     return await route.fulfill(status=201,body='')
   return await route.fulfill(json=[])
  await context.route('**/*',api)
  page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(BASE+'/?preview=contractors');await page.locator('#conMgrList .contractor-row').first.wait_for()
  await page.locator('#nav-contractors').click()
  assert await page.locator('#gsContractorTabs [role=tab]').all_text_contents()==['협력사 관리','사업자등록증']
  assert await page.locator('#page-upload-link,#gs-con-links,#gs-tab-links').count()==0
  assert await page.locator('#conMgrList').get_by_text('링크 관리',exact=True).count()==0
  assert await page.locator('#conMgrList [onclick^="uploadLicense"]').count()==0
  assert await page.locator('#conStatLicense').count()==0
  assert await page.locator('#conMgrFilter option[value="missing-license"]').count()==0
  assert await page.locator('#conMgrList .contractor-row').count()==4
  await page.screenshot(path=str(OUT/'companies-desktop.png'),full_page=True)
  await page.locator('#conStatMsds').click();assert await page.locator('#conMgrList .contractor-row').count()==3
  await page.locator('#conStatAll').click()
  await page.locator('#gs-tab-companies').focus();await page.keyboard.press('ArrowRight')
  assert await page.locator('#gs-tab-licenses').get_attribute('aria-selected')=='true'
  assert await page.locator('#businessLicenseFilter').input_value()=='missing'
  assert await page.locator('.license-missing-item').count()==3
  assert await page.locator('#businessLicenseList .snapshot-item').count()==0
  await page.keyboard.press('ArrowRight');assert await page.locator('#gs-tab-companies').get_attribute('aria-selected')=='true'
  await page.keyboard.press('ArrowLeft');assert await page.locator('#gs-tab-licenses').get_attribute('aria-selected')=='true'
  await page.screenshot(path=str(OUT/'licenses-missing-desktop.png'),full_page=True)
  await page.locator('#businessLicenseSearch').fill('한빛');assert await page.locator('.license-missing-item').count()==1
  await page.locator('#businessLicenseSearch').fill('없는협력사');assert '검색 조건에 맞는 협력사가 없습니다' in await page.locator('#businessLicenseList').inner_text()
  await page.locator('#businessLicenseSearch').fill('한빛')
  async def upload():
   async with page.expect_file_chooser() as chooser:await page.locator('.license-missing-item button').click()
   await (await chooser.value).set_files(dict(name='한빛전기.png',mimeType='image/png',buffer=b'example'))
  await upload();await page.get_by_text('저장 실패: example temporary save failure',exact=False).wait_for()
  assert await page.locator('.license-missing-item').count()==1
  assert len(licenses)==1
  await upload();await page.get_by_text('사업자등록증이 업로드됐습니다',exact=False).wait_for()
  assert writes[-1]['contractor_id']=='con-2';assert '미제출 2개' in await page.locator('#businessLicenseStatus').inner_text()
  assert await page.locator('.license-missing-item').count()==0
  await page.locator('#businessLicenseSearch').fill('');assert await page.locator('.license-missing-item').count()==2
  await page.locator('#businessLicenseFilter').select_option('submitted');assert await page.locator('#businessLicenseList .snapshot-item').count()==2
  assert '한빛전기' in await page.locator('#businessLicenseList').inner_text()
  await page.screenshot(path=str(OUT/'licenses-submitted-desktop.png'),full_page=True)
  async with page.expect_download() as pending:await page.locator('[onclick="downloadAllLicenses()"]').click()
  download=await pending.value;target=OUT/'license-examples.zip';await download.save_as(target)
  with zipfile.ZipFile(target) as z:assert {Path(n).name for n in z.namelist() if not n.endswith('/')}=={'대한건설.pdf','한빛전기.png'}
  await page.locator('#businessLicenseFilter').select_option('all');assert await page.locator('.license-missing-item').count()==2;assert await page.locator('#businessLicenseList .snapshot-item').count()==2
  await page.evaluate("window.openContractorPage('missing-license')")
  assert await page.locator('#businessLicenseFilter').input_value()=='missing'
  assert await page.locator('#gs-tab-licenses').get_attribute('aria-selected')=='true'
  await page.evaluate("window.showPage('upload-link')")
  assert await page.locator('#gs-tab-companies').get_attribute('aria-selected')=='true'
  await page.locator('[onclick="generateSiteDirectoryLink()"]').click()
  await page.locator('#siteDirectoryLinkState a').wait_for()
  assert 'contractors.html?dtoken=directory-example-token' in await page.locator('#siteDirectoryLinkState a').get_attribute('href')
  await page.locator('#nav-requests').click();await page.get_by_role('button',name='전체 협력사 리스트',exact=True).first.click()
  assert await page.locator('#siteDirectoryCard').is_visible()
  for width in [390,768]:
   await page.set_viewport_size(dict(width=width,height=844));await page.locator('#gs-tab-licenses').click()
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   if width==390:await page.screenshot(path=str(OUT/'licenses-missing-mobile.png'),full_page=True)
  assert not errors,errors
  await browser.close();print('PASS: two tabs and keyboard wrap; retired links route; companies have no license/link actions; dedicated missing/submitted/search flow; failed upload remains missing; successful upload removes correct company; ZIP company filenames; shared directory entry; 390/768 layouts; no JS errors; synthetic data only')
asyncio.run(main())
