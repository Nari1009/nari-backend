const resendEndpoint = 'https://api.resend.com/emails';

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const emailConfig = () => {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const fromEmail = String(process.env.RESEND_FROM_EMAIL || '').trim();
  const fromName = String(process.env.RESEND_FROM_NAME || '').trim();
  const replyTo = String(process.env.RESEND_REPLY_TO || '').trim();
  if (!apiKey || !fromEmail || !fromName || !replyTo) throw new Error('Transactional email is not configured.');
  return { apiKey, from: `${fromName} <${fromEmail}>`, replyTo };
};

const sendEmail = async ({ to, subject, htmlBody, textBody }) => {
  const config = emailConfig();
  const response = await fetch(resendEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.from,
      to: [to],
      reply_to: config.replyTo,
      subject,
      html: htmlBody,
      text: textBody,
    }),
  });
  if (!response.ok) throw new Error(`Transactional email request failed with status ${response.status}.`);
  return response.json();
};

const supportEmail = () => String(process.env.RESEND_REPLY_TO || '').trim();

const formatCop = (value) => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', maximumFractionDigits: 0,
}).format(Number.isFinite(Number(value)) ? Number(value) : 0).replace(/\u00a0/g, ' ');

const normalizeAddress = (value) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
};

const addressLines = (value) => {
  const address = normalizeAddress(value);
  return [
    address.firstName && address.lastName ? `${address.firstName} ${address.lastName}` : address.firstName || address.lastName,
    address.addressLine1,
    address.addressLine2,
    address.neighborhood,
    [address.city, address.department].filter(Boolean).join(' / '),
    address.country,
    address.phone,
  ].map((line) => String(line || '').trim()).filter(Boolean);
};

const buildOrderReceivedEmail = ({ order, items, accountUrl = null }) => {
  const orderItems = Array.isArray(items) ? items : [];
  const discount = Number(order?.discountTotal || 0);
  const shipping = Number(order?.shippingTotal || 0);
  const itemRows = orderItems.map((item) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const lineTotal = unitPrice * quantity;
    return `<tr><td style="padding:10px 0;border-bottom:1px solid #e7efec"><strong>${escapeHtml(item.productName)}</strong><br><span style="color:#587169">Cantidad: ${quantity} · ${formatCop(unitPrice)} c/u</span></td><td style="padding:10px 0;border-bottom:1px solid #e7efec;text-align:right;white-space:nowrap">${formatCop(lineTotal)}</td></tr>`;
  }).join('');
  const addressHtml = addressLines(order?.shippingAddress).map((line) => `<div>${escapeHtml(line)}</div>`).join('');
  const discountRow = discount > 0 ? `<tr><td style="padding:4px 0">Descuento</td><td style="padding:4px 0;text-align:right">-${formatCop(discount)}</td></tr>` : '';
  const registeredCta = accountUrl ? `<p style="margin:24px 0"><a href="${escapeHtml(accountUrl)}" style="display:inline-block;background:#064c3e;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px">Ver mis pedidos</a></p>` : '';
  const firstName = String(order?.customerFirstNameSnapshot || '').trim();
  const orderNumber = String(order?.id || '').trim();
  const subject = `Recibimos tu pedido NARI #${orderNumber}`;
  const textItems = orderItems.map((item) => `- ${item.productName || 'Producto'} · Cantidad: ${Number(item.quantity || 0)} · ${formatCop(item.unitPrice)} c/u · ${formatCop(Number(item.unitPrice || 0) * Number(item.quantity || 0))}`).join('\n');
  const textAddress = addressLines(order?.shippingAddress).join('\n');
  const textDiscount = discount > 0 ? `\nDescuento: -${formatCop(discount)}` : '';
  const textCta = accountUrl ? `\nConsulta tus pedidos: ${accountUrl}` : '\nGuarda este correo como referencia de tu pedido.';
  return {
    subject,
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#123f35;line-height:1.5"><h1 style="color:#064c3e">NARI</h1><p>Hola ${escapeHtml(firstName)},</p><p><strong>¡Gracias por tu pedido!</strong></p><p>Recibimos tu pedido y ya está registrado en nuestro sistema.</p><p><strong>Número de pedido:</strong><br>${escapeHtml(orderNumber)}</p><h2 style="font-size:18px;color:#064c3e">Productos</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tbody>${itemRows}</tbody></table><h2 style="font-size:18px;color:#064c3e">Resumen</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tbody><tr><td style="padding:4px 0">Subtotal productos</td><td style="padding:4px 0;text-align:right">${formatCop(order?.subtotal)}</td></tr>${discountRow}<tr><td style="padding:4px 0">Envío</td><td style="padding:4px 0;text-align:right">${shipping > 0 ? formatCop(shipping) : 'Gratis'}</td></tr><tr><td style="padding:10px 0;border-top:1px solid #123f35"><strong>Total</strong></td><td style="padding:10px 0;border-top:1px solid #123f35;text-align:right"><strong>${formatCop(order?.total)}</strong></td></tr></tbody></table><h2 style="font-size:18px;color:#064c3e">Dirección de envío</h2><div>${addressHtml || 'No disponible'}</div>${registeredCta}<p>Recibimos tu pedido y podrás consultar actualizaciones posteriormente. Este mensaje confirma el registro del pedido; no constituye una confirmación de pago.</p><p>Si necesitas ayuda, escríbenos a <a href="mailto:${escapeHtml(supportEmail())}">${escapeHtml(supportEmail())}</a>.</p><p style="color:#587169">NARI<br>Skincare coreano</p></div>`,
    textBody: `Hola ${firstName || ''},\n\n¡Gracias por tu pedido! Recibimos tu pedido y ya está registrado en nuestro sistema.\n\nNúmero de pedido: ${orderNumber}\n\nProductos:\n${textItems}\n\nSubtotal productos: ${formatCop(order?.subtotal)}${textDiscount}\nEnvío: ${shipping > 0 ? formatCop(shipping) : 'Gratis'}\nTotal: ${formatCop(order?.total)}\n\nDirección de envío:\n${textAddress || 'No disponible'}\n\nEste mensaje confirma el registro del pedido; no constituye una confirmación de pago.${textCta}\n\nSi necesitas ayuda, escríbenos a ${supportEmail()}.\n\nNARI · Skincare coreano`,
  };
};

