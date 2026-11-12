import './msds-status-switch.css';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function msdsStatusSwitch(record, handler, readOnly=false) {
 const active=(record.status||'active')==='active';
 return `<button type="button" role="switch" aria-checked="${active}" aria-label="${escape(record.product_name||'MSDS')} 사용 여부" class="msds-usage-switch" ${readOnly?'disabled data-readonly title="현장 관리자만 변경할 수 있습니다"':''} data-record-id="${escape(record.id)}" onclick="${handler}(this.dataset.recordId)"><span class="msds-switch-track" aria-hidden="true"><span></span></span><span class="msds-switch-label">${active?'사용중':'미사용중'}</span></button>`;
}
