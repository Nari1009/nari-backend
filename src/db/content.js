const { get, run } = require('./init');

const defaults = {
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

async function ensureContent() {
  await run(`CREATE TABLE IF NOT EXISTS site_content (page TEXT PRIMARY KEY, content TEXT NOT NULL, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
  for (const [page, content] of Object.entries(defaults)) {
    const existing = await get('SELECT page FROM site_content WHERE page = ?', [page]);
    if (!existing) await run('INSERT INTO site_content (page, content) VALUES (?, ?)', [page, JSON.stringify(content)]);
  }
}

async function getContent(page) {
  const row = await get('SELECT content FROM site_content WHERE page = ?', [page]);
  return row ? JSON.parse(row.content) : defaults[page] || null;
}

async function saveContent(page, content) {
  await run('INSERT INTO site_content (page, content, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(page) DO UPDATE SET content = excluded.content, updatedAt = CURRENT_TIMESTAMP', [page, JSON.stringify(content)]);
  return getContent(page);
}

module.exports = { defaults, ensureContent, getContent, saveContent };
