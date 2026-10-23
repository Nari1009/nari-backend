const normalize = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const OUT_OF_DOMAIN_PATTERNS = [
  /\b(futbol|futbolista|partido|partidos|gol|goles|mundial|liga|baloncesto|tenis|beisbol)\b/i,
  /\bjuega\b|\bjuegan\b|\bjug[oó]\b/i,
  /\b(quien|quienes)\s+(juega|juegan|jugo|jugar[aá])\b/i,
  /\bseleccion\s+(colombia|nacional)\b/i,
  /\b(presidente|presidenta|elecciones|eleccion|gobierno|ministro|politica|politico|politica)\b/i,
  /\b(resuelve|resolver|resultado)\s+(una\s+)?(ecuacion|problema\s+matematico|integral)\b/i,
  /\b(codigo|programa|programar|python|javascript|typescript|algoritmo)\b/i,
  /\b(serie|pelicula|peliculas|cancion|musica|actor|actriz|videojuego)\b/i,
  /\b(historia|capital|geografia)\s+(de|del|sobre)\b/i,
];

const NARI_DOMAIN_PATTERNS = [
  /\b(skincare|piel|cosmetic|rutina|ingrediente|niacinamida|retinol|acido|ampolla|serum|suero|crema|hidratante|limpiador|protector|tonico|esencia)\b/i,
  /\b(producto|marca|catalogo|precio|costo|stock|disponibilidad|promocion|carrito|comprar|pedido|envio|devolucion|pago)\b/i,
  /\b(nari|dr\.?\s*althea|skin1004|celimax)\b/i,
];

const SHORT_FOLLOW_UP = /^(si|sí|no|ese|esa|eso|ese producto|la ampolla|el serum|el sérum|la crema|¿?y ese\??|¿?y esa\??|¿?y manana\??|¿?y mañana\??|¿?cuanto cuesta\??|¿?cómo lo uso\??|¿?como lo uso\??|¿?me sirve\??|¿?lo puedo comprar\??)$/i;
const INJECTION_PATTERN = /\b(ignora|olvida|desobedece|omite)\b.{0,80}\b(instrucciones|reglas|sistema)\b/i;

const hasProductContext = ({ state, context, historyText }) => Boolean(
  state?.conversation?.activeIntent
  || state?.conversation?.pendingAction
  || state?.conversation?.focusProductIds?.length
  || state?.artifacts?.recentRecommendations?.length
  || state?.artifacts?.recentProductReferences?.length
  || context?.currentProductId
  || context?.recentRecommendations?.length
  || context?.recentRoutine?.length
  || NARI_DOMAIN_PATTERNS.some((pattern) => pattern.test(normalize(historyText)))
);

const classifyDomain = ({ message, history = [], state = null, context = null } = {}) => {
  const current = normalize(message);
  const historyText = history.map((item) => item?.content || '').join(' ');
  const normalizedHistoryText = normalize(historyText);
  const combined = `${current} ${normalizedHistoryText}`;
  const explicitOutOfDomain = OUT_OF_DOMAIN_PATTERNS.some((pattern) => pattern.test(current))
    || (INJECTION_PATTERN.test(current) && OUT_OF_DOMAIN_PATTERNS.some((pattern) => pattern.test(combined)))
    || (SHORT_FOLLOW_UP.test(current) && OUT_OF_DOMAIN_PATTERNS.some((pattern) => pattern.test(normalizedHistoryText)) && !NARI_DOMAIN_PATTERNS.some((pattern) => pattern.test(current)));
  if (explicitOutOfDomain) return { status: 'OUT_OF_SCOPE', reason: 'CLEARLY_UNRELATED', hasContext: hasProductContext({ state, context, historyText }) };
  if (NARI_DOMAIN_PATTERNS.some((pattern) => pattern.test(current))) return { status: 'IN_SCOPE', reason: 'NARI_TOPIC' };
  if (SHORT_FOLLOW_UP.test(current) && hasProductContext({ state, context, historyText })) return { status: 'IN_SCOPE', reason: 'VALID_NARI_FOLLOW_UP' };
  if (current.length < 40 && hasProductContext({ state, context, historyText })) return { status: 'IN_SCOPE', reason: 'CONTEXTUAL_FOLLOW_UP' };
  if (!current || current.length < 40) return { status: 'AMBIGUOUS', reason: 'INSUFFICIENT_CONTEXT' };
  return { status: 'AMBIGUOUS', reason: 'NO_NARI_SIGNAL' };
};

const domainRefusal = () => ({
  intent: 'UNKNOWN',
  mode: 'ANSWER',
  message: 'Puedo ayudarte únicamente con cuidado cosmético de la piel (skincare), productos y compras en NARI. ¿Qué te gustaría saber?',
  profile: null,
  recommendations: [],
});

module.exports = { classifyDomain, domainRefusal, NARI_DOMAIN_PATTERNS, OUT_OF_DOMAIN_PATTERNS };
