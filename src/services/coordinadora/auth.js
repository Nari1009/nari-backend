const { getConfig } = require('./config');
const { requestJson } = require('./httpClient');
const { CoordinadoraError } = require('./errors');

class CoordinadoraOAuth {
  constructor({ config, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    this.config = config || getConfig();
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cached = null;
    this.inFlight = null;
  }

  invalidate() { this.cached = null; }

  async getToken() {
    if (!this.config.enabled) throw new CoordinadoraError('Coordinadora está desactivada.', { code: 'COORDINADORA_DISABLED', status: 503 });
    const validUntil = this.cached && this.cached.expiresAt - (this.config.tokenSkewSeconds * 1000);
    if (this.cached && this.now() < validUntil) return this.cached.accessToken;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetchToken().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async fetchToken() {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.consumerKey,
      client_secret: this.config.consumerSecret,
    }).toString();
    const result = await requestJson(this.config.oauthUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      timeoutMs: this.config.timeoutMs,
      fetchImpl: this.fetchImpl,
    });
    const token = result.body && (result.body.access_token || result.body.token);
    if (typeof token !== 'string' || !token.trim()) throw new CoordinadoraError('La respuesta OAuth no contiene un token válido.', { code: 'COORDINADORA_TOKEN_INVALID', status: 502, providerStatus: result.status });
    const expiresIn = Number(result.body.expires_in || result.body.expiresIn || 300);
    const ttl = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 300000;
    this.cached = { accessToken: token, expiresAt: this.now() + ttl };
    return token;
  }
}

module.exports = { CoordinadoraOAuth };
