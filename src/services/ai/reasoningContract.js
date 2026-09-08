const { AI_MODES, AI_LIMITS } = require('./constants');
const { AIServiceError } = require('./errors');
const { validateProfile } = require('./contract');

const fail = (message) => { throw new AIServiceError('INVALID_AI_RESPONSE', message, 502); };

const boundedReason = (value, field) => {
  if (typeof value !== 'string') fail(`${field} no es válido.`);
  const result = value.trim();
  if (!result || result.length > AI_LIMITS.reason) fail(`${field} no es válido.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(result)) fail(`${field} no es válido.`);
  return result;
};

const validateProviderReasoningOutput = (value, { allowedProductIds = [] } = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('La respuesta de razonamiento AI no es válida.');
  const allowedKeys = ['mode', 'message', 'selectedProductIds', 'reasons', 'profile'];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) fail('La respuesta de razonamiento AI contiene campos no permitidos.');
  if (!AI_MODES.includes(value.mode)) fail('La respuesta de razonamiento AI contiene un modo no permitido.');
  const message = boundedReason(value.message, 'message');
  if (!Array.isArray(value.selectedProductIds) || value.selectedProductIds.length > 3) fail('La selección AI no es válida.');
  const allowed = new Set(allowedProductIds.map(String));
  const selectedProductIds = value.selectedProductIds.map((id) => {
    if (typeof id !== 'string' || !id.trim() || id.trim().length > 120) fail('La selección AI contiene un Product ID no válido.');
    return id.trim();
  });
  if (new Set(selectedProductIds).size !== selectedProductIds.length) fail('La selección AI contiene Product IDs duplicados.');
  if (selectedProductIds.some((id) => !allowed.has(id))) fail('La selección AI contiene un Product ID fuera de los candidatos permitidos.');
  if (value.mode === 'RECOMMENDATION' && selectedProductIds.length === 0) fail('La respuesta AI no seleccionó candidatos.');
  if (value.mode !== 'RECOMMENDATION' && selectedProductIds.length > 0) fail('Solo el modo RECOMMENDATION puede seleccionar Products.');
  if (!Array.isArray(value.reasons)) fail('Las razones AI no son válidas.');
  const reasons = value.reasons.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key) => !['productId', 'reason'].includes(key))) fail(`La razón AI ${index} no es válida.`);
    const productId = typeof item.productId === 'string' ? item.productId.trim() : '';
    if (!productId || !selectedProductIds.includes(productId)) fail(`La razón AI ${index} no corresponde a un Product seleccionado.`);
    return { productId, reason: boundedReason(item.reason, `reason[${index}]`) };
  });
  if (new Set(reasons.map((item) => item.productId)).size !== reasons.length) fail('La respuesta AI contiene razones duplicadas.');
  if (reasons.length !== selectedProductIds.length) fail('Cada Product seleccionado requiere una razón.');
  return { mode: value.mode, message, selectedProductIds, reasons, profile: validateProfile(value.profile) };
};

module.exports = { validateProviderReasoningOutput };
