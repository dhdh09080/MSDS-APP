"""Panorama/sticker flow with synthetic API/storage responses; no customer writes."""
import asyncio, json, os, struct, zlib
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
OUT = Path('/workspace/scratch/hazard-map-preview')

def png(width=1200, height=700):
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    # A fixture image makes coordinate alignment visible without customer photos.
    pixels = b''.join(b'\0' + bytes([210 + (y // 100) % 2 * 15, 225, 214]) * width for y in range(height))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    maps, markers, uploads, errors = [], [], [], []
    storage_files = {}
    fail = {'save': False, 'delete': False, 'load': False, 'map': False}
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width': 1440, 'height': 1000}, has_touch=True)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('dialog', lambda dialog: dialog.accept())

        async def api(route):
            req = route.request
            url = urlparse(req.url)
            query = parse_qs(url.query)
            if '/storage/v1/object/sign/' in url.path:
                key = url.path.split('/object/sign/hazard-map-photos/', 1)[1]
                if req.method == 'POST':
                    return await route.fulfill(json={'signedURL': '/object/sign/hazard-map-photos/' + key + '?token=fixture'})
                return await route.fulfill(content_type='image/png', body=storage_files.get(key, png()))
            if '/storage/v1/object/hazard-map-photos/' in url.path:
                uploads.append(url.path)
                body = req.post_data_buffer
                start = body.index(b'\x89PNG\r\n\x1a\n')
                storage_files[url.path.split('/object/hazard-map-photos/', 1)[1]] = body[start:body.index(b'IEND', start)+8]
                return await route.fulfill(json={'Key': url.path, 'Id': 'fixture'})
            if '/storage/v1/object/hazard-map-photos' in url.path:
                for key in json.loads(req.post_data or '{}').get('prefixes', []):
                    storage_files.pop(key, None)
                return await route.fulfill(json=[])
            is_map = url.path.endswith('/hazard_maps')
            if not is_map and not url.path.endswith('/hazard_markers'):
                return await route.fulfill(json=[])
            collection = maps if is_map else markers
            args = json.loads(req.post_data or '{}')
            if req.method == 'GET':
                if fail['load'] and is_map:
                    return await route.fulfill(status=500, json={'message': 'fixture load failure'})
                rows = [row for row in collection if all(query.get(key, ['eq.' + row[key]])[0] == 'eq.' + row[key] for key in ['workspace_id'] + ([] if is_map else ['map_id']))]
                return await route.fulfill(json=rows)
            if (fail['save'] and not is_map) or (fail['map'] and is_map and req.method in ['POST', 'PATCH']) or (fail['delete'] and req.method == 'DELETE'):
                return await route.fulfill(status=403, json={'message': 'fixture permission failure'})
            if req.method == 'POST':
                row = dict(args, id=args.get('id', f'fixture-marker-{len(collection)+1}'), created_at='2026-10-23T01:00:00Z')
                collection.append(row)
            else:
                row = next(row for row in collection if query['id'][0] == 'eq.' + row['id'])
                if req.method == 'PATCH':
                    row.update(args)
                if req.method == 'DELETE':
                    collection.remove(row)
                    if is_map:
                        markers[:] = [marker for marker in markers if marker['map_id'] != row['id']]
            return await route.fulfill(json=row)

        await page.route('**/*.supabase.co/**', api)
        await page.goto(BASE + '/?preview=hazard-map')
        await page.get_by_role('button', name='첫 전경 사진 업로드').wait_for()
        await page.locator('#hmUpload').click()
        await page.locator('#hmUploadForm [name=title]').fill('현장 전체 전경')
        await page.locator('#hmUploadForm [name=photo]').set_input_files({'name': 'bad.txt', 'mimeType': 'text/plain', 'buffer': b'not an image'})
        await page.locator('#hmUploadForm button[type=submit]').click()
        await page.get_by_text('JPG, PNG, WebP 사진을 선택해 주세요.', exact=True).wait_for()
        assert not uploads
        await page.locator('#hmUploadForm [name=photo]').set_input_files({'name': 'corrupt.png', 'mimeType': 'image/png', 'buffer': b'not an image'})
        await page.locator('#hmUploadForm button[type=submit]').click()
        await page.locator('#hmUploadForm .hm-form-error').get_by_text('업로드 실패:', exact=False).wait_for()
        assert not uploads
        await page.locator('#hmUploadForm [name=photo]').set_input_files({'name': 'site.png', 'mimeType': 'image/png', 'buffer': png()})
        await page.locator('#hmUploadForm button[type=submit]').click()
        await page.locator('#hmPhoto').wait_for()
        await page.wait_for_function('document.querySelector("#hmPhoto").naturalWidth > 0')
        assert len(maps) == 1 and len(uploads) == 1

        async def place(x, y):
            box = await page.locator('#hmPhoto').bounding_box()
            await page.mouse.click(box['x'] + box['width'] * x, box['y'] + box['height'] * y)
        await place(.23, .62)
        form = page.locator('#hmMarkerForm')
        await form.locator('[name=storage_name]').fill('동측 위험물 저장소')
        assert await form.locator('[name=manager]').count() == 0
        await form.locator('[name=item_name]').fill('신나')
        await form.locator('[name=item_quantity]').fill('20 L × 10통')
        await page.locator('#hmAddItem').click()
        await form.locator('[name=item_name]').nth(1).fill('페인트')
        await form.locator('[name=item_quantity]').nth(1).fill('18 L × 5통')
        await form.locator('[name=contractor_id]').select_option('con-3')
        await form.locator('[name=access_code]').fill('1234')
        await form.locator('[name=content]').fill('화기 엄금\n매일 점검')
        await page.screenshot(path=str(OUT / 'updated-popup.png'), full_page=True, animations='disabled')
        await form.locator('button[type=submit]').click()
        await page.locator('#hmMarkerDialog').wait_for(state='hidden')
        assert abs(markers[0]['x'] - .23) < .005 and abs(markers[0]['y'] - .62) < .005, markers[0]
        assert '20 L × 10통' in await page.locator('.hm-storage-card').inner_text()
        assert markers[0]['items'] == [{'name': '신나', 'quantity': '20 L × 10통'}, {'name': '페인트', 'quantity': '18 L × 5통'}]
        assert markers[0]['contractor_id'] == 'con-3' and markers[0]['access_code'] == '1234'
        assert '성우도장' in await page.locator('.hm-storage-card').inner_text()
        assert await form.locator('[name=access_code]').get_attribute('type') == 'text'
        await place(.80, .20)
        await form.locator('[name=storage_name]').fill('경유 저장소')
        fail['save'] = True
        await form.locator('button[type=submit]').click()
        await form.locator('.hm-form-error').get_by_text('저장 실패:', exact=False).wait_for()
        assert len(markers) == 1 and await page.locator('#hmMarkerDialog').is_visible()
        fail['save'] = False
        await form.locator('button[type=submit]').click()
        await page.locator('#hmMarkerDialog').wait_for(state='hidden')
        assert len(markers) == 2
        await page.reload()
        await page.locator('.hm-pin').nth(1).wait_for()
        await page.locator('.hm-pin').first.click()
        assert await form.locator('[name=contractor_id]').input_value() == 'con-3'
        assert await form.locator('[name=item_name]').nth(1).input_value() == '페인트'
        assert await form.locator('[name=access_code]').input_value() == '1234'
        await form.locator('[name=content]').fill('<img src=x onerror=alert(1)>\n소화기 비치')
        await form.locator('button[type=submit]').click()
        await page.locator('#hmMarkerDialog').wait_for(state='hidden')
        assert await page.locator('.hm-content img').count() == 0
        await page.locator('.hm-storage-card').first.get_by_role('button', name='위치 이동').click()
        await place(.43, .35)
        await page.wait_for_function('!document.querySelector(".hm-move-banner")')
        assert abs(markers[0]['x'] - .43) < .005 and abs(markers[0]['y'] - .35) < .005
        await page.locator('.hm-storage-card').first.get_by_role('button', name='위치 이동').click()
        await page.keyboard.press('Escape')
        assert await page.locator('.hm-move-banner').count() == 0
        # Real pointer movement saves once at drop and does not open the editor.
        async def mouse_drag(dx, dy):
            await page.locator('.hm-pin').first.scroll_into_view_if_needed()
            pin = await page.locator('.hm-pin').first.bounding_box()
            photo = await page.locator('#hmPhoto').bounding_box()
            x, y = pin['x'] + pin['width']/2, pin['y'] + pin['height']/2
            await page.mouse.move(x, y)
            await page.mouse.down()
            await page.mouse.move(x + photo['width']*dx, y + photo['height']*dy, steps=8)
            await page.mouse.up()
            await page.wait_for_function('!document.querySelector(".hm-pin.is-dragging")')
        before = dict(markers[0])
        await mouse_drag(.1, -.1)
        assert abs(markers[0]['x'] - before['x'] - .1) < .006
        assert abs(markers[0]['y'] - before['y'] + .1) < .006
        assert not await page.locator('#hmMarkerDialog').is_visible()
        before = dict(markers[0]); fail['save'] = True
        await mouse_drag(.05, .05)
        await page.get_by_text('위치 변경 실패:', exact=False).wait_for()
        assert markers[0] == before
        fail['save'] = False
        # Pointer cancellation restores the last saved position without a write.
        await page.locator('.hm-pin').first.scroll_into_view_if_needed()
        pin = await page.locator('.hm-pin').first.bounding_box()
        await page.mouse.move(pin['x'] + pin['width']/2, pin['y'] + pin['height']/2)
        await page.mouse.down()
        await page.mouse.move(pin['x'] + 70, pin['y'] + 40, steps=5)
        await page.keyboard.press('Escape')
        await page.mouse.up()
        assert markers[0] == before
        # Touch dragging leaves normal page scrolling available outside stickers.
        await page.set_viewport_size({'width': 390, 'height': 1000})
        await page.locator('.hm-pin').first.scroll_into_view_if_needed()
        pin = await page.locator('.hm-pin').first.bounding_box()
        photo = await page.locator('#hmPhoto').bounding_box()
        sx, sy = pin['x'] + pin['width']/2, pin['y'] + pin['height']/2
        cdp = await page.context.new_cdp_session(page)
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': sx, 'y': sy}]})
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': sx + 24, 'y': sy + 16}]})
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        await page.wait_for_function('!document.querySelector(".hm-pin.is-dragging")')
        assert abs(markers[0]['x'] - before['x'] - 24/photo['width']) < .009
        assert abs(markers[0]['y'] - before['y'] - 16/photo['height']) < .009
        assert not await page.locator('#hmMarkerDialog').is_visible()
        await cdp.detach()
        await page.set_viewport_size({'width': 1440, 'height': 1000})
        # All five types are distinguishable; building/gate names appear on-photo.
        for kind, name, px, py in [('locker', '락카 보관함', .15, .2), ('fuel', '유류 저장소', .8, .7), ('building', '101동', .55, .15), ('gate', '정문', .65, .8)]:
            await page.locator('#hmPhoto').scroll_into_view_if_needed()
            await place(px, py)
            await form.locator('[name=marker_type]').select_option(kind)
            await form.locator('[name=storage_name]').fill(name)
            assert await page.locator('#hmStorageFields').is_visible() == (kind not in ['building', 'gate'])
            await form.locator('button[type=submit]').click()
            await page.locator('#hmMarkerDialog').wait_for(state='hidden')
            assert await page.locator(f'.hm-pin.hm-type-{kind}').count() == 1
        assert await page.locator('.hm-pin.hm-type-building').inner_text() == '101동'
        assert await page.locator('.hm-pin.hm-type-gate').inner_text() == '정문'
        await page.locator('#toastWrap .toast').last.wait_for(state='detached')
        await page.screenshot(path=str(OUT / 'updated-stickers.png'), full_page=True, animations='disabled')
        # Replace with a different aspect ratio while retaining every sticker row.
        snapshot = json.loads(json.dumps(markers)); old_map = dict(maps[0]); old_files = dict(storage_files)
        await page.locator('[data-action=replace-photo]').click()
        await page.locator('#hmUploadForm [name=photo]').set_input_files({'name': 'new-site.png', 'mimeType': 'image/png', 'buffer': png(400, 900)})
        fail['map'] = True
        await page.locator('#hmUploadForm button[type=submit]').click()
        await page.locator('#hmUploadForm .hm-form-error').get_by_text('업로드 실패:', exact=False).wait_for()
        assert maps[0] == old_map and markers == snapshot and storage_files == old_files
        fail['map'] = False
        await page.locator('#hmUploadForm button[type=submit]').click()
        await page.locator('#hmUploadDialog').wait_for(state='hidden')
        await page.wait_for_function('!document.querySelector("#hmRefresh").disabled')
        assert len(maps) == 1 and maps[0]['id'] == old_map['id']
        assert maps[0]['storage_path'] != old_map['storage_path'] and maps[0]['width'] == 400 and maps[0]['height'] == 900
        assert old_map['storage_path'] not in storage_files and maps[0]['storage_path'] in storage_files
        assert markers == snapshot
        await page.reload()
        await page.locator('.hm-pin').nth(5).wait_for()
        assert markers == snapshot
        for width in [360, 390, 768, 1440]:
            await page.set_viewport_size({'width': width, 'height': 1000})
            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            box = await page.locator('#hmPhoto').bounding_box()
            pin = await page.locator('.hm-pin').first.bounding_box()
            assert abs((pin['x'] + pin['width']/2 - box['x'])/box['width'] - markers[0]['x']) < .003
            assert abs((pin['y'] + pin['height']/2 - box['y'])/box['height'] - markers[0]['y']) < .003
            if width in [390, 1440]:
                await page.screenshot(path=str(OUT / f'{width}.png'), full_page=True)

        fail['delete'] = True
        await page.locator('.hm-storage-card').first.get_by_role('button', name='삭제', exact=True).click()
        await page.get_by_text('삭제 실패:', exact=False).wait_for()
        assert len(markers) == 6
        fail['delete'] = False
        await page.locator('.hm-storage-card').nth(1).get_by_role('button', name='삭제', exact=True).click()
        await page.wait_for_function('document.querySelectorAll(".hm-pin").length === 5')
        await page.locator('#hmUpload').click()
        await page.locator('#hmUploadForm [name=title]').fill('지하 1층 전경')
        await page.locator('#hmUploadForm [name=photo]').set_input_files({'name': 'basement.png', 'mimeType': 'image/png', 'buffer': png(400, 900)})
        fail['map'] = True
        await page.locator('#hmUploadForm button[type=submit]').click()
        await page.locator('#hmUploadForm .hm-form-error').get_by_text('업로드 실패:', exact=False).wait_for()
        assert len(maps) == 1
        fail['map'] = False
        await page.locator('#hmUploadForm button[type=submit]').click()
        await page.locator('#hmUploadDialog').wait_for(state='hidden')
        await page.wait_for_function('document.querySelector("#hmMapSelect").options.length === 2')
        assert await page.locator('.hm-pin').count() == 0
        await page.locator('#hmMapSelect').select_option(maps[0]['id'])
        await page.locator('.hm-pin').first.wait_for()
        fail['load'] = True
        await page.locator('#hmRefresh').click()
        await page.get_by_text('위치도를 불러오지 못했습니다.', exact=True).wait_for()
        fail['load'] = False
        await page.locator('#hmRefresh').click()
        await page.locator('.hm-pin').first.wait_for()
        await page.locator('[data-action=delete-map]').click()
        await page.wait_for_function('document.querySelector("#hmMapSelect").options.length === 1')
        assert len(maps) == 1 and len(markers) == 0
        # A slow previous site's response must not replace the current site's UI.
        race_result = await page.evaluate('''async () => {
          const { createHazardMap } = await import('/src/lib/hazard-map.js');
          let workspace = { id: 'old-site' }, release;
          const pending = new Promise(resolve => { release = resolve; });
          const client = {
            from() {
              let site;
              const query = {
                select() { return this; },
                eq(key, value) { if (key === 'workspace_id') site = value; return this; },
                order() { return this; },
                then(resolve, reject) { return (site === 'old-site' ? pending : Promise.resolve({ data: [], error: null })).then(resolve, reject); }
              };
              return query;
            }
          };
          const controller = createHazardMap({ supabase: client, getWorkspace: () => workspace, getUser: () => ({ id: 'fixture' }), toast() {} });
          const previous = controller.show();
          await Promise.resolve();
          controller.reset(); workspace = { id: 'new-site' };
          await controller.show();
          release({ data: [{ id: 'old-photo', title: 'STALE SITE PHOTO' }], error: null });
          await previous;
          const result = !document.querySelector('#hazardMapRoot').textContent.includes('STALE SITE PHOTO') && document.querySelector('#hmMapSelect').value === '';
          controller.reset();
          return result;
        }''')
        assert race_result, 'Late response leaked previous workspace state'
        assert not errors, errors
        await browser.close()
    print('PASS: material quantities, contractor/code, all five sticker types, mouse/touch drag and cancellation/failure rollback, aspect-ratio photo replacement preserving all sticker data, upload cleanup/retry, persistence, 360/390/768/1440px, CRUD/escaping, workspace race isolation, no JS errors')

asyncio.run(main())
