# NARI AI CONTEXT

## PURPOSE

NARI AI is intended to interpret a customer’s natural-language skincare needs in Spanish and guide them toward suitable products and routines from NARI’s own catalog.

It is cosmetic guidance, not diagnosis or medical treatment.

## SAFETY BOUNDARIES

- Do not diagnose or treat medical conditions.
- Flag or avoid medical-like terminology such as rosacea, eczema, dermatitis, allergies or severe acne.
- Do not infer claims from one ingredient alone.
- Do not recommend products outside NARI’s eligible catalog.
- Backend deterministic logic must control sellability and candidate eligibility.
- A future LLM must not invent Products or independently determine sellability.

## INTENDED ARCHITECTURE

### Designed / planned

1. Natural-language intake in Spanish.
2. Structured customer intent: base profile, conditions and cosmetic goals.
3. Deterministic Backend eligibility and candidate selection.
4. Future ranking/recommendation and routine construction using canonical Product metadata.
5. Future LLM interpretation constrained to NARI catalog data.
6. Client-held temporary conversation history; refresh resets it; Backend validates and truncates received history.
7. No anonymous conversation database for V1.

### Not established

Provider, model, prompt contract, rate limits, logging/evaluation design and final ranking formula remain open decisions.

## CURRENT IMPLEMENTATION

### Backend

Relevant paths:

- `src/domain/productTaxonomy.js` — canonical constants and validators.
- `src/services/productProjection.js` — explicit public Product projection.
- `src/routes/admin.js` — authenticated Product create/update support.
- `src/db/init.js` — Product schema/bootstrap behavior.
- `migrations/20260908_r11b2_product_ai_metadata.sql` — `routineStep`, `sizeLabel`.
- `migrations/20260909_r11b2_canonical_recommendation_metadata.sql` — canonical recommendation fields.

Status: R11B2 catalog foundation and R11B Admin maintenance are closed. R11C Backend AI Base is complete; catalog recommendation runtime is absent.

### Client

The Client uses legacy Product metadata for storefront display, filtering and search. It does not consume canonical recommendation fields and has no NARI AI UI.

### Admin

The Admin frontend supports canonical Product metadata editing in Admin DEV `origin/dev` commit `2598c39`, with taxonomy labels/options in `src/data/canonicalProductMetadata.ts`. It exposes `routineStep`, `sizeLabel`, `suitableSkinTypes`, `suitableConditions` and `targets`; array fields preserve `NULL` (Sin revisar), `[]` (Revisado sin valores) and non-empty selections. Backend validation remains authoritative. Controlled live DEV UI verification passed on the verified implementation and temporary fixture state was restored; semantic integration onto current Admin DEV preserved that behavior. R11B is closed; Admin is the human editing surface and the DB Product row remains the sole persisted Product-specific source of truth.

### Database

DEV contains 25 Products: 20 real catalog Products and 5 preserved fixtures. Canonical fields exist; reviewed values have now been written for the 12 READY real Products, while the 8 PARTIAL real Products remain unresolved and untouched.

### R11C Backend AI Base

Implemented in progress:

- `src/routes/ai.js` mounted at `POST /api/ai/adviser`.
- `src/services/ai/contract.js` validates bounded client requests and strict provider output.
- `src/services/ai/aiService.js` orchestrates transient interpretation without querying the catalog or writing Product data.
- `src/services/ai/providers/aiProvider.js` defines the provider-neutral boundary.
- `src/services/ai/providers/openaiProvider.js` is an optional HTTP adapter using `OPENAI_API_KEY` only when configured; no key is stored or required for tests.
- `src/services/ai/safety.js` handles cautious medical escalation and privileged-instruction boundaries.
- `src/services/ai/rateLimiter.js` provides a bounded in-memory route limiter.

The response is Backend-controlled and never proxies raw provider objects. R11D candidate data remains internal; any public recommendation card is constructed only after selected-ID validation and final DB re-fetch. No live provider key is configured in this environment. Conversation state is request-scoped only; no DB persistence exists.

## CANONICAL PRODUCT TAXONOMY

### routineStep

`FIRST_CLEANSE`, `CLEANSER`, `TONER`, `ESSENCE`, `SERUM`, `EYE_CARE`, `MOISTURIZER`, `SUNSCREEN`.

### sizeLabel

Nullable human-readable commercial presentation, such as `50 ml` or `18 g`. No unit arithmetic.

### suitableSkinTypes

`OILY`, `DRY`, `COMBINATION`, `NORMAL`.

`SENSITIVE`, `DEHYDRATED`, `ACNE_PRONE` and `MATURE` are not base skin types.

### suitableConditions

`SENSITIVE`, `DEHYDRATED`, `ACNE_PRONE`, `REDNESS_PRONE`, `BARRIER_COMPROMISED`.

### targets

`ACNE`, `EXCESS_OIL`, `HYDRATION`, `BARRIER_SUPPORT`, `DARK_SPOTS`, `UNEVEN_TONE`, `TEXTURE`, `PORES`, `FINE_LINES`, `FIRMNESS`, `DULLNESS`, `UV_PROTECTION`.

