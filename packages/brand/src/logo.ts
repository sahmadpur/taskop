/**
 * The Taskop mark: a ring with a check whose long stroke breaks out through the ring at the top right. The check also
 * reads as the two hands of a clock (scheduled checks); the break says the run is done and reported. One colour, so it
 * works at 16 px and as a monochrome icon. The ring is open from -76° to -30° (SVG angles, y down), where the stroke exits.
 */
export const MARK_VIEWBOX = '0 0 64 64';
/** The ring, drawn clockwise from the gap's lower edge round to its upper edge. */
export const MARK_RING = 'M51.05 21 A22 22 0 1 1 37.32 10.65';
/** The check: short stroke bottom-left, long stroke out through the gap. */
export const MARK_CHECK = 'M19 34 L29 44 L52 12';

export interface MarkOptions {
  /** The stroke colour; `currentColor` lets CSS set it. */
  color?: string;
  /** Rendered size in px; omit for a scalable SVG. */
  size?: number;
  /** Extra attributes on the root element (an id, a class, aria attributes). */
  attrs?: string;
}

/** The inner elements of the mark, for pasting into an existing `<svg viewBox="0 0 64 64">`. */
export function markPaths(color = 'currentColor'): string {
  return (
    `<path d="${MARK_RING}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="${MARK_CHECK}" fill="none" stroke="${color}" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

/** The mark alone as an SVG document or inline element. */
export function markSvg({ color = 'currentColor', size, attrs = '' }: MarkOptions = {}): string {
  const dims = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}"${dims}${attrs ? ` ${attrs}` : ''}>${markPaths(color)}</svg>`;
}

export interface TileOptions {
  /** The tile colour, or `none` for a transparent tile (iOS dark and tinted icons, Android foreground). */
  background: string;
  /** The mark colour. */
  color: string;
  /** Corner radius as a fraction of the side (0 = square: iOS rounds its own icons; 0.22 = web favicons). */
  radius?: number;
  /** The mark's share of the tile side (0.62 default; 0.44 for Android's adaptive-icon safe zone). */
  scale?: number;
  size?: number;
}

/** The mark on a tile: app icons, favicons, store listings. Always 64 units wide so the mark keeps its proportions. */
export function tileSvg({ background, color, radius = 0, scale = 0.62, size }: TileOptions): string {
  const dims = size ? ` width="${size}" height="${size}"` : '';
  const r = radius * 64;
  const inset = (64 - 64 * scale) / 2;
  const rect = background === 'none' ? '' : `<rect width="64" height="64" rx="${r}" fill="${background}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"${dims}>${rect}` +
    `<svg x="${inset}" y="${inset}" width="${64 * scale}" height="${64 * scale}" viewBox="${MARK_VIEWBOX}">${markPaths(color)}</svg></svg>`
  );
}

/** The wordmark: mark plus "Taskop" in the brand face, for headers and the landing page. */
export function wordmarkSvg({ color = 'currentColor', markColor = color, height = 28 }: { color?: string; markColor?: string; height?: number } = {}): string {
  const w = Math.round(height * 4.1);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 164 40" width="${w}" height="${height}" role="img" aria-label="Taskop">` +
    `<svg x="0" y="0" width="40" height="40" viewBox="${MARK_VIEWBOX}">${markPaths(markColor)}</svg>` +
    `<text x="50" y="29" font-family="'IBM Plex Sans', system-ui, sans-serif" font-size="27" font-weight="600" letter-spacing="-0.5" fill="${color}">Taskop</text></svg>`
  );
}
