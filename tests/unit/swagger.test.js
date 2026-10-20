const swaggerSpec = require('../../src/config/swagger');

describe('Swagger documentation integrity', () => {
  it('documents callback metadata, abuse control and operational payment unavailability', () => {
    const notify = swaggerSpec.paths['/payments/notify'].post;
    const schema = notify.requestBody.content['application/x-www-form-urlencoded'].schema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.captured_amount.type).toBe('string');
    expect(schema.required).not.toContain('captured_amount');
    expect(schema.properties.recurring.type).toBe('string');
    expect(schema.required).not.toContain('recurring');
    expect(notify.responses['429'].headers['Retry-After']).toBeDefined();
    for (const path of ['/payments/initiate', '/payments/notify']) {
      expect(swaggerSpec.paths[path].post.responses['503'].$ref).toBe(
        '#/components/responses/PaymentUnavailable'
      );
    }
    expect(
      swaggerSpec.components.responses.PaymentUnavailable.content['application/json'].example.error
        .code
    ).toBe('PAYMENT_UNAVAILABLE');
  });
  it('documents retrieval evidence as nonblocking while preserving signed-IPN authority', () => {
    const recovery = swaggerSpec.paths['/payments/{paymentId}/recovery'].post;
    expect(recovery.description).toMatch(/without setting a blocking flag/);
    expect(recovery.description).toMatch(/Existing holds are never cleared/);
    expect(recovery.description).toMatch(/replays recheck current state/);
    expect(recovery.description).toMatch(/ADR-011 requires IPN for completion/);
    expect(
      swaggerSpec.components.schemas.PaymentRetrievalEvidence.properties.reconciliationReason
        .description
    ).toMatch(/not the current Payment blocking flag/);
  });
  const expectedOperations = [
    'GET /health',
    'POST /auth/register',
    'POST /auth/login',
    'POST /auth/forgot-password',
    'POST /auth/reset-password',
    'POST /admin/staff',
    'GET /admin/staff',
    'GET /admin/staff/{id}',
    'PATCH /admin/staff/{id}',
    'PATCH /admin/staff/{id}/role',
    'PATCH /admin/staff/{id}/branch',
    'PATCH /admin/staff/{id}/status',
    'GET /admin/doctors',
    'PATCH /admin/doctors/{id}',
    'PATCH /admin/doctors/{id}/status',
    'GET /profile/me',
    'PATCH /profile/me',
    'GET /products',
    'GET /products/{id}',
    'POST /prescriptions',
    'GET /prescriptions/me',
    'GET /prescriptions/customer/{customerId}',
    'POST /inventory',
    'POST /inventory/images',
    'GET /inventory/branch/{branchId}',
    'PATCH /inventory/{id}',
    'DELETE /inventory/{id}/image',
    'PATCH /inventory/{id}/quantity',
    'GET /inventory/reorder-alerts',
    'GET /inventory/reorder-alerts/branch/{branchId}',
    'GET /inventory/reorder-threshold',
    'PUT /inventory/reorder-threshold',
    'GET /branches',
    'POST /v1/chatbot/query',
    'GET /customers/lookup',
    'GET /cart',
    'POST /cart/items',
    'PATCH /cart/items/{inventoryId}',
    'DELETE /cart/items/{inventoryId}',
    'POST /checkout',
    'GET /orders',
    'GET /orders/{id}',
    'PATCH /orders/{id}/status',
    'PATCH /orders/{id}/claim',
    'POST /orders/{id}/claim',
    'POST /payments/initiate',
    'POST /payments/notify',
    'POST /payments/{paymentId}/recovery',
    'GET /payments/{paymentId}/retrieval-evidence',
    'GET /orders/{orderId}/payment-status',
    'GET /payments',
    'GET /payments/{paymentId}',
    'GET /payments/{paymentId}/events',
    'POST /payments/{paymentId}/refunds',
    'GET /appointments/providers',
    'GET /doctor-sessions/available',
    'POST /doctor-sessions',
    'GET /doctor-sessions',
    'PATCH /doctor-sessions/{id}',
    'POST /appointments',
    'GET /appointments',
    'GET /appointments/{id}',
    'PATCH /appointments/{id}/cancel',
    'PATCH /appointments/{id}/reassign',
    'POST /doctors',
    'GET /doctors',
    'GET /audit-events',
    'GET /loyalty/me',
    'GET /loyalty',
    'GET /reports/sales',
    'GET /reports/sales/orders',
    'GET /reports/sales/export',
    'GET /reports/inventory',
    'GET /reports/inventory/items',
    'GET /reports/inventory/export',
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
    const publicPaths = [
      '/health',
      '/auth/register',
      '/auth/login',
      '/auth/forgot-password',
      '/auth/reset-password',
      '/products',
      '/products/{id}',
      '/payments/notify',
    ];
    const protectedPaths = [
      '/payments/{paymentId}/recovery',
      '/payments/{paymentId}/retrieval-evidence',
      '/payments/{paymentId}/refunds',
      '/profile/me',
      '/admin/staff',
      '/admin/staff/{id}',
      '/admin/staff/{id}/role',
      '/admin/staff/{id}/branch',
      '/admin/staff/{id}/status',
      '/admin/doctors',
      '/admin/doctors/{id}',
      '/admin/doctors/{id}/status',
      '/inventory',
      '/inventory/images',
      '/inventory/branch/{branchId}',
      '/inventory/{id}',
      '/inventory/{id}/image',
      '/inventory/{id}/quantity',
      '/inventory/reorder-alerts',
      '/inventory/reorder-alerts/branch/{branchId}',
      '/inventory/reorder-threshold',
      '/prescriptions',
      '/prescriptions/me',
      '/prescriptions/customer/{customerId}',
      '/branches',
      '/v1/chatbot/query',
      '/customers/lookup',
      '/cart',
      '/cart/items',
      '/cart/items/{inventoryId}',
      '/checkout',
      '/orders',
      '/orders/{id}',
      '/orders/{id}/status',
      '/payments/initiate',
      '/orders/{orderId}/payment-status',
      '/appointments/providers',
      '/doctor-sessions/available',
      '/doctor-sessions',
      '/doctor-sessions/{id}',
      '/appointments',
      '/appointments/{id}',
      '/appointments/{id}/cancel',
      '/appointments/{id}/reassign',
      '/doctors',
      '/audit-events',
      '/loyalty/me',
      '/loyalty',
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
      'CustomerLookupResult',
      'AuthenticatedUser',
      'LoginResponse',
      'Product',
      'InventoryItem',
      'InventoryImageUploadResponse',
      'BranchReference',
      'LoginRequest',
      'RegisterRequest',
      'StaffProvisioningRequest',
      'ProvisionedStaff',
      'StaffMember',
      'StaffPagination',
      'StaffListResponse',
      'StaffResponse',
      'StaffProfileUpdateRequest',
      'StaffRoleUpdateRequest',
      'StaffBranchUpdateRequest',
      'StaffStatusUpdateRequest',
      'AdminDoctor',
      'AdminDoctorListResponse',
      'AdminDoctorResponse',
      'DoctorUpdateRequest',
      'DoctorStatusUpdateRequest',
      'CartAddItemRequest',
      'CartQuantityRequest',
      'CartResponse',
      'CheckoutResult',
      'OrderStatusHistoryEntry',
      'OrderItem',
      'OrderSummary',
      'OrderDetail',
      'UpdateOrderStatusRequest',
      'AppointmentProvider',
      'AppointmentCustomerContact',
      'DoctorSession',
      'Appointment',
      'DoctorSessionCreateRequest',
      'DoctorSessionUpdateRequest',
      'AppointmentCreateRequest',
      'AppointmentReassignRequest',
      'AppointmentResponse',
      'DoctorSessionResponse',
      'AppointmentListResponse',
      'DoctorSessionListResponse',
      'ReorderAlert',
      'Doctor',
      'DoctorCreateRequest',
      'DoctorResponse',
      'DoctorListResponse',
      'ForgotPasswordRequest',
      'ResetPasswordRequest',
      'GenericMessageResponse',
      'LoyaltyTransaction',
      'LoyaltyPagination',
      'OwnLoyaltyData',
      'OwnLoyaltyResponse',
      'ManagementLoyaltyTransaction',
      'ManagementLoyaltyData',
      'ManagementLoyaltyResponse',
    ]) {
      expect(swaggerSpec.components.schemas[schemaName]).toBeDefined();
    }
    expect(swaggerSpec.components.responses.ValidationError).toBeDefined();
    expect(swaggerSpec.components.responses.Unauthorized).toBeDefined();
    expect(swaggerSpec.components.responses.NotFound).toBeDefined();
    expect(swaggerSpec.components.responses.TooManyRequests).toBeDefined();
  });

  it('documents the CUSTOMER-only own-loyalty read contract and safe DTO', () => {
    const operation = swaggerSpec.paths['/loyalty/me'].get;
    expect(Object.keys(swaggerSpec.paths['/loyalty/me'])).toEqual(['get']);
    expect(operation.tags).toEqual(['Loyalty']);
    expect(operation.security).toEqual([{ bearerAuth: [] }]);
    expect(operation.description).toMatch(/CUSTOMER only/);
    expect(operation.description).toMatch(/derived exclusively from the verified JWT/);
    expect(operation.description).toMatch(/read-only/);
    expect(operation.description).toMatch(/backend-authoritative/);
    expect(operation.description).toMatch(/cannot submit balances, awarded points/);
    expect(operation.description).toMatch(/Arbitrary adjustment is prohibited/);
    expect(operation.description).toMatch(
      /redemption and partial-refund processing are not available/
    );
    expect(operation.requestBody).toBeUndefined();
    expect(operation.responses).toEqual(
      expect.objectContaining({
        200: expect.any(Object),
        401: expect.any(Object),
        403: expect.any(Object),
        404: expect.any(Object),
        409: expect.any(Object),
        422: expect.any(Object),
        500: expect.any(Object),
      })
    );
    expect(operation.parameters[0].schema).toMatchObject({
      minimum: 1,
      maximum: 10000,
      default: 1,
    });
    expect(operation.parameters[1].schema).toMatchObject({ minimum: 1, maximum: 100, default: 25 });
    expect(operation.parameters.map((parameter) => parameter.name)).toEqual(['page', 'limit']);

    const transaction = swaggerSpec.components.schemas.LoyaltyTransaction;
    expect(transaction.additionalProperties).toBe(false);
    expect(Object.keys(transaction.properties)).toEqual([
      'id',
      'type',
      'pointsDelta',
      'balanceAfter',
      'orderId',
      'createdAt',
    ]);
    expect(transaction.properties.pointsDelta.type).toBe('string');
    expect(transaction.properties.balanceAfter.type).toBe('string');
    expect(swaggerSpec.components.schemas.OwnLoyaltyData.properties.balance).toMatchObject({
      type: 'string',
      pattern: '^\\d+\\.\\d{2}$',
    });
    for (const forbidden of [
      'customerId',
      'paymentId',
      'providerTransactionId',
      'sourceEventId',
      'earningTransactionId',
      '__v',
    ]) {
      expect(transaction.properties).not.toHaveProperty(forbidden);
    }
  });

  it('documents BRANCH_MANAGER-only loyalty monitoring with exact safe fields', () => {
    const operation = swaggerSpec.paths['/loyalty'].get;
    expect(Object.keys(swaggerSpec.paths['/loyalty'])).toEqual(['get']);
    expect(operation.tags).toEqual(['Loyalty']);
    expect(operation.security).toEqual([{ bearerAuth: [] }]);
    expect(operation.description).toMatch(/BRANCH_MANAGER only/);
    expect(operation.description).toMatch(/Read-only/);
    expect(operation.description).toMatch(/backend-authoritative/);
    expect(operation.description).toMatch(/cannot submit balances or awarded points/);
    expect(operation.description).toMatch(/arbitrary adjustment is prohibited/);
    expect(operation.description).toMatch(
      /redemption\s+and partial-refund processing are not available/
    );
    expect(operation.requestBody).toBeUndefined();
    expect(operation.responses).toEqual(
      expect.objectContaining({
        200: expect.any(Object),
        401: expect.any(Object),
        403: expect.any(Object),
        422: expect.any(Object),
        500: expect.any(Object),
      })
    );
    expect(operation.parameters.map((parameter) => parameter.name)).toEqual([
      'page',
      'limit',
      'customerId',
      'orderId',
      'paymentId',
      'eventType',
      'sortOrder',
    ]);
    expect(operation.parameters[0].schema).toMatchObject({
      minimum: 1,
      maximum: 10000,
      default: 1,
    });
    expect(operation.parameters[1].schema).toMatchObject({ minimum: 1, maximum: 100, default: 25 });

    const transaction = swaggerSpec.components.schemas.ManagementLoyaltyTransaction;
    expect(transaction.additionalProperties).toBe(false);
    expect(Object.keys(transaction.properties)).toEqual([
      'id',
      'customerId',
      'orderId',
      'paymentId',
      'type',
      'pointsDelta',
      'balanceAfter',
      'createdAt',
    ]);
    for (const forbidden of [
      'email',
      'phone',
      'address',
      'providerTransactionId',
      'sourceEventId',
      'earningTransactionId',
      '__v',
    ]) {
      expect(transaction.properties).not.toHaveProperty(forbidden);
    }
  });

  it('should document Doctor directory endpoints with strict SYSTEM_ADMIN write security and canonical read access (Issue #81)', () => {
    const postDoctor = swaggerSpec.paths['/doctors'].post;
    expect(postDoctor).toBeDefined();
    expect(postDoctor.tags).toContain('Doctors');
    expect(postDoctor.responses['201']).toBeDefined();
    expect(postDoctor.responses['403']).toBeDefined();
    expect(postDoctor.responses['422']).toBeDefined();

    const getDoctors = swaggerSpec.paths['/doctors'].get;
    expect(getDoctors).toBeDefined();
    expect(getDoctors.tags).toContain('Doctors');
    expect(getDoctors.responses['200']).toBeDefined();
    expect(getDoctors.responses['403']).toBeDefined();
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

  it('should document customer lookup validation errors as 422 and not 400', () => {
    const lookupDoc = swaggerSpec.paths['/customers/lookup'].get;
    expect(lookupDoc.responses['422']).toBeDefined();
    expect(lookupDoc.responses['400']).toBeUndefined();
  });

  it('should document Cart query validation and concurrent add conflicts', () => {
    expect(swaggerSpec.paths['/cart'].get.responses['422']).toEqual({
      $ref: '#/components/responses/ValidationError',
    });
    expect(swaggerSpec.paths['/cart/items'].post.responses['409']).toEqual({
      $ref: '#/components/responses/Conflict',
    });
  });

  it('should document staff provisioning as SYSTEM_ADMIN-only with a safe response', () => {
    const operation = swaggerSpec.paths['/admin/staff'].post;
    const requestSchema = swaggerSpec.components.schemas.StaffProvisioningRequest;
    const responseSchema = swaggerSpec.components.schemas.ProvisionedStaff;

    expect(operation.description).toMatch(/SYSTEM_ADMIN only/);
    expect(operation.security).toEqual([{ bearerAuth: [] }]);
    expect(operation.responses).toEqual(
      expect.objectContaining({
        201: expect.any(Object),
        401: expect.any(Object),
        403: expect.any(Object),
        409: expect.any(Object),
        422: expect.any(Object),
        500: expect.any(Object),
      })
    );
    expect(requestSchema.additionalProperties).toBe(false);
    expect(requestSchema.required).toEqual([
      'name',
      'email',
      'phone',
      'address',
      'role',
      'password',
    ]);
    expect(requestSchema.properties.branchId).toBeDefined();
    expect(responseSchema.properties).not.toHaveProperty('password');
    expect(responseSchema.properties).not.toHaveProperty('passwordHash');
    expect(responseSchema.properties).not.toHaveProperty('token');
  });

  it('documents all appointment operations with real roles, constraints, and error responses', () => {
    const booking = swaggerSpec.paths['/appointments'].post;
    const cancellation = swaggerSpec.paths['/appointments/{id}/cancel'].patch;
    const reassignment = swaggerSpec.paths['/appointments/{id}/reassign'].patch;
    const sessionUpdate = swaggerSpec.paths['/doctor-sessions/{id}'].patch;

    expect(booking.description).toMatch(/24 hours/);
    expect(booking.description).toMatch(/atomic/);
    expect(booking.security).toEqual([{ bearerAuth: [] }]);
    expect(booking.responses['409']).toBeDefined();
    expect(booking.responses['503']).toBeDefined();
    expect(cancellation.description).toMatch(/before the session starts/);
    expect(cancellation.description).toMatch(/no request body/);
    expect(reassignment.description).toMatch(/BRANCH_ASSISTANT only/);
    expect(sessionUpdate.description).toMatch(/including cancelled appointments/);
    expect(swaggerSpec.components.schemas.DoctorSessionCreateRequest.additionalProperties).toBe(
      false
    );
    expect(swaggerSpec.components.schemas.AppointmentCreateRequest.properties).toEqual({
      sessionId: expect.any(Object),
    });
    expect(swaggerSpec.paths['/appointments/providers'].get.description).toMatch(
      /BRANCH_ASSISTANT/
    );
    expect(swaggerSpec.paths['/appointments/providers'].get.description).toMatch(
      /approved Gampaha branch/
    );
    expect(swaggerSpec.paths['/appointments'].get.description).toMatch(
      /customer ID, name, and phone/
    );
    expect(swaggerSpec.components.schemas.AppointmentCustomerContact.required).toEqual([
      'id',
      'name',
      'phone',
    ]);
  });

  it('documents BRANCH_MANAGER-only monitoring, bounded pagination and explicit financial DTOs', () => {
    for (const path of ['/payments', '/payments/{paymentId}', '/payments/{paymentId}/events']) {
      const operation = swaggerSpec.paths[path].get;
      expect(operation.description).toMatch(/BRANCH_MANAGER only/);
      expect(operation.security).toEqual([{ bearerAuth: [] }]);
      expect(operation.responses).toEqual(
        expect.objectContaining({
          200: expect.any(Object),
          401: expect.any(Object),
          403: expect.any(Object),
          422: expect.any(Object),
          500: expect.any(Object),
        })
      );
    }
    expect(swaggerSpec.components.parameters.PaymentMonitoringPage.schema).toMatchObject({
      minimum: 1,
      maximum: 10000,
      default: 1,
    });
    expect(swaggerSpec.components.parameters.PaymentMonitoringLimit.schema).toMatchObject({
      minimum: 1,
      maximum: 100,
      default: 25,
    });
    for (const name of ['ManagementPayment', 'ManagementPaymentEvent']) {
      const schema = swaggerSpec.components.schemas[name];
      expect(schema.additionalProperties).toBe(false);
      expect(schema.properties.providerTransactionId).toBeDefined();
      for (const field of ['merchantSecret', 'md5sig', 'eventKey', 'rawPayload', 'card_no', '__v'])
        expect(schema.properties).not.toHaveProperty(field);
    }
    expect(
      swaggerSpec.components.schemas.ManagementPayment.properties.reconciliationRequired
    ).toEqual({ type: 'boolean' });
    expect(swaggerSpec.components.schemas.ManagementPaymentEvent.properties.action.enum).toEqual([
      'applied',
      'duplicate',
      'reconciliation_required',
    ]);
  });

  it('should document password recovery endpoints conforming to Issue #83 specifications', () => {
    const forgotDoc = swaggerSpec.paths['/auth/forgot-password'].post;
    expect(forgotDoc).toBeDefined();
    expect(forgotDoc.tags).toContain('Authentication');
    expect(forgotDoc.description).toMatch(/anti-enumeration/i);
    expect(forgotDoc.responses['200']).toBeDefined();
    expect(forgotDoc.responses['422']).toBeDefined();
    expect(forgotDoc.responses['429']).toBeDefined();

    const resetDoc = swaggerSpec.paths['/auth/reset-password'].post;
    expect(resetDoc).toBeDefined();
    expect(resetDoc.tags).toContain('Authentication');
    expect(resetDoc.description).toMatch(/single-use reset token/i);
    expect(resetDoc.responses['200']).toBeDefined();
    expect(resetDoc.responses['400']).toBeDefined();
    expect(resetDoc.responses['422']).toBeDefined();
    expect(resetDoc.responses['429']).toBeDefined();

    const resetRequestSchema = swaggerSpec.components.schemas.ResetPasswordRequest;
    expect(resetRequestSchema.properties).toHaveProperty('token');
    expect(resetRequestSchema.properties).toHaveProperty('newPassword');
    expect(resetRequestSchema.properties).not.toHaveProperty('confirmPassword');
  });

  it('should document Audit trail endpoint with strict SYSTEM_ADMIN security and filter parameters (Issue #57)', () => {
    const auditDoc = swaggerSpec.paths['/audit-events'].get;
    expect(auditDoc).toBeDefined();
    expect(auditDoc.tags).toContain('Audit');
    expect(auditDoc.security).toEqual([{ bearerAuth: [] }]);
    expect(auditDoc.description).toMatch(/SYSTEM_ADMIN/);
    expect(auditDoc.responses['200']).toBeDefined();
    expect(auditDoc.responses['401']).toBeDefined();
    expect(auditDoc.responses['403']).toBeDefined();

    const paramNames = auditDoc.parameters.map((p) => p.name);
    expect(paramNames).toEqual(
      expect.arrayContaining([
        'action',
        'targetType',
        'targetId',
        'actorId',
        'branchId',
        'fromDate',
        'toDate',
        'page',
        'limit',
      ])
    );
  });

  it('should document reporting endpoints with 200 response JSON schemas matching actual response structure', () => {
    // /reports/sales
    const sales200 = swaggerSpec.paths['/reports/sales'].get.responses['200'];
    expect(sales200.content['application/json'].schema).toBeDefined();
    const salesSchema = sales200.content['application/json'].schema;
    expect(salesSchema.required).toEqual(['success', 'data']);
    expect(salesSchema.properties.data.properties.summary.properties.netRevenue).toBeDefined();
    expect(
      salesSchema.properties.data.properties.breakdowns.properties.byTime.items.properties
        .netRevenue
    ).toBeDefined();

    // /reports/sales/orders
    const orders200 = swaggerSpec.paths['/reports/sales/orders'].get.responses['200'];
    expect(orders200.content['application/json'].schema).toBeDefined();
    const ordersSchema = orders200.content['application/json'].schema;
    expect(ordersSchema.properties.data.properties.orders.items.properties.customer).toBeDefined();

    // /reports/inventory
    const inv200 = swaggerSpec.paths['/reports/inventory'].get.responses['200'];
    expect(inv200.content['application/json'].schema).toBeDefined();
    const invSchema = inv200.content['application/json'].schema;
    expect(invSchema.properties.data.properties.summary.properties.totalStockOnHand).toBeDefined();

    // /reports/inventory/items
    const invItems200 = swaggerSpec.paths['/reports/inventory/items'].get.responses['200'];
    expect(invItems200.content['application/json'].schema).toBeDefined();
    const invItemsSchema = invItems200.content['application/json'].schema;
    expect(
      invItemsSchema.properties.data.properties.items.items.properties.reorderStatus
    ).toBeDefined();
  });

  it('documents staff and doctor management endpoints as SYSTEM_ADMIN-only with safe schemas (Issue #93)', () => {
    // Staff listing
    const listStaff = swaggerSpec.paths['/admin/staff'].get;
    expect(listStaff.description).toMatch(/SYSTEM_ADMIN only/);
    expect(listStaff.security).toEqual([{ bearerAuth: [] }]);
    expect(listStaff.responses['200'].content['application/json'].schema).toBeDefined();

    // Staff detail & patch
    const getStaff = swaggerSpec.paths['/admin/staff/{id}'].get;
    expect(getStaff.security).toEqual([{ bearerAuth: [] }]);
    expect(getStaff.responses['404']).toBeDefined();

    const patchProfile = swaggerSpec.paths['/admin/staff/{id}'].patch;
    expect(patchProfile.security).toEqual([{ bearerAuth: [] }]);
    expect(patchProfile.responses['409']).toBeDefined();

    const patchRole = swaggerSpec.paths['/admin/staff/{id}/role'].patch;
    expect(patchRole.security).toEqual([{ bearerAuth: [] }]);

    const patchBranch = swaggerSpec.paths['/admin/staff/{id}/branch'].patch;
    expect(patchBranch.security).toEqual([{ bearerAuth: [] }]);

    const patchStatus = swaggerSpec.paths['/admin/staff/{id}/status'].patch;
    expect(patchStatus.security).toEqual([{ bearerAuth: [] }]);

    // Doctor admin listing & editing
    const listDoctors = swaggerSpec.paths['/admin/doctors'].get;
    expect(listDoctors.description).toMatch(/SYSTEM_ADMIN only/);
    expect(listDoctors.security).toEqual([{ bearerAuth: [] }]);

    const patchDoctor = swaggerSpec.paths['/admin/doctors/{id}'].patch;
    expect(patchDoctor.security).toEqual([{ bearerAuth: [] }]);
    expect(patchDoctor.responses['404']).toBeDefined();

    const patchDocStatus = swaggerSpec.paths['/admin/doctors/{id}/status'].patch;
    expect(patchDocStatus.security).toEqual([{ bearerAuth: [] }]);

    // Schema security check - ensure credentials/secrets are not in public StaffMember
    const staffSchema = swaggerSpec.components.schemas.StaffMember;
    expect(staffSchema.properties).not.toHaveProperty('password');
    expect(staffSchema.properties).not.toHaveProperty('passwordHash');
    expect(staffSchema.properties).toHaveProperty('isActive');
  });
});
