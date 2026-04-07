/**
 * Detect the base path for the shell. When loaded behind a reverse proxy
 * (e.g. /proxy/5199/), the pathname includes the prefix. When loaded
 * directly, the pathname is /.
 */
export function getBasePath() {
  if (typeof window === 'undefined') {
    return '/';
  }

  return window.location.pathname.replace(/\/?$/, '/');
}

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

export function presentationHash(presentationId) {
  return `#/presentation/${encodeURIComponent(presentationId)}`;
}

export function previewScreenSrc(workflowId, screenId) {
  return `${getBasePath()}preview/${screenHash(workflowId, screenId)}`;
}

export function previewVariantSrc(workflowId, variantId) {
  return `${getBasePath()}preview/${variantHash(workflowId, variantId)}`;
}

export function previewPresentationSrc(presentationId) {
  return `${getBasePath()}preview/?presentation=${encodeURIComponent(presentationId)}`;
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

  const presentationMatch = normalizedHash.match(/^\/presentation\/([^/]+)$/u);

  if (presentationMatch) {
    return {
      type: 'presentation',
      presentationId: safeDecode(presentationMatch[1])
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