`DEHYDRATED` is a condition; `HYDRATION` is a goal. `BARRIER_COMPROMISED` is a condition; `BARRIER_SUPPORT` is a goal. `ACNE_PRONE` is a condition; `ACNE` is a goal.

`NULL` means unresolved/not curated. `[]` means reviewed and intentionally empty. No automatic universal interpretation is approved.

## CURATION STATUS

R11B2.6D reviewed 20 real Products:

- READY: 12.
- PARTIAL: 8.
- BLOCKED: 0.
- **At the R11B2.6D checkpoint, no canonical curation values had been written.** The subsequent controlled DEV write populated only the 12 READY Products. See `docs/checkpoints/R11B2_READY_DEV_WRITE.md` for the verified post-write state.

### READY

- Anua Heartleaf 77 Soothing Toner.
- Anua Heartleaf Quercetinol Pore Deep Cleansing Foam.
- Anua Peach 70 Niacin Serum.
- Ksecret SEOUL 1988 Retinal Serum.
- Medicube PDRN Pink Peptide Serum.
- Round Lab 1025 Dokdo Toner.
- Round Lab Birch Juice Moisturizing Sunscreen.
- SKIN1004 Hyalu-Cica Water-Fit Sun Serum.
- SKIN1004 Madagascar Centella Ampoule Foam.
- SKIN1004 Madagascar Centella Light Cleansing Oil.
- SKIN1004 Poremizing Light Gel Cream.
- SKIN1004 Tone Brightening Capsule Ampoule.

### PARTIAL / remaining unknowns

- Dr. Althea 345 Relief Cream — base skin types.
- Dr. Althea Pure Grinding Cleansing Balm — base skin types and conditions.
- KSECRET Eye Cream — exact NARI size.
- Mixsoon Bean Essence — exact NARI size and base skin types.
- Mixsoon Centella Toner — base skin types.
- SKIN1004 Toning Toner — exact NARI size.
- SKIN1004 Probio-Cica Enrich Cream — conditions.
- TOCOBO Sun Stick — base skin types.

## DATA FLOW STATUS

| Area | Current state |
|---|---|
| Product schema | Canonical columns exist in DEV; values uncurated |
| Backend | Validation, persistence and safe public projection exist |
| Admin | Canonical Product metadata editor implemented and live-verified; no Product-specific hardcodes |
| Client | Legacy Product display/filtering exists; canonical consumption absent |
| AI engine | R11C transient adviser base exists; catalog selection and recommendation runtime do not exist |

### R11D Catalog / Fixture Boundary and Candidate Engine

The internal `catalogRole` boundary is implemented in `src/services/ai/candidates/catalogEligibility.js` and migration `migrations/20260912_r11d_catalog_role.sql`. Human verification established 20 `CATALOG`, 5 `DEV_FIXTURE` and 0 NULL in DEV. Only `CATALOG` rows with active status and positive stock are eligible; `DEV_FIXTURE` and `NULL` fail closed. The public Product projection excludes this operational field.

The deterministic engine is split across `candidateRepository.js`, `candidateScoring.js` and `candidateService.js`. It supports `PRODUCT_SELECTION` and step-specific `BUILD_ROUTINE` discovery only. It uses weights of 40 for routine-step match, 20 for skin-type match, 12 for condition match, 10 per requested-target overlap, and a 2-point uncertainty penalty. Routine conflicts and known skin-type conflicts exclude candidates. Results require a minimum score of 10, are capped at five, and sort by score, confidence and Product ID. Budget filtering is deferred because R11C does not define budget scope.

## SOURCE OF TRUTH

Product rows are intended to hold canonical Product recommendation metadata. Legacy Product fields remain in use for storefront compatibility. Seed/import routines remain capable of mutating legacy metadata when explicitly run; normal server startup does not invoke catalog seeding.

## NOT IMPLEMENTED YET

- Client chat UI.
- Full routine builder.
- Later comparison, compatibility, budget and existing-Product flows.
- Chat UI.
- Recommendation engine.
- Routine builder.
- Canonical Client consumption.
- Conversation database.
- Embeddings/vector database.

## CURRENT STOPPING POINT

R11B2.6D, the controlled READY DEV write, and the R11B Admin canonical metadata editor are complete. R11B is closed. R11C Backend AI Base is complete. R11D points 6–9 are complete; later comparison/compatibility/budget/existing-Product flows remain pending. No additional DEV DB or Product metadata writes are made by Codex. No live provider request, external official-source retrieval or permanent conversation history exists.

R11D point 9 adds a bounded V1 routine builder. The Backend plans AM `CLEANSER`, `MOISTURIZER`, `SUNSCREEN` and PM `CLEANSER`, `MOISTURIZER`; `SERUM` is optional in PM when canonical targets justify treatment and is conservatively rejected from AM until trusted Product-specific usage/compatibility knowledge exists. Each step searches its own deterministic candidate group, capped at five. Provider-selected IDs must belong to the exact step group, routine steps/order are validated against the canonical taxonomy, Products may be reused AM/PM, and unique final Products are re-fetched and revalidated from DB. Missing required core Products prevent the routine from being represented as complete; missing optional Products are omitted. Point 10 compatibility, budget, comparison and existing-Product logic remains pending.
