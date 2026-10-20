"""Offline Chromium PDF regression. Run via npm run test:print (see tests/PRINTING.md)."""
import asyncio
import json
import os
import traceback
from pathlib import Path
from urllib.parse import urlsplit

import fitz
from PIL import Image
from playwright.async_api import async_playwright
import zxingcpp

OUT = Path(os.environ.get('PRINT_ARTIFACT_DIR', 'artifacts/warning-print'))
URL = os.environ.get('BASE_URL', 'http://127.0.0.1:3000')
RESULTS = []

# Measure actual text fragments too: an overflow:hidden wrapper alone can appear to fit.
GEOMETRY = r'''() => [...document.querySelectorAll('.wlabel')].map(l => {
    const rect = e => e.getBoundingClientRect();
    const inside = (a,b) => a.left >= b.left-1 && a.right <= b.right+1 && a.top >= b.top-1 && a.bottom <= b.bottom+1;
    const r=rect(l), v=rect(l.querySelector('.wl-body-viewport'));
    const q=rect(l.querySelector('.wl-qr')), foot=rect(l.querySelector('.wl-foot'));
    const c=l.querySelector('.wl-fit-content');
    const walker=document.createTreeWalker(l, NodeFilter.SHOW_TEXT);
    let node, textFits=true;
    while (node=walker.nextNode()) {
        if (!node.textContent.trim() || node.parentElement.closest('svg')) continue;
        const range=document.createRange(); range.selectNodeContents(node);
        const container=c.contains(node) ? v : r;
        for (const fragment of range.getClientRects()) {
            if (!inside(fragment,container)) textFits=false;
        }
    }
    return {qrInside:inside(q,r), footerInside:inside(foot,r), bodyFits:inside(rect(c),v), textFits,
        footerClear:v.bottom <= foot.top+1,
        supplierClear:!l.querySelector('.wl-foot-row') || foot.right <= q.left+1,
        scale:Number(l.dataset.fitScale)};
})'''


