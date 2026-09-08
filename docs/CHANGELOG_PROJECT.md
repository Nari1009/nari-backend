# NARI PROJECT CHANGELOG

This is a milestone history, not a line-by-line Git log.

## DATE UNKNOWN — R1

TYPE: INITIAL FOUNDATION

SUMMARY:

- Initial Backend, Client and Admin repositories and NARI storefront foundation established.
- Early Home, store, Product and cart work appears in repository history.

STATE AFTER: Initial storefront and commerce foundation existed; exact release boundary is incomplete.

## DATE UNKNOWN — R2

TYPE: CATALOG / ADMIN FOUNDATION

SUMMARY:

- Product detail/catalog behavior and Backend/Admin synchronization matured.
- Admin Product CRUD and catalog/filter management foundations were established.

STATE AFTER: Catalog and Product-management flows supported later commerce releases.

## DATE UNKNOWN — R3

TYPE: STOREFRONT UX

SUMMARY:

- Persistent cart, search/filter behavior and Product information sections were improved.
- Catalog-driven filters and resilient Product parsing were added.

STATE AFTER: Core browse, search, filter and cart UX was available.

## DATE UNKNOWN — R4

TYPE: CHECKOUT / ACCOUNT FOUNDATION

SUMMARY:

- Checkout, order confirmation, customer identity and account flows were connected across Client and Backend.

STATE AFTER: Guest/authenticated commerce flows had a persistent Backend foundation; exact phase boundary is incomplete.

## DATE UNKNOWN — R5

TYPE: SHIPPING

SUMMARY:

- Shipping became Backend-authoritative and national shipping configuration was validated.

STATE AFTER: Shipping rules were no longer trusted solely to Client behavior.

## DATE UNKNOWN — R6

TYPE: PUBLIC ORDER NUMBERS

SUMMARY:

- Stable public order references were persisted and exposed without replacing internal order identity.

STATE AFTER: Customers had a durable public order reference.

## DATE UNKNOWN — R7

TYPE: ANALYTICS / REPORTING

SUMMARY:

- Canonical Backend analytics, admin reports and Excel compatibility work were added.

STATE AFTER: Reporting had a durable Backend foundation.

## DATE UNKNOWN — R8

TYPE: REVIEWS / EMAIL / ABANDONED CARTS

SUMMARY:

- Verified reviews, transactional email/outbox workflows and bounded abandoned-cart reminders were implemented.

STATE AFTER: Review and notification workflows were treated as durable Backend operations.

## DATE UNKNOWN — R9

TYPE: SETTINGS / CMS

SUMMARY:

- Settings and CMS contracts were hardened, with related configuration and Admin persistence work.

STATE AFTER: Editable content/configuration had an explicit Backend/Admin foundation; exact release boundary is incomplete.

## DATE UNKNOWN — R10 CLOSED

TYPE: RELEASE CHECKPOINT

SUMMARY:

- Home CMS, Footer, Contacto and final Home hero refinements completed.
- R10 DEV QA passed and selective PROD release was reported live.

STATE AFTER: R10 closed; R11 AI work began afterward.

## DATE UNKNOWN — R11A

TYPE: ARCHITECTURE AUDIT

SUMMARY:

- NARI AI scope, safety boundaries, catalog grounding and future conversation approach audited.
- No AI implementation performed.

STATE AFTER: R11 architecture established as design/audit only.

## DATE UNKNOWN — R11B1

TYPE: SECURITY / TAXONOMY FOUNDATION

SUMMARY:

- Public Product projection hardened in Backend commit `e466534080c7c7c4014047f16a864c97278d22c5`.
- Internal Product fields removed from public projection.

STATE AFTER: Safe public Product contract established; taxonomy work continued.

## DATE UNKNOWN — R11B2

TYPE: CATALOG FOUNDATION

SUMMARY:

- Verified catalog snapshots were created.
- A catalog-only PROD snapshot → DEV import was manually executed and verified.
- DEV ended with 20 real Products plus 5 preserved fixtures.
- No catalog options were imported or normalized.

