# NARI DECISIONS

Only decisions supported by available project instructions or code are recorded here.

## DEC-001 — NARI AI is Cosmetic Guidance, Not Medical Diagnosis

- **Date:** UNKNOWN
- **Area:** Safety
- **Decision:** NARI AI must not diagnose or claim to treat rosacea, eczema, dermatitis, allergies, severe acne or similar medical conditions.
- **Rationale:** NARI provides cosmetic product guidance, not medical care.
- **Status:** VERIFIED_DECISION
- **Source class:** Previous user instructions.

## DEC-002 — Recommendations Must Use NARI’s Eligible Catalog

- **Date:** UNKNOWN
- **Area:** Recommendation architecture
- **Decision:** Recommendations must be grounded in NARI’s own eligible catalog. Product sellability and candidate eligibility belong to deterministic Backend logic.
- **Rationale:** Prevent fabricated, unavailable or unsellable recommendations.
- **Status:** VERIFIED_DECISION
- **Source class:** Previous user instructions.

## DEC-003 — Future LLM Does Not Decide Sellability

- **Date:** UNKNOWN
- **Area:** AI boundaries
- **Decision:** A future LLM may interpret customer language and structured intent, but must not independently decide whether a Product is sellable.
- **Status:** VERIFIED_DECISION
- **Source class:** Previous user instructions.

## DEC-004 — Separate Skin Profiles, Conditions and Goals

- **Date:** UNKNOWN
- **Area:** Taxonomy
- **Decision:** Base skin types are `OILY`, `DRY`, `COMBINATION`, `NORMAL`. Conditions include `SENSITIVE`, `DEHYDRATED`, `ACNE_PRONE`, `REDNESS_PRONE`, `BARRIER_COMPROMISED`. Goals include `ACNE`, `HYDRATION`, `BARRIER_SUPPORT`, `UV_PROTECTION` and the other canonical targets.
- **Rationale:** A person can be dry and sensitive, or oily and dehydrated; these dimensions are not mutually exclusive.
- **Status:** VERIFIED_DECISION
- **Source class:** Previous user instructions and `src/domain/productTaxonomy.js`.

## DEC-005 — Legacy Product Metadata Remains Compatible

- **Date:** UNKNOWN
- **Area:** Product model
- **Decision:** Preserve the semantics and values of legacy `skinTypes`, `concerns`, `ingredients`, `skinBenefits`, `benefits`, `featuredIngredients`, `fullIngredients` and `category` while canonical metadata is introduced separately.
- **Status:** VERIFIED_DECISION
- **Source class:** Previous user instructions and current Backend/Client code.

## DEC-006 — NULL and Empty Arrays Are Distinct

- **Date:** UNKNOWN
- **Area:** Canonical metadata
- **Decision:** `NULL` means not yet curated/unknown. `[]` means reviewed and intentionally no canonical values apply. Empty arrays must not be interpreted as universal suitability without a later approved decision.
- **Status:** VERIFIED_DECISION
- **Source class:** Previous user instructions and Backend validators.

## DEC-007 — Evidence-Based Curation Only

- **Date:** UNKNOWN
- **Area:** Product knowledge
- **Decision:** Do not infer suitability from a Product name, a single ingredient or an unverified marketing assumption. Do not automatically map legacy Spanish or medical-like values.
- **Status:** VERIFIED_DECISION
- **Source class:** Previous user instructions.

## DEC-008 — Exact Commercial Variant for sizeLabel

- **Date:** UNKNOWN
- **Area:** Merchandising metadata
- **Decision:** `sizeLabel` must represent the exact NARI-sold presentation, not any size offered by a manufacturer. No SKU-based inference without separate evidence.
- **Status:** VERIFIED_DECISION
- **Source class:** Previous user instructions.

## DEC-009 — Canonical Metadata Persists on Products

