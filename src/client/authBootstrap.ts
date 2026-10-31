/**
 * R1 authenticated browser transport.
 * Existing domain components use window.fetch; this wrapper attaches the current
 * bearer session to same-origin Garage OS API calls without trusting actor headers.
 */
const nativeFetch = window.fetch.bind(window);

window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const token = sessionStorage.getItem('garage_os_session_token');
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (!token || !url.startsWith('/api/v1/')) {
    return nativeFetch(input, init);
  }

  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  headers.set('Authorization', `Bearer ${token}`);
  return nativeFetch(input, { ...init, headers });
};

export {};