const sendOrderReceivedEmail = ({ order, items, accountUrl = null }) => {
  const email = String(order?.customerEmailSnapshot || '').trim();
  if (!email) throw new Error('Order email snapshot is missing.');
  const message = buildOrderReceivedEmail({ order, items, accountUrl });
  return sendEmail({ to: email, ...message });
};

const sendPasswordResetEmail = ({ to, firstName, resetUrl }) => sendEmail({
  to,
  subject: 'Recupera tu contraseña de NARI',
  htmlBody: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#123f35"><h1>NARI</h1><p>Hola ${escapeHtml(firstName)},</p><p>Recibimos una solicitud para cambiar la contraseña de tu cuenta.</p><p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#064c3e;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px">Cambiar contraseña</a></p><p>Este enlace vence en 30 minutos y solo puede usarse una vez.</p><p>Si no solicitaste este cambio, puedes ignorar este correo.</p></div>`,
  textBody: `Hola ${firstName || ''},\n\nCambia tu contraseña de NARI usando este enlace:\n${resetUrl}\n\nEl enlace vence en 30 minutos y solo puede usarse una vez.`,
});

const sendEmailVerification = ({ to, firstName, verifyUrl }) => sendEmail({
  to,
  subject: 'Confirma tu correo en NARI',
  htmlBody: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#123f35"><h1>NARI</h1><p>Hola ${escapeHtml(firstName)},</p><p>Confirma tu correo para habilitar tu cuenta NARI.</p><p><a href="${escapeHtml(verifyUrl)}" style="display:inline-block;background:#064c3e;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px">Confirmar mi correo</a></p><p>Este enlace vence en 24 horas y solo puede usarse una vez.</p><p>Si no creaste esta cuenta, ignora este correo.</p></div>`,
  textBody: `Hola ${firstName || ''},\n\nConfirma tu correo para habilitar tu cuenta NARI:\n${verifyUrl}\n\nEste enlace vence en 24 horas y solo puede usarse una vez. Si no creaste esta cuenta, ignora este correo.`,
});

