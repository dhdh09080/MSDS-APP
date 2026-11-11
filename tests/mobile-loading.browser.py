"""Mobile startup and on-demand tools regression (Vite dev + production preview).
Run preview on 3000 and dev on 3001; requires Python Playwright and Chromium.
All fixtures are synthetic; this test never writes to the production database.
"""
import asyncio
import io
import os
import subprocess
import zipfile
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
PROD = os.environ.get('BASE_URL', 'http://localhost:3000')
DEV = os.environ.get('DEV_URL', 'http://localhost:3001')

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        # A stalled postcode CDN must not block authentication.
        async def stalled(route):
            await asyncio.sleep(8)
            try:
                await route.fulfill(status=200, body='')
            except Exception:
                pass
        await page.route('https://**/*', stalled)
        await page.goto(PROD, wait_until='commit')
        await page.wait_for_function("document.getElementById('loadingScreen').style.display === 'none'", timeout=6000)
        assert await page.locator('#loginBtn').is_visible()
        resources = await page.evaluate("performance.getEntriesByType('resource').map(r=>r.name)")
        assert not any(any(name in url for name in ['xlsx-', 'jszip.min-', 'measure-pdf-text-', 'measure-docx-', 'measure-analysis-', 'html2canvas', 'pdf-lib.min']) for url in resources), resources
        assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth')
        assert not errors, errors
        print('Production mobile: login renders while postcode CDN stalls; document tools stay unloaded; no console errors or horizontal overflow')
        await page.close()

        page = await browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.route('https://**/*', lambda route: route.fulfill(status=200, body=''))
        await page.goto(DEV + '/?preview=measure')
        await page.wait_for_function("document.getElementById('loadingScreen').style.display === 'none'")
        async with page.expect_download() as download:
            await page.evaluate('downloadMeasureDust()')
        data = Path(await (await download.value).path()).read_bytes()
        with zipfile.ZipFile(io.BytesIO(data)) as sheet:
            assert 'xl/workbook.xml' in sheet.namelist()
        async with page.expect_download() as download:
            await page.evaluate('downloadMeasureAfter()')
        data = Path(await (await download.value).path()).read_bytes()
        with zipfile.ZipFile(io.BytesIO(data)) as doc:
            assert 'document.xml' in ' '.join(doc.namelist())
            assert '내장목공사' in doc.read('word/document.xml').decode()
        print('On-demand Excel export and Word document generation: valid downloaded documents')

        fixture = subprocess.check_output(['node', '--input-type=module', '-e', "import * as X from 'xlsx'; const w=X.utils.book_new(); X.utils.book_append_sheet(w,X.utils.json_to_sheet([{'재직상태':'재직','협력회사':'시험업체','성명':'시험자','혈압':'Y','고령근로자여부':'Y'}]),'목록'); console.log(X.write(w,{type:'base64',bookType:'xlsx'}));"], cwd=ROOT).decode().strip()
        await page.evaluate("b => handleVulFile(new File([Uint8Array.from(atob(b),c=>c.charCodeAt(0))],'fixture.xlsx'))", fixture)
        await page.wait_for_function("document.getElementById('vulCnt2').textContent === '1'")
        async with page.expect_download() as download:
            await page.evaluate('downloadVulSignSheet()')
        assert (await download.value).suggested_filename.endswith('.xlsx')
        print('On-demand Excel import: synthetic worker classified and exported successfully')

        pdf = subprocess.check_output(['node', '--input-type=module', '-e', "import {PDFDocument,StandardFonts} from 'pdf-lib'; const d=await PDFDocument.create(); const p=d.addPage(); p.drawText(('Mobile PDF extraction regression test line.\\n').repeat(5),{size:12,x:40,y:700}); console.log(await d.saveAsBase64());"], cwd=ROOT).decode().strip()
        pages = await page.evaluate("async b => { const {extractMeasurePages}=await import('/src/lib/measure-pdf-text.js'); return extractMeasurePages(b); }", pdf)
        assert len(pages) == 1 and 'Mobile PDF extraction regression' in pages[0]['text']
        print('PDF text extraction: lazy module and worker load and process a synthetic PDF')

        # A failed optional CDN load must be retryable without reloading the page.
        await page.route('**/html2canvas.min.js', lambda route: route.abort())
        result = await page.evaluate("async () => {const {loadCaptureLibrary}=await import('/src/lib/optional-tools.js'); return Promise.allSettled([loadCaptureLibrary(),loadCaptureLibrary()]).then(r=>r.map(x=>x.status));}")
        assert result == ['rejected', 'rejected']
        await page.unroute('**/html2canvas.min.js')
        await page.route('**/html2canvas.min.js', lambda route: route.fulfill(status=200, body='window.html2canvas = async () => document.createElement("canvas");'))
        assert await page.evaluate("async () => {const {loadCaptureLibrary}=await import('/src/lib/optional-tools.js'); return typeof await loadCaptureLibrary() === 'function';}")
        assert not errors, errors
        print('Image capture loader: concurrent failure and retry succeed without page reload')
        await browser.close()

asyncio.run(main())
