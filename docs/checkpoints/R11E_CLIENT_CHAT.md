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
