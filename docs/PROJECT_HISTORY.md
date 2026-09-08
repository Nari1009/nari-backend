# NARI PROJECT HISTORY

## PURPOSE OF THIS FILE

`PROJECT_STATE.md` records where NARI is now. This file records how the project reached that state. `ROADMAP.md` is the release and phase index; `DECISIONS.md` preserves durable human/project decisions; checkpoint files preserve detailed historical snapshots.

## HISTORY CONFIDENCE RULES

- **HIGH:** directly supported by current code, Git history, or verified task results.
- **MEDIUM:** supported by multiple repository signals or recoverable project instructions, but the exact release boundary is incomplete.
- **LOW:** plausible but not sufficiently corroborated; not treated as project fact.
- **HISTORY_INCOMPLETE:** a phase or boundary is known to exist, but its complete history cannot be recovered.

## R1 — HISTORY_INCOMPLETE

- **Purpose:** Initial NARI project and storefront foundation.
- **What is supported:** Backend and Admin scaffolding and the first Client Home/store/product/cart work are present in the earliest repository history (`729ea05`, `481ddd6`, `e124ffe`, `ab7afd6`, `8ff18fc`, `d1d713c`).
- **What was not recoverable:** The original R1 scope, exact release boundary, deployment state and complete acceptance criteria.
- **State at release end:** The project had a working foundation for a storefront and separate Backend, Client and Admin repositories.
- **Confidence:** MEDIUM; recovered history and repository-correlated.

## R2 — HISTORY_INCOMPLETE

- **Purpose:** Product catalog, Product detail and Admin product-management foundation.
- **What is supported:** Product pages, dynamic catalog/cart behavior, Backend synchronization and Admin Product CRUD/filter work appear in the early Client/Admin history (`ab7afd6`, `8316da2`, `891e95a`, `cb562a5`).
- **What was not recoverable:** Exact R2 name, acceptance boundary and complete list of features.
- **State at release end:** Catalog and product-management flows formed the base for later commerce work.
- **Confidence:** MEDIUM; repository-correlated.

## R3 — HISTORY_INCOMPLETE

- **Purpose:** Storefront interaction maturity, including search/filter and cart behavior.
- **What is supported:** Persistent cart, resilient product parsing, expandable Product details, catalog-driven filters, search fixes and related storefront UX are documented by Client history (`8ff18fc`, `54e3255`, `e7a1801`, `565cb15`, `76f764e`, `cc8cde4`).
- **What was not recoverable:** Exact release boundary and whether every account/favorites/points feature was part of R3.
- **State at release end:** Core browse, search, filter and cart UX existed.
- **Confidence:** MEDIUM; repository-correlated.

## R4 — HISTORY_INCOMPLETE

- **Purpose:** Checkout, customer identity and account foundations.
- **What is supported:** Checkout/order confirmation, cart synchronization, authentication redirects, account/order details and customer identity work appear in Backend and Client history (`0a36e3c`, `f514a37`, `1eb9427`, `8e0829f` and corresponding Client checkout/account commits).
- **What was not recoverable:** Exact R4 scope, rollout boundary and complete acceptance record.
- **State at release end:** Guest/authenticated commerce flows were being connected to persistent Backend behavior.
- **Confidence:** MEDIUM; repository-correlated.

## R5 — SHIPPING

- **Purpose:** Make shipping behavior server-authoritative and operationally configurable.
- **What was done:** Shipping data and rates were connected to Backend authority, with validation requiring a positive national rate (`8cf7521`, `ab1c87d`). Client shipping integration followed in the same period.
- **What was not done:** No evidence of a payment gateway implementation in this release.
- **State at release end:** Shipping rules were enforced by the Backend rather than trusted solely to the Client.
- **Confidence:** HIGH for the implementation themes; exact release label recovered from project instructions.

## R6 — PUBLIC ORDER NUMBERS

- **Purpose:** Provide persistent public order numbers while retaining internal order identity.
- **What was done:** Public order number persistence, insertion alignment, API exposure and migration preparation were implemented (`350b892`, `fae6d13`, `60480d7`, `8d92090`; equivalent later sequence `9c7c297` through `86adda3`).
- **What was not done:** No evidence that internal IDs were replaced.
- **State at release end:** Customers could use a stable public order reference.
- **Confidence:** HIGH.

## R7 — ANALYTICS AND REPORTING

