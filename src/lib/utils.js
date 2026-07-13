export const today = () => new Date().toISOString().split('T')[0];

export const generateCode = () =>
  Math.random().toString(36).slice(2, 8).toUpperCase();

export const generateToken = () =>
  Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

export function base64ToBlob(b64, type) {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type });
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export function guessFromPath(rel, contractors, workTypes) {
  const parts = rel.split('/').filter(Boolean);
  let guessCon = '', guessWork = '';
  for (const p of parts.slice(0, -1)) {
    if (!guessCon) {
      const mc = contractors.find(c => p.includes(c.name) || c.name.includes(p));
      if (mc) guessCon = mc.name;
    }
    if (!guessWork) {
      const mw = workTypes.find(w => p.includes(w.name) || w.name.includes(p));
      if (mw) guessWork = mw.name;
    }
  }
  return { guessCon, guessWork };
}

export function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('ko-KR');
}
