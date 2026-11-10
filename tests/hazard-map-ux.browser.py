"""Category/search/review navigation on desktop and phones, synthetic data only."""
import asyncio,json,os
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from playwright.async_api import async_playwright
BASE=os.environ.get('BASE_URL','http://localhost:3000'); OUT=Path('work/hazard-ux-preview')
PLAN='''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700"><rect width="1200" height="700" fill="#f5f7f9"/><g fill="#e3e9ec" stroke="#8b9da7" stroke-width="8"><rect x="70" y="70" width="330" height="230"/><rect x="480" y="70" width="640" height="230"/><rect x="70" y="400" width="620" height="230"/><rect x="780" y="400" width="340" height="230"/></g><g font-family="sans-serif" fill="#748a97" font-size="27"><text x="120" y="195">PIT / EAST</text><text x="650" y="195">PIT / WEST</text><text x="235" y="530">WAREHOUSE</text><text x="880" y="530">GATE</text></g></svg>'''
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 markers=[dict(id=f'm{i}',workspace_id='preview-workspace',map_id='plan',storage_name=name,marker_type=kind,review_status=state,contractor_id=co,x=x,y=y,items=[],content=content,review_note=note) for i,(name,kind,state,co,x,y,content,note) in enumerate([
 ('PIT 동측 통로 적치물 정리','issue','open','con-3',.20,.23,'통행로 적치물을 정리해 주세요',''),
 ('PIT 서측 안전난간 보완','issue','pending','con-1',.66,.23,'조치 사진을 확인해 주세요',''),
 ('PIT 출입구 정비','issue','verified','con-3',.86,.76,'출입구 정리 완료','안전팀 확인 완료'),
 ('지하 자재 창고','warehouse','open','con-1',.30,.72,'자재 적치 상태 확인',''),
 ('정문','gate','open',None,.90,.57,'현장 공용 출입구',''),
 ('동측 위험물 저장소','hazard','open','con-3',.75,.46,'화기 엄금','')])]
 maps=[dict(id='plan',workspace_id='preview-workspace',title='PIT층 도면 · 지하 1층',storage_path='plan.svg',width=1200,height=700),dict(id='second',workspace_id='preview-workspace',title='지상 1층 도면',storage_path='plan.svg',width=1200,height=700)]
 errors=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await browser.new_page(viewport=dict(width=1440,height=1000),has_touch=True);page.on('pageerror',lambda e:errors.append(str(e)))
  async def api(route):
   req=route.request;u=urlparse(req.url);q=parse_qs(u.query)
   if '/storage/v1/object/sign/' in u.path:
    if req.method=='POST':return await route.fulfill(json={'signedURL':'/object/sign/hazard-map-photos/plan.svg?token=fixture'})
    return await route.fulfill(content_type='image/svg+xml',body=PLAN)
   if u.path.endswith('/hazard_maps'):return await route.fulfill(json=maps)
   if u.path.endswith('/hazard_markers'):return await route.fulfill(json=markers if q.get('map_id',[''])[0]=='eq.plan' else [])
   if u.path.endswith('/hazard_location_photos'):return await route.fulfill(json=[])
   return await route.fulfill(json=[])
  await page.route('**/*.supabase.co/**',api)
  await page.goto(BASE+'/?preview=hazard-map');await page.locator('.hm-storage-card').nth(5).wait_for()
  assert await page.locator('[data-count=all]').inner_text()=='3'
  assert await page.locator('[data-count=pending]').inner_text()=='1'
  await page.locator('.hm-help summary').click();assert '도면 등록' in await page.locator('.hm-help').inner_text();await page.locator('.hm-help summary').click()
  await page.locator('[data-quick-status=pending]').click()
  assert await page.locator('.hm-storage-card').count()==1 and await page.locator('.hm-pin').count()==1
  assert '안전난간' in await page.locator('.hm-storage-card').inner_text()
  assert await page.locator('.hm-number').inner_text()=='2' # Original identity remains stable when filtered.
  await page.locator('[data-hm-view=list]').click();assert not await page.locator('.hm-photo-card').is_visible()
  await page.locator('[data-action=locate]').click();assert await page.locator('.hm-photo-card').is_visible()
  assert await page.locator('.hm-pin.is-selected').count()==1
  await page.locator('#hmRefresh').click();await page.locator('.hm-storage-card').wait_for()
  assert await page.locator('#hmStateFilter').input_value()=='pending'
  await page.locator('#hmClearFilters').click()
  await page.locator('#hmTypeFilter').select_option('warehouse');assert '창고' in await page.locator('.hm-storage-card').inner_text()
  await page.locator('#hmContractorFilter').select_option('con-3');assert await page.locator('.hm-storage-card').count()==0
  await page.locator('[data-action=clear-filters]').click();assert await page.locator('.hm-storage-card').count()==6
  await page.locator('#hmContractorFilter').select_option('unassigned');assert await page.locator('.hm-storage-card h3').inner_text()=='정문'
  await page.locator('#hmClearFilters').click()
  await page.locator('#hmSearch').press_sequentially('PIT',delay=45)
  assert await page.locator('#hmSearch').evaluate('e=>document.activeElement===e')
  assert await page.locator('.hm-pin').count()==3
  await page.locator('#hmSearch').fill('성우도장');assert await page.locator('.hm-storage-card').count()==3
  await page.locator('#hmSearch').fill('없는 위치');assert '조건에 맞는 위치가 없습니다' in await page.locator('.hm-list-empty').inner_text()
  await page.locator('#hmMapSelect').select_option('second');assert await page.locator('#hmSearch').input_value()==''
  assert await page.locator('.hm-storage-card').count()==0
  await page.locator('#hmMapSelect').select_option('plan');await page.locator('.hm-storage-card').nth(5).wait_for()
  await page.locator('[data-quick-status=verified]').click();assert '안전팀 확인 완료' in await page.locator('.hm-review-note').inner_text()
  await page.locator('[data-quick-status=pending]').click()
  for width in [360,390,768,1440]:
   await page.set_viewport_size(dict(width=width,height=1000))
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
   await page.evaluate('scrollTo(0,0)')
   await page.screenshot(path=str(OUT/f'overview-{width}.png'),full_page=True)
  # Both directions between common map pins and cards respond without exposing editing.
  await page.locator('#hmClearFilters').click()
  await page.locator('[data-location-id=m4] [data-action=locate]').click()
  assert await page.locator('.hm-storage-card.is-highlighted h3').inner_text()=='정문'
  assert not errors,errors
  await browser.close()
 print('PASS: issue counts, category/status/company/search intersections, stable numbering, input focus, no-results reset, refresh retention, map selection reset, list/map navigation, common-pin viewing and 360/390/768/1440px')
asyncio.run(main())
