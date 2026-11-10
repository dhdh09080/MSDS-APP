"""Synthetic partner import UI: no production requests or data writes."""
import asyncio, os
from playwright.async_api import async_playwright
BASE=os.environ.get('BASE_URL','http://localhost:3007')
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.route('**/partner-fixture',lambda route:route.fulfill(content_type='text/html',body='<html><head></head><body></body></html>'))
  await page.goto(BASE+'/partner-fixture')
  await page.evaluate('''async()=>{
   const {createPartnerPanel}=await import('/src/lib/pmx-partner-panel.js');
   window.ws={id:'site-a',name:'테스트 현장',pmx_prj_cd:'070120'};window.calls=[];window.messages=[];window.refreshed=0;
   window.panel=createPartnerPanel({client:{rpc:async(name,args)=>{calls.push({name,args});return {error:null};}},getWorkspace:()=>ws,getUser:()=>({id:'user-a'}),canManage:()=>true,onUpdate:async()=>{refreshed++;},toast:msg=>messages.push(msg)});
   window.snapshot={version:1,source:'pmx-partners',projectCode:'070120',date:'2026-11-10',fetchedAt:new Date().toISOString(),partners:[{companyNm:'테스트 협력사',contracts:['도장']}]};panel.review(snapshot);
  }''')
  assert await page.locator('#partnerReview').is_visible()
  assert await page.evaluate('calls.length')==0
  await page.locator('#partnerApply').click()
  assert await page.evaluate('calls[0].args.p_workspace')=='site-a'
  assert await page.evaluate('calls[0].args.p_project_code')=='070120'
  assert await page.evaluate('refreshed')==1
  await page.evaluate("panel.review(snapshot);ws={...ws,id:'site-b'}")
  await page.locator('#partnerApply').click()
  assert await page.evaluate('calls.length')==1
  await page.evaluate("panel.review({...snapshot,projectCode:'999999'})")
  assert await page.evaluate("messages.at(-1).includes('다릅니다')")
  assert not errors,errors
  await browser.close()
  print('PASS: explicit partner review, scoped RPC, refresh, workspace-switch and wrong-code rejection')
asyncio.run(main())
