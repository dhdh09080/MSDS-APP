import { escapeBinderText as esc } from './binder-document.js';

export const MANAGER_SIGN_PHRASES = ['화기주의/주변 흡연금지', '인화성물질/흡연금지', '내부 정리 철저'];
export const MANAGER_SIGN_FIELDS = ['primaryName', 'primaryPhone', 'deputyName', 'deputyPhone', 'phrase'];

export function validateManagerSign(data) {
  if (!String(data.company || '').trim()) throw new Error('협력사를 선택해주세요.');
  const labels = ['관리책임자 정 성명', '관리책임자 정 전화번호', '관리책임자 부 성명', '관리책임자 부 전화번호', '문구'];
  MANAGER_SIGN_FIELDS.forEach((key, i) => {
    if (!String(data[key] || '').trim()) throw new Error(`${labels[i]}을(를) 입력해주세요.`);
  });
}

// Original PPT: 780 × 540 pt. Keep its geometry and maximum font sizes.
export function managerSignSvg(data, { measure, characterUrl = '', placeholders = false } = {}) {
  const value = (key, label) => data[key]?.trim() || (placeholders ? `{${label}}` : '');
  const text = (content, x, y, width, height, maxSize, color = '#000') => {
    const lines = String(content).split(/\r?\n/);
    const widths = lines.map(line => measure ? measure(line, maxSize) : Array.from(line).length * maxSize);
    const size = Math.min(maxSize, maxSize * (width - 16) / Math.max(1, ...widths), (height - 12) / (lines.length * 1.08));
    return `<text fill="${color}" font-size="${size.toFixed(3)}" text-anchor="middle" dominant-baseline="central">${lines.map((line, i) => `<tspan x="${x + width / 2}" y="${y + height / 2 + (i - (lines.length - 1) / 2) * size * 1.08}">${esc(line)}</tspan>`).join('')}</text>`;
  };
  const companyBottom = 220.812283, primaryBottom = 327.208189, deputyBottom = 433.604094;
  const nameX = 168.121575, phoneX = 376.824252, phraseX = 123.56748;
  const phrase = value('phrase', '문구');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="manager-sign" viewBox="0 0 780 540" role="img" aria-label="관리책임자 표지">
    <rect width="780" height="540" fill="#fff"/>
    <rect width="780" height="104" fill="#223962"/>
    <g fill="none" stroke="#000" stroke-width="3"><rect x="1.5" y="104" width="777" height="434.5"/>
    <path d="M0 ${companyBottom}H780 M0 ${primaryBottom}H780 M0 ${deputyBottom}H780 M${nameX} ${companyBottom}V${deputyBottom} M${phoneX} ${companyBottom}V${deputyBottom} M${phraseX} ${deputyBottom}V540"/></g>
    <g font-family="ManagerHY" font-weight="400">
    ${text('관리 책임자', 0, 0, 780, 104, 80, '#fff')}
    ${text(value('company', '협력사명'), 0, 104, 780, companyBottom - 104, 90)}
    ${text('정', 0, companyBottom, nameX, primaryBottom - companyBottom, 48)}
    ${text(value('primaryName', '정'), nameX, companyBottom, phoneX - nameX, primaryBottom - companyBottom, 48)}
    ${text(value('primaryPhone', '정번호'), phoneX, companyBottom, 780 - phoneX, primaryBottom - companyBottom, 45)}
    ${text('부', 0, primaryBottom, nameX, deputyBottom - primaryBottom, 48)}
    ${text(value('deputyName', '부'), nameX, primaryBottom, phoneX - nameX, deputyBottom - primaryBottom, 48)}
    ${text(value('deputyPhone', '부번호'), phoneX, primaryBottom, 780 - phoneX, deputyBottom - primaryBottom, 45)}
    ${text(phrase, phraseX, deputyBottom, 780 - phraseX, 540 - deputyBottom, 66, '#ff0000')}
    </g><image href="${esc(characterUrl)}" x="0" y="432" width="123.5" height="108" preserveAspectRatio="none"/>
  </svg>`;
}

export function buildManagerSignHtml(data, { fontCss = '', copies = 1, paper = 'A4', preview = false, ...options } = {}) {
  if (!['A3', 'A4'].includes(paper)) throw new Error('인쇄 용지는 A3 또는 A4를 선택해주세요.');
  if (!Number.isInteger(copies) || copies < 1 || copies > 20) throw new Error('인쇄 매수는 1~20으로 입력해주세요.');
  if (!preview) validateManagerSign(data);
  const svg = managerSignSvg(data, { ...options, placeholders: preview });
  const scale = paper === 'A3' ? Math.SQRT2 : 1;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>관리책임자 표지</title><style>
    ${fontCss}
    @page{size:${paper} landscape;margin:0}*{box-sizing:border-box}html,body{margin:0;background:#fff}
    .manager-sheet{width:${paper === 'A3' ? 420 : 297}mm;height:${paper === 'A3' ? 297 : 210}mm;display:flex;align-items:center;justify-content:center;break-after:page;page-break-after:always}
    .manager-sheet:last-child{break-after:auto;page-break-after:auto}
    .manager-sign{display:block;width:${780 * scale}pt;height:${540 * scale}pt;flex-shrink:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}
    ${preview ? '@media screen{.manager-sheet{width:100vw;height:100vh}.manager-sign{width:100%;height:100%}}' : ''}
    </style></head><body>${Array.from({ length: copies }, () => `<section class="manager-sheet">${svg}</section>`).join('')}</body></html>`;
}
