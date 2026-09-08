class AIServiceError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = 'AIServiceError';
    this.code = code;
    this.status = status;
    this.expose = true;
  }
}

module.exports = { AIServiceError };
