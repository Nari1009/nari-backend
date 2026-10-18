const { CoordinadoraError, errorFromResponse, timeoutError } = require('./errors');

const requestJson = async (url, { method = 'GET', headers = {}, body, timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}) => {
  if (typeof fetchImpl !== 'function') throw new CoordinadoraError('No hay cliente HTTP disponible.', { code: 'COORDINADORA_HTTP_UNAVAILABLE', status: 503 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method, headers, body, signal: controller.signal });
    let parsed;
    const raw = await response.text();
    if (!raw.trim()) throw new CoordinadoraError('Coordinadora devolvió una respuesta vacía.', { code: 'COORDINADORA_EMPTY_RESPONSE', status: 502, providerStatus: response.status, retryable: response.status >= 500 });
    try { parsed = JSON.parse(raw); } catch { throw new CoordinadoraError('Coordinadora devolvió una respuesta no válida.', { code: 'COORDINADORA_MALFORMED_RESPONSE', status: 502, providerStatus: response.status }); }
    if (!response.ok) throw errorFromResponse(parsed, response.status);
    return { status: response.status, body: parsed };
  } catch (error) {
    if (error && error.name === 'AbortError') throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

module.exports = { requestJson };
