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

const sendPasswordResetEmail = ({ to, firstName, resetUrl }) => sendEmail({
  to,
  subject: 'Recupera tu contraseña de NARI',
  htmlBody: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#123f35"><h1>NARI</h1><p>Hola ${escapeHtml(firstName)},</p><p>Recibimos una solicitud para cambiar la contraseña de tu cuenta.</p><p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#064c3e;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px">Cambiar contraseña</a></p><p>Este enlace vence en 30 minutos y solo puede usarse una vez.</p><p>Si no solicitaste este cambio, puedes ignorar este correo.</p></div>`,
  textBody: `Hola ${firstName || ''},\n\nCambia tu contraseña de NARI usando este enlace:\n${resetUrl}\n\nEl enlace vence en 30 minutos y solo puede usarse una vez.`,
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

module.exports = { sendWelcomeEmail, sendPasswordResetEmail, sendPasswordChangedEmail, sendReviewLinkEmail, sendAbandonedCartEmail };
