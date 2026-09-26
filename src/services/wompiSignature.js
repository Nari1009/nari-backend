const crypto = require('crypto');

const WOMPI_REFERENCE_PATTERN = /^NARI-PAY-payment-[a-f0-9]{24}$/;
const WOMPI_REFERENCE_MAX_LENGTH = 255;

const validationError = (message) => Object.assign(new Error(message), { status: 400 });

const normalizeReference = (value) => {
  const reference = String(value || '').trim();
  if (!reference || reference.length > WOMPI_REFERENCE_MAX_LENGTH || !WOMPI_REFERENCE_PATTERN.test(reference)) {
    throw validationError('La referencia Wompi no es válida.');
  }
  return reference;
};

const normalizeAmountInCents = (value) => {
  const amount = String(value ?? '').trim();
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n || BigInt(amount) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw validationError('El monto Wompi no es válido.');
  }
  return amount;
};

const normalizeCurrency = (value) => {
  if (String(value || '').trim().toUpperCase() !== 'COP') throw validationError('La moneda Wompi no es válida.');
  return 'COP';
};

const wompiReferenceForPaymentId = (paymentId) => {
  const id = String(paymentId || '').trim();
  if (!/^payment-[a-f0-9]{24}$/.test(id)) throw validationError('El Payment ID no es válido.');
  return normalizeReference(`NARI-PAY-${id}`);
};

const createIntegritySignature = ({ reference, amountInCents, currency, integritySecret = process.env.WOMPI_INTEGRITY_SECRET }) => {
  const normalizedReference = normalizeReference(reference);
  const normalizedAmount = normalizeAmountInCents(amountInCents);
  const normalizedCurrency = normalizeCurrency(currency);
  const secret = String(integritySecret || '').trim();
  if (!secret) throw new Error('WOMPI_INTEGRITY_SECRET is not configured.');
  return crypto.createHash('sha256').update(`${normalizedReference}${normalizedAmount}${normalizedCurrency}${secret}`, 'utf8').digest('hex');
};

module.exports = {
  WOMPI_REFERENCE_MAX_LENGTH,
  WOMPI_REFERENCE_PATTERN,
  wompiReferenceForPaymentId,
  createIntegritySignature,
};
