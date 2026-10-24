# DDP-085 – Backend OWASP Top 10 Security Assessment

## 1. Assessment Information

- **Issue:** DDP-085 – OWASP Top 10 Compliance Verification and Security Hardening
- **Repository:** `darshana-opticals-osms/backend`
- **Security branch:** `test/91-owasp-security-verification`
- **Target branch:** `develop`
- **Assessment type:** Backend security verification and targeted hardening
- **Approach:** Verify existing controls first, identify real security gaps, apply minimum targeted fixes, run regression tests, and document reproducible evidence.

This document is a working security-assessment record. Final release verification must be repeated after all relevant backend changes are merged into `develop`.

---

## 2. Current Assessment Baseline

The DDP-085 branch has been synchronized with backend `develop` through the merged DDP-101 and DDP-086 / PR #107 baselines.

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

Backend PR #107 / DDP-086 Performance and Reliability Testing has now been merged into `develop` at commit `5c1e20e`.

Security-relevant changes from that merged baseline include:

- `skipSuccessfulRequests: true` for the authentication rate limiter;
- Express `trust proxy` configuration for reverse-proxy client-IP handling;
- performance-related model/index updates that must remain compatible with authorization, transaction, and audit controls.

After synchronizing with the merged PR #107 baseline, targeted security/authentication/password-reset regression verification passed:

- **3 suites passed**
- **52 tests passed**
- **0 failed**

The final local backend regression and dependency audit are complete. CI verification for the accumulated DDP-085 security commits and staging-dependent checks remain required before release sign-off.

---

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

The dependency scan must be repeated during final verification after all relevant backend changes are merged.

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

**Residual Moderate risk – documented pending final review.**

This finding is not being treated as silently resolved.

Final dependency scanning must confirm that no newer safe compatible remediation becomes available before release.

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

### Fix Reference

Commit:

`88b1adc – fix(security): implement account login lockout`

### Regression Evidence

Focused validation after implementation passed:

- account-lockout integration tests
- authentication login integration tests
- security integration tests
- authentication service unit tests

Result:

- **4 suites passed**
- **40 tests passed**
- **0 failed**

Additional post-hardening verification covering authentication, lockout, access-control rejection logging, RBAC, branch authorization, centralized error handling, and the security suite later passed:

- **8 suites passed**
- **82 tests passed**
- **0 failed**

### Current Status

**RESOLVED LOCALLY**

A07 is no longer blocked by SEC-003.

Final CI verification and staging/integrated verification remain required before final release sign-off.

---

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

### Current Status

**PARTIAL / COVERAGE IDENTIFIED**

The relevant automated coverage has been reviewed, but the complete A01 batch has not yet been rerun against the final backend release baseline.

### Remaining Work

Run the complete authorization/security regression set after all required backend PRs are merged.

---

## A02 – Cryptographic Failures

### Verified

- bcrypt password hashing is used.
- bcrypt configured cost requirement was verified by automated test.
- authentication error responses do not expose password hashes.
- configuration loads JWT secrets from environment configuration.
- password-reset implementation has existing tests for hashed reset-token storage and expiry.
- database connection failures do not expose credentials.

### Pending

- final password-reset security regression execution
- final staging HTTPS/TLS verification
- final runtime secret configuration verification

### Status

**PARTIAL**

---

## A03 – Injection

### Verified

The executed security suite confirmed rejection of a representative MongoDB operator injection payload.

Existing sanitizer tests also cover:

- removal of MongoDB operator keys
- dot-notation operator keys
- recursive sanitization
- script-tag stripping

Input-validation tests exist across authentication, prescriptions, payments, reports, inventory, appointments, administration, and chatbot functionality.

### Remaining Work

Execute the relevant input/sanitizer regression suites against the final backend baseline.

### Status

**PARTIAL**

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

**PARTIAL – DESIGN RISKS/MITIGATIONS ASSESSED LOCALLY; FINAL SDS THREAT-MODEL DOCUMENTATION PENDING DDP-088**

No additional backend architecture change is currently required for A04.

The final SDS owner must incorporate the verified DDP-085 security findings, including the explicit threat-model/design-risk documentation required by the development guideline.

---

## A05 – Security Misconfiguration

### Verified Locally

- Helmet security headers
- CORS restrictions
- production-safe error responses
- request-body limits
- environment-secret exclusion
- environment-driven security values

### Pending Deployment Verification

The SENG 34213 guideline requires the integrated `develop` branch to be deployed to a staging environment before release.

Final deployed security verification for DDP-085 must therefore be performed against the approved staging deployment before the release is promoted to `main`.

Final safe deployed verification must include:

- HTTPS/TLS
- staging CORS configuration
- staging security headers
- environment configuration
- error exposure
- secret handling
- externally visible API configuration

No destructive or aggressive security testing will be performed against staging or production. Adversarial or potentially disruptive testing remains restricted to controlled local/test environments.

### Status

**PARTIAL**

---

## A06 – Vulnerable and Outdated Components

### Backend

Initial:

- 2 High
- 5 Moderate

After safe remediation:

- 0 Critical
- 0 High
- 2 Moderate