- **Purpose:** Establish canonical admin analytics and reports.
- **What was done:** Analytics foundations, validation endpoint, environment-aware validation, admin analytics, inclusive date handling and canonical reports were added (`8bcb7a5`, `c959c72`, `5ef5191`, `afcff9d`, `fce6918`, `a93166c`, release `93c4599`). Excel report synchronization and legacy report compatibility were also addressed around this period.
- **What was not done:** No evidence that analytics became a public storefront feature.
- **State at release end:** Admin reporting had a canonical Backend foundation.
- **Confidence:** HIGH.

## R8 — REVIEWS, EMAIL OUTBOX AND ABANDONED CARTS

- **Purpose:** Add reliable review and transactional-email workflows while hardening abandoned-cart behavior.
- **What was done:** Verified reviews, ratings/counts, reviewer names, transactional email delivery/outbox workers, automated review requests and bounded/disableable abandoned-cart reminders were implemented (`24c0b4a`, `2445b26`, `fd7c05c`, `d571b84`, `fe26d7f`, `2932c94`, `3ec3c1a`, `b356fb6`, `b5a26c6`).
- **What was not done:** No evidence of a customer-facing AI capability.
- **State at release end:** Review and email operations were treated as durable Backend workflows.
- **Confidence:** HIGH.

## R9 — SETTINGS AND CMS

- **Purpose:** Harden settings/CMS contracts and establish the settings-driven content foundation used by later Home, Contacto and Admin work.
- **What was done:** Settings/CMS contracts were hardened (`4a0c2eb`, `9791b5c`), with related contact/configuration and Admin persistence work in the surrounding history. Product catalog metadata/filter option persistence and synchronization were also refined through this broader period.
- **What was not done:** No NARI AI runtime or canonical recommendation metadata population.
- **State at release end:** Settings and CMS became explicit Backend/Admin concerns rather than ad hoc Client-only content.
- **Confidence:** MEDIUM/HIGH; the exact R9 release boundary is not fully recoverable.

## R10 — FOOTER, CONTACTO AND HOME CMS

- **Purpose:** Connect Home CMS and refine Home, Footer and Contacto for the selective production release.
- **What was done:** Typed Home CMS Backend contract, Admin Home editor, Client CMS consumption, full-bleed hero, final image positioning, Footer hierarchy/icons, Contacto channel integration and the FAQ/hero final fixes were delivered. The selective release was reported QA-approved and live.
- **What was not done:** Payments and R11 AI were explicitly out of scope; no PROD CMS data was copied during development.
- **Important commits:** Backend `abd5e4b`; Admin `286a589`; Client approved chain `49ff9f4`, `9f22c17`, `5d03dde`, `5aee166`, `a631c3c`, `db3c8be`, `428c638`, `5eb6491`.
- **Confidence:** HIGH from available project instructions and Git history.

## R11 — NARI AI

- **Purpose:** Build a safe, catalog-grounded cosmetic guidance capability over NARI's existing commerce platform.
- **What was done:** R11A architecture/product audit; R11B1 public Product projection hardening and taxonomy design; R11B2 catalog snapshots, catalog-only DEV clone, metadata schema foundations and evidence-based curation specifications.
- **What was not done:** No AI provider, chat route, chat UI, recommendation engine, routine builder, embeddings, vector storage, conversation persistence or canonical Product metadata population.
- **Current state:** R11B2.6D is the last verified checkpoint: 20 real Products reviewed, 12 READY, 8 PARTIAL, 0 BLOCKED; no canonical values written.
- **References:** `docs/AI_CONTEXT.md` and `docs/checkpoints/R11B2.6D.md`.
- **Confidence:** HIGH for the current state.

## POST-R11D — REAL OPENAI DEV INTEGRATION GATE

- **Date:** 2026-09-08.
- **What was done:** Validated the real OpenAI Responses API provider in DEV with `OPENAI_MODEL=gpt-5.6-luna`. Interpretation uses Structured Outputs; the provider extracts Responses API text safely and retains Backend contract, safety and commercial-truth validation.
- **Verification:** `npm run ai:dev:openai` passed 3/3 real cases; `node --test` passed 117/117; `git diff --check` passed.
- **Boundaries:** Web search is OFF; external Product knowledge/retrieval is NOT IMPLEMENTED; Client chat is NOT STARTED. No DB writes, PROD access or deployment occurred. `OPENAI_API_KEY` was not committed.
- **State:** Gate CLOSED and validated. R11D remains complete; R11E is not started.

