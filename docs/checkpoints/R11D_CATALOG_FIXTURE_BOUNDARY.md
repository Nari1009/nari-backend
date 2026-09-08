# R11D — CATALOG / DEV FIXTURE BOUNDARY

## STATUS

- Boundary implementation: PASS.
- DEV migration/classification: NOT RUN.
- Candidate scoring engine: NOT IMPLEMENTED.
- DEV database modified by this task: NO.
- PROD accessed or modified: NO.
- Commit: NO.
- Push: NO.

## IMPLEMENTED

- Added nullable `catalogRole TEXT` with controlled values `CATALOG` and `DEV_FIXTURE`.
- `NULL` means unclassified and is not recommendation eligible.
- Only `CATALOG` rows with `status = 'active'` and positive stock pass the current eligibility helper.
- Public Product projection does not expose `catalogRole`.
- Generic Product creation and Admin updates do not set or clear `catalogRole`.
- Startup and seed code do not assign Product catalog roles.
- Runtime code contains no Product-specific fixture ID list.
- A reviewed one-time DEV runner contains the historical 20 catalog IDs and 5 fixture IDs for explicit classification only.

## DEV CLASSIFICATION

The intended reviewed classification is 20 real catalog Products as `CATALOG` and 5 historical DEV fixtures as `DEV_FIXTURE`.

The one-time runner was not executed because the Codex environment could not resolve `aws-0-us-east-2.pooler.supabase.com`. No connection or write occurred. Manual execution requires review of the 25-row snapshot before applying the transaction.

## R11D CANDIDATE ENGINE

Candidate engine implementation follows this prerequisite in the current worktree. It remains in review and is not yet committed. Human DEV verification established 20 `CATALOG`, 5 `DEV_FIXTURE`, and 0 NULL.

## NOT IMPLEMENTED

- Final Product recommendation.

## NEXT GATE

The boundary is human-verified. Review the R11D deterministic candidate engine before any commit or push; no additional DEV classification write is required by this checkpoint.
