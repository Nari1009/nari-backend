const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../src/services/reportData'), 'utf8');

test('report datasets share the canonical commercial predicate', () => {
  assert.match(source, /const validSaleStatuses = \['Pagado', 'Preparando', 'Enviado', 'Entregado'\]/);
  assert.match(source, /\.status IN \(\$\{validSalePlaceholders\}\).*\.isTest = FALSE/);
  assert.doesNotMatch(source, /validSaleStatuses = \[[^\]]*'Pendiente'/);
  assert.doesNotMatch(source, /validSaleStatuses = \[[^\]]*'Cancelado'/);
});
