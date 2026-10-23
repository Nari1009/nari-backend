const crypto = require('node:crypto');
const DEFAULT_LEASE_MS = 60_000;
const MAX_LEASE_MS = 120_000;

const domainOf = (value) => {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
};

const mapRow = (row) => row ? ({
  productId: row.product_id,
  productFingerprint: row.product_fingerprint,
  extractorVersion: row.extractor_version,
  expiresAt: new Date(row.expires_at).getTime(),
  evidence: {
    productId: row.product_id,
    source: row.source_url,
    sourceDomain: row.source_domain,
    sourceType: row.source_type,
    consultedAt: row.consulted_at,
    extractorVersion: row.extractor_version,
    confidence: row.confidence,
    facts: row.evidence,
  },
}): null;

const createProductResearchRepository = ({ query } = {}) => {
  if (typeof query !== 'function') throw new TypeError('La consulta del repositorio de investigación es obligatoria.');

  return {
    async get(cacheKey) {
      const result = await query(`
        SELECT product_id, product_fingerprint, source_url, source_domain,
               source_type, evidence, confidence, consulted_at, expires_at,
               extractor_version
        FROM public.ai_product_research_evidence
        WHERE cache_key = $1
        ORDER BY consulted_at DESC
        LIMIT 1
      `, [cacheKey]);
      return mapRow(result.rows?.[0]);
    },

    async set(cacheKey, value) {
      const evidence = value?.evidence || {};
      const sourceUrl = String(evidence.source || '').trim();
      const sourceDomain = String(evidence.sourceDomain || domainOf(sourceUrl) || '').trim();
      if (!value?.productId || !value?.productFingerprint || !sourceUrl || !sourceDomain) throw new Error('La evidencia persistente está incompleta.');
      await query(`
        INSERT INTO public.ai_product_research_evidence (
          cache_key, product_id, product_fingerprint, brand_snapshot,
          name_snapshot, variant_snapshot, source_url, source_domain,
          source_type, evidence, confidence, consulted_at, expires_at,
          extractor_version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14)
        ON CONFLICT (cache_key) DO UPDATE SET
          product_id = EXCLUDED.product_id,
          product_fingerprint = EXCLUDED.product_fingerprint,
          brand_snapshot = EXCLUDED.brand_snapshot,
          name_snapshot = EXCLUDED.name_snapshot,
          variant_snapshot = EXCLUDED.variant_snapshot,
          source_url = EXCLUDED.source_url,
          source_domain = EXCLUDED.source_domain,
          source_type = EXCLUDED.source_type,
          evidence = EXCLUDED.evidence,
          confidence = EXCLUDED.confidence,
          consulted_at = EXCLUDED.consulted_at,
          expires_at = EXCLUDED.expires_at,
          extractor_version = EXCLUDED.extractor_version,
          updated_at = CURRENT_TIMESTAMP
      `, [
        cacheKey,
        String(value.productId),
        String(value.productFingerprint),
        String(value.product?.brand || ''),
        String(value.product?.name || ''),
        value.product?.variant || value.product?.sizeLabel || null,
        sourceUrl,
        sourceDomain,
        evidence.sourceType || 'OFFICIAL',
        JSON.stringify(evidence.facts || {}),
        evidence.confidence || 'VERIFIED',
        evidence.consultedAt || new Date().toISOString(),
        new Date(value.expiresAt).toISOString(),
        String(value.extractorVersion || evidence.extractorVersion || 'unknown'),
      ]);
    },

    async withLock(cacheKey, work, { leaseMs = DEFAULT_LEASE_MS } = {}) {
      const ownerId = crypto.randomUUID();
      const boundedLeaseMs = Math.max(1_000, Math.min(MAX_LEASE_MS, Number(leaseMs) || DEFAULT_LEASE_MS));
      const claim = await query(`
        INSERT INTO public.ai_product_research_locks (cache_key, owner_id, lease_until)
        VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 millisecond'))
        ON CONFLICT (cache_key) DO UPDATE SET
          owner_id = EXCLUDED.owner_id,
          lease_until = EXCLUDED.lease_until
        WHERE public.ai_product_research_locks.lease_until <= CURRENT_TIMESTAMP
        RETURNING owner_id
      `, [cacheKey, ownerId, boundedLeaseMs]);
      if (!claim.rows?.length) return null;
      try { return await work(); } finally {
        await query('DELETE FROM public.ai_product_research_locks WHERE cache_key = $1 AND owner_id = $2', [cacheKey, ownerId]).catch(() => undefined);
      }
    },
  };
};

module.exports = { createProductResearchRepository, mapRow };
