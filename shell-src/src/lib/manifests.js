export function emptyManifestState() {
  return {
    workflows: [],
    errors: [],
    warnings: []
  };
}

export function normalizeManifestPayload(payload) {
  if (Array.isArray(payload)) {
    return {
      workflows: payload,
      errors: [],
      warnings: []
    };
  }

  if (payload && typeof payload === 'object') {
    const workflows = Array.isArray(payload.workflows) ? payload.workflows : [];
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];

    return {
      workflows,
      errors,
      warnings
    };
  }

  return emptyManifestState();
}

export function formatManifestTransportError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.length > 0) {
    return error;
  }

  return 'Unknown manifest transport error';
}
