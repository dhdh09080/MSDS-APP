export const PHOTO_KINDS = {record:'일반 기록',finding:'조치 요청',remedy:'조치 후'};
export const REVIEW_STATES = {
  none: {label:'일반 기록', hint:'사진을 기록하거나 필요한 경우 조치를 요청하세요'},
  open: {label:'조치 전', hint:'현장 확인 후 조치 사진을 등록하세요'},
  pending: {label:'관리자 확인 전', hint:'제출된 조치 사진을 확인해 주세요'},
  verified: {label:'관리자 확인 완료', hint:'관리자가 조치 내용을 확인했습니다'},
};
export const reviewState = marker => Object.hasOwn(REVIEW_STATES, marker.review_status) ? marker.review_status : 'none';
export const emptyFilters = () => ({type:'all',status:'all',contractor:'all',query:'',requested:false});

export function filterHazardMarkers(markers, filters, contractors = []) {
  const companies = new Map(contractors.map(row => [row.id, row.name]));
  const query = filters.query.trim().toLocaleLowerCase();
  return markers.filter(marker => {
    if (filters.requested && reviewState(marker)==='none') return false;
    if (filters.type !== 'all' && (marker.marker_type || 'hazard') !== filters.type) return false;
    if (filters.status !== 'all' && reviewState(marker) !== filters.status) return false;
    if (filters.contractor === 'unassigned' ? marker.contractor_id : filters.contractor !== 'all' && marker.contractor_id !== filters.contractor) return false;
    if (!query) return true;
    return [marker.storage_name, marker.content, companies.get(marker.contractor_id), ...(Array.isArray(marker.items) ? marker.items.map(item => item.name) : [])].some(value => String(value || '').toLocaleLowerCase().includes(query));
  });
}

export function actionSummary(markers) {
  const counts = {all:0,open:0,pending:0,verified:0};
  for (const marker of markers) if (reviewState(marker) !== 'none') { counts.all++; counts[reviewState(marker)]++; }
  return counts;
}
