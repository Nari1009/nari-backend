const { get, run } = require('./init');
const { ContractValidationError } = require('../services/settingsContract');

const defaults = {
  home: {
    hero: {
      eyebrow: 'NARI · SKINCARE COREANO',
      title: 'Skincare con criterio.',
      description: 'Una selección de skincare coreano para ayudarte a entender qué tiene sentido para tu piel.',
      ctaLabel: 'Explorar productos',
    },
    faq: [
      { question: '¿Cómo sé qué productos son adecuados para mi piel?', answer: 'Cuéntanos cómo sientes tu piel y qué quieres mejorar. NARI te ayudará a encontrar una rutina sencilla y personalizada.' },
      { question: '¿Los productos son originales?', answer: 'Sí. Trabajamos con distribuidores confiables y seleccionamos cada producto con intención.' },
      { question: '¿Cómo funcionan los envíos?', answer: 'Enviamos tus productos cuidadosamente empacados a todo Colombia.' },
      { question: '¿Cómo puedo crear una rutina?', answer: 'Puedes comenzar conversando con NARI o escribiéndonos para recibir una recomendación.' },
      { question: '¿Cuánto tarda mi pedido?', answer: 'Los pedidos suelen llegar entre 2 y 5 días hábiles, según tu ciudad.' },
      { question: '¿Qué métodos de pago aceptan?', answer: 'Aceptamos los principales medios de pago disponibles en Colombia.' },
    ],
  },
  ayuda: {
    eyebrow: 'NARI · CENTRO DE AYUDA', title: '¿Cómo podemos ayudarte?', description: 'Encuentra información clara sobre los temas más importantes de tu experiencia con NARI.',
    topics: [
      { id: 'politicas-privacidad', title: 'Políticas de privacidad', intro: 'Queremos que tengas claridad sobre la información que compartes cuando navegas o te comunicas con NARI.', detail: 'La política oficial de privacidad se publicará cuando terminemos de definir los procesos de datos, cuentas y pedidos.' },
      { id: 'terminos-condiciones', title: 'Términos y condiciones', intro: 'Aquí reuniremos las condiciones de uso de la tienda, la información de los productos y los servicios de NARI.', detail: 'Los términos oficiales están pendientes de completar.' },
      { id: 'envios', title: 'Política de envíos', intro: 'Te ayudaremos a entender cómo se prepara y se entrega un pedido de NARI.', detail: 'Los tiempos, costos, transportadoras y cobertura se definirán al conectar la operación logística.' },
      { id: 'cambios-devoluciones', title: 'Cambios y devoluciones', intro: 'Si necesitas orientación después de una compra, este será el espacio para consultar el proceso correspondiente.', detail: 'Las condiciones para cambios y devoluciones todavía están pendientes de definición.' },
      { id: 'metodos-pago', title: 'Métodos de pago', intro: 'Aquí podrás consultar las alternativas de pago disponibles para tus compras en NARI.', detail: 'Los medios de pago se incorporarán cuando se conecte la plataforma correspondiente.' },
    ],
    contactTitle: '¿No encuentras lo que necesitas?', contactText: 'Estamos preparando más información para acompañarte mejor. Mientras tanto, puedes escribirnos desde la página de Contacto.',
  },
  contacto: {
    eyebrow: 'NARI · ESTAMOS PARA AYUDARTE', title: 'Hablemos.', description: '¿Tienes una pregunta sobre tu pedido, nuestros productos o no sabes por dónde empezar? Encuentra el canal que mejor se adapte a ti.',
    sectionTitle: 'Una conversación puede empezar aquí.', channels: [
      { type: 'WhatsApp', title: '¿Necesitas ayuda? Escríbenos.', text: 'Para preguntas sobre productos, pedidos, envíos o si necesitas orientación para encontrar lo que buscas.', action: 'Hablar por WhatsApp' },
      { type: 'Correo electrónico', title: '¿Prefieres escribirnos?', text: 'Para consultas que requieran un poco más de detalle. Te responderemos tan pronto como podamos.', action: 'Enviar un correo' },
      { type: 'Alianzas', title: 'Crezcamos juntos.', text: 'Si tienes una empresa, centro, comunidad o proyecto y crees que podemos crear algo juntos, nos gustaría conocerte.', action: 'Hablemos de una alianza' },
    ],
    topics: [
      { title: 'Productos', text: 'Dudas sobre nuestros productos y cómo elegir entre diferentes opciones.' }, { title: 'Pedidos', text: 'Información relacionada con una compra realizada.' }, { title: 'Envíos', text: 'Preguntas relacionadas con la entrega de pedidos.' }, { title: 'Skincare', text: 'Orientación general para encontrar productos según lo que buscas.' }, { title: 'Cambios y devoluciones', text: 'Te orientamos sobre el proceso correspondiente.' }, { title: 'Alianzas', text: 'Propuestas para trabajar con NARI.' },
    ],
    questions: [
      { question: '¿Cómo puedo saber el estado de mi pedido?', answer: 'Escríbenos por uno de nuestros canales de contacto con tu número de pedido.' }, { question: '¿Cuánto tarda mi envío?', answer: 'Los tiempos pueden depender de la ciudad y de la transportadora.' }, { question: '¿Puedo cambiar o devolver un producto?', answer: 'Consulta con nuestro equipo para conocer el proceso aplicable.' }, { question: '¿Cómo sé qué producto elegir?', answer: 'Puedes explorar la Tienda para ordenar tus opciones según tu piel.' }, { question: '¿Los productos son originales?', answer: 'Trabajamos para seleccionar productos de fuentes confiables.' }, { question: '¿Cómo puedo trabajar con NARI?', answer: 'Cuéntanos sobre tu empresa, centro, comunidad o proyecto.' },
    ],
  },
  nosotros: {
    eyebrow: 'NARI · SOBRE NOSOTROS', title: 'Skincare con criterio.', description: 'Una selección de skincare coreano para ayudarte a entender qué tiene sentido para tu piel.', introTitle: 'Elegir skincare no debería sentirse como investigar una tesis.', introText: 'NARI nace para hacer esa selección más simple: mirar con atención, ordenar la información y acercarte productos que tengan una razón clara para estar en tu rutina.', methodTitle: 'Seleccionamos con curiosidad y criterio.', methodText: 'No buscamos llenar un catálogo. Buscamos que cada producto tenga sentido dentro de él.', criteria: [{ title: 'Fórmula', text: 'Miramos qué contiene el producto y cómo está formulado.' }, { title: 'Función', text: 'Entendemos para qué necesidad puede tener sentido.' }, { title: 'Experiencia', text: 'Consideramos textura, acabado y facilidad de uso.' }, { title: 'Evidencia', text: 'Separamos el marketing, la tendencia y lo que podemos justificar.' }, { title: 'Selección', text: 'Elegimos productos que aporten algo claro al catálogo.' }], philosophyTitle: 'Una rutina con menos ruido.', philosophy: ['Menos ruido. Más criterio.', 'No todo el mundo necesita diez pasos.', 'La piel no es una tendencia.', 'Una buena rutina empieza por entender.'],
  },
};

