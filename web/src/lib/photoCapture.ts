// Downscale a captured/selected image to a small JPEG data URL. Canvas re-encode
// also strips EXIF. Keeps upload payloads well under the 6 MB body limit.
export async function downscaleToJpegDataUrl(
  file: File,
  maxPx = 1600,
  quality = 0.8,
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unsupported');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}