STATE AFTER: Production-like catalog available in DEV for curation.

## DATE UNKNOWN — R11B2.4

TYPE: SCHEMA FOUNDATION

SUMMARY:

- Added canonical recommendation fields and validators.
- DEV migration was manually executed.
- No Product canonical values populated.

STATE AFTER: Schema foundation ready for reviewed curation.

## DATE UNKNOWN — R11B2.6A

TYPE: TAXONOMY UPDATE

SUMMARY:

- Added `UV_PROTECTION` to canonical targets.
- Tests passed.
- No Product data changed.

## DATE UNKNOWN — R11B2.6D

TYPE: CURATION CHECKPOINT

SUMMARY:

- 20 real Products reviewed.
- 12 READY.
- 8 PARTIAL.
- 0 BLOCKED.
- NULL versus [] semantics finalized.
- No canonical metadata written.

STATE AFTER: Human approval required before the next mutation/development phase.

## CURRENT FRONTIER

R11B2.6D is the latest verified checkpoint. No later phase is established in the recovered project history.

## 2026-09-08 — R11B2 READY DEV WRITE

TYPE: CONTROLLED DEV DATA CHECKPOINT

SUMMARY:

- Wrote the approved canonical metadata for 12 READY real Products only.
- Preserved all 8 PARTIAL Products without changes.
- Product count remained 25; no Products were inserted or deleted.
- Catalog options remained unchanged at 15.
- Independent read-only verification passed.
- PROD was not accessed.

STATE AFTER: R11B2 technical foundation is closed. Reviewed canonical metadata exists for 12 real DEV Products; 8 PARTIAL Products remain intentionally unresolved. One-time migration, clone, export, verification and replay tools were removed before versioning; generated artifacts were removed and `tmp/` is ignored. No later numbered phase is established.

## 2026-09-08 — R11B Admin Canonical Metadata Editor

TYPE: ADMIN MAINTENANCE IMPLEMENTATION

SUMMARY:

- Added canonical NARI AI Product metadata controls to the clean Admin Product form.
- Preserved `NULL` versus `[]` semantics through explicit unreviewed/reviewed controls.
- Kept taxonomy labels/options in Admin only; Product-specific values remain in the Backend database contract.
- Backend regression tests and Admin production build passed.

STATE AFTER: Controlled live DEV UI verification passed using a preserved fixture; all temporary values were restored exactly. The implementation was then semantically integrated onto current Admin `origin/dev` and published as `2598c39`. No curation values were added to real Products by this task. R11B is now closed, R11 remains in progress, R11C is not started, and PROD remains untouched.

## 2026-09-08 — R11C Backend AI Base

TYPE: BACKEND AI FOUNDATION

SUMMARY:

- Added the provider-neutral `POST /api/ai/adviser` contract.
- Added bounded request/history validation, canonical transient profile validation and controlled intent/mode output.
- Added optional provider wiring, fake-provider testability, medical safety escalation, prompt-injection boundaries, timeout/error mapping and in-memory rate limiting.
- Kept recommendations empty and catalog access out of scope for R11C.
- Added 11 focused AI base tests; the complete Backend suite passed 49 tests.

STATE AFTER: R11C Backend AI Base is complete. No database, Product metadata, PROD environment, Client or Admin changes were made. R11D deterministic catalog candidate selection is planned but not started.

## 2026-09-08 — R11D Catalog / DEV Fixture Boundary

TYPE: R11D PREREQUISITE

SUMMARY:

- Added nullable fail-closed `catalogRole` classification with `CATALOG` and `DEV_FIXTURE` values.
- Added internal eligibility logic requiring `CATALOG`, active status and positive stock.
- Preserved the field from public projections, generic Product creation and Admin updates.
- Added a reviewed one-time DEV classification runner without runtime fixture ID hardcoding.

