# NARI ROADMAP

Statuses distinguish implementation from design and research.

Historical release boundaries before R10 are reconstructed from Git and available project instructions. Where the original phase boundary is not fully recoverable, the status is `HISTORY_INCOMPLETE`.

## R1 — Initial Storefront Foundation

- **Status:** HISTORY_INCOMPLETE
- **Purpose:** Establish the first NARI repositories and storefront foundation.
- **What was done:** Initial Backend/Admin scaffolding and Client Home, store, Product and cart work are visible in early history.
- **What was not done:** Exact original R1 scope and acceptance boundary are unknown.
- **Evidence:** Backend `729ea05`; Client `481ddd6`, `e124ffe`, `ab7afd6`, `8ff18fc`; Admin `d1d713c`.

## R2 — Catalog and Admin Foundation

- **Status:** HISTORY_INCOMPLETE
- **Purpose:** Build Product catalog/detail and Admin Product-management foundations.
- **What was done:** Dynamic Product pages, Backend synchronization, Product CRUD and catalog/filter management foundations.
- **What was not done:** Exact original release boundary is unknown.
- **Evidence:** Client `ab7afd6`, `8316da2`; Admin `891e95a`, `cb562a5`.

## R3 — Storefront and Cart UX

- **Status:** HISTORY_INCOMPLETE
- **Purpose:** Mature browse, search, filters, Product details and cart behavior.
- **What was done:** Persistent cart, resilient Product parsing, expandable details, catalog-driven filters and search fixes.
- **What was not done:** Exact R3 acceptance boundary and feature grouping are unknown.
- **Evidence:** Client `8ff18fc`, `54e3255`, `e7a1801`, `565cb15`, `76f764e`, `cc8cde4`.

## R4 — Checkout and Account Foundation

- **Status:** HISTORY_INCOMPLETE
- **Purpose:** Connect checkout, customer identity and account flows.
- **What was done:** Order confirmation, cart synchronization, authentication/account redirects and customer/order identity work.
- **What was not done:** Exact original R4 scope and acceptance boundary are unknown.
- **Evidence:** Backend `0a36e3c`, `f514a37`, `1eb9427`, `8e0829f` and corresponding Client history.

## R5 — Shipping

- **Status:** DONE
- **Purpose:** Make shipping server-authoritative and validate national shipping configuration.
- **What was done:** Backend shipping authority and positive-rate validation.
- **What was not done:** Payment gateway implementation.
- **Evidence:** Backend `8cf7521`, `ab1c87d`.

## R6 — Public Order Numbers

- **Status:** DONE
- **Purpose:** Add stable public order references.
- **What was done:** Persistent public order number schema preparation, insertion alignment and API exposure.
- **What was not done:** Internal order identity was not replaced.
- **Evidence:** Backend `350b892`, `fae6d13`, `60480d7`, `8d92090` and equivalent later sequence.

## R7 — Analytics and Reports

- **Status:** DONE
- **Purpose:** Establish canonical admin analytics/reporting.
- **What was done:** Analytics foundation, validation, admin analytics, canonical reports and Excel compatibility work.
- **What was not done:** No public AI feature.
- **Evidence:** Backend `8bcb7a5`, `c959c72`, `5ef5191`, `afcff9d`, `fce6918`, `a93166c`, release `93c4599`.

## R8 — Reviews, Email and Abandoned Carts

- **Status:** DONE
- **Purpose:** Harden reviews, transactional email/outbox and abandoned-cart workflows.
- **What was done:** Verified reviews, ratings/counts, email workers/outbox, automated review requests and bounded abandoned-cart reminders.
- **What was not done:** No NARI AI runtime.
- **Evidence:** Backend `24c0b4a`, `2445b26`, `fd7c05c`, `d571b84`, `b356fb6`, `b5a26c6`.

## R9 — Settings and CMS

- **Status:** DONE / HISTORY_INCOMPLETE
- **Purpose:** Harden settings/CMS contracts and establish the content foundation used by R10.
- **What was done:** Settings/CMS contract hardening and related configuration/Admin persistence work.
- **What was not done:** No canonical recommendation metadata or AI runtime.
- **Evidence:** Backend `4a0c2eb`, `9791b5c`; exact release boundary is only partially recoverable.

## R10 — Footer, Contacto and Home CMS

- **Status:** DONE
- **Purpose:** Home CMS integration plus Footer and Contacto refinement.
- **What was done:** Backend Home CMS contract, Admin Home editor, Client Home CMS, full-bleed hero, Footer refinement/icon fixes, Contacto CMS/channel integration, FAQ layout and hero decoration fixes.
- **What was not done:** Payments/R11 AI; no PROD data edits during development.
- **Commits:** Backend `abd5e4b...`; Admin `286a589...`; Client approved R10 chain including `49ff9f4`, `9f22c17`, `5d03dde`, `5aee166`, `a631c3c`, `db3c8be`, `428c638`, `5eb6491`.
- **Result:** R10 was reported closed and live.

## R11 — NARI AI

- **Status:** IN_PROGRESS
- **Purpose:** Build a safe, catalog-grounded cosmetic guidance capability.
- **What was done:** Architecture/audit and catalog foundation work.
- **What was not done:** AI provider, chat, recommendation engine, routine builder or conversation persistence.
- **Result:** Current frontier is R11B2.6D.

## R11A — Architecture and Product Audit

