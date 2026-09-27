const enabled = () => process.env.WOMPI_ENABLED === 'true';

const getWompiEventsConfig = () => {
  if (!enabled()) throw Object.assign(new Error('Wompi no está habilitado.'), { status: 503, code: 'WOMPI_DISABLED' });
  const environment = String(process.env.WOMPI_ENV || '').trim().toLowerCase();
  const eventsSecret = String(process.env.WOMPI_EVENTS_SECRET || '').trim();
  if (environment !== 'sandbox') throw Object.assign(new Error('WOMPI_ENV debe ser sandbox en DEV.'), { status: 503, code: 'WOMPI_ENV_INVALID' });
  if (!/^test_events_[A-Za-z0-9_-]+$/.test(eventsSecret)) throw Object.assign(new Error('WOMPI_EVENTS_SECRET de Sandbox no es válido.'), { status: 503, code: 'WOMPI_EVENTS_SECRET_INVALID' });
  return { environment, eventsSecret };
};

const getWompiConfig = () => {
  if (!enabled()) throw Object.assign(new Error('Wompi no está habilitado.'), { status: 503 });
  const environment = String(process.env.WOMPI_ENV || '').trim().toLowerCase();
  const publicKey = String(process.env.WOMPI_PUBLIC_KEY || '').trim();
  const integritySecret = String(process.env.WOMPI_INTEGRITY_SECRET || '').trim();
  if (environment !== 'sandbox') throw new Error('WOMPI_ENV debe ser sandbox en DEV.');
  if (!/^pub_test_[A-Za-z0-9_-]+$/.test(publicKey)) throw new Error('WOMPI_PUBLIC_KEY de Sandbox no es válido.');
  if (!/^test_integrity_[A-Za-z0-9_-]+$/.test(integritySecret)) throw new Error('WOMPI_INTEGRITY_SECRET de Sandbox no es válido.');
  return { environment, publicKey, integritySecret };
};

module.exports = { enabled, getWompiConfig, getWompiEventsConfig };
