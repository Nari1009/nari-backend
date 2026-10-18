const crypto = require('crypto');
const { createOfficialDaneResolver } = require('./coordinadora/dane');
const { providerCodeMapFromConfig } = require('./coordinadora/dane');
const { standardPackageFromEnvironment } = require('./coordinadora/config');

const LOGISTICS_STATUS = Object.freeze({ DRAFT: 'DRAFT', READY_FOR_GUIDE: 'READY_FOR_GUIDE', GUIDE_CREATION_DISABLED: 'GUIDE_CREATION_DISABLED' });
const EDITABLE_FIELDS = Object.freeze([
  'recipientName', 'recipientPhone', 'addressLine1', 'addressLine2', 'department', 'municipality',
  'deliveryObservations', 'packageProfileId', 'weightKg', 'lengthCm', 'widthCm', 'heightCm', 'units', 'declaredValue',
]);
const fieldColumns = {
  recipientName: 'recipientname', recipientPhone: 'recipientphone', addressLine1: 'addressline1', addressLine2: 'addressline2',
  department: 'department', municipality: 'municipality', deliveryObservations: 'deliveryobservations', packageProfileId: 'packageprofileid',
  weightKg: 'weightkg', lengthCm: 'lengthcm', widthCm: 'widthcm', heightCm: 'heightcm', units: 'units', declaredValue: 'declaredvalue',
};
const createError = (message, status = 400, code = 'LOGISTICS_INVALID') => Object.assign(new Error(message), { status, code });
const clean = (value) => (value === null || value === undefined ? null : String(value).trim());
const optionalText = (value, label, max) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const result = String(value).trim();
  if (result.length > max) throw createError(`${label} supera el límite permitido.`);
  return result;
};
const requiredText = (value, label, max) => {
  const result = optionalText(value, label, max);
  if (!result) throw createError(`${label} es obligatorio.`);
  return result;
};
const positiveNumber = (value, label, { integer = false, max = 100000 } = {}) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max || (integer && !Number.isInteger(number))) throw createError(`${label} no es válido.`);
  return number;
};
const nonNegativeNumber = (value, label, max = 1000000000) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max) throw createError(`${label} no es válido.`);
  return number;
};

const parseAddress = (value) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
};

const snapshotFromOrder = (order, standardPackage) => {
  const address = parseAddress(order.shippingAddress);
  return {
    recipientName: clean(address.recipientName || address.fullName || [address.firstName, address.lastName].filter(Boolean).join(' ')) || clean([order.customerFirstNameSnapshot, order.customerLastNameSnapshot].filter(Boolean).join(' ')),
    recipientPhone: clean(address.phone || order.customerPhoneSnapshot),
    addressLine1: clean(address.addressLine1 || address.address || address.street),
    addressLine2: clean(address.addressLine2 || address.complement || address.neighborhood),
    department: clean(address.department), municipality: clean(address.city || address.municipality), deliveryObservations: clean(address.deliveryInstructions || address.observations),
    packageProfileId: standardPackage?.id || null, weightKg: standardPackage?.quoteWeight ?? null, lengthCm: standardPackage?.length ?? null,
    widthCm: standardPackage?.width ?? null, heightCm: standardPackage?.height ?? null, units: 1, declaredValue: null,
  };
};

const officialResolver = () => createOfficialDaneResolver();
const providerMap = (config) => { try { return providerCodeMapFromConfig(config); } catch { return null; } };
const resolveLocation = ({ department, municipality, daneResolver = officialResolver(), providerCodeMap: codeMap = null }) => {
  if (!department || !municipality) return { department: department || null, municipality: municipality || null, daneCode: null, providerCode: null };
  let location;
  try { location = daneResolver.resolveLocation({ department, municipality }); } catch (error) { throw createError(error.message, 400, error.code); }
  const providerCode = codeMap?.resolve(location.daneCode) || null;
  return { ...location, providerCode, providerCodeConfirmed: Boolean(providerCode) };
};

