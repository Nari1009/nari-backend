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
| Admin (verified implementation checkout) | `/Users/luis/Documents/Codex/nari-admin-clone-I15V58` | **LOCAL PATH**: `/Users/luis/Documents/Codex/nari-admin-customer-status-dev` | detached HEAD / `dddd444c57cca10207379c44fdd1bbd647dc9d67` | Source of the verified R11B implementation; packaging target is the original Admin branch. |

The original Admin checkout `/Users/luis/Documents/Codex/2026-08-24/nari-admin` has unrelated dirty work in `src/pages/OrderDetail.tsx`, `src/pages/Orders.tsx` and `src/services/orderService.ts`. It must not be reset, stashed, cleaned, overwritten or committed.

The verified R11B Admin implementation is published on Admin `origin/dev` as commit `2598c39`, based on Admin `origin/dev` `286a589`. The original checkout remains on `codex/admin-prod-release` with the unrelated Order changes preserved locally.

## ENVIRONMENTS

Verified intended separation:

- DEV: Client DEV → Backend DEV → Supabase DEV; Admin DEV → Backend DEV → Supabase DEV.
- PROD: Client PROD → Backend PROD → Supabase PROD; Admin PROD → Backend PROD → Supabase PROD.

No credentials or environment values are stored here.

## CURRENT RELEASE / MODULE

Current active release: **R11 — NARI AI**.

## CURRENT CHECKPOINT

**R11E — CLIENT CHAT IMPLEMENTATION** is implemented and in review. The primary Client experience is a branded global floating NARI AI advisor available across storefront pages, consuming only the Backend adviser endpoint. The shared `/nari-ai` route remains secondary and is not a primary navigation destination; checkout/payment flows intentionally hide the entry point. R11D remains complete; R11C is complete; R11B remains closed. R11E is not yet closed.

- Products reviewed: 20/20 real catalog Products.
- READY: 12.
- PARTIAL: 8.
- BLOCKED: 0.
- Canonical Product metadata written: 12 READY Products in DEV; 8 PARTIAL Products remain untouched.
- PROD accessed during curation: NO.

## ACTIVE MODULE CONTEXT

Read next:

1. [`docs/DECISIONS.md`](DECISIONS.md)
2. [`docs/ROADMAP.md`](ROADMAP.md)
3. [`docs/PROJECT_HISTORY.md`](PROJECT_HISTORY.md)
4. [`docs/AI_CONTEXT.md`](AI_CONTEXT.md)
5. [`docs/checkpoints/R11B2.6D.md`](checkpoints/R11B2.6D.md)
6. [`docs/checkpoints/R11B2_READY_DEV_WRITE.md`](checkpoints/R11B2_READY_DEV_WRITE.md)
7. [`docs/checkpoints/R11B_ADMIN_CANONICAL_METADATA.md`](checkpoints/R11B_ADMIN_CANONICAL_METADATA.md)
8. [`docs/checkpoints/R11C_BACKEND_AI_BASE.md`](checkpoints/R11C_BACKEND_AI_BASE.md)
9. [`docs/checkpoints/R11D_CATALOG_FIXTURE_BOUNDARY.md`](checkpoints/R11D_CATALOG_FIXTURE_BOUNDARY.md)
10. [`docs/checkpoints/R11D_CANDIDATE_ENGINE.md`](checkpoints/R11D_CANDIDATE_ENGINE.md)
11. [`docs/checkpoints/R11D_CONTROLLED_LLM_REASONING.md`](checkpoints/R11D_CONTROLLED_LLM_REASONING.md)
12. [`docs/checkpoints/R11D_ROUTINE_BUILDING.md`](checkpoints/R11D_ROUTINE_BUILDING.md)
13. [`docs/checkpoints/R11D_POINT10_COMPARE_COMPATIBILITY_BUDGET_EXISTING.md`](checkpoints/R11D_POINT10_COMPARE_COMPATIBILITY_BUDGET_EXISTING.md)

## IMPLEMENTATION SNAPSHOT

- **Client:** Existing storefront, Home CMS, Contacto, Footer, Product browsing, filters, cart, checkout and account flows implemented. R11E adds the `/nari-ai` conversational surface, Backend-only adviser integration, trusted recommendation cards and structured routine/compare/compatibility/budget presentation.
- **Admin:** Existing authenticated Product CRUD and CMS administration implemented. The verified R11B Admin implementation contains the canonical NARI AI Product editor with explicit reviewed/unreviewed states; live DEV UI verification passed and temporary fixture changes were restored.
- **Backend:** Product APIs, explicit public projection, canonical taxonomy validators and persistence support exist. R11C provides the adviser base; R11D provides fail-closed catalog eligibility, deterministic candidate scoring, controlled provider handoff, selected-ID validation, final commercial re-fetch and bounded AM/PM routine construction.
- **Database:** DEV has human-verified `catalogRole`: 20 `CATALOG`, 5 `DEV_FIXTURE`, 0 NULL. The migration remains in the repository for other environments; Codex did not execute it.
- **NARI AI:** R11C adviser foundation, all R11D points 6–10 and the real DEV provider gate are complete. R11E Client chat is implemented/in review; conversation state is temporary in-memory/session UI state only.
- **Real OpenAI DEV integration:** Responses API adapter with Structured Outputs is validated through the opt-in no-DB harness: 3/3 real cases PASS. Automated tests remain fake-provider and network-free; 117/117 tests PASS.

## CURRENT STOPPING POINT

R11B2.6D is complete and R11B is closed. R11C Backend AI Base is complete. R11D points 6–10 are complete and R11D is closed. The post-R11D real OpenAI DEV gate is closed. R11E Client chat is implemented/in review at `/nari-ai`; DEV classification is human-verified as 20 `CATALOG`, 5 `DEV_FIXTURE`, 0 NULL; Codex made no additional DEV writes.

R11B2 technical closure is complete and recorded in `docs/checkpoints/R11B2_READY_DEV_WRITE.md`: 12 approved Products were written and 8 PARTIAL Products were preserved. R11B Admin maintenance is recorded in `docs/checkpoints/R11B_ADMIN_CANONICAL_METADATA.md`; live DEV verification passed. The DB Product row remains the sole persisted Product-specific canonical metadata source, with Admin as the human editing surface. No reliable next numbered phase was recovered. Human approval is required before further mutation or development.

Do not record or assume R11B2.7 as started, completed, approved or established roadmap work.

## CURRENT RISKS

- Legacy seed/import mechanisms can mutate Product metadata if explicitly executed.
- Eight PARTIAL Products still have unresolved canonical dimensions.
- The Admin canonical metadata editor has been exercised against DEV; temporary fixture edits were restored and independently verified.
- Live OpenAI DEV validation is complete; provider tests remain fake-provider and network-free.
- The real provider uses the Responses API with Structured Outputs, `store:false`, bounded output and `OPENAI_MODEL=gpt-5.6-luna` in the current DEV environment.
- OpenAI web search is OFF; external Product knowledge/retrieval is NOT IMPLEMENTED.
- Permanent conversation history, embeddings and vector storage are not implemented. Client visual runtime QA remains pending because the local dev server could not bind in the restricted environment.
- PROD was untouched by the integration validation.
- Formula/active compatibility remains limited or unknown without trusted Product-specific knowledge.
- R11 remains in progress; R11D is complete and R11E is implemented/in review.

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
