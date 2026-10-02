const swaggerSpec = require('../../src/config/swagger');

describe('Swagger documentation integrity', () => {
  const expectedOperations = [
    'GET /health',
    'POST /auth/register',
    'POST /auth/login',
    'GET /profile/me',
    'PATCH /profile/me',
    'GET /products',
    'GET /products/{id}',
    'POST /prescriptions',
    'GET /prescriptions/me',
    'GET /prescriptions/customer/{customerId}',
    'POST /inventory',
    'GET /inventory/branch/{branchId}',
    'PATCH /inventory/{id}',
    'PATCH /inventory/{id}/quantity',
  ];

  const normalize = (value) => value.toUpperCase();

  it('should define OpenAPI 3.0 and represent the real backend API surface', () => {
    expect(swaggerSpec.openapi).toBe('3.0.0');

    const actualOperations = [];
    for (const [path, item] of Object.entries(swaggerSpec.paths || {})) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head']) {
        if (item[method]) {
          actualOperations.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    expect(actualOperations).toHaveLength(expectedOperations.length);
    expect(new Set(actualOperations)).toEqual(new Set(expectedOperations));
  });

  it('should include the missing login endpoint and not expose fake routes', () => {
    expect(swaggerSpec.paths['/auth/login']).toBeDefined();
    expect(swaggerSpec.paths['/auth/login'].post).toBeDefined();
    expect(swaggerSpec.paths['/auth/login'].post.summary).toBeDefined();

    const operationKeys = Object.keys(swaggerSpec.paths || {}).flatMap((path) =>
      Object.keys(swaggerSpec.paths[path]).map((method) => `${normalize(method)} ${path}`)
    );

    expect(operationKeys).toHaveLength(expectedOperations.length);
    expect(operationKeys).toEqual(expect.arrayContaining(expectedOperations));
    expect(operationKeys).not.toEqual(expect.arrayContaining(['GET /auth/login']));
  });

  it('should mark public routes without bearerAuth and protected routes with bearerAuth', () => {
    const publicPaths = ['/health', '/auth/register', '/auth/login', '/products', '/products/{id}'];
    const protectedPaths = [
      '/profile/me',
      '/inventory',
      '/inventory/branch/{branchId}',
      '/inventory/{id}',
      '/inventory/{id}/quantity',
      '/prescriptions',
      '/prescriptions/me',
      '/prescriptions/customer/{customerId}',
    ];

    for (const path of publicPaths) {
      for (const method of Object.keys(swaggerSpec.paths[path] || {})) {
        expect(swaggerSpec.paths[path][method].security).toBeUndefined();
      }
    }

    for (const path of protectedPaths) {
      for (const method of Object.keys(swaggerSpec.paths[path] || {})) {
        expect(swaggerSpec.paths[path][method].security).toEqual([{ bearerAuth: [] }]);
      }
    }
  });

  it('should expose shared schemas and error contract components', () => {
    expect(swaggerSpec.components.schemas).toBeDefined();
    for (const schemaName of [
      'ErrorResponse',
      'ValidationErrorResponse',
      'CustomerProfile',
      'AuthenticatedUser',
      'LoginResponse',
      'Product',
      'InventoryItem',
      'LoginRequest',
      'RegisterRequest',
    ]) {
      expect(swaggerSpec.components.schemas[schemaName]).toBeDefined();
    }
    expect(swaggerSpec.components.responses.ValidationError).toBeDefined();
    expect(swaggerSpec.components.responses.Unauthorized).toBeDefined();
    expect(swaggerSpec.components.responses.NotFound).toBeDefined();
  });

  it('should describe the real health response without a success wrapper', () => {
    const healthSchema =
      swaggerSpec.paths['/health'].get.responses['200'].content['application/json'].schema;
    expect(healthSchema.properties.status.example).toBe('ok');
    expect(healthSchema.properties.service.example).toBe('osms-backend');
    expect(healthSchema.properties.success).toBeUndefined();
  });

  it('should document registration as 422 and email-based conflict handling', () => {
    const registerDoc = swaggerSpec.paths['/auth/register'].post;
    expect(registerDoc.responses['422']).toBeDefined();
    expect(registerDoc.responses['400']).toBeUndefined();
    expect(registerDoc.description).toMatch(/email/i);
  });
});
