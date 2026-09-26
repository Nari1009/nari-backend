const assert = require('node:assert/strict');
const test = require('node:test');
const { buildOrderReceivedEmail } = require('../src/services/email');

test('order_received email clearly communicates payment pending while preserving order details', () => {
  const email = buildOrderReceivedEmail({
    order: {
      id: 'order-1',
      orderNumber: 'NAR-1234',
      subtotal: '100000',
      shippingTotal: '12000',
      total: '112000',
      shippingAddress: { city: 'Bogotá' },
    },
    items: [{ productName: 'Limpiador', quantity: 2, unitPrice: 50000 }],
  });

  assert.equal(email.subject, 'Recibimos tu pedido NARI #NAR-1234 — pago en verificación');
  for (const body of [email.htmlBody, email.textBody]) {
    assert.match(body, /¡Recibimos tu pedido!/);
    assert.match(body, /Tu pedido quedó registrado en NARI y estamos esperando la confirmación del pago\./);
    assert.match(body, /Pago en verificación/);
    assert.match(body, /Te enviaremos una confirmación cuando el pago sea aprobado\./);
    assert.match(body, /NAR-1234/);
    assert.match(body, /Limpiador/);
    assert.match(body, /Cantidad: 2/);
    assert.match(body, /Subtotal productos/);
    assert.match(body, /Envío/);
    assert.match(body, /Total/);
    assert.match(body, /no constituye una confirmación de pago/);
    assert.doesNotMatch(body, /pago aprobado/i);
  }
});
