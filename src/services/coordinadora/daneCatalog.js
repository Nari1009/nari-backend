// Fuente oficial: Datos Abiertos Colombia, conjunto DIVIPOLA suministrado por DANE.
// Dataset: DIVIPOLA - Códigos municipios (gdxc-w37w).
// Versión de datos: corte 30 diciembre 2024.
// Consulta/metadata: https://www.datos.gov.co/Mapas-Nacionales/DIVIPOLA-C-digos-municipios/gdxc-w37w
// Fecha de incorporación local: 2026-10-17.
// Integridad: verificar el hash del conjunto fuente antes de futuras actualizaciones.
const entries = [
  ...require('./daneCatalog.part01'),
  ...require('./daneCatalog.part02'),
  ...require('./daneCatalog.part03'),
  ...require('./daneCatalog.part04'),
  ...require('./daneCatalog.part05'),
  ...require('./daneCatalog.part06'),
  ...require('./daneCatalog.part07'),
  ...require('./daneCatalog.part08'),
  ...require('./daneCatalog.part09'),
  ...require('./daneCatalog.part10'),
  ...require('./daneCatalog.part11'),
  ...require('./daneCatalog.part12'),
];
module.exports = {
  source: 'Datos Abiertos Colombia / DANE',
  sourceUrl: 'https://www.datos.gov.co/Mapas-Nacionales/DIVIPOLA-C-digos-municipios/gdxc-w37w',
  version: 'corte 30 diciembre 2024',
  retrievedAt: '2026-10-17',
  sourceSha256: '1028ab04c10a08fa860dd89e621de1eb9246710a56102c915f0988ae9e10d63d',
  entries,
};
