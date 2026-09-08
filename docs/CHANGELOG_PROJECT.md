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