async def case(browser, context, size, per, copies, lengthy):
    stem = f'{size}-' + ('long' if lengthy else 'normal') + f'-{copies}'
    result = {'case': stem, 'status': 'failed'}
    RESULTS.append(result)
    page = await context.new_page()
    paper = None
    try:
        # Override before iframe creation, avoiding the timer race with native print/cleanup.
        await page.add_init_script('window.print = () => {};')
        await page.goto(f'{URL}/?preview=warning')
        await page.wait_for_selector('#warnPrintSelectedBtn:not([disabled])')
        await page.select_option('#warnSizeSel', size)
        await page.evaluate('(n) => setWarnCopies(n)', copies)
        await page.locator('#warnPrintSelectedBtn').click()
        iframe = page.locator('#__printFrame')
        await iframe.wait_for(state='attached')
        await iframe.evaluate('(f) => { f.contentWindow.print = () => {}; }')
        frame = await (await iframe.element_handle()).content_frame()
        await frame.wait_for_selector('.wlabel')
        assert await iframe.evaluate('(f) => Math.abs(f.clientWidth - 210*96/25.4) < 2'), 'iframe must be A4 width'
        html = await frame.content()
        paper = await context.new_page(viewport={'width': 530, 'height': 1000})
        await paper.goto(URL)
        await paper.set_content(html, wait_until='load')
        await paper.evaluate('''async () => {
            await document.fonts.ready;
            await Promise.all([...document.images].map(i => i.decode()));
        }''')
        if lengthy:
            # Test-only DOM mutations: never writes MSDS records or production APIs.
            await paper.evaluate('''() => {
                document.querySelectorAll('.wl-safety-text').forEach(e => {
                    e.textContent = (e.textContent + '\\n').repeat(8) + ' LONG_SAFETY_END';
                });
                document.querySelectorAll('.wl-name-box').forEach(e => {
                    e.textContent += ' 장문 제품명 시험용 도료 및 에폭시 혼합제품';
                });
                document.querySelectorAll('.wl-foot > div:first-child').forEach(e => {
                    e.textContent += ' 공급업체 긴 상호 시험용 안전화학 주식회사 연락처 02-1234-5678 SUPPLIER_END';
                });
            }''')
        await paper.emulate_media(media='print')
        await paper.evaluate("() => window.dispatchEvent(new Event('beforeprint'))")
        bounds = await paper.evaluate(GEOMETRY)
        result['geometry'] = bounds
        await paper.screenshot(path=str(OUT / f'{stem}-dom.png'), full_page=True)
        await paper.pdf(path=str(OUT / f'{stem}.pdf'), format='A4', prefer_css_page_size=True, print_background=True)
        # Save evidence before asserting so failed cases remain inspectable.
        counts = []
        texts = []
        expected_qr = await paper.locator('.wl-qr-img svg').first.get_attribute('aria-label')
        with fitz.open(OUT / f'{stem}.pdf') as pdf:
            result['pages'] = len(pdf)
            for i, sheet in enumerate(pdf):
                pix = sheet.get_pixmap(matrix=fitz.Matrix(3, 3), colorspace=fitz.csRGB)
                img = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
                img.save(OUT / f'{stem}-page-{i+1}.png')
                codes = zxingcpp.read_barcodes(img)
                assert all('/functions/v1/msds-view?id=msds-1' in c.text for c in codes), [c.text for c in codes]
                counts.append(len(codes))
                texts.append(sheet.get_text())
            result['qr_per_page'] = counts
        expected = [min(per, copies-i) for i in range(0, copies, per)]
        assert counts == expected, ('QR/page count', counts, expected)
        assert result['pages'] == len(expected), result
        assert len(bounds) == copies and all(all(v for k,v in b.items() if k != 'scale') for b in bounds), bounds
        if lengthy:
            assert sum(t.count('SUPPLIER_END') for t in texts) == copies, 'supplier text clipped in PDF'
            if size != 'mini':
                assert sum(t.count('LONG_SAFETY_END') for t in texts) == copies * 2, 'long safety text clipped in PDF'
        result['status'] = 'passed'
        print(f'PASS {stem}: {len(expected)} pages, QR {counts}', flush=True)
    except Exception:
        result['error'] = traceback.format_exc()
        print(f'FAIL {stem}: {result["error"]}', flush=True)
        if paper:
            await paper.screenshot(path=str(OUT / f'{stem}-failure.png'), full_page=True)
    finally:
        if paper:
            await paper.close()
        await page.close()


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    assert urlsplit(URL).hostname in ('localhost', '127.0.0.1'), 'Only a local fixture server is allowed'
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=os.environ.get('CHROMIUM_PATH') or None,
            args=['--no-sandbox'],
        )
        context = await browser.new_context(viewport={'width': 1600, 'height': 1000}, service_workers='block')
        async def local_only(route):
            if urlsplit(route.request.url).netloc == urlsplit(URL).netloc:
                await route.continue_()
            else:
                await route.abort()
        await context.route('**/*', local_only)
        try:
            for size, per in [('a4', 1), ('a5', 2), ('a6', 4), ('mini', 8)]:
                for copies, lengthy in [(1, False), (per, False), (per+1, False), (per+1, True)]:
                    # A4 single and full-sheet are the same case.
                    if per == 1 and copies == 1 and len([r for r in RESULTS if r['case']=='a4-normal-1']):
                        continue
                    await case(browser, context, size, per, copies, lengthy)
        finally:
            await browser.close()
            (OUT / 'results.json').write_text(json.dumps(RESULTS, ensure_ascii=False, indent=2))
            summary = '# Warning print PDF regression\n\nSynthetic preview records; external requests blocked. Physical printer output is not verified.\n\n| Case | Result | Pages | Decoded QR per page |\n|---|---|---|---|\n'
            summary += '\n'.join(f'| {r["case"]} | {r["status"]} | {r.get("pages", "-")} | {r.get("qr_per_page", "-")} |' for r in RESULTS)
            (OUT / 'summary.md').write_text(summary + '\n')
    assert RESULTS and all(r['status']=='passed' for r in RESULTS), 'Print regression failed; inspect artifacts/warning-print'


asyncio.run(main())