STATE AFTER: Boundary code and tests pass. Human verification established 20 `CATALOG`, 5 `DEV_FIXTURE`, 0 NULL in DEV; Codex made no additional DB writes. R11D candidate scoring remained the next implementation step at this checkpoint. PROD remains untouched.

## 2026-09-08 — R11D Deterministic Catalog Candidate Engine

TYPE: BACKEND AI CANDIDATE FOUNDATION

SUMMARY:

- Added explicit eligible-Product repository querying through `catalogRole`, active status and positive stock.
- Added deterministic routine, skin-type, condition and target scoring with hard conflicts, uncertainty handling, confidence labels and machine-readable reasons.
- Added intent policy, maximum-five cap, stable ordering and a private candidate projection.
- Integrated candidate discovery internally with R11C without changing the public response or invoking an LLM.

STATE AFTER: R11D candidate search is complete and remains the foundation for the next controlled reasoning/re-fetch work. Live DEV verification is HUMAN VERIFIED, not Codex-executed. No additional DEV writes, PROD access, final recommendation or external retrieval occurred.

## DATE UNKNOWN — R11D Part 2 Controlled Reasoning and Validation

TYPE: BACKEND AI VALIDATION CHECKPOINT

SUMMARY:

- Added a strict provider reasoning contract with a maximum of three selected Product IDs and one concise reason per selected Product.
- Passed at most five safe deterministic candidates to the provider; private fields and `catalogRole` are excluded.
- Validated selected IDs as a subset of the candidate set and rejected invented, duplicate or malformed selections.
- Re-fetched selected Products from PostgreSQL and revalidated catalog role, active status and positive stock before building public recommendation cards.
- Removed Products invalidated by a race condition without replacement; all-invalid selections return a safe non-recommendation.

STATE AFTER: R11D deterministic search, controlled LLM reasoning and Backend validation/re-fetch are complete. Routine construction and later comparison/compatibility/budget/existing-Product flows remain pending. No DB schema change, DEV write, PROD access, live provider request or external retrieval occurred.

## DATE UNKNOWN — R11D Part 3 Full Routine Building

TYPE: BACKEND AI ROUTINE CHECKPOINT

SUMMARY:

- Added deterministic V1 routine planning with bounded AM/PM core steps.
- Restricted optional treatment `SERUM` to PM in V1 until trusted Product-specific usage/compatibility knowledge exists.
- Added per-step candidate groups and exact step-to-Product ID validation.
- Added routine provider contract, canonical order validation, morning/evening safety rules and maximum unique Product limits.
- Allowed legitimate Product reuse between AM and PM while returning unique public Product recommendations.
- Re-fetched every unique selected Product and refused to present a complete routine when a required Product became unavailable.

STATE AFTER: R11D points 6–9 are complete. Point 10 comparison, compatibility, budget and existing-Product flows remain pending. No DB schema change, DEV write, PROD access, live provider request or external retrieval occurred.

## DATE UNKNOWN — R11D Part 4 Compare, Compatibility, Budget and Existing Products

TYPE: BACKEND AI POINT-10 CHECKPOINT

SUMMARY:

- Added deterministic bounded Product resolution using exact IDs, normalized names/slugs and ambiguity-safe follow-up behavior; `DEV_FIXTURE` rows never resolve as real NARI Products.
- Added bounded comparison over two resolved Products with profile-aware canonical evidence and explicit uncertainty for `NULL` versus `[]`.
- Added structural compatibility analysis with canonical routine ordering and safe `UNKNOWN` formula-level compatibility; no unsupported active claims, frequencies or waiting times.
- Added deterministic total-purchase budget handling in COP, counting unique Products once and using current DB selling prices.
- Added existing-Product completion using transient `knownProducts`, owned-vs-purchase separation and stock-independent owned Product recognition.

STATE AFTER: R11D points 6–10 are complete and R11D is closed. No DB schema change, DEV write, PROD access, live provider request or external retrieval occurred. R11E is not started; R11 remains in progress.