const sendWelcomeEmail = ({ to, firstName }) => sendEmail({
  to,
  subject: 'Bienvenido a NARI',
  htmlBody: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#123f35"><h1>NARI</h1><p>Hola ${escapeHtml(firstName)},</p><p>Tu cuenta fue creada correctamente. Ahora puedes iniciar sesión, consultar tus pedidos y mantener tus datos actualizados desde tu espacio personal.</p><p>Gracias por elegir NARI.</p><p>Si necesitas ayuda, escríbenos a <a href="mailto:${escapeHtml(supportEmail())}">${escapeHtml(supportEmail())}</a>.</p></div>`,
  textBody: `Hola ${firstName || ''},\n\nTu cuenta de NARI fue creada correctamente. Ahora puedes iniciar sesión, consultar tus pedidos y mantener tus datos actualizados desde tu espacio personal.\n\nGracias por elegir NARI.\n\nSi necesitas ayuda, escríbenos a ${supportEmail()}.`,
});

const sendPasswordChangedEmail = ({ to, firstName }) => sendEmail({
  to,
  subject: 'Tu contraseña de NARI fue actualizada',
  htmlBody: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#123f35"><h1>NARI</h1><p>Hola ${escapeHtml(firstName)},</p><p>La contraseña de tu cuenta NARI fue actualizada correctamente.</p><p>Si tú no realizaste este cambio, escribe inmediatamente a <a href="mailto:${escapeHtml(supportEmail())}">${escapeHtml(supportEmail())}</a> para recibir ayuda.</p><p>Por seguridad, cerramos todas las sesiones activas de tu cuenta.</p></div>`,
  textBody: `Hola ${firstName || ''},\n\nLa contraseña de tu cuenta NARI fue actualizada correctamente.\n\nSi tú no realizaste este cambio, escribe inmediatamente a ${supportEmail()} para recibir ayuda.\n\nPor seguridad, cerramos todas las sesiones activas de tu cuenta.`,
});

const sendReviewLinkEmail = ({ to, firstName, reviewUrl, productNames }) => sendEmail({
  to,
  subject: 'Cuéntanos qué te pareció tu compra en NARI',
  htmlBody: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#123f35"><h1>NARI</h1><p>Hola ${escapeHtml(firstName)},</p><p>Esperamos que ya estés disfrutando tu pedido. Nos gustaría conocer tu experiencia con:</p><ul>${productNames.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul><p><a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#064c3e;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px">Valorar mi compra</a></p><p>El enlace estará disponible durante 30 días. Solo podrás valorar productos de este pedido una vez.</p><p>Si necesitas ayuda, escríbenos a <a href="mailto:${escapeHtml(supportEmail())}">${escapeHtml(supportEmail())}</a>.</p></div>`,
  textBody: `Hola ${firstName || ''},\n\nCuéntanos qué te pareció tu compra en NARI:\n${productNames.map((name) => `- ${name}`).join('\n')}\n\nValora tu compra aquí:\n${reviewUrl}\n\nEl enlace estará disponible durante 30 días.`,
});

const sendAbandonedCartEmail = ({ to, firstName, cartUrl, items, reminderNumber }) => sendEmail({
  to,
  subject: reminderNumber === 1 ? 'Tus productos siguen esperándote en NARI' : 'Último recordatorio de tu carrito NARI',
  htmlBody: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#123f35"><h1>NARI</h1><p>Hola ${escapeHtml(firstName || '')},</p><p>${reminderNumber === 1 ? 'Vimos que dejaste algunos productos en tu carrito.' : 'Este es el último recordatorio de los productos que dejaste en tu carrito.'}</p><ul>${items.map((item) => `<li>${escapeHtml(item.name)} · ${item.quantity} unidad(es)</li>`).join('')}</ul><p><a href="${escapeHtml(cartUrl)}" style="display:inline-block;background:#064c3e;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px">Volver a mi carrito</a></p><p>Si ya no deseas comprarlos, puedes ignorar este mensaje.</p></div>`,
  textBody: `Hola ${firstName || ''},\n\n${reminderNumber === 1 ? 'Vimos que dejaste productos en tu carrito.' : 'Este es el último recordatorio de tu carrito.'}\n\n${items.map((item) => `- ${item.name} · ${item.quantity} unidad(es)`).join('\n')}\n\nContinúa tu compra aquí:\n${cartUrl}`,
});

module.exports = { buildOrderReceivedEmail, sendOrderReceivedEmail, sendWelcomeEmail, sendPasswordResetEmail, sendEmailVerification, sendPasswordChangedEmail, sendReviewLinkEmail, sendAbandonedCartEmail };