const contentLimits = { short: 160, body: 1200, question: 240, answer: 800, array: 20, faq: 12 };
const contentFail = (message) => { throw new ContractValidationError(message); };
const contentObject = (value, label) => { if (!value || typeof value !== 'object' || Array.isArray(value)) contentFail(`${label} debe ser un objeto.`); };
const contentString = (value, field, max = contentLimits.body) => {
  if (typeof value !== 'string') contentFail(`${field} debe ser texto.`);
  const result = value.trim();
  if (result.length > max) contentFail(`${field} supera el máximo permitido.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(result)) contentFail(`${field} contiene caracteres no permitidos.`);
  if (/<\/?[a-z][^>]*>/i.test(result)) contentFail(`${field} no admite HTML.`);
  return result;
};
const contentKeys = (value, keys, label) => {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length) contentFail(`${label} contiene campos no permitidos: ${unknown.join(', ')}.`);
};
const textItem = (value, fields, label) => {
  contentObject(value, label);
  contentKeys(value, fields, label);
  return Object.fromEntries(fields.map((field) => [field, contentString(value[field], `${label}.${field}`, contentLimits.short)]));
};
const textList = (value, fields, label) => {
  if (!Array.isArray(value) || value.length > contentLimits.array) contentFail(`${label} debe ser una lista válida.`);
  return value.map((item) => textItem(item, fields, label));
};
const faqList = (value) => {
  if (!Array.isArray(value) || value.length > contentLimits.faq) contentFail('home.faq debe ser una lista válida.');
  return value.map((item) => textItemWithLimits(item, ['question', 'answer'], 'home.faq', { question: contentLimits.question, answer: contentLimits.answer }));
};
const textItemWithLimits = (value, fields, label, limits) => {
  contentObject(value, label);
  contentKeys(value, fields, label);
  return Object.fromEntries(fields.map((field) => [field, contentString(value[field], `${label}.${field}`, limits[field])]));
};

const validateContent = (page, value) => {
  if (!Object.prototype.hasOwnProperty.call(defaults, page)) contentFail('Content page not found');
  contentObject(value, page);
  if (page === 'home') {
    contentKeys(value, ['hero', 'faq'], page);
    contentObject(value.hero, 'home.hero');
    contentKeys(value.hero, ['eyebrow', 'title', 'description', 'ctaLabel'], 'home.hero');
    return {
      hero: {
        eyebrow: contentString(value.hero.eyebrow, 'home.hero.eyebrow', contentLimits.short),
        title: contentString(value.hero.title, 'home.hero.title', contentLimits.short),
        description: contentString(value.hero.description, 'home.hero.description', contentLimits.body),
        ctaLabel: contentString(value.hero.ctaLabel, 'home.hero.ctaLabel', contentLimits.short),
      },
      faq: faqList(value.faq),
    };
  }
  if (page === 'ayuda') {
    contentKeys(value, ['eyebrow', 'title', 'description', 'topics', 'contactTitle', 'contactText'], page);
    return {
      eyebrow: contentString(value.eyebrow, 'ayuda.eyebrow', contentLimits.short),
      title: contentString(value.title, 'ayuda.title', contentLimits.short),
      description: contentString(value.description, 'ayuda.description'),
      topics: textList(value.topics, ['id', 'title', 'intro', 'detail'], 'ayuda.topics'),
      contactTitle: contentString(value.contactTitle, 'ayuda.contactTitle', contentLimits.short),
      contactText: contentString(value.contactText, 'ayuda.contactText'),
    };
  }
  if (page === 'contacto') {
    contentKeys(value, ['eyebrow', 'title', 'description', 'sectionTitle', 'channels', 'topics', 'questions'], page);
    return {
      eyebrow: contentString(value.eyebrow, 'contacto.eyebrow', contentLimits.short),
      title: contentString(value.title, 'contacto.title', contentLimits.short),
      description: contentString(value.description, 'contacto.description'),
      sectionTitle: contentString(value.sectionTitle, 'contacto.sectionTitle', contentLimits.short),
      channels: textList(value.channels, ['type', 'title', 'text', 'action'], 'contacto.channels'),
      topics: textList(value.topics, ['title', 'text'], 'contacto.topics'),
      questions: textList(value.questions, ['question', 'answer'], 'contacto.questions'),
    };
  }
  contentKeys(value, ['eyebrow', 'title', 'description', 'introTitle', 'introText', 'methodTitle', 'methodText', 'criteria', 'philosophyTitle', 'philosophy'], page);
  if (!Array.isArray(value.philosophy) || value.philosophy.length > contentLimits.array) contentFail('nosotros.philosophy debe ser una lista válida.');
  return {
    eyebrow: contentString(value.eyebrow, 'nosotros.eyebrow', contentLimits.short),
    title: contentString(value.title, 'nosotros.title', contentLimits.short),
    description: contentString(value.description, 'nosotros.description'),
    introTitle: contentString(value.introTitle, 'nosotros.introTitle', contentLimits.short),
    introText: contentString(value.introText, 'nosotros.introText'),
    methodTitle: contentString(value.methodTitle, 'nosotros.methodTitle', contentLimits.short),
    methodText: contentString(value.methodText, 'nosotros.methodText'),
    criteria: textList(value.criteria, ['title', 'text'], 'nosotros.criteria'),
    philosophyTitle: contentString(value.philosophyTitle, 'nosotros.philosophyTitle', contentLimits.short),
    philosophy: value.philosophy.map((item) => contentString(item, 'nosotros.philosophy', contentLimits.short)),
  };
};

async function ensureContent() {
  await run(`CREATE TABLE IF NOT EXISTS site_content (page TEXT PRIMARY KEY, content TEXT NOT NULL, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
  for (const [page, content] of Object.entries(defaults)) {
    if (page === 'home') continue;
    const existing = await get('SELECT page FROM site_content WHERE page = ?', [page]);
    if (!existing) await run('INSERT INTO site_content (page, content) VALUES (?, ?)', [page, JSON.stringify(content)]);
  }
}

async function getContent(page) {
  const row = await get('SELECT content FROM site_content WHERE page = ?', [page]);
  if (!Object.prototype.hasOwnProperty.call(defaults, page)) return null;
  if (!row) return defaults[page];
  try { return validateContent(page, JSON.parse(row.content)); } catch (error) {
    console.error('Invalid persisted site content ignored', { page });
    return defaults[page];
  }
}

async function saveContent(page, content) {
  const validated = validateContent(page, content);
  await run('INSERT INTO site_content (page, content, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(page) DO UPDATE SET content = excluded.content, updatedAt = CURRENT_TIMESTAMP', [page, JSON.stringify(validated)]);
  return getContent(page);
}

module.exports = { defaults, ensureContent, getContent, saveContent, validateContent };