`SEC-001` remediated the identified High findings.

`SEC-002` records the remaining transitive Moderate `uuid` risk.

### Frontend

The separate frontend DDP-085 branch has Draft PR #68:

`[DDP-085] fix(security): remediate frontend dependency vulnerabilities`

Previously recorded frontend validation reported:

- 0 Critical
- 0 High
- 2 Moderate React Router advisories

The available automatic remediation requires a breaking React Router major upgrade and was intentionally not force-applied.

### Current Status

**PASS for known High/Critical dependency gate at the verified baseline, with documented Moderate residual risks.**

Final dependency scans are still required before release sign-off.

---

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

Relevant commit:

`88b1adc – fix(security): implement account login lockout`

Focused lockout/authentication/security verification passed:

- **4 suites**
- **40 tests**
- **0 failed**

Post-hardening A09/A07/RBAC verification also passed:

- **8 suites**
- **82 tests**
- **0 failed**

### Status

**PASS LOCALLY**

Final CI verification and deployed staging verification remain pending before final release sign-off.

---

## A08 – Software and Data Integrity Failures

### Controls Identified

- committed npm lockfile
- reproducible dependency installation
- GitHub pull-request workflow
- PayHere provider verification
- payment replay/idempotency controls
- transaction-backed business operations
- immutable audit-trail architecture
- security remediation associated with a specific commit

### Relevant Security Commit

`f7f56eb`

### Pending

- final CI verification
- final branch protection/review evidence
- final release-commit traceability
- final payment/integrity regression

### Status

**PARTIAL**

---

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

Authentication security logs do not include:

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

### Status

**PASS LOCALLY**

Final full audit/logging regression and staging/runtime verification remain required before final release sign-off.

---

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

**COVERAGE IDENTIFIED – FINAL EXECUTION PENDING**

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

**COVERAGE IDENTIFIED – FINAL EXECUTION PENDING**

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

**COVERAGE IDENTIFIED – FINAL EXECUTION PENDING**

---

# 13. Frontend Security Assessment

Frontend security remediation is tracked separately through frontend Draft PR #68.

Previously verified frontend results:

- frontend tests passed
- ESLint passed
- Prettier passed
- production build passed
- 0 High dependency vulnerabilities
- 0 Critical dependency vulnerabilities
- 2 Moderate React Router advisories remain

Frontend final verification must include:

- public Vite environment variables
- absence of private keys/secrets in browser bundles
- protected navigation
- safe rendering of untrusted content
- appropriate client-side persistence
- safe error presentation
- final dependency audit against the integrated frontend baseline
- staging integration verification before final release

Backend authorization remains authoritative.

### Status

**PARTIAL – DRAFT PR #68 REMAINS OPEN**

---

# 14. Final Verification Still Required

Local backend verification is complete. Remaining work is deployment and release evidence:

- push the accumulated DDP-085 backend commits and verify the final CI result
- perform safe staging HTTPS/CORS/security-header/configuration checks
- verify staging runtime error/logging behaviour
- rerun final frontend dependency/security checks
- update frontend Draft PR #68 after staging-dependent verification
- verify final frontend/backend integration on staging
- provide the verified A04 security-design/threat-model findings to DDP-088 for final SDS integration
- prepare the final OWASP compliance checklist in the `documents` repository

---

# 15. Security Release Gate

DDP-085 must not be marked complete until:

- no unresolved Critical security vulnerability exists
- no unresolved High security vulnerability exists without formal authorized disposition
- final security-critical regression tests pass
- authorization controls are verified against the final integrated backend
- dependency scans are repeated against the final backend and frontend lockfiles
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

---

# 16. Current Overall Status

**DDP-085: IN PROGRESS**

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
- account-lockout commit `88b1adc`
- account-lockout/auth/security verification: **4 suites / 40 tests passed**
- privacy-safe authentication event logging implemented in `a7df245`
- privacy-safe 401/403 access-control rejection logging implemented in `393da00`
- post-hardening A07/A09/RBAC/error-handler verification: **8 suites / 82 tests passed**
- final backend regression with coverage: **118 suites / 2072 tests passed**
- final coverage: **92.33% statements / 81.68% branches / 93% lines**
- final dependency audit: **0 Critical / 0 High / 2 Moderate** residual vulnerabilities through exceljs -> uuid
- lint verification
- format verification
- database security foundation test
- 21-test backend security integration suite
- review of existing authorization, authentication, clinical, payment, upload, logging, sanitizer, and integrity coverage
- A04 design-risk and mitigation assessment completed locally
- final A04 SDS integration correctly assigned to existing DDP-088 / `documents#47` rather than duplicated
- A10 external-request/SSRF boundary review completed
- A07 marked locally passing after SEC-003 remediation
- A09 marked locally passing after privacy-safe authentication and access-rejection logging

Still pending:

- push accumulated backend security commits
- final backend CI verification
- final frontend verification
- safe staging security verification
- final staging frontend/backend security smoke
- DDP-088 final SDS incorporation of verified A04 security-design/threat-model findings
- final OWASP compliance evidence in the `documents` repository
- peer review and final DDP-085 release sign-off
