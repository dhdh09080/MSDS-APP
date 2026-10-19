// Render only instructions supported by the record. Never infer PPE from a hazard class.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const absent = /^(?:정보\s*미등록|내용\s*없음|정보\s*없음|자료\s*없음|미확인|미기재|미등록|해당\s*없음|없음|[-–])\.?$/;

export function concreteSafetyText(value) {
  return String(value || '').split(/\n|(?<=[.!?。])\s+/).map(s => s.trim()).filter(s => s && !absent.test(s))
    .filter(s => !/^(?:(?:기타|자세한|상세한|관련|해당)\s*(?:내용|정보|사항)?\s*(?:은|는)?\s*)?(?:원본\s*)?(?:MSDS|물질안전보건자료).*?(?:참조|참고|확인)/i.test(s))
    .join('\n');
}

// Original user-provided PNGs from 안전보건표지.zip; keep the numbered filenames.
export const PPE_ASSETS = Object.freeze({
  goggles: '/ppe/안전보건표지-301-보안경착용.png',
  gas: '/ppe/안전보건표지-302-방독마스크착용.png',
  dust: '/ppe/안전보건표지-303-방진마스크착용.png',
  face: '/ppe/안전보건표지-304-보안면착용.png',
  helmet: '/ppe/안전보건표지-305-안전모착용.png',
  hearing: '/ppe/안전보건표지-306-귀마개착용.png',
  boots: '/ppe/안전보건표지-307-안전화착용.png',
  gloves: '/ppe/안전보건표지-308-안전장갑착용.png',
});

const rules = [
  ['gloves', '안전장갑 착용', /장갑|gloves?/i],
  ['boots', '안전화 착용', /안전화|안전\s*장화|보호\s*장화|safety\s*(?:shoes|boots)/i],
  ['goggles', '보안경 착용', /보안경|보호\s*안경|고글|goggles?|safety\s*glasses/i],
  ['gas', '방독마스크 착용', /방독\s*마스크|유기\s*가스용|유기\s*증기용|gas\s*mask/i],
  ['dust', '방진마스크 착용', /방진\s*마스크|분진용\s*(?:마스크|호흡)|dust\s*(?:mask|respirator)/i],
  ['respirator', '호흡보호구 착용', /호흡(?:용)?\s*(?:보호구|보호)|호흡기\s*보호|respirator/i],
  ['face', '보안면 착용', /안면\s*(?:보호구|보호대)|보호\s*면|face\s*shield/i],
  ['hearing', '귀마개 착용', /귀마개|귀덮개|청력\s*보호|ear\s*(?:plugs?|muffs?)/i],
  ['helmet', '안전모 착용', /안전모|보호\s*헬멧|hard\s*hat|safety\s*helmet/i],
  ['clothing', '보호복 착용', /보호복|보호의|보호\s*앞치마|내화학\s*(?:의복|앞치마)|화학\s*보호\s*의류|protective\s*clothing/i],
];

export function summarizePpe(value) {
  const source = concreteSafetyText(value);
  const parts = source.split(/\n|;|,(?![^()]*\))|(?=(?:호흡기|눈|손|신체|발|귀|머리)\s*보호\s*[:：])/).map(s => s.trim()).filter(Boolean);
  const matches = [];
  for (const [key, label, pattern] of rules) {
    const segments = parts.filter(part => {
      const body = part.replace(/^(?:호흡기|눈|손|신체|발|귀|머리)\s*보호\s*[:：]\s*/, '');
      return Boolean(concreteSafetyText(body)) && pattern.test(part) && !/필요\s*(?:없|하지\s*않)|착용하지\s*않아도|불필요|해당\s*없|not\s*(?:required|necessary)/i.test(part);
    });
    if (!segments.length) continue;
    const text = [...new Set(segments)].join(' · ');
    matches.push({ key, label: key === 'hearing' && /귀덮개/.test(text) ? '귀덮개 착용' : label,
      detail: text.replace(/^(?:호흡기|눈|손|신체|발|귀|머리)\s*보호\s*[:：]\s*/, '') });
  }
  if (matches.some(item => item.key === 'gas' || item.key === 'dust')) return matches.filter(item => item.key !== 'respirator');
  return matches;
}

export function renderPpe(value) {
  const items = summarizePpe(value);
  if (!items.length) {
    const text = concreteSafetyText(value);
    return `<div class="wl-safety-text ${text ? '' : 'wl-missing'}">${escape(text || '보호구 정보 미등록')}</div>`;
  }
  return `<div class="wl-ppe-grid">${items.map(item => {
    const asset = PPE_ASSETS[item.key];
    const image = asset ? `<img src="${encodeURI(asset)}" width="64" height="64" alt="${escape(item.label)}" decoding="sync">` : '';
    // Keep material, filter and conditional-use requirements alongside the short label.
    const basic = item.detail.replace(/\s|착용(?:하시오|하세요)?[.!]?/g, '');
    const detail = /^(?:안전|보호|내화학)?장갑$|^(?:방독|방진)?마스크$|^보안경$|^안전화$|^보호복$|^안전모$|^귀마개$/.test(basic) ? '' : item.detail;
    return `<div class="wl-ppe-item${asset ? '' : ' wl-ppe-text-only'}" data-ppe="${item.key}">${image}<strong>${escape(item.label)}</strong>${detail ? `<span>${escape(detail)}</span>` : ''}</div>`;
  }).join('')}</div>`;
}

export function labelSafetySections(record, precautions) {
  const byCode = predicate => precautions.filter(item => predicate(item.code)).map(item => item.text).join('\n');
  const handling = concreteSafetyText(record.handling_precautions) || byCode(code => /^P2/.test(code) && !/^P20[12]$|^P280$|^P284$/.test(code));
  const firstAid = concreteSafetyText(record.first_aid) || byCode(code => /^P3/.test(code) && !/^P3[789]/.test(code) && !/^P30[12458]$/.test(code));
  const emergency = concreteSafetyText(record.emergency_response) || byCode(code => /^P3[789]/.test(code));
  return {
    handling: handling || '취급·보관 정보 미등록',
    firstAid: firstAid || '응급조치 정보 미등록',
    emergency: emergency || '화재·누출 대응 정보 미등록',
    missing: [!handling && '취급·보관', !firstAid && '응급조치', !emergency && '화재·누출 대응', !concreteSafetyText(record.protective_equipment) && '보호구'].filter(Boolean),
  };
}
