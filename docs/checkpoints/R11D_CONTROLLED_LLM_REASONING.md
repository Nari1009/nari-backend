# R11D PART 2 — CONTROLLED LLM REASONING + BACKEND VALIDATION

## STATUS

- Deterministic candidate search: COMPLETE.
- Controlled LLM reasoning: COMPLETE.
- Backend validation and final Product re-fetch: COMPLETE.
- Routine building: PENDING.
- Compare, compatibility, budget and existing-Product flows: PENDING.
- R11D: IN PROGRESS.
- R11E: NOT STARTED.

## PROVIDER INPUT

The provider receives at most five candidates produced by the deterministic R11D engine. Each candidate contains only:

- `id`
- `name`
- `routineStep`
- `sizeLabel`
- `suitableSkinTypes`
- `suitableConditions`
- `targets`

`NULL` and `[]` remain distinct. `catalogRole`, supplier, cost, stock, margins, raw rows and private fields are not sent to the provider.

## PROVIDER OUTPUT

The strict internal reasoning contract contains `mode`, `message`, `selectedProductIds`, `reasons` and a validated transient `profile`. Modes are `FOLLOW_UP`, `ANSWER` and `RECOMMENDATION`. Recommendation mode may select at most three IDs. Every selected ID requires one concise reason; reasons for unselected or unknown Products are rejected. Duplicate IDs and arbitrary extra fields are rejected.

The provider cannot create Product truth, commercial fields or replacement Products. No chain-of-thought or raw provider response is exposed.

## FINAL VALIDATION

Selected IDs must be a subset of the exact deterministic candidate set. Backend re-fetches each selected Product and requires `catalogRole = CATALOG`, `status = active` and `stock > 0`. Public recommendation cards use only DB values for ID, name, price, primary image and slug.

If a selected Product becomes unavailable, it is removed without replacement. If none remain, the response is a controlled non-recommendation. This is the V1 race-condition policy.

## LIMITATIONS

- No live OpenAI key or request.
- No database schema changes or Product writes.
- No routine builder yet.
- No compare, compatibility, budget or existing-Product flow yet.
- No external official-source retrieval.
- No permanent conversation history.
- No Client or Admin changes.
- PROD untouched.
