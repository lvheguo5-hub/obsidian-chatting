/** Bounds for Canvas thumbnails, checked before invoking a native decoder. */
export const PREVIEW_SOURCE_BYTES = 10 * 1024 * 1024;
const PREVIEW_PIXELS = 4 * 1024 * 1024;

/** Header dimensions only; unknown/truncated sources must not reach the decoder. */
export function rasterDimensions(buffer: ArrayBuffer): { width: number; height: number } | null {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const ascii = (at: number, value: string) => [...value].every((char, i) => bytes[at + i] === char.charCodeAt(0));
  const size = (width: number, height: number) => width > 0 && height > 0 ? { width, height } : null;
  // PNG: signature, first IHDR chunk, two big-endian uint32 dimensions.
  if (bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
    && view.getUint32(8) === 13 && ascii(12, "IHDR")) return size(view.getUint32(16), view.getUint32(20));
  if (bytes.length >= 10 && (ascii(0, "GIF87a") || ascii(0, "GIF89a"))) return size(view.getUint16(6, true), view.getUint16(8, true));
  // JPEG: skip bounded marker segments until a start-of-frame header.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at < bytes.length) {
      if (bytes[at++] !== 0xff) return null;
      while (bytes[at] === 0xff) at++;
      const marker = bytes[at++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (at + 2 > bytes.length) return null;
      const length = view.getUint16(at);
      if (length < 2 || at + length > bytes.length) return null;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return length >= 8 ? size(view.getUint16(at + 5), view.getUint16(at + 3)) : null;
      }
      at += length;
    }
  }
  // WebP dimensions live in the first VP8, VP8L or VP8X chunk.
  // https://developers.google.com/speed/webp/docs/riff_container
  if (bytes.length >= 25 && ascii(0, "RIFF") && ascii(8, "WEBP")) {
    const chunkLength = view.getUint32(16, true);
    if (chunkLength > bytes.length - 20) return null;
    if (ascii(12, "VP8X") && chunkLength >= 10) {
      const uint24 = (at: number) => bytes[at] + (bytes[at + 1] << 8) + (bytes[at + 2] << 16);
      return size(uint24(24) + 1, uint24(27) + 1);
    }
    if (ascii(12, "VP8L") && chunkLength >= 5 && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (ascii(12, "VP8 ") && chunkLength >= 10 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return size(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
    }
  }
  return null;
}

export function canvasImageWithinBudget(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength > PREVIEW_SOURCE_BYTES) return false;
  const size = rasterDimensions(bytes);
  return size !== null && size.width <= 8192 && size.height <= 8192 && size.width * size.height <= PREVIEW_PIXELS;
}
