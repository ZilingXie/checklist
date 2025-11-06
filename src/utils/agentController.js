export const resolveAgentControllerEndpoint = (baseUrl, action) => {
  if (!baseUrl) return '';

  const trimmedBase = baseUrl.trim();
  if (!trimmedBase) return '';

  const normalizedBase = trimmedBase.replace(/\/+$/, '');
  const expectedSuffix = `/agent/${action}`;
  if (normalizedBase.endsWith(expectedSuffix)) {
    return normalizedBase;
  }

  try {
    const origin =
      typeof window !== 'undefined' && window.location
        ? window.location.origin
        : 'http://localhost';
    const url = new URL(normalizedBase, origin);
    const segments = url.pathname.split('/').filter(Boolean);

    if (segments[segments.length - 1] === action) {
      segments.pop();
    }
    if (segments[segments.length - 1] !== 'agent') {
      segments.push('agent');
    }
    segments.push(action);
    url.pathname = `/${segments.join('/')}`;
    return url.toString().replace(/\/+$/, '');
  } catch {
    if (normalizedBase.endsWith('/agent')) {
      return `${normalizedBase}/${action}`;
    }
    return `${normalizedBase}/agent/${action}`;
  }
};
