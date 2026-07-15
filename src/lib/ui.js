// ═══════════════════════════════════════════════
// 공용 UI 유틸 — 모달 열기/닫기, 토스트, 인쇄 창
// (상태 공유 없는 순수 유틸이라 안전하게 분리 가능)
// ═══════════════════════════════════════════════

export function openModal(id) { document.getElementById(id)?.classList.add('open'); }
export function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

export function toast(msg, type = '') {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = (type === 'success' ? '✓ ' : type === 'error' ? '✕ ' : type === 'warn' ? '⚠ ' : '') + msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// 인쇄 공통 유틸 — 팝업 차단에 안전한 숨김 iframe 방식
// (기존 window.open 방식은 팝업 차단 시 조용히 실패해 "인쇄가 안 됨"으로 보이는 문제가 있었음)
export function openPrintWindow(html) {
  const old = document.getElementById('__printFrame');
  if (old) old.remove();
  const iframe = document.createElement('iframe');
  iframe.id = '__printFrame';
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  const cleanup = () => { try { iframe.remove(); } catch {} };
  try { iframe.contentWindow.onafterprint = cleanup; } catch {}
  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      toast('인쇄 창을 열지 못했습니다: ' + (e?.message || e), 'error');
      cleanup();
      return;
    }
    setTimeout(cleanup, 60000); // afterprint 미지원 브라우저 대비 안전장치
  }, 350);
}

export function buildPrintHtml(title, pageSize, bodyStyle, bodyHtml) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>
    @page{size:${pageSize};margin:6mm;}
    *{box-sizing:border-box;}
    body{margin:0;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#111;}
    ${bodyStyle}
  </style></head><body>${bodyHtml}</body></html>`;
}