- **Date:** UNKNOWN
- **Area:** Source of truth
- **Decision:** Product rows are the intended persistence location for recommendation metadata; avoid hidden duplicate Product-specific sources of truth.
- **Status:** VERIFIED_DECISION
- **Source class:** Previous user instructions and current schema/code.

## DEC-010 — Public Product Projection Is Explicit

- **Date:** UNKNOWN
- **Area:** Security
- **Decision:** Public Product endpoints use an explicit projection and must exclude private fields including `cost`, `supplier`, `minimumStock`, `sku`, `createdAt` and `updatedAt`.
- **Status:** VERIFIED_IMPLEMENTATION
- **Source class:** Current Backend code and commit `e466534...`.

## DEC-011 — DEV/PROD Separation

- **Date:** UNKNOWN
- **Area:** Operations
- **Decision:** R11 foundation and curation work is DEV-only. No PROD access or mutation is permitted during curation.
- **Status:** VERIFIED_DECISION
- **Source class:** Previous user instructions.

## DEC-012 — No Canonical Product Writes Without Approval

- **Date:** UNKNOWN
- **Area:** Change control
- **Decision:** Curation specifications do not authorize Product updates. Canonical values require explicit human approval before writing.
- **Status:** VERIFIED_DECISION
- **Source class:** Previous user instructions.

## OPEN DECISIONS

- Final LLM provider and model class.
- Exact future AI API and structured response contract.
- Deterministic recommendation scoring/ranking.
- Anonymous session identifier strategy.
- Future Admin controls for canonical fields and `sizeLabel`.
- Future Client presentation/use of canonical metadata.

## DEC-013 — PostgreSQL/Supabase Is the Backend Persistence Convention

- **Date:** UNKNOWN
- **Area:** Database architecture
- **Decision:** Backend persistence uses PostgreSQL through the project’s `pg` convention; Supabase PostgreSQL is the authoritative deployed database architecture.
- **Rationale:** The repository history records the transition away from SQLite/legacy query assumptions.
- **Status:** VERIFIED_IMPLEMENTATION
- **Source class:** Git history (`a6cf7a4`, `42d6e03`, `c37edb8`) and current Backend code.

## DEC-014 — Seed and Normalization Operations Must Not Be Treated as Startup Defaults

- **Date:** UNKNOWN
- **Area:** Product persistence
- **Decision:** Explicit seed, enrichment and normalization operations must not overwrite persisted Product metadata during ordinary startup. Product rows remain the intended source of truth.
- **Rationale:** A startup-seed overwrite incident was fixed, while explicit catalog tooling remains capable of mutation if deliberately run.
- **Status:** VERIFIED_IMPLEMENTATION
- **Source class:** Git commit `9f8e8b7`, current `src/db/seed.js` and server initialization.

## DEC-015 — Product Images Use Supabase Storage Workflows

- **Date:** UNKNOWN
- **Area:** Media infrastructure
- **Decision:** Product image migration/upload behavior is handled through the Backend/Supabase Storage integration, not by embedding file-management logic in the Client.
- **Status:** VERIFIED_IMPLEMENTATION
- **Source class:** Git history (`936d474`, `8de78cc`, `1c7752f`, `0583089`) and current Backend/Admin code.

## DEC-016 — Shipping Is Server-Authoritative

- **Date:** UNKNOWN
- **Area:** Commerce
- **Decision:** Shipping rates and shipping transitions are validated and applied by Backend logic; the Client is not the authority for shipping rules.
- **Status:** VERIFIED_IMPLEMENTATION
- **Source class:** Git history (`8cf7521`, `ab1c87d`) and current commerce code.

## DEC-017 — Public Order Numbers Are Separate from Internal Identity

- **Date:** UNKNOWN
- **Area:** Orders
- **Decision:** Customer-facing order references are persisted and exposed separately from internal order identifiers.
- **Status:** VERIFIED_IMPLEMENTATION
- **Source class:** Git history around `350b892`, `60480d7`, `8d92090` and current order contracts.

