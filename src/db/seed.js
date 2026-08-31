const { run, all, initDb, ensureOrderShippingColumns, ensureCatalogOptions } = require('./init');
const { ensureAdminUser } = require('../services/adminAuth');
const productDetails = require('./productDetails');

const purchasedProducts = [
  ['H880983506045', 'TOCOBO', 'Tocobo Cica Cooling Sun Stick SPF50+ PA++++', 3, 60350, 'Harumi'],
  ['H8809447255071', 'Dr. Althea', 'Dr. Althea Pure Grinding Cleansing Balm', 4, 84490, 'Harumi'],
  ['NH4485324519', 'Medicube', 'Medicube PDRN Pink Peptide Serum', 2, 95850, 'Harumi'],
  ['H8809657114731', 'Round Lab', 'Round Lab 1025 Dokdo Toner', 4, 63190, 'Harumi'],
  ['H8809782551814', 'Round Lab', 'Round Lab Birch Juice Moisturizing Sunscreen', 4, 74550, 'Harumi'],
  ['H8809732911583', 'Mixsoon', 'Mixsoon Centella Asiatica Toner (150ml)', 2, 53250, 'Harumi'],
  ['H8809576261141', 'SKIN1004', 'Skin1004 Madagascar Centella Toning Toner', 2, 64680, 'Harumi'],
  ['H8809576261646', 'SKIN1004', 'Skin1004 Madagascar Centella Poremizing Light Gel Cream', 2, 65340, 'Harumi'],
  ['H8809576261417', 'SKIN1004', 'Skin1004 Madagascar Centella Tone Brightening Capsule Ampoule (30ml)', 5, 38940, 'Harumi'],
  ['H8809640733550', 'Anua', 'Anua Peach 70 Niacin Serum', 3, 84490, 'Harumi'],
  ['H8809640734427', 'Anua', 'Anua Heartleaf Quercetinol Pore Deep Cleansing Foam', 5, 63190, 'Harumi'],
  ['H8809640731433', 'Anua', 'Anua Heartleaf 77 Soothing Toner (250ml)', 5, 84490, 'Harumi'],
  ['H8809576261110', 'SKIN1004', 'Skin1004 Madagascar Centella Light Cleansing Oil', 5, 65340, 'Harumi'],
  ['H8809732911880', 'Mixsoon', 'Mixsoon Bean Essence', 3, 74550, 'Harumi'],
  [null, 'SKIN1004', 'SKIN1004 Hyalu-Cica Water-Fit Sun Serum SPF50+ PA++++ 50ml', 6, 63700, 'SOMI'],
  [null, 'SKIN1004', 'SKIN1004 Madagascar Centella Ampoule Foam', 6, 57400, 'SOMI'],
  [null, 'SKIN1004', 'SKIN1004 Probio-Cica Enrich Cream', 4, 80100, 'SOMI'],
  [null, 'Dr. Althea', 'Dr. Althea 345 Relief Cream', 4, 88900, 'SOMI'],
  [null, 'Ksecret', 'Ksecret SEOUL 1988 Serum: Retinal Liposome 2% + Black Ginseng', 4, 66400, 'SOMI'],
  [null, 'Ksecret', 'Ksecret SEOUL 1988 Eye Cream: Retinal Liposome 4% + Fermented Bean', 4, 67400, 'SOMI'],
];

