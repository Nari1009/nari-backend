# R11E — CLIENT CHAT IMPLEMENTATION

## STATUS

- R11A: COMPLETE.
- R11B: CLOSED.
- R11C: COMPLETE.
- R11D: COMPLETE.
- R11E: IMPLEMENTED / IN REVIEW.
- R11 remains IN PROGRESS.

## CLIENT SURFACE

The primary Client experience is a branded global floating NARI AI entry point available across storefront pages. It uses a refined NARI pill rather than a generic circular support bubble, and opens a premium advisor panel: side-panel scale on desktop and near-full-screen on mobile. The panel starts with “Hola, soy NARI AI” / “¿En qué puedo ayudarte hoy?” and one natural-language input, with three subtle optional conversation starters. It is not a generic support widget or questionnaire menu.

The shared implementation remains available at `/nari-ai` as a secondary direct route, but it is not exposed as a primary navigation destination and does not create a second chat implementation. Checkout and payment routes intentionally hide the global entry point.

## TEMPORARY STATE

Active conversation state is held in the shared Client provider for the current application tab, so normal client-side navigation preserves the open conversation. Tabs do not intentionally share state, refresh creates a fresh provider, and no `localStorage`, database history, account memory or historical retrieval is used. After 30 minutes without NARI AI interaction, the provider clears messages, transient profile context, bounded request history and retry/error state. “Nueva conversación” performs the same clear immediately.

The Client calls only `POST /api/ai/adviser` through the existing API base configuration. It does not call OpenAI, contain an API key, mutate Products, control the cart or persist conversation history.

## TRUSTED PRESENTATION

Recommendation cards use only Backend-provided Product projections and link to the existing `/producto/[slug]` route. Prices, images, slugs and Product existence are not reconstructed from Client catalog data. Structured routine, comparison, compatibility and budget fields are rendered when present; canonical enum values are translated only for presentation.

The Backend remains authoritative for domain scope, medical safety, Product identity, current commercial truth, ownership and recommendation eligibility. Web search and external official Product retrieval remain OFF.

## VERIFICATION

- `npm run build`: PASS, including TypeScript validation.
- `npm run lint`: repository remains blocked by pre-existing errors outside R11E; the new R11E files add no lint errors, with the storefront's existing `<img>` warning pattern present.
- Automated Client test framework: not configured in this repository; no network tests were added.
- Local visual runtime QA: pending because the restricted environment could not bind the development server port.
- PROD: untouched.

## DEFERRED

R11F remains the dedicated future phase for durable/bounded multi-turn history. Live OpenAI, web search, external Product knowledge, embeddings, Client cart authority and permanent conversation persistence are not added by this checkpoint.

## DEV CONVERSATION QA ROUND 2

The real DEV provider path was confirmed operational by owner testing. This review preserves that architecture and adds only bounded conversation guidance and customer-facing fallback cleanup.

- Provider instructions now favor progressive interpretation, at most one concise follow-up when genuinely necessary, and a conservative routine once enough information exists. They do not require perfect skin-type classification before being useful.
- The provider is explicitly told not to present a wash-and-wait procedure as a reliable diagnostic skin-type test. Painful, frequent, worsening or scarring breakouts receive cautious cosmetic guidance and a professional-evaluation suggestion without diagnosis or aggressive selling.
- Required routine-step failures use natural Spanish labels such as “limpiador” and never expose `CLEANSER`, `Product`, candidate, score or catalog-role terminology in customer messages.
- The deterministic candidate engine remains unchanged in eligibility semantics: `CATALOG`, active, positive stock, with the existing hard-conflict and `NULL`/`[]` rules. A regression fixture confirms canonical oily-skin cleanser evidence scores and remains eligible.
- Live DEV read-only verification was attempted but DNS resolution for `nari-backend-dev.onrender.com` was unavailable in this environment; no DEV write or PROD access occurred.

R11E remains IN REVIEW — DEV QA.

## DEV CONVERSATION QA ROUND 5 — TWO-STAGE ORCHESTRATION

The provider interpretation contract now separates `intent` from `nextAction`. `BUILD_ROUTINE` means the customer's goal, not an execution command. Interpretation may return `ASK_FOLLOW_UP` while retaining `BUILD_ROUTINE`; Backend then returns the conversational response without invoking routine planning, candidate search or Product reasoning. Only `nextAction: RECOMMEND`, followed by Backend readiness validation, can enter deterministic routine construction.

This preserves a two-stage flow: understand and converse first, then search eligible NARI Products and reason only among bounded candidates. Short replies continue to be interpreted through bounded history and profile context. General maintenance is allowed as a valid simple-routine goal without requiring a treatment target. Catalog failures remain structured data and cannot decide the next customer-facing turn by themselves.

R11E remains IN REVIEW — DEV QA.

## DEV CONVERSATION QA ROUND 5 — ORCHESTRATION

The conversation layer now has an explicit readiness boundary before routine catalog search. A `BUILD_ROUTINE` intent is treated as the customer's goal, not proof that enough information is available. When the transient profile has no skin type, canonical condition/target or verified owned Product signal, the Backend returns one concise profile question and does not invoke deterministic candidate search. Provider instructions preserve facts across bounded history and interpret brief replies such as “sí”, “listo”, “eso” and “creo que grasa” in context.

Routine construction remains Backend-controlled after readiness. If a required step has no eligible candidate but other planned steps do, the provider sees only the available bounded step groups and an internal missing-step list. Validated partial progress may be returned with `routineComplete: false` and customer-facing labels such as “limpiador”; the response never claims completeness or invents a replacement. If no usable step remains, the existing safe non-recommendation response is retained.

The DEV cleanser investigation is supported by `npm run ai:diagnose:dev:cleanser`, guarded by `NARI_ALLOW_DEV_READONLY_DIAGNOSTIC=YES` and `DEV_DATABASE_URL`. It is read-only, rejects generic/PROD database variables and emits no private commercial fields beyond the diagnostic fields needed to explain eligibility and scoring. Codex did not execute it because the DEV host was not resolvable in the available environment.

R11E remains IN REVIEW — DEV QA.

## DEV CONVERSATION QA ROUND 4

Verified NARI-owned Products and user-reported external Products are now separate transient concepts.

- `knownProducts` remains reserved for references intended for verified NARI catalog resolution.
- `unresolvedOwnedProducts` preserves an external or uncertain user report without creating an identity, Product ID or catalog metadata.
- `ownedRoutineSteps` records only an explicitly reported generic category, such as `SUNSCREEN` for “uso un bloqueador”; it is not Product metadata and does not create a recommendation card.
- User-reported routine-step coverage is removed from the purchase routine plan, while missing steps continue through the existing deterministic NARI catalog candidate engine.
- Verified owned Products continue using the existing R11D.10 resolver and ownership behavior.
- No formula, price, stock, image, slug, compatibility or availability facts are inferred for unresolved external Products. Nothing is persisted to the database.

R11E remains IN REVIEW — DEV QA.