const normalizePayload = (payload = {}, { ready = false, current = {}, daneResolver, providerCodeMap: codeMap, packageProfile } = {}) => {
  const merged = { ...current, ...payload };
  const result = {
    recipientName: optionalText(merged.recipientName, 'El nombre del destinatario', 180), recipientPhone: optionalText(merged.recipientPhone, 'El teléfono', 60),
    addressLine1: optionalText(merged.addressLine1, 'La dirección', 240), addressLine2: optionalText(merged.addressLine2, 'El complemento', 240),
    department: optionalText(merged.department, 'El departamento', 120), municipality: optionalText(merged.municipality, 'El municipio', 160),
    deliveryObservations: optionalText(merged.deliveryObservations, 'Las observaciones', 500), packageProfileId: optionalText(merged.packageProfileId, 'El perfil de empaque', 100),
    weightKg: positiveNumber(merged.weightKg, 'El peso'), lengthCm: positiveNumber(merged.lengthCm, 'El largo'), widthCm: positiveNumber(merged.widthCm, 'El ancho'), heightCm: positiveNumber(merged.heightCm, 'El alto'), units: positiveNumber(merged.units, 'Las unidades', { integer: true, max: 100 }),
    declaredValue: nonNegativeNumber(merged.declaredValue, 'El valor declarado'),
  };
  if (result.department && result.municipality) {
    const location = resolveLocation({ department: result.department, municipality: result.municipality, daneResolver, providerCodeMap: codeMap });
    result.department = location.department; result.municipality = location.municipality; result.daneCode = location.daneCode; result.providerCode = location.providerCode;
  } else if (result.department || result.municipality) throw createError('Departamento y municipio deben enviarse juntos.');
  if (result.packageProfileId && packageProfile && result.packageProfileId !== packageProfile.id) throw createError('El perfil de empaque no está configurado.');
  if (ready) {
    for (const [key, label] of [['recipientName', 'El nombre del destinatario'], ['recipientPhone', 'El teléfono'], ['addressLine1', 'La dirección'], ['department', 'El departamento'], ['municipality', 'El municipio'], ['daneCode', 'El código DANE'], ['packageProfileId', 'El perfil de empaque'], ['weightKg', 'El peso'], ['lengthCm', 'El largo'], ['widthCm', 'El ancho'], ['heightCm', 'El alto'], ['units', 'Las unidades']]) if (result[key] === null || result[key] === undefined) throw createError(`${label} es obligatorio para marcar como listo.`);
    if (packageProfile && result.packageProfileId !== packageProfile.id) throw createError('El perfil de empaque no coincide con la configuración estándar.');
  }
  return result;
};

const mapRow = (row) => row && ({ id: row.id, orderId: row.orderId, status: row.status, recipientName: row.recipientName, recipientPhone: row.recipientPhone, addressLine1: row.addressLine1, addressLine2: row.addressLine2, department: row.department, municipality: row.municipality, daneCode: row.daneCode, providerCode: row.providerCode, deliveryObservations: row.deliveryObservations, packageProfileId: row.packageProfileId, weightKg: row.weightKg === null ? null : Number(row.weightKg), lengthCm: row.lengthCm === null ? null : Number(row.lengthCm), widthCm: row.widthCm === null ? null : Number(row.widthCm), heightCm: row.heightCm === null ? null : Number(row.heightCm), units: row.units === null ? null : Number(row.units), declaredValue: row.declaredValue === null ? null : Number(row.declaredValue), shippingAmountPaidByCustomer: row.shippingAmountPaidByCustomer === null ? null : Number(row.shippingAmountPaidByCustomer), actualCarrierShippingCost: row.actualCarrierShippingCost === null ? null : Number(row.actualCarrierShippingCost), version: Number(row.version || 1), createdAt: row.createdAt, updatedAt: row.updatedAt, createdBy: row.createdBy, updatedBy: row.updatedBy, guideGenerationAvailable: false });

const select = `SELECT id, orderid AS "orderId", status, recipientname AS "recipientName", recipientphone AS "recipientPhone", addressline1 AS "addressLine1", addressline2 AS "addressLine2", department, municipality, danecode AS "daneCode", providercode AS "providerCode", deliveryobservations AS "deliveryObservations", packageprofileid AS "packageProfileId", weightkg AS "weightKg", lengthcm AS "lengthCm", widthcm AS "widthCm", heightcm AS "heightCm", units, declaredvalue AS "declaredValue", shippingamountpaidbycustomer AS "shippingAmountPaidByCustomer", actualcarriershippingcost AS "actualCarrierShippingCost", version, createdat AS "createdAt", updatedat AS "updatedAt", createdby AS "createdBy", updatedby AS "updatedBy" FROM order_logistics_preparations`;

const getPreparation = async (repository, orderId) => mapRow(await repository.get(`${select} WHERE orderid = ?`, [orderId]));
const auditValue = (value) => value === null || value === undefined ? null : String(value);