## DEC-018 — Project History Must Preserve Uncertainty

- **Date:** 2026-09-07
- **Area:** Continuity
- **Decision:** Historical documentation must distinguish repository facts, verified decisions, recovered history and inference; unknown release boundaries must remain explicitly unknown.
- **Rationale:** Prevent future sessions from treating reconstructed history or prompts as implementation evidence.
- **Status:** VERIFIED_DECISION
- **Source class:** Current user instruction and continuity documentation protocol.

## DEC-019 — Approved READY Metadata May Be Written Independently of PARTIAL Rows

- **Date:** 2026-09-08
- **Area:** R11B2 curation
- **Decision:** Only the 12 Products marked READY in the reviewed R11B2.6D worksheet may receive canonical metadata. The 8 PARTIAL Products remain untouched until their unresolved fields are approved.
- **Rationale:** Preserve the NULL-versus-empty semantics and prevent uncertain suitability claims from entering Product rows.
- **Status:** VERIFIED_IMPLEMENTATION
- **Source class:** Approved R11B2.6D curation instructions and DEV post-write verification.

## DEC-020 — All AI Traffic Goes Through the Backend

- **Date:** 2026-09-08
- **Area:** R11C AI architecture
- **Decision:** The Client must not communicate directly with an LLM provider. AI requests go through the Backend adviser route.
- **Rationale:** Keep provider credentials, safety policy, validation and orchestration server-side.
- **Status:** VERIFIED_DECISION / VERIFIED_IMPLEMENTATION
- **Source class:** R11C user instruction and `server.js`/`src/routes/ai.js`.

## DEC-021 — R11C AI State Is Transient

- **Date:** 2026-09-08
- **Area:** R11C persistence
- **Decision:** R11C does not persist conversation history, AI profiles, embeddings or AI-specific database rows.
- **Rationale:** Establish the contract and safety shell before persistence or recommendation infrastructure.
- **Status:** VERIFIED_IMPLEMENTATION
- **Source class:** R11C implementation and tests.

## DEC-022 — R11C Does Not Select Catalog Candidates

- **Date:** 2026-09-08
- **Area:** Recommendation architecture
- **Decision:** R11C may interpret intent and ask follow-up questions, but deterministic catalog candidate selection is deferred to R11D. Recommendation responses remain empty and controlled.
- **Rationale:** Prevent fabricated Products and preserve the planned Backend eligibility boundary.
- **Status:** VERIFIED_DECISION / VERIFIED_IMPLEMENTATION
- **Source class:** R11C user instruction and `src/services/ai/aiService.js`.

## DEC-023 — Product Catalog Boundary Is Explicit and Fail-Closed

- **Date:** 2026-09-08
- **Area:** R11D catalog eligibility
- **Decision:** Product rows use nullable `catalogRole` values `CATALOG` or `DEV_FIXTURE`. Only `CATALOG` is eligible for future AI candidate discovery; `NULL` and `DEV_FIXTURE` are ineligible.
- **Rationale:** DEV/test fixtures must not leak into customer-facing recommendations, and unclassified Products must fail closed rather than defaulting to the catalog.
- **Status:** IMPLEMENTED; DEV classification HUMAN VERIFIED
- **Source class:** R11D implementation and migration. The DEV database write was not verified because the Codex environment could not resolve the DEV host.

## DEC-024 — R11D Candidate Selection Is Deterministic and Internal

- **Date:** 2026-09-08
- **Area:** R11D candidate discovery
- **Decision:** Candidate discovery uses explicit Product rows, `catalogRole = CATALOG`, active status and positive stock. Routine-step conflicts are hard exclusions; known skin-type conflicts are hard exclusions; NULL remains unknown; [] remains field-specific neutral. Results are capped at five and ordered by score, confidence and Product ID.
- **Rationale:** The Backend must constrain the candidate set before any future LLM reasoning, without fabricating Products or treating unresolved metadata as incompatibility.
- **Status:** IMPLEMENTED
- **Source class:** R11D implementation and focused tests.

