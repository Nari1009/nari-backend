const crypto = require('crypto');

const bucket = 'product-images';

const supabaseConfig = () => ({
  url: String(process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  key: String(process.env.SUPABASE_SERVICE_ROLE_KEY || ''),
});

const parseDataUrl = (dataUrl) => {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) throw new Error('La imagen debe ser PNG, JPG o WebP válida.');
  const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) throw new Error('La imagen no puede superar 8 MB.');
  return { mimeType, buffer };
};

const storageRequest = async (path, options = {}) => {
  const { url, key } = supabaseConfig();
  if (!url || !key) throw new Error('Falta configurar SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el backend.');
  return fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(options.headers || {}),
    },
  });
};

const ensureBucket = async () => {
  const response = await storageRequest('/storage/v1/bucket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: true,
      allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp'],
      file_size_limit: 8 * 1024 * 1024,
    }),
  });
  if (!response.ok && response.status !== 409) {
    const detail = await response.text();
    throw new Error(`No se pudo preparar Supabase Storage (${response.status}): ${detail.slice(0, 180)}`);
  }
};

const uploadProductImage = async ({ productId, dataUrl, alt }) => {
  const { mimeType, buffer } = parseDataUrl(dataUrl);
  await ensureBucket();
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const filePath = `products/${encodeURIComponent(productId)}/${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${extension}`;
  const response = await storageRequest(`/storage/v1/object/${bucket}/${filePath}`, {
    method: 'POST',
    headers: { 'Content-Type': mimeType, 'x-upsert': 'false' },
    body: buffer,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`No se pudo subir la imagen (${response.status}): ${detail.slice(0, 180)}`);
  }
  const { url } = supabaseConfig();
  return {
    url: `${url}/storage/v1/object/public/${bucket}/${filePath}`,
    alt: String(alt || '').trim(),
    path: filePath,
  };
};

module.exports = { uploadProductImage };