- **Status:** AUDITED_ONLY
- **Purpose:** Audit feasibility, boundaries, catalog data, safety and future AI architecture.
- **What was done:** Established non-medical scope, catalog-grounded recommendation direction, deterministic eligibility concept, anonymous client-held history concept and provider decision requirements.
- **What was not done:** No AI implementation.
- **Result:** Audit complete.

## R11B1 — Catalog Security and Taxonomy Foundation

- **Status:** DONE / DESIGNED_ONLY
- **Purpose:** Restrict public Product projection and design the catalog taxonomy.
- **What was done:** Public Product projection hardened in Backend commit `e466534080c7c7c4014047f16a864c97278d22c5`.
- **What was not done:** No AI and no taxonomy normalization.
- **Result:** Internal Product fields are excluded from public Product projections.

## R11B2 — Catalog Metadata Foundation

- **Status:** DONE
- **Purpose:** Establish safe Product metadata foundations for future deterministic recommendation retrieval.
- **What was done:** Verified catalog snapshots, safe catalog-only DEV clone, additive schema foundations and canonical validators.
- **What was not done:** Eight PARTIAL Products remain unresolved; no AI runtime or Client/Admin canonical UI was implemented.
- **Result:** R11B2 technical foundation is closed. 20 real Products are available in DEV with five preserved fixtures; the 12 approved READY Products have canonical metadata in DEV and the 8 PARTIAL Products remain intentionally unresolved.

## R11B2.3 — Product Metadata Dependency Audit

- **Status:** AUDITED_ONLY
- **Purpose:** Audit Backend, Client and Admin dependencies on legacy Product metadata.
- **What was done:** Confirmed legacy `skinTypes`, `concerns`, `ingredients` and `category` must remain compatible.
- **What was not done:** No code or data changes.
- **Result:** Separate canonical recommendation fields were recommended.

## R11B2.4 — Canonical Recommendation Metadata Schema

- **Status:** IMPLEMENTED_AND_VERIFIED
- **Purpose:** Add `suitableSkinTypes`, `suitableConditions` and `targets` as nullable JSON-array text fields.
- **What was done:** Migration, validators, Product create/update support, explicit public projection and tests. DEV migration was manually executed and verified.
- **What was not done:** No values were populated.
- **Result:** Canonical fields exist in DEV and remain NULL pending curation.

## R11B2.5 — Canonical Product Curation Specification

- **Status:** CURATED_ONLY
- **Purpose:** Produce evidence-based specifications for the 20 real Products.
- **What was done:** Product-by-product routine, size, profile, condition and target proposals.
- **What was not done:** No Product writes.
- **Result:** Initial worksheet was partial and sent for review.

## R11B2.6A — Add UV_PROTECTION Canonical Target

- **Status:** DONE
- **Purpose:** Add the sunscreen target `UV_PROTECTION`.
- **What was done:** Added the target and tests in the Backend taxonomy module.
- **What was not done:** No Product metadata population.
- **Result:** Canonical target taxonomy expanded without migration.

## R11B2.6B — Final Curation Worksheet

- **Status:** CURATED_ONLY
- **Purpose:** Consolidate local snapshot data and approved research input.
- **What was done:** 20-product worksheet; 5 READY, 15 PARTIAL, 0 BLOCKED.
- **What was not done:** No writes.

## R11B2.6C — Revised Final Canonical Curation Spec

- **Status:** CURATED_ONLY
- **Purpose:** Apply human-reviewed corrections and exact commercial variants.
- **What was done:** Corrected Medicube, SKIN1004, Mixsoon, Round Lab, Dr. Althea and KSECRET proposals.
- **What was not done:** No writes.

## R11B2.6D — Final NULL vs Empty Curation Review

- **Status:** CURATED_ONLY / DONE AS SPECIFICATION
- **Purpose:** Distinguish unresolved metadata (`NULL`) from intentionally empty dimensions (`[]`).
- **What was done:** Reviewed all 20 Products and finalized the worksheet.
- **What was not done:** No Product updates, migration, Admin UI, Client UI or AI implementation.
- **Result:** 12 READY, 8 PARTIAL, 0 BLOCKED.

## R11B — Admin Canonical Metadata Editor

- **Status:** DONE / CLOSED
- **Purpose:** Provide safe Admin maintenance controls for canonical Product recommendation metadata without hardcoding Product-specific values.
- **What was done:** Added Admin Product-form controls for `routineStep`, `sizeLabel`, `suitableSkinTypes`, `suitableConditions` and `targets`, with Spanish display labels and explicit `Sin revisar` versus `Revisado` handling for `NULL` versus `[]`.
- **What was not done:** No Client changes, AI runtime, Product research or automatic completion of PARTIAL Products.
- **Result:** Admin production build, Backend regression tests and controlled live DEV UI round trips passed; temporary fixture state was restored exactly. The implementation was semantically integrated onto current Admin `origin/dev` and published as `2598c39`. R11B is closed. The 12 READY Products remain intact, the 8 PARTIAL Products remain intentionally unresolved, and the Product row is the sole persisted Product-specific source of truth.

## CURRENT ROADMAP FRONTIER

Last verified phase: **R11B — Admin Canonical Metadata Editor**.

Next verified phase: **UNKNOWN / NOT YET APPROVED**.

R11 remains in progress. R11C is not started. No numbered successor phase is approved.

No R11B2.6E or R11B2.7 is recorded as established work.

The controlled DEV write is an operational checkpoint under R11B2, not a new numbered phase. See `docs/checkpoints/R11B2_READY_DEV_WRITE.md`. The latest R11B implementation checkpoint is `docs/checkpoints/R11B_ADMIN_CANONICAL_METADATA.md`.
