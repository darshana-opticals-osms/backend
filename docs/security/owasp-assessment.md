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

The DDP-085 branch was synchronized with backend `develop` after DDP-101 was merged.

Relevant branch history:

- `f7f56eb` – `fix(security): remediate vulnerable backend dependencies`
- `1a3f864` – merged DDP-101 order-address snapshot changes from backend `develop`
- `06c5a38` – synchronized DDP-085 branch with latest merged backend baseline at that stage

Backend PR #107 / DDP-086 Performance and Reliability Testing remains relevant to the final security baseline because it includes security-adjacent runtime changes such as authentication rate-limiter configuration and reverse-proxy handling.

Therefore, final full regression and final security sign-off must be performed after the required backend changes are merged.

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

**Residual Moderate risk – documented and accepted for further review.**

This finding is not being treated as silently resolved.

Final dependency scanning must confirm that no newer safe compatible remediation becomes available before release.

---

## 6. MongoDB Security-Test Environment

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

## 7. Existing Security Integration Suite

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

# 8. OWASP Top 10 Assessment

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
- final deployed HTTPS verification
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

Existing automated coverage was identified for critical business boundaries including:

- checkout authority
- inventory reservation
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

**PARTIAL / DESIGN CONTROLS IDENTIFIED**

Final integrated regression execution is pending.

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

Because the project now uses a production-only final deployment approach, old staging-specific wording in DDP-085 is no longer treated as the current deployment plan.

Final safe deployed verification must include:

- HTTPS
- production CORS
- production security headers
- environment configuration
- error exposure
- secret handling
- externally visible API configuration

No destructive security testing will be performed against production.

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

`SEC-001` remediated the High findings.

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

### Executed Verification

The security integration suite verified:

- safe failed-login response
- account-existence information is not disclosed
- authentication rate limiting is active

The RBAC test suite contains coverage for:

- missing JWT
- malformed token
- invalid token
- expired JWT

Password-reset integration tests contain coverage for:

- generic anti-enumeration responses
- hashed reset-token storage
- reset-token expiry
- token replacement
- single use
- already-used-token rejection
- invalid-token rejection
- concurrent-reset protection

### Pending

The complete authentication and password-reset regression set must be rerun after the final backend baseline is established.

PR #107 is security-relevant because it includes authentication rate-limiter changes.

### Status

**PARTIAL**

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

### Controls Identified

Existing tests verify or inspect:

- sanitized production error logging
- audit records for important business operations
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

### Pending

Final consolidated logging/audit regression execution.

### Status

**PARTIAL**

---

## A10 – Server-Side Request Forgery

### Assessment

A review of backend external-integration boundaries did not identify generic application functionality that accepts an arbitrary user-provided URL and performs an unrestricted server-side HTTP request to that destination.

No general-purpose URL fetch endpoint was identified.

External integrations use application-controlled configuration/provider boundaries rather than exposing an arbitrary server-side destination supplied directly by normal application users.

### Decision

Generic SSRF destination allow-listing is not being added because there is currently no identified arbitrary user-controlled server-side URL-fetch feature that requires such a control.

### Status

**NOT APPLICABLE to generic arbitrary URL fetching, subject to final external-integration review.**

---

# 9. Secure Image Upload Assessment

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

# 10. Payment Security Assessment

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

# 11. Clinical Data Protection Assessment

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

# 12. Frontend Security Assessment

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

Backend authorization remains authoritative.

### Status

**PARTIAL – DRAFT PR #68 REMAINS OPEN**

---

# 13. Final Verification Still Required

The following checks are deliberately not being claimed as final yet:

- sync DDP-085 branch after all required backend PRs merge
- rerun backend dependency audit
- rerun A01 authorization test batch
- rerun authentication/password-reset tests
- rerun injection/sanitizer tests
- rerun payment security tests
- rerun clinical-data tests
- rerun image-upload tests
- rerun audit/logging tests
- run full backend regression suite
- run ESLint
- run Prettier
- verify Git diff/whitespace
- verify final CI result
- perform safe production HTTPS/CORS/security-header/configuration checks
- rerun final frontend dependency/security checks
- update frontend Draft PR #68 to reflect the production-only deployment strategy
- prepare final OWASP compliance checklist in the `documents` repository

---

# 14. Security Release Gate

DDP-085 must not be marked complete until:

- no unresolved Critical security vulnerability exists
- no unresolved High security vulnerability exists without formal authorized disposition
- final security-critical regression tests pass
- authorization controls are verified against the final integrated backend
- dependency scans are repeated against the final lockfiles
- production configuration is safely verified
- residual Moderate risks are documented
- frontend security verification is complete
- OWASP evidence is prepared for the final project documentation
- security-related PRs receive peer review

---

# 15. Current Overall Status

**DDP-085: IN PROGRESS**

Completed so far:

- backend dependency security scan
- remediation of identified High dependency vulnerabilities
- dependency-fix commit
- lint verification
- format verification
- database security foundation test
- 21-test backend security integration suite
- review of existing authorization, authentication, clinical, payment, upload, logging, sanitizer, and integrity coverage
- initial SSRF applicability assessment
- synchronization with merged DDP-101 backend changes

Still pending:

- final backend baseline after remaining relevant PR merges
- full targeted OWASP regression execution
- full backend regression
- final frontend verification
- safe production security verification
- final OWASP evidence and release sign-off
