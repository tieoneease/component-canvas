export function getHash() {
  if (typeof window === 'undefined') {
    return '#/';
  }

  return window.location.hash || '#/';
}

export function overviewHash() {
  return '#/';
}

export function workflowHash(workflowId) {
  return `#/workflow/${encodeURIComponent(workflowId)}`;
}

export function screenHash(workflowId, screenId) {
  return `#/screen/${encodeURIComponent(workflowId)}/${encodeURIComponent(screenId)}`;
}

export function variantHash(workflowId, variantId) {
  return `#/variant/${encodeURIComponent(workflowId)}/${encodeURIComponent(variantId)}`;
}

export function previewScreenSrc(workflowId, screenId) {
  return `/preview/${screenHash(workflowId, screenId)}`;
}

export function previewVariantSrc(workflowId, variantId) {
  return `/preview/${variantHash(workflowId, variantId)}`;
}

export function parseRoute(hash) {
  const normalizedHash = (hash || '#/').replace(/^#/, '') || '/';

  if (normalizedHash === '/' || normalizedHash === '') {
    return { type: 'overview' };
  }

  const workflowMatch = normalizedHash.match(/^\/workflow\/([^/]+)$/u);

  if (workflowMatch) {
    return {
      type: 'workflow',
      workflowId: safeDecode(workflowMatch[1])
    };
  }

  const screenMatch = normalizedHash.match(/^\/screen\/([^/]+)\/([^/]+)$/u);

  if (screenMatch) {
    return {
      type: 'screen',
      workflowId: safeDecode(screenMatch[1]),
      screenId: safeDecode(screenMatch[2])
    };
  }

  const variantMatch = normalizedHash.match(/^\/variant\/([^/]+)\/([^/]+)$/u);

  if (variantMatch) {
    return {
      type: 'variant',
      workflowId: safeDecode(variantMatch[1]),
      variantId: safeDecode(variantMatch[2])
    };
  }

  return { type: 'not-found' };
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