## DEC-025 — R11D Budget Semantics Are Explicit for Point 10

- **Date:** 2026-09-08
- **Area:** R11D budget handling
- **Decision:** Point 10 interprets an explicit budget as the maximum total current selling price in COP for unique Products still needed. Owned Products cost zero toward that purchase total; reused Products count once; the Backend re-fetches and rechecks final DB prices before returning a within-budget routine.
- **Rationale:** The interpretation is now explicit and bounded to the point-10 routine flow; provider-supplied prices and purchase costs remain outside the contract.
- **Status:** IMPLEMENTED
- **Source class:** R11D point-10 implementation, tests and current user instruction.

## DEC-026 — R11D Provider Selection Is Bounded and Revalidated

- **Date:** 2026-09-08
- **Area:** R11D controlled reasoning
- **Decision:** The provider may reason only over the deterministic candidate set, receives at most five safe candidate projections, and may select at most three unique Product IDs. Selected IDs must be an exact subset of the candidate IDs; invented, duplicate or malformed IDs fail closed. Backend must re-fetch selected Products and revalidate `catalogRole = CATALOG`, active status and positive stock before constructing public recommendation cards. Provider-selected commercial fields are rejected and never become source of truth. No replacement Product is fabricated when a selected Product disappears.
- **Rationale:** Keep the LLM advisory and bounded while the Backend remains authoritative for Product identity, sellability and commercial truth.
- **Status:** IMPLEMENTED
- **Source class:** R11D Part 2 implementation, tests and current user instruction.

## DEC-027 — R11D V1 Routine Planning Is Simple and Backend-Controlled

- **Date:** 2026-09-08
- **Area:** R11D routine construction
- **Decision:** V1 routine planning uses AM `CLEANSER`, `MOISTURIZER`, `SUNSCREEN` and PM `CLEANSER`, `MOISTURIZER` as required core steps. `SERUM` may be added to PM only when canonical targets justify treatment, and treatment `SERUM` is conservatively rejected from AM until trusted Product-specific usage/compatibility knowledge exists. Optional toner, essence, eye care and first cleanse are not forced. Each step gets its own deterministic candidate group; the provider cannot cross-select IDs between step groups. Products may be reused AM/PM, but final public recommendations contain unique DB-backed Products. A required step that becomes unavailable prevents the routine from being presented as complete; no replacement is fabricated.
- **Rationale:** Keep beginner routines bounded and understandable while preserving Backend authority over steps, candidate membership and commercial truth. The PM-only treatment default avoids implying unsupported AM usage guidance; advanced compatibility, budget, comparison and existing-Product logic remain deferred.
- **Status:** IMPLEMENTED
- **Source class:** R11D Part 3 implementation, tests and current user instruction.

## DEC-028 — R11D Product References Resolve Deterministically Before Provider Reasoning

- **Date:** 2026-09-08
- **Area:** R11D point 10 Product identity
- **Decision:** Compare, compatibility and existing-Product flows resolve bounded Product references through exact ID, normalized slug/name or deterministic unambiguous partial matching. Only `CATALOG` rows may resolve as real NARI Products; ambiguous or unresolved references produce `FOLLOW_UP`.
- **Rationale:** The provider may explain or reason, but it cannot establish Product identity or silently choose an ambiguous catalog row.
- **Status:** IMPLEMENTED
- **Source class:** R11D Part 4 implementation, tests and current user instruction.

## DEC-029 — R11D Compatibility Is Structural-Only Until Trusted Formula Knowledge Exists

- **Date:** 2026-09-08
- **Area:** R11D point 10 compatibility
- **Decision:** V1 may validate canonical routine-step order, same-step conflicts and morning/evening placement. Formula-level active compatibility remains `UNKNOWN`; the provider cannot assert interaction safety, irritation certainty, frequency or waiting times.
- **Rationale:** Current approved Product metadata does not provide complete structured formula/use knowledge, and external official-source retrieval is not implemented.
- **Status:** IMPLEMENTED
- **Source class:** R11D Part 4 implementation, tests and current user instruction.

