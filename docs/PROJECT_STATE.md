# NARI PROJECT STATE

> SINGLE ENTRY POINT FOR CONTEXT RECOVERY
>
> Any new Codex/ChatGPT session working on NARI should read this file first and then read the module-specific files referenced below.
>
> Do not assume previous conversation history is available.
>
> Repository/code is authoritative for implementation state. Recorded project decisions in `docs/DECISIONS.md` are authoritative when consistent with current code and later approved decisions.

## PROJECT

NARI is a Colombian K-beauty e-commerce project with separate Backend, Client and Admin repositories. R11 is developing NARI AI on top of the existing catalog.

## REPOSITORIES

| Repository | Local path | Remote | Branch / HEAD | Worktree status |
|---|---|---|---|---|
| Backend | `/Users/luis/Documents/Codex/2026-08-24/nari-backend` | `https://github.com/Nari1009/nari-backend.git` | `dev` / R11B2 closure commit | R11B2 durable package versioned here; generated temporary artifacts ignored. |
| Client | `/Users/luis/Documents/Codex/2026-08-24/quiero-que-construyas-la-p-gina` | `https://github.com/Nari1009/nari-frontend.git` | `dev` / `5eb649167ebe3ff0b777dda87d1e4268f03fbbee` | Clean at inspection. |
| Admin (safe audit checkout) | `/Users/luis/Documents/Codex/nari-admin-clone-I15V58` | **LOCAL PATH**: `/Users/luis/Documents/Codex/nari-admin-customer-status-dev` | detached HEAD / `dddd444c57cca10207379c44fdd1bbd647dc9d67` | Clean, read-only audit checkout. |

The original Admin checkout `/Users/luis/Documents/Codex/2026-08-24/nari-admin` has unrelated dirty work in `src/pages/OrderDetail.tsx`, `src/pages/Orders.tsx` and `src/services/orderService.ts`. It must not be reset, stashed, cleaned, overwritten or committed.

## ENVIRONMENTS

Verified intended separation:

- DEV: Client DEV → Backend DEV → Supabase DEV; Admin DEV → Backend DEV → Supabase DEV.
- PROD: Client PROD → Backend PROD → Supabase PROD; Admin PROD → Backend PROD → Supabase PROD.

No credentials or environment values are stored here.

## CURRENT RELEASE / MODULE

Current active release: **R11 — NARI AI**.

## CURRENT CHECKPOINT

**R11B2.6D — FINAL NULL VS EMPTY CURATION REVIEW** is complete.

- Products reviewed: 20/20 real catalog Products.
- READY: 12.
- PARTIAL: 8.
- BLOCKED: 0.
- Canonical Product metadata written: NO.
- PROD accessed during curation: NO.

## ACTIVE MODULE CONTEXT

Read next:

1. [`docs/DECISIONS.md`](DECISIONS.md)
2. [`docs/ROADMAP.md`](ROADMAP.md)
3. [`docs/PROJECT_HISTORY.md`](PROJECT_HISTORY.md)
4. [`docs/AI_CONTEXT.md`](AI_CONTEXT.md)
5. [`docs/checkpoints/R11B2.6D.md`](checkpoints/R11B2.6D.md)
6. [`docs/checkpoints/R11B2_READY_DEV_WRITE.md`](checkpoints/R11B2_READY_DEV_WRITE.md)

## IMPLEMENTATION SNAPSHOT

- **Client:** Existing storefront, Home CMS, Contacto, Footer, Product browsing, filters, cart, checkout and account flows implemented. NARI AI UI and canonical metadata consumption are not implemented.
- **Admin:** Existing authenticated Product CRUD and CMS administration implemented. Canonical Product metadata controls are not implemented in the frontend.
- **Backend:** Product APIs, explicit public projection, canonical taxonomy validators and persistence support exist in the current uncommitted R11B2 foundation work. No AI runtime exists.
- **Database:** Product schema contains `routineStep`, `sizeLabel`, `suitableSkinTypes`, `suitableConditions` and `targets` in DEV. The 12 approved READY Products now contain reviewed canonical values; 8 PARTIAL Products remain unresolved and untouched.
- **NARI AI:** Designed/audited only; no provider, chat route, recommendation engine, routine builder, embeddings or conversation storage.

## CURRENT STOPPING POINT

R11B2.6D is complete.

R11B2 technical closure is complete and recorded in `docs/checkpoints/R11B2_READY_DEV_WRITE.md`: 12 approved Products were written and 8 PARTIAL Products were preserved. No reliable next phase was recovered. Human approval is required before further mutation or development.

Do not record or assume R11B2.7 as started, completed, approved or established roadmap work.

## CURRENT RISKS

- Legacy seed/import mechanisms can mutate Product metadata if explicitly executed.
- Eight PARTIAL Products still have unresolved canonical dimensions.
- Admin does not expose canonical metadata controls.
- NARI AI runtime and recommendation engine do not exist.

## CONTINUATION PROTOCOL

1. Read `PROJECT_STATE.md`.
2. Read `DECISIONS.md`, `ROADMAP.md`, `PROJECT_HISTORY.md`, then the module-specific files and latest checkpoint listed above.
3. Inspect current Git and worktree state.
4. Compare documentation against repository state.
5. Report discrepancies before modifying anything.
6. Never assume a phase is complete merely because documentation mentions it.
7. Never execute the next planned action without current user approval.

## DOCUMENTATION UPDATE PROTOCOL

After an approved phase that actually changes project state, evaluate updating `PROJECT_STATE.md`, `ROADMAP.md`, `DECISIONS.md`, `AI_CONTEXT.md`, `CHANGELOG_PROJECT.md` and, when useful, a new checkpoint file. Documentation must never mark a phase complete before implementation and verification succeed. Read-only tasks that create no durable project-state change do not require mechanical updates to every file.

## ANTI-DRIFT RULES

Code/schema/Git wins for implementation truth. `DECISIONS.md` records human decisions. `PROJECT_STATE.md` describes current state. Checkpoints are historical snapshots. Never store secrets or claim unverified PROD state. A prompt is not project history until executed and verified. Report documentation/repository discrepancies instead of silently resolving them.
