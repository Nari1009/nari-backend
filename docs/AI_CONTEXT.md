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

Status: R11B2 catalog foundation technically closed; AI runtime absent.

### Client

The Client uses legacy Product metadata for storefront display, filtering and search. It does not consume canonical recommendation fields and has no NARI AI UI.

### Admin

The Admin frontend supports legacy Product metadata. It does not yet expose canonical metadata controls or `sizeLabel` editing.

### Database

DEV contains 25 Products: 20 real catalog Products and 5 preserved fixtures. Canonical fields exist; reviewed values have now been written for the 12 READY real Products, while the 8 PARTIAL real Products remain unresolved and untouched.

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
| Admin | Legacy Product editing exists; canonical controls absent |
| Client | Legacy Product display/filtering exists; canonical consumption absent |
| AI engine | Does not exist |

## SOURCE OF TRUTH

Product rows are intended to hold canonical Product recommendation metadata. Legacy Product fields remain in use for storefront compatibility. Seed/import routines remain capable of mutating legacy metadata when explicitly run; normal server startup does not invoke catalog seeding.

## NOT IMPLEMENTED YET

- AI chat route.
- LLM provider integration.
- Chat UI.
- Recommendation engine.
- Routine builder.
- Canonical Admin controls.
- Canonical Client consumption.
- AI tests.
- Conversation database.
- Embeddings/vector database.

## CURRENT STOPPING POINT

R11B2.6D and the controlled READY DEV write are complete. R11B2 is technically closed. Next phase: **NOT YET APPROVED**. Do not infer or create R11B2.7 or any other new numbered phase.
