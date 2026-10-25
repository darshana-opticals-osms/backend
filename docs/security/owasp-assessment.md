# DDP-085 – Backend OWASP Top 10 Security Assessment

## 1. Assessment Information

- **Issue:** DDP-085 – OWASP Top 10 Compliance Verification and Security Hardening

- **Repository:** `darshana-opticals-osms/backend`

- **Security implementation branch:** `test/91-owasp-security-verification` (merged through PR #108)

- **Post-deployment evidence branch:** `docs/91-post-deployment-security-verification`

- **Target branch:** `develop`

- **Assessment type:** Backend security verification and targeted hardening

- **Approach:** Verify existing controls first, identify real security gaps, apply minimum targeted fixes, run regression tests, and document reproducible evidence.

This document records the DDP-085 backend security assessment, targeted hardening, final regression evidence, and post-merge deployment verification. The remaining release evidence is explicitly identified in Sections 14–16.

---

## 2. Current Assessment Baseline

The DDP-085 implementation was completed on `test/91-owasp-security-verification` and merged into backend `develop` through PR #108.

Relevant security and CI history includes:

- `f7f56eb` – `fix(security): remediate vulnerable backend dependencies`

- `1a3f864` – merged DDP-101 order-address snapshot changes from backend `develop`

- `06c5a38` – synchronized DDP-085 with the merged backend baseline at that stage

- `804b183` – `docs(security): document OWASP assessment progress`

- `9aa59c1` – `docs(security): record A07 account lockout gap`

- `33d12b0` – `fix(ci): restore reproducible npm lockfile`

- `88b1adc` – `fix(security): implement account login lockout`

- `a7df245` – `fix(security): add privacy-safe authentication event logging`

- `393da00` – `fix(security): log access control rejections`

- `00c2a7a` – `fix(security): make account lockout concurrency safe`

- `2f31231` – `docs(security): fix OWASP assessment Markdown formatting`

- `7afbeb0` – `fix(security): close zero-state account lockout race`

- `0881662` – merge commit for backend PR #108 into `develop`

Backend PR #107 / DDP-086 Performance and Reliability Testing had already been merged into `develop` at commit `5c1e20e`.

Security-relevant changes from that merged baseline include:

- `skipSuccessfulRequests: true` for the authentication rate limiter;

- Express `trust proxy` configuration for reverse-proxy client-IP handling;

- performance-related model/index updates that remain compatible with authorization, transaction, and audit controls.

After synchronizing with the merged PR #107 baseline, targeted security/authentication/password-reset regression verification passed:

- **3 suites passed**

- **52 tests passed**

- **0 failed**

The final DDP-085 backend regression completed successfully after the final concurrency fix:

- **118 / 118 test suites passed**

- **2075 / 2075 tests passed**

- ESLint passed

- Prettier passed

- `git diff --check` passed

Backend CI run #501 for final commit `7afbeb0` completed successfully.

CI run #501 with **118 / 118 test suites and 2075 / 2075 tests passed** is retained as the historical final DDP-085 security-implementation baseline for commit `7afbeb0`.

The latest verification for this documentation PR completed successfully in Backend CI run #517, with **118 / 118 test suites and 2076 / 2076 tests passed**. ESLint and Prettier also passed, and the dependency security gate remained at **0 Critical / 0 High** vulnerabilities. This later CI result verifies the current integrated backend state and does not replace the historical DDP-085 implementation baseline.

The final dependency audit satisfied the DDP-085 High/Critical release gate with **0 Critical / 0 High / 2 Moderate** findings. The remaining Moderate findings are documented as residual dependency risk and were not force-remediated because the available automatic fix would introduce a breaking dependency change.

PR #108 received final approval after the account-lockout concurrency edge cases were resolved and was merged into `develop` as commit `0881662`.

The accepted DDP-085 backend revision was then deployed successfully to Render. Targeted post-deployment verification confirmed HTTPS/security headers, generic authentication failures, account-lockout behavior and recovery, approved-origin CORS behavior, final frontend/backend authentication integration, and deployed runtime authentication-security logging. The planned post-deployment security verification is complete.

## 3. Verification Already Executed

### 3.1 Dependency Installation

Dependencies were installed successfully using the committed lockfile.

`mongodb-memory-server` post-install binary downloading was disabled during installation because the development machine already contains MongoDB.

Result:

- Dependency installation completed successfully.

- Working tree remained clean after installation.

---

### 3.2 ESLint Verification

Command executed:

`npm run lint`

Result:

**PASS**

No ESLint errors were reported.

---

### 3.3 Prettier Verification

Command executed:

`npm run format:check`

Result:

**PASS**

All checked files matched the configured Prettier formatting rules.

---

### 3.4 Initial Backend Dependency Security Scan

Command executed:

`npm audit --audit-level=high`

Initial result:

- **2 High**

- **5 Moderate**

- **7 vulnerabilities total**

High-severity findings:

1. `body-parser <1.20.9`

   - Denial-of-Service vulnerability involving trailing bytes after compressed request bodies.

2. `multer 2.0.0 – 2.4.0`

   - Denial-of-Service vulnerability involving an asynchronous `fileFilter` remaining pending after request teardown.

Additional Moderate findings affected:

- `fast-uri`

- `ip-address`

- `nodemailer`

- `uuid` through `exceljs`

---

## 4. Security Finding SEC-001

### Finding ID

`SEC-001`

### OWASP Category

A06 – Vulnerable and Outdated Components

### Severity

High

### Affected Components

Backend dependency tree.

Primary High-severity affected packages:

- `body-parser`

- `multer`

Additional compatible vulnerable dependencies:

- `nodemailer`

- `fast-uri`

- `ip-address`

### Preconditions

Install dependencies from the existing backend lockfile and execute `npm audit`.

### Reproduction

Run:

`npm audit --audit-level=high`

### Expected Behaviour

The release candidate must not contain unresolved Critical or High dependency vulnerabilities.

### Actual Behaviour

The initial scan reported:

- 2 High vulnerabilities

- 5 Moderate vulnerabilities

### Remediation

A dry run was performed before making changes.

Safe compatible updates identified:

- `body-parser 1.20.8 → 1.20.9`

- `multer 2.4.0 → 2.5.0`

- `nodemailer 10.1.0 → 10.2.1`

- `ip-address 10.7.2 → 10.7.4`

- `fast-uri 3.1.8 → 3.1.9`

The updates were applied using:

`npm audit fix`

No `npm audit fix --force` command was used.

### Fix Reference

Commit:

`f7f56eb – fix(security): remediate vulnerable backend dependencies`

### Retest Result

After remediation:

- **0 Critical**

- **0 High**

- **2 Moderate**

Result:

**PASS for DDP-085 High/Critical dependency release gate at the tested baseline.**

The dependency scan was repeated in the final PR CI after the relevant backend changes were integrated. The verified final result remained **0 Critical / 0 High / 2 Moderate**.

---

## 5. Residual Dependency Risk – SEC-002

### Finding ID

`SEC-002`

### OWASP Category

A06 – Vulnerable and Outdated Components

### Severity

Moderate

### Dependency Chain

`exceljs@4.4.0`

→ `uuid@8.3.2`

### Advisory

The installed `uuid` version is affected by a Moderate advisory involving missing buffer bounds checking for specific UUID operations when a buffer is supplied.

### Automatic Remediation Assessment

The available npm automatic remediation requires:

`npm audit fix --force`

npm reports that this would introduce a potentially breaking `exceljs` dependency change.

### Decision

The force fix was intentionally **not applied** because DDP-085 requires minimal targeted remediation and avoidance of unnecessary breaking dependency changes.

### Current Disposition

**Residual Moderate risk – documented for final release review; no force-fix applied.**

This finding is not being treated as silently resolved.

Final PR CI confirmed the documented **0 Critical / 0 High / 2 Moderate** state. The residual Moderate dependency risk should continue to be monitored for a safe compatible remediation before the final production release.

---

## 6. Security Finding SEC-003 – Account Lockout

### Finding ID

`SEC-003`

### OWASP Category

A07 – Identification and Authentication Failures

### Original Gap

The backend already implemented IP-based authentication rate limiting, but initially had no persistent account-level mechanism for:

- counting consecutive failed login attempts;

- locking an individual account after repeated failures;

- storing a lock expiry;

- rejecting a correct password while the account is locked;

- resetting failure state after a successful authentication;

- starting a fresh failure sequence after lock expiry.

The SENG 34213 development guideline explicitly requires account lockout as part of the A07 authentication controls.

### Remediation Implemented

A minimum-change account-level lockout policy was implemented without redesigning the JWT/session architecture.

Policy:

- **5 consecutive failed login attempts**

- **15-minute temporary account lock**

- successful authentication resets failed-attempt state

- an expired lock starts a fresh failure sequence

- the policy applies consistently to Customer, Staff, and System Administrator identities

- the existing IP-based authentication rate limiter remains active as a complementary control

- locked, invalid-password, and unknown-account responses remain generic to avoid account-state enumeration

Configuration is environment-driven through:

- `ACCOUNT_LOCKOUT_MAX_ATTEMPTS`

- `ACCOUNT_LOCKOUT_DURATION_MS`

The identity models store hidden account-lockout state and do not expose it through normal API responses.

### Fix References

Relevant commits:

- `88b1adc – fix(security): implement account login lockout`

- `00c2a7a – fix(security): make account lockout concurrency safe`

- `7afbeb0 – fix(security): close zero-state account lockout race`

### Regression Evidence

Focused validation after implementation passed:

- account-lockout integration tests

- authentication login integration tests

- security integration tests

- authentication service unit tests

Initial focused result:

- **4 suites passed**

- **40 tests passed**

- **0 failed**

Additional post-hardening verification covering authentication, lockout, access-control rejection logging, RBAC, branch authorization, centralized error handling, and the security suite later passed:

- **8 suites passed**

- **82 tests passed**

- **0 failed**

The final regression after the concurrency fixes passed:

- **118 / 118 test suites**

- **2075 / 2075 tests**

- **0 failed**

Backend CI run #501 completed successfully.

### Deployed Verification

The merged DDP-085 revision was deployed to Render and the account-lockout lifecycle was verified using a fictional staging Customer account:

- five consecutive incorrect passwords returned HTTP 401;

- the correct password was still rejected with HTTP 401 while the account was locked;

- after the 15-minute lock expired, the same correct credentials authenticated successfully;

- the authenticated identity returned the expected `CUSTOMER` role.

This verifies the deployed account-lockout and recovery behavior without exposing credentials in the assessment document.

### Current Status

**RESOLVED / FINAL REGRESSION PASS / DEPLOYED LOCKOUT VERIFICATION PASS**

A07 is no longer blocked by SEC-003.

## 7. MongoDB Security-Test Environment

The development machine contains the following MongoDB system binary:

`C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe`

`mongodb-memory-server` was configured to reuse this binary using:

`MONGOMS_SYSTEM_BINARY`

The library requested MongoDB 8.2.6 but detected system MongoDB 8.3.11 and explicitly reported:

`Using SystemBinary!`

The version difference produced a warning only and did not prevent test execution.

### Database Integration Verification

Test:

`tests/integration/database.test.js`

Result:

- **1 test suite passed**

- **3 tests passed**

- **0 failed**

Verified behaviours included:

- MONGODB_URI is required outside test environments.

- A temporary MongoDB instance can be used successfully during tests.

- MongoDB connection failures do not expose database URI credentials.

Status:

**PASS**

---

## 8. Existing Security Integration Suite

Test executed:

`tests/integration/security.test.js`

Result:

- **1 test suite passed**

- **21 tests passed**

- **0 failed**

Verified controls included:

### Security Headers

- `X-Content-Type-Options`

- `X-Frame-Options`

- suppression of `X-Powered-By`

Status: **PASS**

### CORS

- configured origin permitted

- OPTIONS preflight handled

- unapproved production origin does not receive an allow-origin header

Status: **PASS**

### Rate Limiting

- general API limiter active

- excessive requests return HTTP 429

- authentication routes use stricter limiting

Status: **PASS**

### Password Security

- bcrypt cost factor is at least 12

- password hashes are not plain text

- bcrypt verification behaves correctly

Status: **PASS**

### Request-Body Size

- oversized request rejected with HTTP 413

- normal requests continue successfully

Status: **PASS**

### NoSQL Injection

A representative MongoDB operator injection payload against authentication was rejected and did not bypass authentication.

Status: **PASS**

### Authentication Failure Safety

- login failure does not disclose whether an account exists

- password hashes are not exposed

Status: **PASS**

### Production Error Safety

- stack traces and internal paths are not returned

- sensitive values are sanitized from server error logs

Status: **PASS**

### Environment Secret Protection

- `.env.example` uses placeholder values

- `.gitignore` excludes environment files

Status: **PASS**

### Configurable Security Controls

CORS and rate-limit configuration are environment-controlled.

Status: **PASS**

---

# 9. OWASP Top 10 Assessment

## A01 – Broken Access Control

### Existing Controls Identified

Existing automated tests cover:

- missing authentication

- malformed JWT

- invalid JWT claims/signatures

- expired JWT

- unauthorized roles

- administrative role restrictions

- clinical role restrictions

- customer prescription ownership

- cross-customer access rejection

- branch-scoped orders

- branch-scoped reports

- unauthorized payment access

- administrative endpoint protection

Examples of relevant test suites include:

- `tests/integration/rbac.test.js`

- `tests/integration/prescriptionApi.test.js`

- `tests/integration/orderStatusApi.test.js`

- `tests/integration/reportApi.test.js`

- `tests/integration/paymentApi.test.js`

- administrative API integration tests

### Final Verification Evidence

The latest final backend regression completed successfully with **118 / 118 suites and 2075 / 2075 tests passed**.

Deployed-backend smoke verification confirmed:

- protected administrative endpoints reject missing authentication with HTTP 401;

- malformed/invalid bearer tokens receive a safe HTTP 401 response;

- unexpected privileged `role` fields are rejected by login validation;

- public registration rejects attempts to inject `SYSTEM_ADMIN` or other privileged account fields.

Final browser-level integration also confirmed that the deployed Customer authentication flow works through the production Vercel frontend against the Render backend.

### Current Status

**PASS – AUTOMATED REGRESSION AND DEPLOYED ACCESS-CONTROL SMOKE VERIFIED**

No additional A01-specific manual repetition is required for DDP-085. Final release sign-off remains dependent on the explicitly listed outstanding evidence in Sections 14–16.

## A02 – Cryptographic Failures

### Verified

- bcrypt password hashing is used.

- bcrypt configured cost requirement was verified by automated test.

- authentication error responses do not expose password hashes.

- configuration loads JWT secrets from environment configuration.

- password-reset implementation has existing tests for hashed reset-token storage and expiry.

- database connection failures do not expose credentials.

### Final Local and Deployed Evidence

- the latest final backend regression passed **118 / 118 suites and 2075 / 2075 tests**;

- the deployed Render API is reachable over HTTPS;

- backend HSTS is enabled with `max-age=31536000; includeSubDomains`;

- authentication failures do not expose passwords, password hashes, JWT secrets, database credentials, or stack traces;

- the production Vercel frontend is served over HTTPS and returns HSTS;

- production frontend/backend authentication integration was verified successfully.

### Status

**PASS – LOCAL REGRESSION AND DEPLOYED HTTPS / AUTHENTICATION INTEGRATION VERIFIED**

The deployed Render authentication-security log inspection was completed under A09 and confirmed privacy-safe authentication event logging.

## A03 – Injection

### Verified

The executed security suite confirmed rejection of a representative MongoDB operator injection payload.

Existing sanitizer tests also cover:

- removal of MongoDB operator keys

- dot-notation operator keys

- recursive sanitization

- script-tag stripping

Input-validation tests exist across authentication, prescriptions, payments, reports, inventory, appointments, administration, and chatbot functionality.

### Final Verification Evidence

The final backend regression completed successfully with **118 suites / 2075 tests passed**.

Deployed input-validation smoke checks also confirmed:

- malformed JSON is rejected with a controlled HTTP 400 response;

- unexpected privileged `role` input on login is rejected with HTTP 422;

- privileged `role` injection during public registration is rejected with HTTP 422.

### Status

**PASS LOCALLY / DEPLOYED INPUT-VALIDATION SMOKE PASS**

---

## A04 – Insecure Design

### Security Design Baseline

The approved SDS already documents substantial security-design controls, including:

- JWT authentication

- role-based authorization

- data protection and least privilege

- input validation and sanitization

- TLS / encryption requirements

The existing SDS v1.0 does **not** contain an explicit standalone threat-model / STRIDE section.

Final implementation-aligned SDS work is already owned by:

- `documents#47` – DDP-088, Final SRS/SDS Alignment

- existing branch: `docs/47-final-srs-sds`

DDP-085 therefore records the verified design risks and mitigations without creating a duplicate SDS artifact or silently changing architecture.

### Design Risks and Mitigations Assessed

| Design Risk                                       | Verified / Existing Mitigation                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Duplicate or forged payment effects               | provider verification, amount/currency checks, replay/idempotency controls, reconciliation logic |
| Inventory overselling or inconsistent restoration | transaction-backed reservation/restoration rules and concurrency tests                           |
| Appointment overbooking                           | authoritative session-capacity and conflict controls                                             |
| Cross-customer clinical disclosure                | backend role/ownership restrictions and safe response shaping                                    |
| Cross-branch inventory/report access              | server-side RBAC and branch-scoping controls                                                     |
| Unauthorized loyalty manipulation                 | backend-authoritative loyalty rules and controlled persistence                                   |
| Audit-history tampering                           | centralized immutable audit-trail design with restricted normal mutation paths                   |
| Authentication brute force                        | IP rate limiting plus account-level temporary lockout                                            |
| Unrestricted external server requests             | fixed/configured provider destinations; no generic arbitrary URL-fetch feature identified        |
| Sensitive information in operational logs         | sanitizer controls plus privacy-safe authentication and access-rejection event logging           |

Existing automated coverage was identified for critical business boundaries including:

- checkout authority

- inventory reservation and restoration

- order lifecycle

- payment idempotency

- duplicate payment notification behaviour

- payment reconciliation

- appointment concurrency

- prescription ownership

- loyalty authority

- audit-trail operations

- branch isolation

- immutable order-address snapshot behaviour

### Current Status

**PASS – DESIGN-RISK ASSESSMENT COMPLETE; FINAL SDS INCORPORATION TRACKED UNDER DDP-088**

No additional backend architecture change is required for A04.

The verified A04 security-design and threat-risk findings are tracked under DDP-088 / `documents#47` for incorporation into the final implementation-aligned SDS. This is a documentation handoff and does not make the DDP-085 security assessment incomplete.

---

## A05 – Security Misconfiguration

### Verified Locally

- Helmet security headers

- CORS restrictions

- production-safe error responses

- request-body limits

- environment-secret exclusion

- environment-driven security values

### Deployed Render Verification

Safe deployed-backend verification was performed against:

`https://osms-backend-staging.onrender.com`

Verified evidence includes:

- `GET /api/health` returned HTTP 200 with `{"status":"ok","service":"osms-backend"}`;

- HTTPS is active;

- HSTS is enabled;

- Helmet security headers are present, including CSP, `X-Content-Type-Options`, `X-Frame-Options`, Referrer Policy, COOP, and CORP;

- general API rate-limit headers are present;

- an unapproved origin (`https://attacker.example.com`) did **not** receive `Access-Control-Allow-Origin`;

- missing authentication on a protected admin endpoint returned a safe HTTP 401 response;

- an invalid JWT returned a safe HTTP 401 response;

- an unknown API route returned a controlled HTTP 404 response without stack traces or internal implementation details;

- malformed JSON returned a controlled HTTP 400 response;

- login and registration validation rejected unexpected privileged `role` fields with HTTP 422;

- the deployed authentication limiter was observed as **10 requests per 180 seconds**;

- the approved production origin `https://darshana-opticals.vercel.app` received `Access-Control-Allow-Origin: https://darshana-opticals.vercel.app`;

- credentialed CORS support returned `Access-Control-Allow-Credentials: true`.

The deployed revision was confirmed to include merged backend PR #108.

No destructive or aggressive security testing was performed against the deployed environment.

### Status

**PASS – FINAL DDP-085 BACKEND REVISION AND APPROVED-ORIGIN CORS VERIFIED**

## A06 – Vulnerable and Outdated Components

### Backend

Initial:

- 2 High

- 5 Moderate

After safe remediation and final verification:

- 0 Critical

- 0 High

- 2 Moderate

`SEC-001` remediated the identified High findings.

`SEC-002` records the remaining transitive Moderate `uuid` risk through `exceljs`.

The backend dependency scan passed the High/Critical release gate in the final PR CI. The available forced automatic remediation was intentionally not used because it would introduce a potentially breaking dependency change.

### Frontend

Frontend DDP-085 PR #68 was merged into `develop`.

Final synchronized frontend verification recorded:

- **110 / 110 test files passed**

- **1341 / 1341 tests passed**

- **88.05% statements coverage**

- **81.80% branch coverage**

- **90.95% function coverage**

- **88.86% line coverage**

- ESLint passed

- Prettier passed

- production build passed

- **0 Critical / 0 High** dependency vulnerabilities

- 2 Moderate React Router advisories remain

The available automatic remediation for the remaining frontend Moderate advisories requires a breaking React Router major-version upgrade and was intentionally not force-applied.

Post-merge production verification also confirmed the expected Vercel security headers and successful frontend/backend authentication integration.

### Current Status

**PASS for the DDP-085 High/Critical dependency gate, with documented Moderate residual dependency risks.**

No unresolved Critical or High dependency vulnerability remains in the verified backend or frontend baseline.

## A07 – Identification and Authentication Failures

### Verified Controls

The security and authentication test coverage verifies:

- generic invalid-login responses

- no account-existence disclosure

- authentication rate limiting

- missing JWT rejection

- malformed JWT rejection

- invalid JWT rejection

- expired JWT rejection

- password-reset anti-enumeration

- hashed password-reset-token storage

- reset-token expiry

- reset-token replacement

- single-use reset-token behaviour

- already-used-token rejection

- invalid-token rejection

- concurrent-reset protection

### SEC-003 Remediation

The previously identified account-lockout gap has been resolved.

Implemented policy:

- 5 consecutive failed attempts

- 15-minute temporary lock

- successful authentication clears prior failures

- expired locks permit a fresh failure sequence

- Customer, Staff, and System Administrator identities use the same policy

- generic authentication responses are preserved

- IP-based authentication rate limiting remains active

Relevant commits:

- `88b1adc – fix(security): implement account login lockout`

- `00c2a7a – fix(security): make account lockout concurrency safe`

- `7afbeb0 – fix(security): close zero-state account lockout race`

Focused lockout/authentication/security verification passed:

- **4 suites**

- **40 tests**

- **0 failed**

Post-hardening A09/A07/RBAC verification also passed:

- **8 suites**

- **82 tests**

- **0 failed**

The final regression after all concurrency fixes passed:

- **118 / 118 test suites**

- **2075 / 2075 tests**

Backend CI run #501 completed successfully.

### Deployed Verification

Post-merge Render verification confirmed:

- five consecutive incorrect login attempts returned HTTP 401;

- the correct password was rejected while the account remained locked;

- after the 15-minute lock expired, the same correct credentials authenticated successfully;

- the authenticated test identity returned role `CUSTOMER`;

- the production Vercel frontend successfully authenticated against the deployed backend;

- authenticated state remained valid after refresh;

- logout returned the application to the unauthenticated state.

### Status

**PASS – FINAL REGRESSION, CI, DEPLOYED ACCOUNT LOCKOUT, RECOVERY, AND FRONTEND/BACKEND AUTHENTICATION VERIFIED**

## A08 – Software and Data Integrity Failures

### Controls Identified

- committed npm lockfile

- reproducible dependency installation

- GitHub pull-request workflow

- PayHere provider verification

- payment replay/idempotency controls

- transaction-backed business operations

- immutable audit-trail architecture

- security remediation associated with specific commits and peer review

### Relevant Security References

- dependency remediation commit `f7f56eb`

- final account-lockout concurrency fix `7afbeb0`

- backend PR #108

- backend merge commit `0881662`

### Verified

- the committed npm lockfile remains reproducible;

- backend PR #108 received approving peer review;

- final backend regression completed successfully with **118 / 118 suites and 2075 / 2075 tests passed**;

- Backend CI run #501 completed successfully;

- the dependency security scan passed the High/Critical release gate;

- PR #108 was merged into `develop`;

- the accepted revision was successfully deployed to Render;

- final frontend/backend authentication integration was verified after deployment.

### Status

**PASS – CI, PEER REVIEW, MERGE TRACEABILITY, DEPLOYMENT, AND INTEGRATION EVIDENCE VERIFIED**

## A09 – Security Logging and Monitoring Failures

### Existing Audit and Error-Logging Controls

Existing tests verify or inspect:

- sanitized production error logging

- immutable audit records for important business operations

- payment events

- inventory audit behaviour

- clinical audit behaviour

- administrative audit behaviour

Sanitizer tests cover redaction of values including:

- credentials

- API secrets

- bearer tokens

- MongoDB URIs

- system paths

Prescription security tests also verify that clinical remarks and eye measurements are not unnecessarily written to error logs.

### Authentication Security Event Logging

A verified A09 gap was identified because authentication outcomes were not explicitly recorded as privacy-safe security events.

The following events are now logged:

- `LOGIN_FAILED`

- `LOGIN_BLOCKED_LOCKED`

- `LOGIN_SUCCEEDED role=<canonical-role>`

Successful-login logging contains the canonical role only.

Authentication security logs are designed not to include:

- email addresses

- passwords

- JWTs

- account IDs

- IP addresses

- request bodies

- other unnecessary PII

Relevant commit:

`a7df245 – fix(security): add privacy-safe authentication event logging`

### Authentication / Authorization Rejection Logging

A second A09 review found that centrally handled HTTP 401 and 403 access-control failures were safely returned but were not recorded as security events.

The centralized error handler now records:

- `[SecurityAccess] AUTHENTICATION_REJECTED`

- `[SecurityAccess] AUTHORIZATION_DENIED`

The event intentionally contains no request body, identity value, token, password, URL, or other user-controlled sensitive data.

Relevant commit:

`393da00 – fix(security): log access control rejections`

### Regression Evidence

Focused post-hardening verification passed:

- centralized error/validation integration tests

- authentication logging unit tests

- authentication service unit tests

- account-lockout integration tests

- login integration tests

- security integration tests

- canonical-role authorization unit tests

- branch-inventory authorization unit tests

Result:

- **8 suites passed**

- **82 tests passed**

- **0 failed**

- ESLint passed

- Prettier passed

- `git diff --check` passed

The latest full backend regression also passed **118 / 118 suites and 2075 / 2075 tests**, and Backend CI run #501 completed successfully.

### Deployed Runtime Evidence

On 25 October 2026, the deployed Render authentication-security logs were inspected during controlled authentication and account-lockout verification. The deployed security baseline included backend PR #108, merged into `develop` as commit `0881662`.

The sanitized runtime evidence confirmed:

- `[SecurityAuth] LOGIN_FAILED` was emitted for failed authentication attempts;
- `[SecurityAuth] LOGIN_BLOCKED_LOCKED` was emitted when authentication was attempted against the locked account;
- `[SecurityAccess] AUTHENTICATION_REJECTED` was emitted for rejected authentication requests;
- passwords were not present in the verified security log entries;
- JWT/access-token values were not present;
- sensitive credentials were not exposed;
- unnecessary Customer data was not exposed.

This confirms that the deployed authentication security events are emitted without exposing sensitive authentication data.

### Status

**PASS – CODE, AUTOMATED REGRESSION, CI, AND DEPLOYED RUNTIME SECURITY LOGGING VERIFIED**

## A10 – Server-Side Request Forgery

### Assessment

A final code-level review of the backend external-integration boundaries did not identify generic application functionality that accepts an arbitrary normal-user URL and performs an unrestricted server-side HTTP request to that destination.

Verified provider boundaries include:

- **Google Gemini** – requests use the backend-controlled Google Generative Language API endpoint; the model comes from backend configuration rather than a user-supplied destination.

- **PayHere checkout** – the checkout URL is selected from backend configuration according to the approved sandbox/live mode.

- **PayHere retrieval** – the adapter selects only the approved PayHere sandbox or live host, encodes the provider order reference, rejects redirects, and bounds the response size.

- **Cloudinary** – provider access is configured through the backend-controlled Cloudinary SDK configuration and deployment credentials.

- **Notification / SMTP providers** – service destinations are deployment configuration, not arbitrary normal-user URL inputs.

No general-purpose user-controlled URL-fetch endpoint was identified.

### Decision

Generic SSRF allow-list middleware is **not** being added because the current system does not expose an arbitrary user-controlled server-side URL-fetch feature.

Adding such middleware without an applicable input would introduce unnecessary complexity and would not address a real current attack surface.

If future functionality introduces user-controlled external URLs, it must add explicit protocol validation, destination restrictions/allow-listing, and private-network protections before release.

### Status

**PASS / NOT APPLICABLE TO GENERIC ARBITRARY URL FETCHING**

The current external-provider boundaries are restricted by backend-controlled configuration or fixed provider hosts.

---

# 10. Secure Image Upload Assessment

Existing automated coverage includes:

- authentication requirement

- Branch Manager authorization

- rejection of unauthorized roles

- required image file

- MIME/type restrictions

- image magic-byte validation

- spoofed-content rejection

- maximum file-size enforcement

- Cloudinary failure handling

- provider-secret-safe error handling

Relevant tests:

- `tests/integration/inventory.imageUpload.test.js`

- `tests/unit/uploadImage.middleware.test.js`

### Status

**PASS IN FINAL BACKEND REGRESSION**

---

# 11. Payment Security Assessment

Existing payment tests cover:

- authenticated initiation

- customer ownership

- rejection of client-controlled financial fields

- PayHere notification verification

- forged/mismatched notification rejection

- duplicate notification handling

- exact replay idempotency

- amount/currency integrity

- concurrent success handling

- reconciliation-required states

- late success handling

- reservation-expiry behaviour

- protection against unauthorized state transitions

DDP-101 additionally introduced an immutable order-address snapshot used by payment initiation.

### Status

**PASS IN FINAL BACKEND REGRESSION**

---

# 12. Clinical Data Protection Assessment

Existing prescription integration tests cover:

- authenticated Optometrist creation

- customer ownership

- cross-customer access rejection

- rejection of unauthorized roles

- immutable correction history

- absence of internal password/staff fields

- safe clinical validation errors

- prevention of clinical-data leakage through logs

### Status

**PASS IN FINAL BACKEND REGRESSION**

---

# 13. Frontend Security Assessment

Frontend DDP-085 remediation was completed through frontend PR #68 and merged into `develop`.

Final synchronized frontend verification recorded:

- **110 / 110 test files passed**

- **1341 / 1341 tests passed**

- statements coverage: **88.05%**

- branch coverage: **81.80%**

- function coverage: **90.95%**

- line coverage: **88.86%**

- ESLint passed

- Prettier passed

- production build passed

- dependency audit: **0 Critical / 0 High**

- 2 Moderate React Router advisories remain and are documented as residual dependency risk because the available automatic remediation requires a breaking major-version upgrade.

Frontend security verification covered:

- public Vite environment variables

- absence of checked private keys/secrets in deployed browser bundles

- protected navigation

- safe rendering of untrusted content

- authentication/logout/session handling

- password-reset token handling

- payment-state integrity and provider response validation

- safe error presentation

- dependency security

- production build integrity

Pre-merge deployed verification confirmed:

- frontend HTTPS access

- HSTS

- SPA deep-route rewriting

- production Vercel origin accepted by Render CORS

- unauthorized preview origin not allowlisted

- deployed frontend bundle uses the configured Render API base URL

- checked localhost/loopback values and backend secret identifiers were absent from the deployed frontend bundle

Post-merge production verification additionally confirmed:

- HTTP 200 from `https://darshana-opticals.vercel.app`;

- HSTS `max-age=63072000; includeSubDomains; preload`;

- `X-Content-Type-Options: nosniff`;

- `X-Frame-Options: DENY`;

- `Referrer-Policy: no-referrer`;

- restrictive `Permissions-Policy`;

- Content Security Policy with `frame-ancestors 'none'`, `object-src 'none'`, and `base-uri 'self'`;

- approved production Vercel origin accepted by Render CORS;

- `Access-Control-Allow-Credentials: true`;

- Customer login through the deployed frontend;

- authenticated Customer functionality loading successfully;

- authenticated state remaining valid after refresh;

- logout returning to the unauthenticated state.

Backend authorization remains authoritative.

The existing browser-side JWT `localStorage` design remains a documented residual design consideration; DDP-085 did not redesign the authentication architecture.

### Status

**PASS – FRONTEND PR #68 MERGED; LOCAL SECURITY VERIFICATION AND POST-MERGE DEPLOYED INTEGRATION VERIFIED**

# 14. Final Verification Status

Backend PR #108 has been approved and merged into `develop`.

The accepted DDP-085 revision was deployed successfully to the Render staging backend and targeted post-deployment verification was completed.

Verified after deployment:

- Render backend `/api/health` returned HTTP 200 with `status: ok`.

- HTTPS transport was confirmed.

- HSTS was enabled.

- `X-Content-Type-Options`, `X-Frame-Options`, and Content Security Policy headers were present.

- Invalid authentication returned HTTP 401 with the generic `Invalid email or password.` response.

- Five consecutive invalid login attempts triggered the account-level lockout.

- A correct password was rejected while the account remained locked.

- The same correct credentials authenticated successfully after the 15-minute lockout expired.

- Production Vercel frontend login succeeded against the deployed backend.

- Authenticated Customer functionality loaded correctly.

- Authenticated state remained valid after refresh.

- Logout completed successfully.

- Production Vercel security headers were verified, including HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and Content Security Policy.

- The exact production Vercel origin `https://darshana-opticals.vercel.app` was accepted by Render CORS.

- Credentialed CORS support returned `Access-Control-Allow-Credentials: true`.

Frontend DDP-085 PR #68 has also been merged and its final local and deployed integration evidence is recorded in Section 13.

### Post-Deployment Security Verification Completion

The final Render runtime authentication-security log verification has now been completed.

The deployed logs confirmed:

- `[SecurityAuth] LOGIN_FAILED`;
- `[SecurityAuth] LOGIN_BLOCKED_LOCKED`;
- `[SecurityAccess] AUTHENTICATION_REJECTED`;
- no passwords in the verified authentication-security entries;
- no JWT/access-token values;
- no sensitive credentials;
- no unnecessary Customer data.

The planned frontend and backend post-deployment DDP-085 security verification is therefore complete.

No additional manual repetition of the completed backend or frontend automated suites is required.

### Final Documentation Status

The final OWASP compliance checklist has been prepared for contribution to the `documents` repository at:

`security/owasp-checklist.pdf`

The verified A04 security-design and threat-risk findings are tracked under DDP-088 for incorporation into the final SDS.

The remaining workflow activity is limited to peer-review completion, publication of the prepared OWASP evidence through the `documents` repository, and final DDP-085 release sign-off.

# 15. Security Release Gate

DDP-085 must not be marked complete until:

- no unresolved Critical security vulnerability exists

- no unresolved High security vulnerability exists without formal authorized disposition

- final security-critical regression tests pass

- authorization controls are verified against the final integrated backend

- dependency scans are completed against the verified backend and frontend baselines

- final CI passes for the accumulated backend DDP-085 commits

- staging HTTPS/TLS and security configuration are safely verified

- staging runtime errors/logging are verified not to expose sensitive data

- residual Moderate dependency risks are documented

- frontend security verification is complete

- required OWASP A01–A10 evidence is complete

- A04 design-risk/threat-model findings are handed off to DDP-088 for final SDS incorporation

- OWASP evidence is prepared for the final project documentation

- security-related PRs receive peer review

- all relevant CI security gates pass

Current evidence satisfies the following gate items:

- historical DDP-085 implementation baseline: **118 / 118 suites and 2075 / 2075 tests passed**;

- Backend CI run #501: **success**;

- latest documentation-PR verification: **118 / 118 suites and 2076 / 2076 tests passed**;

- Backend CI run #517: **success**;

- latest CI dependency gate: **0 Critical / 0 High**;

- backend dependency result: **0 Critical / 0 High / 2 Moderate**;

- backend PR #108: **approved and merged**;

- accepted backend security revision: **deployed to Render**;

- deployed HTTPS, HSTS, security-header, safe-error, account-lockout, recovery, and approved-origin CORS verification: **passed**;

- frontend PR #68: **merged**;

- frontend final local verification: **110 / 110 test files and 1341 / 1341 tests passed**;

- frontend dependency gate: **0 Critical / 0 High**, with 2 documented Moderate React Router advisories;

- production Vercel security-header verification: **passed**;

- final deployed frontend/backend login, authenticated refresh, and logout integration verification: **passed**.

- deployed Render authentication-security logging verification: **passed**, including `LOGIN_FAILED`, `LOGIN_BLOCKED_LOCKED`, and privacy-safe authentication rejection logging;

Remaining release workflow:

- final peer approval of this documentation PR;

- contribution and review of the prepared OWASP compliance checklist in the `documents` repository;

- final DDP-085 release sign-off.

Related documentation follow-up:

- DDP-088 incorporates the verified A04 design-risk and threat-model findings into the final SDS.

# 16. Current Overall Status

**DDP-085: SECURITY VERIFICATION COMPLETE – FINAL REVIEW / DOCUMENTATION PUBLICATION IN PROGRESS**

Completed so far:

- backend dependency security scan

- identification of 2 High and 5 Moderate dependency vulnerabilities at the initial baseline

- remediation of identified High dependency vulnerabilities

- backend dependency-fix commit `f7f56eb`

- backend dependency retest showing 0 Critical and 0 High at the tested baseline

- documentation of residual Moderate dependency risk `SEC-002`

- reproducible npm lockfile repair and successful branch CI at `33d12b0`

- synchronization with the merged DDP-101 backend changes

- synchronization with merged DDP-086 / PR #107 security-adjacent runtime changes

- post-merge targeted security/authentication/password-reset regression: **3 suites / 52 tests passed**

- account-lockout gap `SEC-003` remediated

- initial account-lockout commit `88b1adc`

- account-lockout concurrency fixes `00c2a7a` and `7afbeb0`

- account-lockout/auth/security verification: **4 suites / 40 tests passed**

- privacy-safe authentication event logging implemented in `a7df245`

- privacy-safe 401/403 access-control rejection logging implemented in `393da00`

- post-hardening A07/A09/RBAC/error-handler verification: **8 suites / 82 tests passed**

- latest final backend regression: **118 / 118 suites and 2075 / 2075 tests passed**

- recorded backend coverage evidence: **92.33% statements / 81.68% branches / 97.86% functions / 93% lines**

- final backend dependency audit: **0 Critical / 0 High / 2 Moderate** residual vulnerabilities through `exceljs -> uuid`

- lint verification

- format verification

- database security foundation test

- 21-test backend security integration suite

- review of existing authorization, authentication, clinical, payment, upload, logging, sanitizer, and integrity coverage

- A04 design-risk and mitigation assessment completed

- final A04 SDS integration correctly assigned to existing DDP-088 / `documents#47` rather than duplicated

- A10 external-request/SSRF boundary review completed

- A07 automated verification passed after SEC-003 remediation and concurrency fixes

- A09 code and automated verification passed after privacy-safe authentication and access-rejection logging

- backend PR #108 received final approving peer review

- Backend CI run #501 completed successfully

- latest documentation PR verification: **118 / 118 suites and 2076 / 2076 tests passed**

- Backend CI run #517 completed successfully

- backend PR #108 merged into `develop` at merge commit `0881662`

- accepted DDP-085 backend revision deployed successfully to Render

- deployed Render `/api/health` HTTPS check passed

- deployed HSTS and security-header verification passed

- deployed unapproved-origin CORS rejection check passed

- deployed missing-authentication and invalid-JWT rejection checks passed

- deployed safe 404 and malformed-JSON error checks passed

- deployed privileged-field validation checks passed for login and public registration

- deployed authentication limiter observed as 10 requests per 180 seconds

- deployed generic authentication-error verification passed

- deployed account-lockout lifecycle verification passed

- post-lockout authentication recovery verification passed

- frontend PR #68 merged into `develop`

- frontend final verification: **110 / 110 test files and 1341 / 1341 tests passed**

- frontend coverage recorded as **88.05% statements / 81.80% branches / 90.95% functions / 88.86% lines**

- frontend dependency verification: **0 Critical / 0 High**, with 2 documented Moderate React Router advisories

- production Vercel security-header verification passed

- approved production Vercel origin CORS verification passed

- deployed frontend/backend login, authenticated refresh, and logout integration verification passed

- deployed Render authentication-security log verification passed, including `LOGIN_FAILED`, `LOGIN_BLOCKED_LOCKED`, and `AUTHENTICATION_REJECTED`, with no passwords, JWT/access-token values, sensitive credentials, or unnecessary Customer data exposed in the verified entries

- final OWASP compliance checklist prepared for contribution to the `documents` repository

Final workflow actions:

- resolve the remaining PR #110 review comments and obtain final peer approval;

- contribute the prepared OWASP compliance checklist to the `documents` repository;

- complete final DDP-085 release sign-off.

Related documentation follow-up:

- DDP-088 will incorporate the verified A04 security-design and threat-risk findings into the final SDS.
