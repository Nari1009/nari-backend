# R11C — BACKEND AI BASE

## STATUS

- R11C implementation: COMPLETE
- Endpoint contract: PASS — `POST /api/ai/adviser`
- Provider abstraction: PASS
- Request and structured-output validation: PASS
- Safety and prompt-injection boundaries: PASS
- Tests: PASS — 50 complete Backend tests, including 11 R11C-focused tests
- Database modified: NO
- Product metadata modified: NO
- PROD accessed or modified: NO
- Commit: NO
- Push: NO

## IMPLEMENTED

- Provider-neutral `AIProvider` boundary.
- Optional OpenAI HTTP adapter using `OPENAI_API_KEY` only when configured; no key is stored or required by tests.
- Controlled intents: `DISCOVERY`, `BUILD_ROUTINE`, `PRODUCT_SELECTION`, `COMPARE`, `COMPATIBILITY`, `BUDGET_ROUTINE`, `PRODUCT_INFO`, `GENERAL_SKINCARE`, `UNKNOWN`.
- Response modes: `FOLLOW_UP`, `ANSWER`, `RECOMMENDATION`.
- Transient cosmetic profile reusing the Backend canonical taxonomy.
- Strict request limits for message length, history count, history item length and total conversation size.
- Medical escalation for severe or urgent symptoms.
- In-memory route rate limiting and bounded provider timeout handling.
- Backend-controlled response envelope; raw provider responses and chain-of-thought are not exposed.

## SEMANTICS

- Client history accepts only `user` and `assistant` roles; Client `system` messages and unknown privileged fields are rejected.
- `NULL` and `[]` remain distinct in canonical profile arrays.
- R11C does not query Products, select candidates, persist conversations or mutate canonical Product metadata.
- Recommendation mode returns an empty recommendation list and a controlled pending message until R11D.

## NOT IMPLEMENTED

- Deterministic catalog candidate selection.
- Recommendation ranking or routine construction.
- Client chat UI.
- Conversation persistence, embeddings or vector storage.
- External official-product retrieval.

## REVIEW STATE

R11C is complete as a Backend foundation. R11D is planned and not started. No catalog recommendation engine, permanent conversation history or external official-source retrieval exists.
