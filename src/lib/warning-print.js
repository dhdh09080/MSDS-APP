import qrcode from 'qrcode-generator';
import { WARN_SIZES } from '../data/constants.js';
import { ghsPictogramWithLabel, decodeHCodes, decodePCodes, applyPictogramRules, condensePCodes } from './ghs.js';
import { renderPpe, labelSafetySections } from './warning-label.js';
import warningLabelStyles from '../warning-label.css?inline';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createWarningRenderer({ size = 'a4', qrEnabled = true, preview = false } = {}) {
const warnLabelSize = WARN_SIZES[size] ? size : 'a4';
const warnQrEnabled = qrEnabled;
const getDevPreviewPage = () => preview;
function warnQrSvg(r) {
  if (!warnQrEnabled || !r.pdf_path) return '';
  try {
    const base = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
    const qr = qrcode(0, 'M');
    qr.addData(`${base}/functions/v1/msds-view?id=${r.id}`);
    qr.make();
    return qr.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
  } catch {
    return '';
  }
}

function buildWarnLabel(r, site, size = warnLabelSize) {
  const isDanger = r.signal_word?.includes('위험');
  const rawCodes = (r.pictograms || '').match(/GHS\d{2}/g) || [];
  const { codes } = applyPictogramRules(rawCodes); // 법정 규칙: GHS06>GHS07, 최대 4개
  const cfg = WARN_SIZES[size] || WARN_SIZES.a4;
  const pictoHtml = codes.length
    ? codes.map((c) => ghsPictogramWithLabel(c, cfg.picto)).join('')
    : `<span style="font-size:${Math.round(cfg.picto * 0.45)}px;">⚠️</span>`;
  const qrSvg = warnQrSvg(r);
  const qrBox = qrSvg
    ? `<div class="wl-qr"><div class="wl-qr-img">${qrSvg}</div><div class="wl-qr-cap">QR스캔 →<br>MSDS 원본</div></div>`
    : '';
  const productName = escapeHtml(r.product_name || '제품명 정보 없음');
  const signalWord = escapeHtml(r.signal_word || '경고');
  const supplier = escapeHtml(r.supplier || '-');
  const supplierContact = r.supplier_contact
    ? ` (${escapeHtml(r.supplier_contact)})`
    : '';

  // ── 소분용기 간이표지 (고시 제6조②: 100g/100㎖ 이하 → 명칭·그림문자·신호어·공급자정보만) ──
  if (size === 'mini') {
    return `<div class="wlabel wlabel--mini" data-warning-autofit="true"><div class="wl-body-viewport"><div class="wl-fit-content">
      <div class="wl-name-box">${productName}</div>
      <div class="wl-mini-row">
        <div class="wl-picto-row">${pictoHtml}</div>
        ${qrBox}
      </div>
      <div class="wl-signal-bar ${isDanger ? 'danger' : 'warning'}">${signalWord}</div>
    </div></div>
      <div class="wl-foot">
        <div><b>공급</b>${supplier}${supplierContact}</div>
        <div style="font-weight:700;">■ 100g·100㎖ 이하 소분용기용 간이표지</div>
      </div>
    </div>`;
  }

  const hList = decodeHCodes(r.h_codes);
  const pRaw = decodePCodes(r.p_codes);
  // 한 라벨의 안전영역을 넘지 않도록 크기별 대표 문구 수를 제한한다.
  // 예방조치문구는 예방·대응·저장·폐기 범주가 빠지지 않도록 condensePCodes가 먼저 선별한다.
  const hShown = hList; // Preserve safety text; fit to the selected label size after layout.
  const hCondensed = hShown.length < hList.length;
  const { list: pList, condensed: pCondensed } = condensePCodes(pRaw);
  const safety = labelSafetySections(r, pRaw);
  const autoFit = hCondensed || pCondensed;
  const hHtml =
    (hShown.length
      ? hShown
          .map(
            (h) =>
              `<li><span style="color:#888;font-size:0.85em;">[${escapeHtml(h.code)}]</span> ${escapeHtml(h.text)}</li>`,
          )
          .join('')
      : '<li>해당 정보 없음</li>') +
    (hCondensed
      ? `<li class="wl-condensed-note" data-kind="hazard">그 밖의 유해·위험 문구 ${hList.length - hShown.length}건은 MSDS 참조</li>`
      : '');
  const pHtml = pList.length
    ? pList.map(p => `<li><span style="color:#888;font-size:0.85em;">[${escapeHtml(p.code)}]</span> ${escapeHtml(p.text)}</li>`).join('')
    : '<li>예방조치문구 정보 미등록</li>';

  return `<div class="wlabel wlabel--${size}${autoFit ? ' wl-auto-fit' : ''}" data-warning-autofit="true"><div class="wl-body-viewport"><div class="wl-fit-content">
    ${getDevPreviewPage() ? '<div style="text-align:center;color:#888;font-size:10px;margin-bottom:5px;">미리보기 샘플 · 실제 작업에는 원본 MSDS를 확인하세요</div>' : ''}
    <div class="wl-top">(산업안전보건법 제115조 규정에 의한 경고표지)</div>
    <div class="wl-name-box">${productName}</div>
    <div class="wl-picto-row">${pictoHtml}</div>
    <div class="wl-signal-bar ${isDanger ? 'danger' : 'warning'}">신호어 : ${signalWord}</div>
    <div class="wl-block"><div class="wl-block-head">유해·위험 문구</div><ul class="wl-list">${hHtml}</ul></div>
    <div class="wl-block"><div class="wl-block-head">예방조치문구</div><ul class="wl-list wl-precautions">${pHtml}</ul></div>
    <div class="wl-block"><div class="wl-block-head">취급상의 주의사항</div><div class="wl-safety-text">${escapeHtml(safety.handling)}</div></div>
    <div class="wl-block"><div class="wl-block-head">착용할 보호구</div>${renderPpe(r.protective_equipment)}</div>
    <div class="wl-block"><div class="wl-block-head">응급조치 요령 및 사고 시 대처방법</div><div class="wl-safety-text"><b>응급조치</b> ${escapeHtml(safety.firstAid)}<br><b>화재·누출 대응</b> ${escapeHtml(safety.emergency)}</div></div>
    ${r.legal_special === 'Y' ? `<div class="wl-special">⚠️ 특별관리물질 — 취급 시 관리감독자 확인 및 특별안전보건교육 필수</div>` : ''}
    </div></div>
    <div class="wl-foot-row">
      <div class="wl-foot">
        <div><b>공급업체</b>${supplier}${supplierContact}</div>
        <div style="margin-top:4px;font-weight:700;">■ 등록된 MSDS의 안전정보를 바탕으로 작성</div>
      </div>
      ${qrBox}
    </div>
  </div>`;
}

// ═══ 라벨 공통 인쇄 CSS — 크기별 폰트 스케일 + A4 분할 시트 그리드 ═══
function warnLabelCss() {
  return `
    ${warningLabelStyles}
    .wl-safety-text{padding:6px 10px;font-size:inherit;line-height:1.55;}
    .wl-fit-content{display:flex;flex-direction:column;}
    .sheet{display:grid;page-break-after:always;width:210mm;height:283mm;min-height:0;max-height:283mm;overflow:hidden;box-sizing:border-box;}
    .sheet:last-child{page-break-after:auto;}
    .sheet-1{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr);}
    .sheet-2{grid-template-columns:minmax(0,1fr);grid-template-rows:repeat(2,minmax(0,1fr));}
    .sheet-4{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr));}
    .sheet-8{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(4,minmax(0,1fr));}
    .cell{min-width:0;min-height:0;box-sizing:border-box;padding:3mm;display:flex;align-items:stretch;justify-content:center;overflow:hidden;border:0.2mm dashed #bbb;}
    .sheet-1 .cell{border:none;padding:0;}
    .sheet-1 .wlabel{border-radius:0;}
    .wlabel{box-sizing:border-box;display:flex;flex-direction:column;height:100%;border:3px solid #111;border-radius:6px;padding:16px;width:100%;font-family:'Malgun Gothic',sans-serif;color:#111;background:#fff;font-size:11.5px;word-break:keep-all;overflow-wrap:break-word;}
    .wlabel--a5{padding:11px;font-size:10px;border-width:2px;}
    .wlabel--a6{padding:8px;font-size:8.5px;border-width:1.5px;}
    .wlabel--mini{padding:7px;font-size:8.5px;border-width:1.5px;}
    .wl-top{text-align:center;font-size:14px;font-weight:700;margin-bottom:7px;}
    .wlabel--a5 .wl-top{font-size:10px;margin-bottom:5px;}
    .wlabel--a6 .wl-top{font-size:9px;margin-bottom:4px;}
    .wl-name-box{border:2.5px solid #E30613;border-radius:5px;text-align:center;font-size:42px;font-weight:900;padding:13px;margin-bottom:12px;letter-spacing:3px;}
    .wlabel--a5 .wl-name-box{font-size:29px;padding:9px;margin-bottom:8px;letter-spacing:2px;border-width:2px;}
    .wlabel--a6 .wl-name-box{font-size:20px;padding:5px;margin-bottom:5px;letter-spacing:1px;border-width:1.5px;}
    .wlabel--mini .wl-name-box{font-size:18px;padding:4px;margin-bottom:5px;letter-spacing:1px;border-width:1.5px;}
    .wl-picto-row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:12px;align-items:flex-end;}
    .wlabel--a5 .wl-picto-row{gap:8px;margin-bottom:8px;}
    .wlabel--a6 .wl-picto-row,.wlabel--mini .wl-picto-row{gap:5px;margin-bottom:5px;}
    .wl-mini-row{display:flex;align-items:center;justify-content:space-between;gap:5px;}
    .wl-signal-bar{text-align:center;font-size:19px;font-weight:900;color:#fff;padding:7px;border-radius:5px;margin-bottom:12px;}
    .wlabel--a5 .wl-signal-bar{font-size:14px;padding:5px;margin-bottom:8px;}
    .wlabel--a6 .wl-signal-bar,.wlabel--mini .wl-signal-bar{font-size:12px;padding:3px;margin-bottom:5px;}
    .wl-signal-bar.danger{background:#C0392B;} .wl-signal-bar.warning{background:#E67E22;}
    .wl-block{margin-bottom:8px;border:1px solid #ccc;border-radius:4px;overflow:hidden;}
    .wlabel--a6 .wl-block{margin-bottom:5px;}
    .wl-block-head{background:#C0392B;color:#fff;font-size:13px;font-weight:800;padding:4px 11px;}
    .wlabel--a5 .wl-block-head{font-size:10px;padding:3px 7px;}
    .wlabel--a6 .wl-block-head{font-size:9px;padding:2px 6px;}
    .wl-list{margin:0;padding:6px 11px 6px 24px;font-size:11.5px;line-height:1.65;columns:2;column-gap:12px;}
    .wlabel--a5 .wl-list{font-size:9.5px;line-height:1.5;padding:4px 7px 4px 18px;column-gap:8px;}
    .wlabel--a6 .wl-list{font-size:8.5px;line-height:1.4;padding:3px 6px 3px 15px;columns:1;}
    .wl-list li{break-inside:avoid;}
    .wl-condensed-note{font-weight:800;color:#7c2d12;}
    .wl-auto-fit .wl-list{line-height:1.48;}
    .wl-pe{padding:6px 11px;font-size:11.5px;font-weight:600;columns:2;column-gap:12px;}
    .wlabel--a5 .wl-pe{font-size:9.5px;padding:4px 7px;}
    .wl-special{background:#FFF3CD;border:1.5px solid #FFC107;border-radius:4px;padding:7px;margin:7px 0;font-size:11.5px;font-weight:800;color:#856404;text-align:center;}
    .wlabel--a5 .wl-special{font-size:9.5px;padding:5px;margin:5px 0;}
    .wlabel--a6 .wl-special{font-size:8.5px;padding:3px;margin:4px 0;border-width:1px;}
    .wl-foot-row{display:flex;align-items:flex-end;gap:9px;border-top:1px solid #ddd;padding-top:7px;margin-top:9px;}
    .wlabel--a6 .wl-foot-row{padding-top:4px;margin-top:5px;}
    .wl-foot{flex:1;min-width:0;font-size:11.5px;color:#555;line-height:1.65;}
    .wl-foot-row .wl-foot{border-top:none;padding-top:0;margin-top:0;}
    .wlabel--a5 .wl-foot{font-size:9.5px;line-height:1.5;}
    .wlabel--a6 .wl-foot,.wlabel--mini .wl-foot{font-size:8.5px;line-height:1.4;}
    .wlabel--mini .wl-foot{border-top:1px solid #ddd;padding-top:4px;margin-top:4px;}
    .wl-foot b{color:#333;margin-right:3px;}
    .wl-qr{flex-shrink:0;text-align:center;}
    .wl-qr-img{width:88px;height:88px;}
    .wlabel--a5 .wl-qr-img{width:70px;height:70px;}
    .wlabel--a6 .wl-qr-img{width:58px;height:58px;}
    .wlabel--mini .wl-qr-img{width:52px;height:52px;}
    .wl-qr-img svg{width:100%;height:100%;display:block;}
    .wl-qr-cap{font-size:8.5px;font-weight:700;color:#333;line-height:1.3;margin-top:3px;}
  `;
}

function fitWarningLabels(root = document) {
  root?.querySelectorAll('[data-warning-autofit="true"]').forEach((label) => {
    const host = label.closest('.cell');
    const hostStyle = host ? getComputedStyle(host) : null;
    const maxHeight = host
      ? host.clientHeight - parseFloat(hostStyle.paddingTop) - parseFloat(hostStyle.paddingBottom)
      : { a4: 1010, a5: 490, a6: 480, mini: 240 }[warnLabelSize] || 1010;
    label.style.height = `${Math.max(0, maxHeight)}px`;
    label.style.zoom = '1';
    const viewport = label.querySelector('.wl-body-viewport');
    const content = label.querySelector('.wl-fit-content');
    if (!viewport || !content || viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return;
    const width = viewport.clientWidth;
    const height = Math.max(0, viewport.clientHeight - 2); // Allow for fractional font/layout rounding.
    // Widening the text changes wrapping, so every candidate must be measured again.
    const fits = scale => {
      content.style.width = `${width / scale}px`;
      // CSS zoom participates in print layout; transforms can paint over the footer.
      content.style.transform = 'none';
      content.style.zoom = String(scale);
      return content.getBoundingClientRect().height <= height;
    };
    let scale = 1;
    if (!fits(1)) {
      let low = 0, high = 1;
      for (let i = 0; i < 20; i++) {
        const candidate = (low + high) / 2;
        if (fits(candidate)) low = candidate;
        else high = candidate;
      }
      scale = Math.max(0.000001, Math.floor(low * 1000000) / 1000000);
      fits(scale);
    }
    label.dataset.fitScale = String(scale);
  });
}
function warningAutoFitPrintScript() {
  return `<script>const warnLabelSize=${JSON.stringify(warnLabelSize)};const fitWarningLabels = ${fitWarningLabels.toString()};
    const refitWarningLabels = () => fitWarningLabels();
    window.addEventListener('load', () => requestAnimationFrame(refitWarningLabels));
    window.addEventListener('beforeprint', refitWarningLabels);
    window.matchMedia?.('print').addEventListener('change', event => { if (event.matches) refitWarningLabels(); });
  <\/script>`;
}

// 라벨 목록 → A4 분할 시트 HTML로 묶기
function warnSheets(labelHtmlArr, size = warnLabelSize) {
  const per = (WARN_SIZES[size] || WARN_SIZES.a4).perPage;
  const sheets = [];
  for (let i = 0; i < labelHtmlArr.length; i += per) {
    const cells = labelHtmlArr
      .slice(i, i + per)
      .map((h) => `<div class="cell">${h}</div>`)
      .join('');
    sheets.push(`<div class="sheet sheet-${per}">${cells}</div>`);
  }
  return sheets;
}


return { buildWarnLabel, warnLabelCss, fitWarningLabels, warningAutoFitPrintScript, warnSheets };
}
