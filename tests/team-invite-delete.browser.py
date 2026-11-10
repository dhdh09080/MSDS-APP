"""Administrator deletion for every link state, with synthetic RPC responses."""
import asyncio,os
from pathlib import Path
from playwright.async_api import async_playwright
BASE=os.environ.get('BASE_URL','http://localhost:3000');OUT=Path('work/invite-delete-preview')
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 links=[dict(id='active',role='member',expires_at='2099-11-10T00:00:00Z',revoked_at=None,accepted_at=None),dict(id='used',role='member',expires_at='2099-11-10T00:00:00Z',revoked_at=None,accepted_at='2026-11-09T00:00:00Z'),dict(id='expired',role='member',expires_at='2020-11-10T00:00:00Z',revoked_at=None,accepted_at=None),dict(id='revoked',role='member',expires_at='2099-11-10T00:00:00Z',revoked_at='2026-11-09T00:00:00Z',accepted_at=None)]
 calls=[];errors=[];fail=True
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await browser.new_page(viewport=dict(width=1440,height=1000));page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('dialog',lambda d:d.accept())
  async def api(route):
   nonlocal fail
   url=route.request.url;data=route.request.post_data_json or {}
   if 'list_workspace_team' in url:return await route.fulfill(json=[dict(id='member1',user_id='preview-user',role='admin',user=dict(email='manager@example.test',raw_user_meta_data=dict(name='현장 관리자'))),dict(id='member2',user_id='worker',role='member',user=dict(email='worker@example.test',raw_user_meta_data=dict(name='팀원')))])
   if 'list_workspace_invite_links' in url:return await route.fulfill(json=links)
   if 'list_workspace_join_requests' in url:return await route.fulfill(json=[])
   if 'create_workspace_invite_link' in url:
    link=dict(id='new',role='member',expires_at='2099-11-10T00:00:00Z',revoked_at=None,accepted_at=None);links.append(link)
    return await route.fulfill(json=dict(id=link['id'],token='a'*64,expiresAt=link['expires_at'],role='member'))
   if 'delete_workspace_invite_link' in url:
    calls.append(data['p_id'])
    if fail:fail=False;return await route.fulfill(status=403,json=dict(message='잠시 후 다시 시도해 주세요.'))
    links[:]=[link for link in links if link['id']!=data['p_id']]
    return await route.fulfill(status=204)
   return await route.fulfill(json=[])
  await page.route('**/*.supabase.co/**',api)
  await page.goto(BASE+'/?preview=pmx');await page.locator('#pmxDashboard').wait_for()
  await page.evaluate("showPage('settings');refreshWorkspaceTeam()")
  await page.locator('[data-delete-invite]').nth(3).wait_for()
  await page.locator('[data-delete-invite=active]').click()
  await page.locator('[data-delete-invite=active]:not([disabled])').wait_for()
  assert len(links)==4
  for state in ['active','used','expired','revoked']:
   await page.locator(f'[data-delete-invite={state}]').click()
   await page.locator(f'[data-delete-invite={state}]').wait_for(state='detached')
  assert len(links)==0 and '팀원' in await page.locator('#memberList').inner_text()
  await page.get_by_role('button',name='+ 초대 링크 만들기',exact=True).click()
  await page.locator('#inviteBtn').click();await page.locator('#teamInviteResult:not([hidden])').wait_for()
  await page.evaluate("closeModal('inviteModal')")
  await page.locator('[data-delete-invite=new]').click()
  await page.locator('[data-delete-invite=new]').wait_for(state='detached')
  assert await page.locator('#teamInviteUrl').input_value()==''
  await page.locator('#memberList').scroll_into_view_if_needed()
  await page.screenshot(path=str(OUT/'team-desktop.png'))
  assert calls==['active','active','used','expired','revoked','new']
  assert not errors,errors
  await browser.close()
 print('PASS: all invite states deletable, failed delete retry, created-link URL cleared, member roster retained')
asyncio.run(main())