const importPurchasedProducts = async () => {
  for (const [index, [sku, brand, name, stock, cost, supplier]] of purchasedProducts.entries()) {
    const existing = sku ? await all('SELECT id FROM products WHERE sku = ?', [sku]) : await all('SELECT id FROM products WHERE name = ? AND supplier = ?', [name, supplier]);
    if (existing.length) continue;
    const reference = sku || `${String(supplier).toLowerCase()}-${index + 1}`;
    const id = `purchase-${reference.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const slug = `${brand}-${name}-${reference}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    await run(`INSERT INTO products (id, brand, name, slug, category, description, sku, price, cost, stock, minimumStock, status, supplier, images)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, brand, name, slug, '', '', sku || null, null, cost, stock, 3, 'inactive', supplier, '[]']);
    await run('INSERT INTO inventory_movements (id, productId, quantity, type, description, stockBefore, stockAfter, reason, reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [`purchase-${id}`, id, stock, 'initial', `Ingreso de compra - ${supplier}`, 0, stock, 'Compra', sku]);
  }
  console.log(`✓ Productos comprados revisados (${purchasedProducts.length} registros de Harumi y SOMI)`);
};

const catalogMetadata = [
  ['SKIN1004', ['hyalu-cica', 'water-fit sun serum'], 'Protector solar', 'Normal / mixta / deshidratada', 'Seca / sensible', 'Centella asiática + ácido hialurónico + niacinamida'],
  ['SKIN1004', ['light cleansing oil'], 'Aceite limpiador', 'Normal / mixta / grasa', 'Seca / sensible', 'Centella asiática + mezcla de aceites/emolientes'],
  ['SKIN1004', ['ampoule foam'], 'Limpiador acuoso', 'Normal / mixta', 'Sensible / grasa', 'Centella asiática + agentes limpiadores'],
  ['Anua', ['heartleaf 77', 'soothing toner'], 'Tónico calmante', 'Mixta / grasa / sensible', 'Acne-prone / normal', 'Heartleaf 77%'],
  ['SKIN1004', ['tone brightening', 'capsule ampoule'], 'Ampoule iluminadora', 'Manchas / tono desigual', 'Normal / mixta / post-acné', 'Niacinamida + ácido tranexámico + centella'],
  ['Dr. Althea', ['345 relief cream'], 'Hidratante', 'Mixta / sensible / acne-prone', 'Normal / deshidratada', 'Niacinamida + pantenol + centella y complejo calmante'],
  ['Anua', ['quercetinol', 'pore deep cleansing foam'], 'Limpiador acuoso', 'Grasa / mixta / poros', 'Acne-prone', 'Heartleaf + Quercetinol™ + BHA'],
  ['Mixsoon', ['bean essence'], 'Esencia', 'Textura / deshidratación', 'Normal / seca / mixta', 'Fermentos de soja + ingredientes humectantes'],
  ['Round Lab', ['birch juice', 'moisturizing sunscreen'], 'Protector solar', 'Normal / seca / deshidratada', 'Mixta / sensible', 'Savia de abedul + humectantes'],
  ['Anua', ['peach 70', 'niacin serum'], 'Sérum iluminador', 'Manchas / luminosidad / tono desigual', 'Normal / mixta', 'Niacinamida + Peach Complex'],
  ['Round Lab', ['1025 dokdo toner'], 'Tónico', 'Normal / sensible / deshidratada', 'Mixta / seca', 'Agua de mar profundo + pantenol + humectantes'],
  ['SKIN1004', ['probio-cica', 'enrich cream'], 'Hidratante', 'Seca / sensible / barrera alterada', 'Normal / deshidratada', 'Centella fermentada + ceramidas + complejo Probio-Cica'],
  ['Mixsoon', ['glacier water', 'hyaluronic acid serum'], 'Sérum hidratante', 'Deshidratada / seca', 'Normal / mixta', 'Ácido hialurónico'],
  ['Medicube', ['pdrn pink', 'peptide serum'], 'Sérum', 'Antiedad / elasticidad / glow', 'Normal / seca', 'PDRN + péptidos'],
  ['SKIN1004', ['poremizing fresh ampoule'], 'Ampoule / poros', 'Grasa / mixta / poros', 'Normal / textura', 'Centella asiática + complejo Poremizing'],
  ['Dr. Althea', ['pure grinding', 'cleansing balm'], 'Bálsamo limpiador', 'Normal / seca / sensible', 'Mixta', 'Aceites/emolientes + ingredientes calmantes'],
  ['Ksecret', ['seoul 1988', 'retinal liposome 2', 'black ginseng'], 'Sérum antiedad', 'Antiedad / líneas / textura', 'Manchas / piel madura', 'Retinal liposomal + ginseng negro'],
  ['Ksecret', ['seoul 1988', 'eye cream', 'retinal liposome 4', 'fermented bean'], 'Contorno de ojos', 'Líneas del contorno / antiedad', 'Textura / firmeza', 'Retinal liposomal + soja fermentada'],
  ['SKIN1004', ['poremizing light gel cream'], 'Hidratante gel', 'Grasa / mixta', 'Normal / acne-prone', 'Centella asiática + complejo Poremizing + humectantes'],
  ['SKIN1004', ['toning toner'], 'Tónico', 'Mixta / textura', 'Grasa / normal', 'Centella + PHA'],
  ['Mixsoon', ['centella asiatica', 'toner'], 'Tónico calmante', 'Sensible / calmante', 'Normal / mixta', 'Centella asiática'],
];

const normalizeText = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const updateCatalogMetadata = async () => {
  const products = await all('SELECT id, brand, name FROM products');
  let updated = 0; let skipped = 0;
  for (const [brand, nameParts, category, skinTypes, concerns, ingredients] of catalogMetadata) {
    const normalizedBrand = normalizeText(brand);
    const matchedProducts = products.filter((candidate) => normalizeText(candidate.brand) === normalizedBrand && nameParts.every((part) => normalizeText(candidate.name).includes(normalizeText(part))));
    if (!matchedProducts.length) { skipped += 1; continue; }
    for (const product of matchedProducts) await run('UPDATE products SET category = ?, skinTypes = ?, concerns = ?, ingredients = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [category, JSON.stringify(skinTypes.split('/').map((item) => item.trim())), JSON.stringify(concerns.split('/').map((item) => item.trim())), JSON.stringify(ingredients.split('+').map((item) => item.trim())), product.id]);
    updated += matchedProducts.length;
  }
  console.log(`✓ Metadata de catálogo actualizada (${updated} productos; ${skipped} filas no encontradas y omitidas)`);
};

const updateProductDetails = async () => {
  const products = await all('SELECT id, brand, name, sku FROM products');
  const stripSource = (value) => String(value || '').replace(/\s+(?:Anua US|Anua Global|Ulta Beauty|DR\.ALTHEA|What's In My Jar|Walmart\.ca|MEDICUBE US|mixsoon|Round Lab|Sephora UK|SKIN1004|Self Care Skin|incidecoder\.com)$/i, '').trim();
  let updated = 0; let skipped = 0;
  for (const detail of productDetails) {
    let matches = products.filter((product) => product.sku && product.sku === detail.sku);
    if (!matches.length) {
      const cleanName = (value) => normalizeText(value).replace(/\b\d+\s?(?:ml|g)\b/g, '').replace(/\b(?:spf\d+|pa)\b/g, '');
      const target = cleanName(detail.name);
      const tokens = target.split(' ').filter((token) => token.length > 2 && token !== normalizeText(detail.brand));
      const scored = products.filter((product) => normalizeText(product.brand) === normalizeText(detail.brand)).map((product) => ({
        product,
        score: tokens.filter((token) => cleanName(product.name).includes(token)).length,
      })).sort((a, b) => b.score - a.score);
      if (scored[0]?.score >= 2 && scored[0].score > (scored[1]?.score || 0)) matches = [scored[0].product];
    }
    if (matches.length !== 1) { skipped += 1; console.warn(`⚠ Ficha omitida por coincidencia no única: ${detail.name}`); continue; }
    const product = matches[0];
    await run(`UPDATE products SET brand = ?, sku = ?, category = ?, concerns = ?, skinTypes = ?, description = ?, audience = ?, skinBenefits = ?, howToUse = ?, precautions = ?, fullIngredients = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [
      detail.brand, detail.sku, detail.category,
      JSON.stringify(detail.concerns.split('·').map((item) => item.trim()).filter(Boolean)),
      JSON.stringify([detail.skinTypes]), stripSource(detail.description), detail.audience,
      detail.skinBenefits, JSON.stringify(detail.howToUse ? [detail.howToUse] : []), detail.precautions, stripSource(detail.fullIngredients), product.id
    ]);
    updated += 1;
  }
  console.log(`✓ Fichas de productos actualizadas (${updated} productos; ${skipped} filas no encontradas y omitidas)`);
};

