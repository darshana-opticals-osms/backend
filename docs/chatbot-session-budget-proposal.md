# Issue #77: approved chatbot usage session contract

Status: Approved by the issue implementer in this workspace conversation on
2026-10-15 ("meka approved"). Implementation follows this contract. The canonical
ADR-010 amendment is submitted in
[documents PR #37](https://github.com/darshana-opticals-osms/documents/pull/37)
for normal peer review. This record does not claim a new supervisor sign-off.

## Approval prerequisite

Issue #77 requires approved session identity, lifetime, counting, retries and
reset semantics before implementation. Accepted ADR-010 sections 9.3.2, 11.1
and 11.6 specify stateless conversation processing, 20 messages and browser
history deletion, but do not define authoritative usage state or its retention.
The approval below authorizes this implementation. The canonical clarification
is recorded in the documents PR linked above and awaits its normal peer review.

Approval reference: explicit user approval in this workspace conversation on
2026-10-15, following review of this proposal.

## Approved decisions for ADR-010 clarification

1. A usage session is a fixed 30-minute window beginning with the first admitted
   valid query for an authenticated Customer. All tabs, devices and JWTs for that
   Customer share that window. It does not slide with activity.
2. The budget is 20 messages, interpreted as 10 admitted exchanges: one Customer
   question and one reserved assistant reply per exchange. Reserve both slots
   atomically before boundary handling, knowledge retrieval or provider work.
   Unsupported and provider-failure fallback replies consume the reservation.
3. Authentication, authorization, rate-limit and input-validation rejections do
   not consume slots. Once admitted, a request consumes its two slots even if
   retrieval, persistence or delivery fails. A disconnect does not refund slots;
   this avoids retries and crashes permitting repeated provider work.
4. An adapter's automatic retry belongs to the original exchange and consumes no
   additional slots. A manual retry or replay is a new exchange and consumes two
   slots. No idempotency contract or stored response cache is introduced.
5. Refresh, history omission, shorter history, clearing browser storage, changing
   client identifiers, logout/login and tab close do not reset the usage budget.
   Logout and tab close still purge browser conversation text as required by the
   Accepted ADR. Backend usage expires independently; no reset endpoint exists.
6. The next valid query at or after expiry starts a fresh usage window. A request
   admitted before expiry belongs to its original window even if it finishes
   later. Admission time is evaluated by the database to keep replicas consistent.
7. Persist one minimal usage record per Customer in the existing MongoDB database:
   authenticated Customer reference, window start/expiry and reserved message
   count. Do not store messages, hashes of messages, JWTs, provider payloads,
   clinical/payment details or additional Customer PII. This is usage metadata,
   while conversation processing remains stateless.
8. Use a TTL index to delete expired usage records, with MongoDB's asynchronous
   TTL cleanup delay explicitly acknowledged. Expiry is enforced in admission
   logic independently of physical deletion. Reuse an expired record atomically
   if cleanup has not run; delete usage metadata on Customer deletion as well.
   The TTL cleanup delay must be acceptable to the ADR reviewers; this proposal
   does not promise immediate physical deletion at expiry.

The 30-minute duration and interpretation of 20 messages as 10 exchanges were
approved in this conversation; they are clarifications beyond the existing ADR.

## API and frontend compatibility

Keep `POST /api/v1/chatbot/query` and its existing message/history request and
successful response unchanged. Derive ownership exclusively from the verified
Customer JWT. Accept no client session reference or usage counter as authority.
Keep the 500-character limit, six-entry context and 10 requests/minute controls.

Exhaustion returns HTTP 429 with stable code `CHATBOT_SESSION_EXHAUSTED`, safe
message `Chatbot session message limit reached. Please try again later.`, and
`Retry-After` seconds until window expiry. Document the code and response envelope
in Swagger using the existing error conventions. Database admission failure must
fail closed with a safe 503 before retrieval/provider work.

Existing frontend requests remain compatible. The widget should distinguish
session exhaustion from the existing per-minute limit and retain any safe retry
guidance. Its local transcript bound is a UX control and may show fewer messages
than the shared backend window permits. Clearing the transcript does not reset
the backend budget. No frontend session identifier migration is needed.

## Implementation and verification after approval

- Enforce admission centrally in ChatbotService after validation and before any
  retrieval/provider work, across both route aliases and every reply path.
- Use a unique Customer key and atomic conditional database updates. Handle
  competing first-window creation, expiry rollover and TTL deletion races without
  exceeding the budget or allowing duplicate active windows.
- Verify exactly 10 exchanges/20 slots, the next request rejected without
  retrieval/provider calls, and concurrent admission at the final slots.
- Exercise real authenticated endpoints with MockChatbotAdapter for history
  omission, storage-independent requests, replay, arbitrary client identifiers,
  cross-Customer isolation, JWT rejection, both aliases and all failure paths.
- Verify manual versus automatic retry behavior, expiry rollover, stale in-flight
  requests, no reset on logout/login, TTL configuration and Customer deletion.
- Preserve input/context/rate-limit regressions; validate Swagger, lint,
  formatting, full tests and coverage using the CI commands. Remote CI status can
  only be claimed after a pushed change has actually run.
