"""Click/drop routing for every upload surface, with end-to-end document fixture submissions."""
import asyncio,json,os,tempfile,base64
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
BASE=os.environ.get('BASE_URL','http://localhost:3003');OUT=Path(os.environ.get('UPLOAD_ARTIFACT_DIR','work/upload-dropzones'))
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=')
companies=[dict(id=f'con-{i}',name=n) for i,n in enumerate(['대한건설','한빛전기','성우도장','새길설비'],1)]
async def main():
 OUT.mkdir(parents=True,exist_ok=True);errors=[];writes=[];licenses=[];portal_licenses={};reuploads=[];license_storage_requests=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  ctx=await browser.new_context(viewport=dict(width=1440,height=1080),locale='ko-KR')
  async def api(route):
   req=route.request;u=urlparse(req.url)
   if u.hostname in ['localhost','127.0.0.1']:return await route.continue_()
   if not u.hostname.endswith('.supabase.co'):return await route.abort()
   if '/storage/' in u.path:
    if req.method=='POST' and '/business-licenses/' in u.path:
     license_storage_requests.append(dict(path=u.path,upsert=req.headers.get('x-upsert')))
     if req.headers.get('x-upsert')=='true':
      return await route.fulfill(status=403,json=dict(statusCode='403',error='Unauthorized',message='new row violates row-level security policy'))
    await asyncio.sleep(.1);return await route.fulfill(json=dict(Key='example'))
   data=json.loads(req.post_data or '{}');name=u.path.rsplit('/',1)[-1]
   if name=='get_contractor_portal':return await route.fulfill(json=dict(workspace=dict(id='example-ws',name='성동 안전현장'),contractor=companies[0],public_link=None,work_types=[dict(id='wt-1',name='도장'),dict(id='wt-2',name='방수')],license=portal_licenses.get(data['p_token']),records=[dict(id='r1',product_name='수성도료',pdf_name='수성도료.pdf')]))
   if name=='get_contractor_workspace':return await route.fulfill(json=dict(contacts=[],worker_site_code='070120'))
   if name=='get_public_reupload_requests':return await route.fulfill(json=[dict(id='r1',product_name='수성도료',version=1,reupload_reason='최신 개정본 제출 요청')])
   if name=='register_contractor_license':portal_licenses[data['p_token']]=dict(file_name=data['p_file_name']);writes.append(data);return await route.fulfill(status=204,body='')
   if name=='complete_public_reupload':reuploads.append(data);return await route.fulfill(status=204,body='')
   if name=='business_licenses':
    if req.method=='GET':return await route.fulfill(json=licenses)
    licenses.append(dict(data,id=f'license-{len(licenses)}',contractor=next(c for c in companies if c['id']==data['contractor_id']),uploaded_at='2026-10-27T00:00:00Z'));writes.append(data);return await route.fulfill(status=201,body='')
   if name=='contractors':return await route.fulfill(json=companies)
   if name=='msds_records':return await route.fulfill(json=[])
   if name=='contractor_directory_links':return await route.fulfill(json=None)
   return await route.fulfill(json=[])
  await ctx.route('**/*',api)
  page=await ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  async def drop(selector,name='선택파일.png',mime='image/png',count=1):
   await page.locator(selector).first.evaluate('''(zone,args)=>{const dt=new DataTransfer();for(let i=0;i<args.count;i++)dt.items.add(new File(['example'],i?i+args.name:args.name,{type:args.mime}));zone.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));}''',dict(name=name,mime=mime,count=count))
  async def choose(selector,name='선택파일.png',mime='image/png'):
   async with page.expect_file_chooser() as pending:await page.locator(selector).first.click()
   chooser=await pending.value;await chooser.set_files(dict(name=name,mimeType=mime,buffer=PNG if mime=='image/png' else b'example'));return chooser
  await page.goto(BASE+'/?preview=contractors');await page.locator('#gs-tab-licenses').click();await page.screenshot(path=str(OUT/'admin-license-dropzones.png'),full_page=True)
  row='[data-upload-input="manualLicenseInput"][data-upload-value="con-2"]'
  await choose(row+' button');await page.get_by_text('사업자등록증이 업로드됐습니다',exact=False).wait_for();assert writes[-1]['contractor_id']=='con-2'
  row='[data-upload-input="manualLicenseInput"][data-upload-value="con-3"]'
  before=len(writes);await drop(row,'불가.exe','application/octet-stream');await page.get_by_text('지원하는 파일을 놓아주세요.',exact=False).wait_for();assert len(writes)==before
  await drop(row,count=2);await page.get_by_text('파일을 한 개씩',exact=False).wait_for();assert len(writes)==before
  await drop(row);await page.wait_for_function('document.querySelector("#manualLicenseInput").disabled')
  await drop('[data-upload-input="manualLicenseInput"][data-upload-value="con-4"]')
  await page.wait_for_function('!document.querySelector("#manualLicenseInput").disabled');assert writes[-1]['contractor_id']=='con-3';assert len(writes)==before+1
  # Audit every static upload input, then exercise picker + drop in its actual page/modal.
  missing=await page.evaluate('''()=>[...document.querySelectorAll('input[type=file]')].filter(i=>![...document.querySelectorAll('[data-upload-input]')].some(z=>z.dataset.uploadInput===i.id)).map(i=>i.id)''');assert not missing,missing
  routes=[
   ('pdfInput',"showPage('msds');openMsdsRegister()",'document.pdf','application/pdf'),
   ('folderInput',"showPage('msds');openMsdsRegister()",'document.pdf','application/pdf'),
   ('msdsRenewFileInput',"showPage('msds');showMsdsDetail('msds-1')",'renew.pdf','application/pdf'),
   ('msdsFileReplaceInput',"showPage('msds');showMsdsDetail('msds-1')",'replace.pdf','application/pdf'),
   ('measureFileInput',"showPage('measure');openMeasureUpload()",'측정.pdf','application/pdf'),
   ('healthFileInput',"showPage('health');openHealthUpload()",'검진.pdf','application/pdf'),
   ('healthExcelInput',"showPage('health');openModal('healthConfirmModal')",'양식.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
   ('placementExcelInput',"showPage('health');switchHealthSub('placement')",'배치전.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
   ('sortingExcelInput',"showPage('health');switchHealthSub('sorting')",'소팅.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
   ('mpFileInput',"showPage('manpower')",'투입.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
   ('vulFileInput',"showPage('vulnerable')",'취약.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
   ('bpFileInput',"showPage('bp')",'혈압.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
   ('kgFileInput',"showPage('library')",'목록.csv','text/csv'),
   ('photoUploadFileInput',"showPage('photos');openModal('photoUploadModal')",'사진.png','image/png'),
   ('binderImport',"showPage('binders')",'바인더.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
   ('hmPhotoInput',"showPage('hazard-map')",'현장.png','image/png'),
  ]
  await page.evaluate('''ids=>{window.uploadSpyIds=ids;window.uploadRouteEvents=[];document.addEventListener('change',e=>{if(window.uploadSpyIds.includes(e.target.id)){window.uploadRouteEvents.push({id:e.target.id,names:[...e.target.files].map(f=>f.name)});e.stopImmediatePropagation();}},true)}''',[r[0] for r in routes])
  for id,setup,name,mime in routes:
   await page.evaluate("document.querySelectorAll('.modal-backdrop.open').forEach(m=>closeModal(m.id));document.querySelectorAll('dialog[open]').forEach(d=>d.close());"+setup)
   if id=='binderImport':
    await page.locator('#binderImport').wait_for(state='attached');await page.locator('#binderManageOpen').click();await page.locator('#binderImport').evaluate("el=>el.closest('details').open=true")
   if id=='hmPhotoInput':
    await page.locator('#hmUpload').click();await page.locator('#hmUploadDialog').wait_for(state='visible')
   if id=='healthExcelInput':await page.locator('#healthExcelInput').evaluate("el=>el.closest('details')?.setAttribute('open','')")
   selector='[data-upload-input="'+id+'"]';await page.locator(selector).first.wait_for(state='visible')
   previous=await page.evaluate('window.uploadRouteEvents.length')
   if id=='folderInput':
    with tempfile.TemporaryDirectory() as directory:
     Path(directory,'MSDS.pdf').write_bytes(b'example')
     async with page.expect_file_chooser() as pending:await page.locator(selector).click()
     await (await pending.value).set_files(directory)
   else:await choose(selector,name,mime)
   await page.wait_for_function('(n)=>window.uploadRouteEvents.length===n',arg=previous+1)
   assert (await page.evaluate('window.uploadRouteEvents.at(-1)'))['id']==id
   await drop(selector,'drop-'+name,mime);await page.wait_for_function('(n)=>window.uploadRouteEvents.length===n',arg=previous+2)
   assert (await page.evaluate('window.uploadRouteEvents.at(-1)'))==dict(id=id,names=['drop-'+name])
   if id=='hmPhotoInput':
    await page.locator('#hmUploadForm').evaluate('form=>form.reset()')
    assert await page.locator('#hmUploadForm [data-upload-status]').inner_text()=='선택된 파일 없음'
    await page.locator('#hmMarkerDialog').evaluate("()=>document.querySelector('#hmUploadDialog').close()")
   print('PASS picker/drop routing:',id,flush=True)
  await page.evaluate('window.uploadSpyIds=[];document.querySelectorAll(".modal-backdrop.open").forEach(m=>closeModal(m.id));showPage("msds");openMsdsRegister()')
  await choose('#msdsUploadZone','실제대기.pdf','application/pdf');await page.locator('#msdsFileQueue .file-item').first.wait_for()
  await drop('#msdsUploadZone','추가자료.png');await page.wait_for_function('document.querySelectorAll("#msdsFileQueue .file-item").length===2')
  await page.locator('#msdsUploadZone').evaluate("""zone=>{
    const file=new File(['example'],'폴더도료.pdf',{type:'application/pdf'});
    const entry={isFile:true,name:file.name,file:resolve=>resolve(file)};
    const dir=(name,children)=>({isDirectory:true,name,createReader:()=>{let read=false;return {readEntries:resolve=>{resolve(read?[]:children);read=true}}}});
    const dt={types:['Files'],files:[],items:[{kind:'file',getAsFile:()=>file,webkitGetAsEntry:()=>dir('성우도장',[dir('도장',[entry])])}]};
    const event=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:dt});zone.dispatchEvent(event);
  }""")
  await page.wait_for_function('document.querySelectorAll("#msdsFileQueue .file-item").length===3')
  await page.locator('#msdsFileQueue .file-item').last.get_by_text('분석 대기 · 성우도장 / 도장').wait_for()
  await page.screenshot(path=str(OUT/'manager-msds-queue.png'),full_page=True)
  await page.goto(BASE+'/upload.html?token=license-click&panel=license');await page.locator('#licenseUploadZone').wait_for(state='visible');await choose('#licenseUploadZone','클릭등록증.png');await page.locator('#licenseAlreadyDone').wait_for(state='visible');assert portal_licenses['license-click']['file_name']=='클릭등록증.png'
  await page.goto(BASE+'/upload.html?token=license-drop&panel=license');await page.locator('#licenseUploadZone').wait_for(state='visible');await page.screenshot(path=str(OUT/'partner-license-dropzone.png'),full_page=True);await drop('#licenseUploadZone','드롭등록증.png');await page.locator('#licenseAlreadyDone').wait_for(state='visible');assert portal_licenses['license-drop']['file_name']=='드롭등록증.png';await page.screenshot(path=str(OUT/'partner-license-uploaded.png'),full_page=True)
  await page.goto(BASE+'/upload.html?token=reupload&panel=upload');await page.locator('#reuploadSection [data-upload-input]').wait_for(state='visible');await page.screenshot(path=str(OUT/'partner-msds-reupload.png'),full_page=True)
  await drop('#reuploadSection [data-upload-input]','개정MSDS.pdf','application/pdf');await page.get_by_text('재업로드 접수 완료! 감사합니다',exact=False).wait_for();assert reuploads[-1]['p_record_id']=='r1'
  await choose('#uploadZone','신규MSDS.pdf','application/pdf');await page.locator('.file-item').wait_for();await drop('#uploadZone','추가MSDS.png');await page.wait_for_function('document.querySelectorAll(".file-item").length===2')
  await page.screenshot(path=str(OUT/'partner-msds-dropzones.png'),full_page=True)
  for width in [390,768]:
   await page.set_viewport_size(dict(width=width,height=844));assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   if width==390:await page.screenshot(path=str(OUT/'partner-upload-mobile.png'),full_page=True)
  assert not errors,errors
  assert len(license_storage_requests)==4
  assert all(request['upsert']=='false' for request in license_storage_requests)
  assert len({request['path'] for request in license_storage_requests})==4
  await browser.close();print('PASS: 16 picker/drop routing contexts; admin license click/drop target and busy safety; invalid/multiple rejection; actual manager and partner MSDS queues; partner license click/drop; reupload; mobile; no JS errors. License uploads require INSERT-only storage permissions and unique paths. All APIs synthetic.')
asyncio.run(main())