const saveDraft = async ({ repository, orderId, payload, adminId, order, standardPackage, daneResolver = officialResolver(), providerCodeMap: codeMap = null }) => repository.withTransaction(async (tx) => {
  const existing = await tx.get(`${select} WHERE orderid = ? FOR UPDATE`, [orderId]);
  if (existing && payload?.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(existing.version)) throw createError('La preparación logística cambió; vuelve a consultar antes de guardar.', 409, 'LOGISTICS_VERSION_CONFLICT');
  const base = existing || snapshotFromOrder(order, standardPackage);
  const normalized = normalizePayload(payload, { current: base, ready: false, daneResolver, providerCodeMap: codeMap, packageProfile: standardPackage });
  const id = existing?.id || `logistics-${crypto.randomBytes(12).toString('hex')}`;
  const paidShipping = existing ? existing.shippingAmountPaidByCustomer : (order.shippingTotal ?? null);
  const values = [normalized.recipientName, normalized.recipientPhone, normalized.addressLine1, normalized.addressLine2, normalized.department, normalized.municipality, normalized.daneCode || null, normalized.providerCode || null, normalized.deliveryObservations, normalized.packageProfileId, normalized.weightKg, normalized.lengthCm, normalized.widthCm, normalized.heightCm, normalized.units, normalized.declaredValue, paidShipping, existing ? existing.version + 1 : 1, adminId, id];
  if (existing) await tx.run(`UPDATE order_logistics_preparations SET status='DRAFT', recipientname=?, recipientphone=?, addressline1=?, addressline2=?, department=?, municipality=?, danecode=?, providercode=?, deliveryobservations=?, packageprofileid=?, weightkg=?, lengthcm=?, widthcm=?, heightcm=?, units=?, declaredvalue=?, version=?, updatedby=?, updatedat=CURRENT_TIMESTAMP WHERE id=?`, [...values.slice(0, 16), existing.version + 1, adminId, id]);
  else await tx.run(`INSERT INTO order_logistics_preparations (id, orderid, status, recipientname, recipientphone, addressline1, addressline2, department, municipality, danecode, providercode, deliveryobservations, packageprofileid, weightkg, lengthcm, widthcm, heightcm, units, declaredvalue, shippingamountpaidbycustomer, version, createdby, updatedby) VALUES (?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, orderId, ...values.slice(0, 16), paidShipping, 1, adminId, adminId]);
  const next = await tx.get(`${select} WHERE id = ?`, [id]);
  for (const field of [...EDITABLE_FIELDS, 'status']) if (auditValue(existing?.[field]) !== auditValue(next?.[field])) await tx.run('INSERT INTO order_logistics_preparation_history (id, preparationid, orderid, fieldname, previousvalue, newvalue, changedby) VALUES (?, ?, ?, ?, ?, ?, ?)', [`logistics-history-${crypto.randomBytes(12).toString('hex')}`, id, orderId, field, auditValue(existing?.[field]), auditValue(next?.[field]), adminId]);
  return mapRow(next);
});

const markReady = async ({ repository, orderId, adminId, standardPackage, daneResolver = officialResolver(), providerCodeMap: codeMap = null }) => repository.withTransaction(async (tx) => {
  const order = await tx.get('SELECT id, shippingtotal AS "shippingTotal" FROM orders WHERE id = ? FOR UPDATE', [orderId]);
  if (!order) throw createError('Pedido no encontrado.', 404, 'ORDER_NOT_FOUND');
  const payment = await tx.get("SELECT EXISTS (SELECT 1 FROM payments WHERE orderid = ? AND status = 'APPROVED') AS approved", [orderId]);
  if (!payment?.approved) throw createError('Solo los pedidos con pago aprobado pueden quedar listos para guía.', 409, 'PAYMENT_NOT_APPROVED');
  const current = await tx.get(`${select} WHERE orderid = ? FOR UPDATE`, [orderId]);
  if (!current) throw createError('Primero crea un borrador logístico.', 409, 'LOGISTICS_NOT_PREPARED');
  const normalized = normalizePayload({}, { current, ready: true, daneResolver, providerCodeMap: codeMap, packageProfile: standardPackage });
  await tx.run("UPDATE order_logistics_preparations SET status='READY_FOR_GUIDE', danecode=?, providercode=?, updatedby=?, updatedat=CURRENT_TIMESTAMP, version=version+1 WHERE id=?", [normalized.daneCode, normalized.providerCode, adminId, current.id]);
  const next = await tx.get(`${select} WHERE id = ?`, [current.id]);
  if (current.status !== next.status) await tx.run('INSERT INTO order_logistics_preparation_history (id, preparationid, orderid, fieldname, previousvalue, newvalue, changedby) VALUES (?, ?, ?, ?, ?, ?, ?)', [`logistics-history-${crypto.randomBytes(12).toString('hex')}`, current.id, orderId, 'status', current.status, next.status, adminId]);
  return mapRow(next);
});

module.exports = { LOGISTICS_STATUS, EDITABLE_FIELDS, fieldColumns, createError, getPreparation, saveDraft, markReady, normalizePayload, snapshotFromOrder, standardPackageFromEnvironment, providerMap };
