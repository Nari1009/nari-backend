const enabled = () => process.env.WOMPI_ENABLED === 'true';

const ENVIRONMENT_RULES = Object.freeze({
  sandbox: Object.freeze({
    eventEnvironment: 'test',
    publicKey: /^pub_test_[A-Za-z0-9_-]+$/,
    integritySecret: /^test_integrity_[A-Za-z0-9_-]+$/,
    eventsSecret: /^test_events_[A-Za-z0-9_-]+$/,
  }),
  production: Object.freeze({
    eventEnvironment: 'prod',
    publicKey: /^pub_prod_[A-Za-z0-9_-]+$/,
    integritySecret: /^prod_integrity_[A-Za-z0-9_-]+$/,
    eventsSecret: /^prod_events_[A-Za-z0-9_-]+$/,
  }),
});

const environmentRules = (value) => ENVIRONMENT_RULES[value] || null;

const getWompiEventsConfig = () => {
  if (!enabled()) throw Object.assign(new Error('Wompi no está habilitado.'), { status: 503, code: 'WOMPI_DISABLED' });
  const environment = String(process.env.WOMPI_ENV || '').trim().toLowerCase();
  const eventsSecret = String(process.env.WOMPI_EVENTS_SECRET || '').trim();
  const rules = environmentRules(environment);
  if (!rules) throw Object.assign(new Error('WOMPI_ENV debe ser sandbox o production.'), { status: 503, code: 'WOMPI_ENV_INVALID' });
  if (!rules.eventsSecret.test(eventsSecret)) throw Object.assign(new Error(`WOMPI_EVENTS_SECRET no es válido para ${environment}.`), { status: 503, code: 'WOMPI_EVENTS_SECRET_INVALID' });
  return { environment, eventsSecret };
};

const getWompiConfig = () => {
  if (!enabled()) throw Object.assign(new Error('Wompi no está habilitado.'), { status: 503 });
  const environment = String(process.env.WOMPI_ENV || '').trim().toLowerCase();
  const publicKey = String(process.env.WOMPI_PUBLIC_KEY || '').trim();
  const integritySecret = String(process.env.WOMPI_INTEGRITY_SECRET || '').trim();
  const rules = environmentRules(environment);
  if (!rules) throw Object.assign(new Error('WOMPI_ENV debe ser sandbox o production.'), { code: 'WOMPI_ENV_INVALID' });
  if (!rules.publicKey.test(publicKey)) throw new Error(`WOMPI_PUBLIC_KEY no es válido para ${environment}.`);
  if (!rules.integritySecret.test(integritySecret)) throw new Error(`WOMPI_INTEGRITY_SECRET no es válido para ${environment}.`);
  return { environment, publicKey, integritySecret };
};

module.exports = { enabled, getWompiConfig, getWompiEventsConfig, environmentRules };