const seedProducts = async () => {
  const products = [
    {
      id: 'p-001',
      brand: 'TOCOBO',
      name: 'Cotton Soft Sun Stick SPF50+ PA++++',
      slug: 'tocobo-cotton-soft-sun-stick-spf50-pa',
      category: 'Protectores solares',
      price: 78000,
      cost: 45000,
      stock: 5,
      status: 'active',
      rating: 4.9,
      reviewCount: 256,
      soldCount: 5200,
      isBestSeller: 1,
      skinTypes: JSON.stringify(['grasa', 'mixta', 'normal']),
      concerns: JSON.stringify(['proteccion', 'textura']),
      ingredients: JSON.stringify(['niacinamida']),
      benefits: JSON.stringify(['Ayuda a acompañar una rutina enfocada en proteccion.', 'Ayuda a acompañar una rutina enfocada en textura.']),
      howToUse: JSON.stringify(['Aplica después de limpiar y tonificar.', 'Distribuye suavemente sobre rostro y cuello.', 'Continúa con el siguiente paso de tu rutina.']),
      precautions: 'Suspende su uso si notas incomodidad. Consulta la información del empaque antes de usar.',
      images: JSON.stringify([{ url: '', alt: 'Placeholder de Cotton Soft Sun Stick SPF50+ PA++++' }]),
      description: 'Producto seleccionado para una rutina de skincare coreano consciente.',
    },
    {
      id: 'p-002',
      brand: 'SKIN1004',
      name: 'Hyalu-Cica Water-Fit Sun Serum SPF50+ PA++++',
      slug: 'skin1004-hyalu-cica-water-fit-sun-serum-spf50-pa',
      category: 'Protectores solares',
      price: 98000,
      cost: 55000,
      stock: 8,
      status: 'active',
      rating: 4.9,
      reviewCount: 184,
      soldCount: 4100,
      isBestSeller: 1,
      skinTypes: JSON.stringify(['seca', 'sensible', 'normal']),
      concerns: JSON.stringify(['hidratacion', 'sensibilidad']),
      ingredients: JSON.stringify(['centella asiatica', 'acido hialuronico']),
      benefits: JSON.stringify(['Ayuda a acompañar una rutina enfocada en hidratacion.']),
      howToUse: JSON.stringify(['Aplica después de limpiar y tonificar.', 'Distribuye suavemente sobre rostro y cuello.', 'Continúa con el siguiente paso de tu rutina.']),
      precautions: 'Suspende su uso si notas incomodidad. Consulta la información del empaque antes de usar.',
      images: JSON.stringify([{ url: '', alt: 'Placeholder de Hyalu-Cica Water-Fit Sun Serum SPF50+ PA++++'  }]),
      description: 'Producto seleccionado para una rutina de skincare coreano consciente.',
    },
    {
      id: 'p-003',
      brand: 'SKIN1004',
      name: 'Madagascar Centella Ampoule',
      slug: 'skin1004-madagascar-centella-ampoule',
      category: 'Ampoules',
      price: 105000,
      cost: 60000,
      stock: 12,
      status: 'active',
      rating: 4.8,
      reviewCount: 127,
      soldCount: 3200,
      isBestSeller: 1,
      skinTypes: JSON.stringify(['grasa', 'seca', 'mixta', 'sensible']),
      concerns: JSON.stringify(['sensibilidad', 'reparacion de barrera']),
      ingredients: JSON.stringify(['centella asiatica']),
      benefits: JSON.stringify(['Ayuda a acompañar una rutina enfocada en sensibilidad.', 'Ayuda a acompañar una rutina enfocada en reparacion de barrera.']),
      howToUse: JSON.stringify(['Aplica después de limpiar y tonificar.', 'Distribuye suavemente sobre rostro y cuello.', 'Continúa con el siguiente paso de tu rutina.']),
      precautions: 'Suspende su uso si notas incomodidad. Consulta la información del empaque antes de usar.',
      images: JSON.stringify([{ url: '', alt: 'Placeholder de Madagascar Centella Ampoule' }]),
      description: 'Producto seleccionado para una rutina de skincare coreano consciente.',
    },
    {
      id: 'p-004',
      brand: 'Beauty of Joseon',
      name: 'Relief Sun Rice + Probiotics SPF50+ PA++++',
      slug: 'beauty-of-joseon-relief-sun-rice-probiotics-spf50-pa',
      category: 'Protectores solares',
      price: 89000,
      cost: 50000,
      stock: 6,
      status: 'active',
      rating: 4.8,
      reviewCount: 98,
      soldCount: 2400,
      isBestSeller: 1,
      skinTypes: JSON.stringify(['seca', 'normal', 'sensible']),
      concerns: JSON.stringify(['hidratacion', 'luminosidad']),
      ingredients: JSON.stringify(['niacinamida']),
      benefits: JSON.stringify(['Ayuda a acompañar una rutina enfocada en hidratacion.']),
      howToUse: JSON.stringify(['Aplica después de limpiar y tonificar.', 'Distribuye suavemente sobre rostro y cuello.', 'Continúa con el siguiente paso de tu rutina.']),
      precautions: 'Suspende su uso si notas incomodidad. Consulta la información del empaque antes de usar.',
      images: JSON.stringify([{ url: '', alt: 'Placeholder de Relief Sun Rice + Probiotics SPF50+ PA++++'  }]),
      description: 'Producto seleccionado para una rutina de skincare coreano consciente.',
    },
    {
      id: 'p-005',
      brand: 'COSRX',
      name: 'Low pH Good Morning Gel Cleanser',
      slug: 'cosrx-low-ph-good-morning-gel-cleanser',
      category: 'Limpiadores',
      price: 72000,
      cost: 40000,
      stock: 10,
      status: 'active',
      rating: 4.7,
      reviewCount: 221,
      soldCount: 3600,
      isBestSeller: 0,
      skinTypes: JSON.stringify(['grasa', 'mixta', 'acneica']),
      concerns: JSON.stringify(['acne', 'control de grasa', 'poros']),
      ingredients: JSON.stringify(['acido salicilico']),
      benefits: JSON.stringify(['Ayuda a acompañar una rutina enfocada en acne.']),
      howToUse: JSON.stringify(['Aplica después de limpiar y tonificar.', 'Distribuye suavemente sobre rostro y cuello.', 'Continúa con el siguiente paso de tu rutina.']),
      precautions: 'Suspende su uso si notas incomodidad. Consulta la información del empaque antes de usar.',
      images: JSON.stringify([{ url: '', alt: 'Placeholder de Low pH Good Morning Gel Cleanser' }]),
      description: 'Producto seleccionado para una rutina de skincare coreano consciente.',
    },
    {
      id: 'p-006',
      brand: 'COSRX',
      name: 'Advanced Snail 92 All In One Cream',
      slug: 'cosrx-advanced-snail-92-all-in-one-cream',
      category: 'Cremas',
      price: 99000,
      cost: 55000,
      stock: 7,
      status: 'active',
      rating: 4.7,
      reviewCount: 87,
      soldCount: 1500,
      isBestSeller: 1,
      skinTypes: JSON.stringify(['seca', 'normal', 'sensible']),
      concerns: JSON.stringify(['reparacion de barrera', 'hidratacion']),
      ingredients: JSON.stringify(['heartleaf']),
      benefits: JSON.stringify(['Ayuda a acompañar una rutina enfocada en reparacion de barrera.']),
      howToUse: JSON.stringify(['Aplica después de limpiar y tonificar.', 'Distribuye suavemente sobre rostro y cuello.', 'Continúa con el siguiente paso de tu rutina.']),
      precautions: 'Suspende su uso si notas incomodidad. Consulta la información del empaque antes de usar.',
      images: JSON.stringify([{ url: '', alt: 'Placeholder de Advanced Snail 92 All In One Cream' }]),
      description: 'Producto seleccionado para una rutina de skincare coreano consciente.',
    },
    {
      id: 'p-007',
      brand: 'Anua',
      name: 'Heartleaf Pore Control Cleansing Oil',
      slug: 'anua-heartleaf-pore-control-cleansing-oil',
      category: 'Aceites limpiadores',
      price: 109000,
      cost: 60000,
      stock: 9,
      status: 'active',
      rating: 4.9,
      reviewCount: 176,
      soldCount: 2600,
      isBestSeller: 1,
      skinTypes: JSON.stringify(['grasa', 'mixta', 'acneica']),
      concerns: JSON.stringify(['poros', 'control de grasa']),
      ingredients: JSON.stringify(['heartleaf']),
      benefits: JSON.stringify(['Ayuda a acompañar una rutina enfocada en poros.']),
      howToUse: JSON.stringify(['Aplica después de limpiar y tonificar.', 'Distribuye suavemente sobre rostro y cuello.', 'Continúa con el siguiente paso de tu rutina.']),
      precautions: 'Suspende su uso si notas incomodidad. Consulta la información del empaque antes de usar.',
      images: JSON.stringify([{ url: '', alt: 'Placeholder de Heartleaf Pore Control Cleansing Oil' }]),
      description: 'Producto seleccionado para una rutina de skincare coreano consciente.',
    },
    {
      id: 'p-008',
      brand: 'Medicube',
      name: 'PDRN Pink Collagen Capsule Cream',
      slug: 'medicube-pdrn-pink-collagen-capsule-cream',
      category: 'Cremas',
      price: 135000,
      cost: 75000,
      stock: 4,
      status: 'active',
      rating: 4.8,
      reviewCount: 63,
      soldCount: 1200,
      isBestSeller: 0,
      skinTypes: JSON.stringify(['seca', 'normal']),
      concerns: JSON.stringify(['antiedad', 'reparacion de barrera']),
      ingredients: JSON.stringify(['pdrn']),
      benefits: JSON.stringify(['Ayuda a acompañar una rutina enfocada en antiedad.']),
      howToUse: JSON.stringify(['Aplica después de limpiar y tonificar.', 'Distribuye suavemente sobre rostro y cuello.', 'Continúa con el siguiente paso de tu rutina.']),
      precautions: 'Suspende su uso si notas incomodidad. Consulta la información del empaque antes de usar.',
      images: JSON.stringify([{ url: '', alt: 'Placeholder de PDRN Pink Collagen Capsule Cream' }]),
      description: 'Producto seleccionado para una rutina de skincare coreano consciente.',
    },
    {
      id: 'p-009',
      brand: 'Torriden',
      name: 'Dive-In Low Molecular Hyaluronic Serum',
      slug: 'torriden-dive-in-low-molecular-hyaluronic-serum',
      category: 'Serums',
      price: 102000,
      cost: 58000,
      stock: 11,
      status: 'active',
      rating: 4.8,
      reviewCount: 111,
      soldCount: 1800,
      isBestSeller: 0,
      skinTypes: JSON.stringify(['seca', 'normal', 'sensible']),
      concerns: JSON.stringify(['hidratacion', 'textura']),
      ingredients: JSON.stringify(['acido hialuronico']),
      benefits: JSON.stringify(['Ayuda a acompañar una rutina enfocada en hidratacion.']),
      howToUse: JSON.stringify(['Aplica después de limpiar y tonificar.', 'Distribuye suavemente sobre rostro y cuello.', 'Continúa con el siguiente paso de tu rutina.']),
      precautions: 'Suspende su uso si notas incomodidad. Consulta la información del empaque antes de usar.',
      images: JSON.stringify([{ url: '', alt: 'Placeholder de Dive-In Low Molecular Hyaluronic Serum' }]),
      description: 'Producto seleccionado para una rutina de skincare coreano consciente.',
    },
    {
      id: 'p-010',
      brand: 'COSRX',
      name: 'The Niacinamide 15 Serum',
      slug: 'cosrx-the-niacinamide-15-serum',
      category: 'Serums',
      price: 89000,
      cost: 50000,
      stock: 3,
      status: 'active',
      rating: 4.8,
      reviewCount: 94,
      soldCount: 1100,
      isBestSeller: 0,
      skinTypes: JSON.stringify(['grasa', 'mixta', 'acneica']),
      concerns: JSON.stringify(['poros', 'manchas', 'control de grasa']),
      ingredients: JSON.stringify(['niacinamida']),
      benefits: JSON.stringify(['Ayuda a acompañar una rutina enfocada en poros.']),
      howToUse: JSON.stringify(['Aplica después de limpiar y tonificar.', 'Distribuye suavemente sobre rostro y cuello.', 'Continúa con el siguiente paso de tu rutina.']),
      precautions: 'Suspende su uso si notas incomodidad. Consulta la información del empaque antes de usar.',
      images: JSON.stringify([{ url: '', alt: 'Placeholder de The Niacinamide 15 Serum' }]),
      description: 'Producto seleccionado para una rutina de skincare coreano consciente.',
    },
  ];

  await initDb();
  await ensureOrderShippingColumns();

  const existing = await all('SELECT COUNT(*) as count FROM products');
  if (existing[0].count === 0) {
    for (const product of products) {
      await run(
        `INSERT INTO products (id, brand, name, slug, category, price, cost, stock, status, rating, reviewCount, soldCount, isBestSeller, skinTypes, concerns, ingredients, benefits, howToUse, precautions, images, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          product.id, product.brand, product.name, product.slug, product.category,
          product.price, product.cost, product.stock, product.status,
          product.rating, product.reviewCount, product.soldCount, product.isBestSeller,
          product.skinTypes, product.concerns, product.ingredients, product.benefits,
          product.howToUse, product.precautions, product.images, product.description
        ]
      );
    }
    console.log('✓ Productos iniciales cargados (10 productos)');
  }
  await importPurchasedProducts();
  await updateCatalogMetadata();
  await updateProductDetails();
  await ensureCatalogOptions();
  await ensureAdminUser();
};

if (require.main === module) {
  seedProducts().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seedProducts };
