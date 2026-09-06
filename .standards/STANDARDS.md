# Project Coding and Testing Standards (SENG 34213)

## 5. Coding Standards

### 5.1 Core Principles

All code produced in SENG 34213 must strictly adhere to the following principles:

1. **SOLID Principles**
   - **Single Responsibility**: Each module, class, or function must have one concise responsibility.
   - **Open/Closed**: Software entities should be open for extension, but closed for modification.
   - **Liskov Substitution**: Subclasses must be substitutable for their base classes (`AppError` hierarchy).
   - **Interface Segregation**: Keep functions and middleware interfaces focused and minimal.
   - **Dependency Inversion**: Depend on abstractions, not concrete implementations.

2. **DRY (Don’t Repeat Yourself)**
   - Avoid code duplication across controllers, services, and middleware.
   - Extract shared logic into reusable utilities, errors, or middleware.

3. **YAGNI (You Aren’t Gonna Need It)**
   - Implement only what is explicitly required by the current sprint’s user stories and acceptance criteria.
   - Avoid over-engineering or premature optimization.

4. **Clean Code**
   - Meaningful, self-describing variable and function names.
   - Small, single-purpose functions.
   - Minimal side effects.
   - No magic numbers (use named status codes or error constants).

---

## 6. Testing Standards

### 6.1 Testing Philosophy

- **Testing as Professional Practice**: Code without tests is considered unfinished. Tests are a mandatory part of the Definition of Done for every issue.
- **Coverage & Quality**: Test quality and coverage are explicitly evaluated.

### 6.2 Test Pyramid

| Layer                 | Scope                                          | Speed             | Min. Coverage Target                  |
| :-------------------- | :--------------------------------------------- | :---------------- | :------------------------------------ |
| **Unit Tests**        | Single function or class in isolation          | Very fast (<1 ms) | 80% of all new code                   |
| **Integration Tests** | Module-to-module or service-to-DB interactions | Moderate          | All API endpoints                     |
| **End-to-End (E2E)**  | Full user journey through UI and backend       | Slow              | All happy paths; top 3 critical flows |

### 6.3 Writing Professional Test Cases

#### 6.3.1 Unit Test Standards

- Unit tests must follow the **Arrange-Act-Assert (AAA)** pattern.
- Use **Given-When-Then** descriptive test naming conventions (e.g., `it('should return new token pair given a valid refresh token')`).
- Mock dependencies (repositories, external services) appropriately.

#### 6.3.2 Integration Test Standards

- Integration tests exercise real HTTP endpoints against a test environment/database using `supertest`.
- Use `beforeEach` to seed known test data and `afterEach` to clean/rollback data between test runs.
- Verify exact HTTP status codes, error payload contracts, and database side effects.
