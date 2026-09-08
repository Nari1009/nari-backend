# R11D — DETERMINISTIC CATALOG CANDIDATE ENGINE

## STATUS

- Implementation: Candidate search COMPLETE; Part 2 controlled reasoning/re-fetch COMPLETE.
- Human DEV catalog classification: VERIFIED — 20 `CATALOG`, 5 `DEV_FIXTURE`, 0 NULL.
- Codex DEV DB writes: NO.
- PROD accessed or modified: NO.
- Candidate scoring: IMPLEMENTED.
- Final LLM Product reasoning: NOT IMPLEMENTED.
- Commit: NO.
- Push: NO.

## ELIGIBILITY

Candidate discovery queries explicit Product fields and requires `catalogRole = 'CATALOG'`, `status = 'active'` and `stock > 0`. `DEV_FIXTURE` and NULL catalog roles are ineligible. Runtime code contains no fixture IDs.

## SCORING

- Routine-step match: 40.
- Suitable base skin-type match: 20.
- Suitable-condition overlap: 12.
- Each requested-target overlap: 10.
- Unknown relevant metadata penalty: 2.
- Minimum score: 10.
- Routine-step conflict: hard exclusion.
- Known skin-type mismatch: hard exclusion.
- Tie-break: score descending, confidence descending, Product ID ascending.
- Maximum candidates: 5.

The engine uses no name, brand, supplier, ingredient, legacy metadata, LLM, embedding or popularity inference.

## NULL AND EMPTY SEMANTICS

NULL remains unknown. `[]` remains reviewed neutral/no applicable canonical value. Neither is converted into the other. Empty targets receive no target bonus; empty conditions are neutral; empty skin types are neutral and not universal suitability.

## INTENT POLICY

- `PRODUCT_SELECTION`: search when structured criteria exist.
- `BUILD_ROUTINE`: search only for a specified routine step; full routine assembly is deferred.
- `DISCOVERY`, `COMPARE`, `COMPATIBILITY`, `PRODUCT_INFO`, `GENERAL_SKINCARE`, `UNKNOWN`: no forced candidate search.
- `BUDGET_ROUTINE`: budget filtering deferred because R11C does not define per-Product versus total-routine budget semantics.

## PROJECTION

Candidate metadata includes only Product ID, name, routine step, size label and canonical recommendation arrays. It excludes catalogRole, supplier, cost, margins, inventory internals and raw DB rows.

## LIMITS

Candidate results are internal. R11C public responses remain controlled and do not expose final Product recommendations. Part 2 controlled provider reasoning and final DB re-fetch are complete; routine construction and compare/compatibility/budget/existing-Product flows remain pending. No external retrieval, Product mutation, conversation persistence or DEV write is performed. R11D remains in progress; no later numbered phase is approved.
