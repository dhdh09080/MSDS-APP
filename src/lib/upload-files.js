/** Match the same extension/MIME forms supported by a native file input's accept attribute. */
export function acceptsUpload(file, accept = '') {
  const rules = accept.split(',').map(rule => rule.trim().toLowerCase()).filter(Boolean);
  if (!rules.length) return true;
  const name = file.name.toLowerCase(), type = (file.type || '').toLowerCase();
  return rules.some(rule => rule.startsWith('.') ? name.endsWith(rule)
    : rule.endsWith('/*') ? type.startsWith(rule.slice(0, -1)) : type === rule);
}

/** Capture drag entries synchronously before the browser protects DataTransfer after dispatch. */
export async function collectDroppedFiles(transfer) {
  const fallback = [...(transfer.files || [])];
  const items = [...(transfer.items || [])].filter(item => item.kind === 'file');
  const sources = items.map(item => ({entry: item.webkitGetAsEntry?.(), file: item.getAsFile?.()}));
  if (!sources.some(source => source.entry)) return fallback;
  const files = [];
  async function visit(entry, prefix = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      if (prefix && !file.webkitRelativePath) Object.defineProperty(file, 'webkitRelativePath', {value: prefix + file.name});
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // Chromium returns directory children in batches, often at most 100 per read.
      for (;;) {
        const children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!children.length) break;
        for (const child of children) await visit(child, prefix + entry.name + '/');
      }
    }
  }
  for (const source of sources) {
    if (source.entry) await visit(source.entry);
    else if (source.file) files.push(source.file);
  }
  return files;
}
