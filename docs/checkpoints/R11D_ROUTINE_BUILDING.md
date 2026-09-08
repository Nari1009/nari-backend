# R11D PART 3 — FULL ROUTINE BUILDING

## STATUS

- Candidate search: COMPLETE.
- Controlled LLM reasoning: COMPLETE.
- Backend validation and DB re-fetch: COMPLETE.
- Routine building: COMPLETE.
- Compare, compatibility, budget and existing-Product flows: PENDING.
- R11D: IN PROGRESS.
- R11E: NOT STARTED.

## V1 PLAN

Required core steps:

- Morning: `CLEANSER`, `MOISTURIZER`, `SUNSCREEN`.
- Evening: `CLEANSER`, `MOISTURIZER`.

`SERUM` may be added to the evening plan when canonical targets indicate treatment relevance, including hydration, barrier support, acne, dark spots, uneven tone, texture, dullness, fine lines or firmness. Treatment `SERUM` is conservatively restricted to PM in V1 because trusted Product-specific usage/compatibility knowledge is not yet complete; this is not a claim that every serum is night-only. `TONER`, `ESSENCE`, `EYE_CARE` and `FIRST_CLEANSE` are optional and are not automatically forced in V1. Unknown routine preference defaults to the simple plan.

## PER-STEP CANDIDATES

Backend searches each planned step separately. Each group contains at most five deterministic candidates and uses the existing safe provider projection. A provider-selected Product ID must belong to the exact candidate group for its returned step.

## VALIDATION AND REUSE

The routine contract validates canonical steps, order, AM/PM semantics, required core steps, optional steps and a maximum of five unique Products. `SUNSCREEN` is morning-only; `FIRST_CLEANSE` is evening-only. The same cleanser or moisturizer may be referenced in both periods, while the public `recommendations` list contains each final Product once.

## FINAL TRUTH AND AVAILABILITY

Every unique selected Product is re-fetched from PostgreSQL and revalidated as `CATALOG`, active and positive stock. Final price, image, slug and name come from the DB. If an optional Product disappears, it is omitted. If a required core Product disappears, the response is `ANSWER` with `routine: null`, `recommendations: []` and a generic availability message; no replacement is fabricated.

Advanced ingredient compatibility, budget optimization, comparisons and existing-Product completion remain point 10 work. No external official-source retrieval, live OpenAI request, DB write, Client change or PROD access occurred.
