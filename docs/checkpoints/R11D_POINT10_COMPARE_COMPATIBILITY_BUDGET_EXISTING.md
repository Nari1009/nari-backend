# R11D POINT 10 — COMPARE, COMPATIBILITY, BUDGET AND EXISTING PRODUCTS

## STATUS

- Candidate search: COMPLETE.
- Controlled LLM reasoning: COMPLETE.
- Backend validation and DB re-fetch: COMPLETE.
- Routine building: COMPLETE.
- Compare / compatibility / budget / existing Products: COMPLETE.
- R11D: COMPLETE.
- R11E: NOT STARTED.

## PRODUCT RESOLUTION

Backend resolves Product references before provider reasoning using exact ID, normalized slug/name, and bounded deterministic partial matching. Ambiguous or unresolved references produce `FOLLOW_UP`. Only `catalogRole = CATALOG` rows can resolve as real NARI Products; fixtures are excluded. No embeddings, fuzzy ranking, Product maps or external lookup are used.

## COMPARE

Comparison is bounded to two resolved Products. The provider receives only safe canonical projections. `NULL` remains unknown and `[]` remains reviewed-neutral. A winner is optional and must belong to the resolved Product set; unavailable winners are not returned as purchasable recommendation cards. Absolute superiority is not established without a meaningful criterion.

## COMPATIBILITY

V1 confirms only structural facts: canonical routine-step order, same-step conflicts, and morning/evening placement rules. Formula-level compatibility is always `UNKNOWN` in this phase when trusted structured Product knowledge is absent. No active interaction, irritation certainty, frequency or waiting-time claims are inferred from names or uncontrolled text.

## BUDGET ROUTINE

`budget` means the maximum total selling price in COP for unique Products still needed for the routine. Reused AM/PM Products count once. Backend evaluates bounded candidate combinations, prioritizes routine suitability, then deterministic candidate score, then lower total price. It does not spend the full budget by default. Prices are taken from the current DB Product rows; provider values and purchase cost/margin are not trusted.

If no complete core routine fits, the response is a safe non-recommendation with an empty routine and recommendations. Final re-fetch and price validation occur before returning a budget routine.

## EXISTING PRODUCTS

`knownProducts` is transient and is never persisted. Resolved owned Products may fill their trusted canonical routine step even when their current NARI stock is zero or they are inactive. They are not included in purchase recommendations and do not count against the purchase budget. Missing steps are resolved from eligible current candidates. `DEV_FIXTURE` rows and Products with unresolved `routineStep` cannot fill a personal routine.

## PROVIDER AND SOURCE-OF-TRUTH BOUNDARY

The provider receives bounded safe Product projections and cannot establish Product identity, price, stock, image, slug, catalog eligibility or formula compatibility. Product existence, purchase eligibility and commercial truth come from Backend queries and final DB re-fetches. No Product metadata is written, no conversation history is persisted, no external official-source retrieval is used, and PROD remains untouched.

## FINAL LIMITATIONS

Real OpenAI DEV integration is validated and the gate is CLOSED through the Responses API with Structured Outputs using `gpt-5.6-luna`: `npm run ai:dev:openai` passed 3/3 real cases and `node --test` passed 117/117. Automated provider coverage remains fake-provider and network-free. Web search is OFF; external Product knowledge/retrieval is NOT IMPLEMENTED; Client chat is NOT STARTED; permanent conversation history, embeddings and vector storage are not implemented. Formula/active compatibility remains limited or unknown without trusted Product-specific knowledge. No DB writes, PROD access or deployment occurred; `OPENAI_API_KEY` was not committed. R11E is not started and R11 overall remains in progress.
