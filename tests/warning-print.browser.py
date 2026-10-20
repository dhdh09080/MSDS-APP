"""Print regression: npm run dev -- --host 0.0.0.0, then run this script.
Requires Python playwright, pymupdf, pillow, zxing-cpp and Chromium.
BASE_URL, CHROMIUM_PATH and PRINT_ARTIFACT_DIR may override local defaults.
"""
import asyncio
import os
from pathlib import Path

import fitz
from PIL import Image
from playwright.async_api import async_playwright
import zxingcpp


async def main():
    out = Path(os.environ.get('PRINT_ARTIFACT_DIR', '/tmp/warning-print'))
    out.mkdir(parents=True, exist_ok=True)
    url = os.environ.get('BASE_URL', 'http://localhost:3002')
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'),
            args=['--no-sandbox'],
        )
        page = await browser.new_page(viewport={'width': 1600, 'height': 1000})
        await page.goto(f'{url}/?preview=warning')
        await page.wait_for_selector('#warnPrintSelectedBtn:not([disabled])')
        for size, per_page in [('a4', 1), ('a5', 2), ('a6', 4), ('mini', 8)]:
            await page.select_option('#warnSizeSel', size)
            await page.evaluate('(n) => setWarnCopies(n)', per_page + 1)
            await page.locator('#warnPrintSelectedBtn').click()
            await page.locator('#__printFrame').evaluate('(f) => { f.contentWindow.print = () => {}; }')
            await page.wait_for_timeout(600)
            frame = page.frames[-1]
            assert await page.locator('#__printFrame').evaluate('(f) => f.clientWidth') > 790
            html = await frame.content()
            paper = await browser.new_page(viewport={'width': 530, 'height': 1000})
            await paper.goto(url)
            await paper.set_content(html, wait_until='load')
            await paper.evaluate('''async () => {
                await document.fonts.ready;
                await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
            }''')
            for lengthy in [False, True] if size != 'mini' else [False]:
                if lengthy:
                    await paper.evaluate('''() => document.querySelectorAll('.wl-safety-text').forEach(e => {
                        e.textContent = (e.textContent + '\\n').repeat(8);
                    })''')
                await paper.emulate_media(media='print')
                await paper.evaluate("() => window.dispatchEvent(new Event('beforeprint'))")
                bounds = await paper.evaluate('''() => [...document.querySelectorAll('.wlabel')].map(l => {
                    const r = l.getBoundingClientRect(), q = l.querySelector('.wl-qr').getBoundingClientRect();
                    const v = l.querySelector('.wl-body-viewport').getBoundingClientRect();
                    const c = l.querySelector('.wl-fit-content').getBoundingClientRect();
                    return {inside: q.bottom < r.bottom && q.right <= r.right && q.top >= r.top,
                        bodyFits: c.bottom <= v.bottom + 1, footerClear: !l.querySelector('.wl-foot-row') || v.bottom <= q.top};
                })''')
                assert all(all(v.values()) for v in bounds), (size, lengthy, bounds)
                stem = f'qr-fixed-{size}' + ('-long' if lengthy else '')
                pdf_path = out / f'{stem}.pdf'
                await paper.pdf(path=str(pdf_path), format='A4', print_background=True)
                pdf = fitz.open(pdf_path)
                assert len(pdf) == 2, (stem, len(pdf))
                # Decode the actual printed pixels, not the DOM's QR source.
                counts = []
                for sheet in pdf:
                    pix = sheet.get_pixmap(matrix=fitz.Matrix(3, 3))
                    codes = zxingcpp.read_barcodes(Image.frombytes('RGB', [pix.width, pix.height], pix.samples))
                    assert all('/functions/v1/msds-view?id=' in c.text for c in codes)
                    counts.append(len(codes))
                assert counts == [per_page, 1], (stem, counts)
                pdf[0].get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(str(out / f'{stem}.png'))
                print(f'{stem}: 2 pages, {sum(counts)} readable QR codes, body and footer within borders')
            await paper.close()
        await browser.close()


asyncio.run(main())
