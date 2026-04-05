const KB = 1024;
const MB = KB * KB;
const GB = KB * MB;

/**
 * Human-readable size for file listings. Uses 1024-based steps; labels are `KB`/`MB`/`GB` (common
 * UI convention) rather than IEC `KiB`/`MiB`/`GiB`.
 */
export function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  if (n < KB) return `${n} B`;
  if (n < MB) return `${(n / KB).toFixed(1)} KB`;
  if (n < GB) return `${(n / MB).toFixed(1)} MB`;
  return `${(n / GB).toFixed(1)} GB`;
}