## MAJOR ARCHITECTURAL EVOLUTION

1. Separate Backend, Client and Admin repositories grew from initial storefront scaffolding into a full commerce system.
2. Backend persistence moved from legacy SQLite assumptions to PostgreSQL/Supabase as the authoritative database (`a6cf7a4`, `42d6e03`, `c37edb8`).
3. Catalog and Admin management evolved from free-form product data toward persisted catalog options, while legacy Product metadata remains compatibility-sensitive.
4. Product images gained Supabase Storage integration and protected migration tooling (`936d474`, `8de78cc`, `1c7752f`, `0583089`).
5. Customer identity, checkout, shipping, public order references, analytics, reviews and transactional email became explicit Backend workflows.
6. Settings/CMS became the source for editable Home/contact content; R10 connected that content to the Client.
7. R11 adds a separate canonical recommendation metadata model beside legacy storefront metadata. The current model is schema/validation-ready but not populated.

## MAJOR INCIDENTS AND LESSONS

### INC-001 — PostgreSQL transition and legacy query compatibility

- **What happened:** Early Backend code carried SQLite/legacy assumptions while the deployed architecture moved to PostgreSQL.
- **Root cause/evidence:** `a6cf7a4`, `42d6e03`, `c37edb8`.
- **Fix/current status:** PostgreSQL is the current Backend persistence convention; current code uses `pg`.
- **Lesson:** Inspect actual database conventions before adding migrations or queries. **Confidence: HIGH.**

### INC-002 — Startup seed could overwrite persisted Product data

- **What happened:** Product metadata could be reintroduced or overwritten when seed/enrichment/normalization operations were explicitly run.
- **Root cause/evidence:** `9f8e8b7` is titled `fix: prevent startup seed from overwriting persisted data`; `src/db/seed.js` still contains explicit `seedProducts`, `updateCatalogMetadata` and `normalizeExistingSkinTypes` operations.
- **Fix/current status:** Normal startup no longer calls the catalog seeding path; those operations remain explicit tooling and therefore remain a risk if invoked.
- **Lesson:** Product rows are the intended source of truth; never treat seed/default code as harmless fallback. **Confidence: HIGH.**

### INC-003 — Catalog option and metadata inconsistency

- **What happened:** Product filter values had multiline, legacy, duplicate and canonicalization issues.
- **Root cause/evidence:** catalog enrichment and option commits `02cef6a`, `237ad1f`, `55cf314`, `2967b1a`, `4566c4d`, `7b6add9`, `a524b65`, `3d8c403`.
- **Fix/current status:** Catalog options and filter handling were made more explicit, but legacy Product semantics remain compatibility-sensitive and were deliberately not normalized during R11B2 curation.
- **Lesson:** Separate legacy storefront contracts from reviewed canonical recommendation metadata. **Confidence: HIGH.**

### INC-004 — Product image Storage migration

- **What happened:** Product images required migration to Supabase Storage and resilience around bucket/project URL behavior.
- **Fix/current status:** Backend and Admin Storage/migration support exists; R11 catalog cloning temporarily preserved public image URL strings and did not copy Storage data.
- **Lesson:** Do not confuse catalog metadata cloning with Storage migration. **Confidence: HIGH.**

### INC-005 — Public Product overexposure

- **What happened:** Public Product reads used wildcard-style exposure that could include operational fields such as cost, supplier and minimumStock.
- **Fix/current status:** R11B1 commit `e466534080c7c7c4014047f16a864c97278d22c5` introduced an explicit safe projection; current code excludes private fields.
- **Lesson:** Public Product contracts must be explicit and must not automatically expose future columns. **Confidence: HIGH.**

## HISTORICAL UNKNOWNS

- Exact original names, acceptance criteria and boundaries for R1–R4 are not fully recoverable.
- The complete history of Nari Points, favorites and some early account features is not established from the available evidence.
- Exact deployment dates and some historical environment details are not recoverable without external records.
- The original Admin R10 release checkout/commit relationship is not fully recoverable from the safe audit checkout.
- Current PROD state beyond previously reported release outcomes was not re-queried for this documentation task.
- A possible R11B2.7 discussion occurred outside the recoverable Codex execution history and is not an established phase.
