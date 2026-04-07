import html2canvas from 'html2canvas';

const DEFAULT_SCALE = 0.5;
const DEFAULT_TIMEOUT_MS = 3000;

export async function captureIframeThumbnail(iframe, options = {}) {
  const scale = options.scale ?? DEFAULT_SCALE;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

  try {
    const doc = iframe?.contentDocument;

    if (!doc?.documentElement || doc.URL === 'about:blank') {
      return null;
    }

    const canvas = await Promise.race([
      html2canvas(doc.documentElement, {
        scale,
        useCORS: true,
        logging: false,
        allowTaint: true,
        windowWidth: doc.documentElement.scrollWidth,
        windowHeight: doc.documentElement.scrollHeight
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Thumbnail capture timed out')), timeout);
      })
    ]);

    return await new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  } catch (error) {
    console.warn('[component-canvas] Thumbnail capture failed:', error?.message ?? error);
    return null;
  }
}