## DEC-030 — R11D Budget and Owned-Product Accounting Use Separate Purchase Truth

- **Date:** 2026-09-08
- **Area:** R11D point 10 budget and existing Products
- **Decision:** `BUDGET_ROUTINE` treats budget as a maximum total purchase price in COP for unique Products still needed. Current DB selling price is authoritative; reused and owned Products count once and owned Products do not count toward purchase total. Owned real `CATALOG` Products may fill their canonical routine step regardless of current stock, while only current eligible Products may be recommended for purchase.
- **Rationale:** Personal ownership and current NARI availability are distinct states. The Backend must not force repurchase or claim an out-of-stock owned Product is unavailable to the user.
- **Status:** IMPLEMENTED / IN REVIEW
- **Source class:** R11D Part 4 implementation, tests and current user instruction.

## DEC-031 — Real OpenAI Is an Opt-In DEV Provider Behind Existing Boundaries

- **Date:** 2026-09-08
- **Area:** Post-R11D provider integration
- **Decision:** The existing provider abstraction may call the OpenAI Responses API only when `OPENAI_ENABLED=true` and `OPENAI_API_KEY` is present. The current DEV model is `gpt-5.6-luna`. Interpretation uses Structured Outputs with the canonical NARI schema; requests use bounded output, `store:false` and the existing timeout/error handling. Backend contracts, safety checks, candidate restrictions and DB commercial truth remain authoritative.
- **Rationale:** Enable real-model validation without making automated tests network-dependent or allowing the provider to become a source of Product truth. Web search and external manufacturer retrieval remain disabled.
- **Status:** IMPLEMENTED / VALIDATED — 3/3 real DEV cases PASS; 117/117 automated tests PASS.
- **Source class:** Official OpenAI documentation, provider implementation and network-free tests.

## DEC-032 — R11E Client Presents Backend-Controlled AI Responses

- **Date:** 2026-09-08
- **Area:** R11E Client chat
- **Decision:** The primary Client experience is a branded global floating NARI AI entry point across storefront pages, opening a premium advisor panel and calling only `POST /api/ai/adviser`. The shared `/nari-ai` route may remain as a secondary direct route, but is not a primary navigation destination; checkout/payment flows hide the entry point. The Client renders Backend-provided recommendation projections and optional routine, comparison, compatibility and budget structures; it does not call OpenAI, infer Product truth, recalculate commercial data or persist permanent conversation history. Active state is per-tab in memory, preserved through normal SPA navigation, manually resettable and expired after 30 minutes without NARI AI interaction.
- **Rationale:** The Backend remains responsible for scope, safety, catalog eligibility, Product identity, current price/availability and provider validation. R11F remains the future phase for durable bounded conversation history.
- **Status:** IMPLEMENTED / IN REVIEW
- **Source class:** R11E Client implementation, build review and current user instruction.

## DEC-033 — External Owned Products Are Context, Not Catalog Identity

- **Date:** 2026-09-08
- **Area:** R11E conversation and routine planning
- **Decision:** `knownProducts` is reserved for references intended for verified NARI catalog resolution. `unresolvedOwnedProducts` preserves user-reported external or uncertain items without creating Product identity, IDs or metadata. `ownedRoutineSteps` may preserve an explicit generic category such as `SUNSCREEN` for routine coverage only; it never becomes a NARI Product or purchase recommendation.
- **Rationale:** Customers may already use Products NARI does not sell. Conversation should continue naturally while commercial truth, purchase eligibility and formula compatibility remain Backend-controlled and NARI-only.
- **Status:** IMPLEMENTED / IN REVIEW
- **Source class:** R11E DEV Conversation QA Round 4 implementation and tests.
