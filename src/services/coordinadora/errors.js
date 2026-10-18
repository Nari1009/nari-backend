class CoordinadoraError extends Error {
  constructor(message, { code = 'COORDINADORA_ERROR', status = 502, providerStatus = null, providerCode = null, retryable = false, details = null } = {}) {
    super(message);
    this.name = 'CoordinadoraError';
    this.code = code;
    this.status = status;
    this.providerStatus = providerStatus;
    this.providerCode = providerCode;
    this.retryable = retryable;
    this.details = details;
  }
}

const providerMessage = (body) => {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.error === 'string') return body.error;
  if (body.error && typeof body.error.message === 'string') return body.error.message;
  if (typeof body.message === 'string') return body.message;
  return null;
};

const normalizeProviderError = (body, status) => ({
  providerStatus: Number.isInteger(status) ? status : null,
  providerCode: body && typeof body === 'object' && typeof body.code === 'string' ? body.code : null,
  message: providerMessage(body),
});

const errorFromResponse = (body, status) => {
  const provider = normalizeProviderError(body, status);
  const statusCode = Number.isInteger(status) ? status : 502;
  const code = statusCode === 400 ? 'COORDINADORA_VALIDATION_ERROR'
    : statusCode === 401 ? 'COORDINADORA_AUTHENTICATION_ERROR'
      : statusCode === 429 ? 'COORDINADORA_RATE_LIMITED'
        : statusCode >= 500 ? 'COORDINADORA_PROVIDER_ERROR' : 'COORDINADORA_REQUEST_ERROR';
  return new CoordinadoraError('Coordinadora rechazó la solicitud.', {
    code,
    status: statusCode === 400 ? 400 : statusCode === 401 ? 502 : 502,
    providerStatus: provider.providerStatus,
    providerCode: provider.providerCode,
    retryable: statusCode === 429 || statusCode >= 500,
    details: { providerMessage: provider.message },
  });
};

const timeoutError = () => new CoordinadoraError('La solicitud a Coordinadora agotó el tiempo de espera.', {
  code: 'COORDINADORA_TIMEOUT',
  status: 504,
  retryable: true,
});

module.exports = { CoordinadoraError, errorFromResponse, timeoutError };
