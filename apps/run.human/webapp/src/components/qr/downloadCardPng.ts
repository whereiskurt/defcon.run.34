/** Rasterize an SVG document to PNG on-device and trigger a download. */
export async function downloadCardPng(
  svg: string,
  w: number,
  h: number,
  filename: string,
): Promise<void> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG rasterization failed'));
      img.src = url;
    });
    // WebKit can report load before the SVG is decodable by drawImage.
    await img.decode().catch(() => {});
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d unavailable');
    ctx.drawImage(img, 0, 0, w, h);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(png);
    a.download = filename;
    // Attached anchor + deferred revoke: Safari/Firefox cancel the download
    // when the blob URL is revoked in the same tick as click().
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Fetch a same-origin asset as a data URI (SVG-in-<img> can't load external refs). */
export async function assetAsDataUri(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`asset fetch failed: ${path}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}
