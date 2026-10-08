const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Darshana Opticals OSMS API Documentation',
      version: '1.0.0',
      description:
        'REST API documentation for Darshana Opticals Optical Store Management System (OSMS)',
    },
    servers: [
      {
        url: 'http://localhost:5000/api',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        ValidationIssue: {
          type: 'object',
          required: ['field', 'message'],
          properties: {
            field: {
              type: 'string',
              example: 'email',
            },
            message: {
              type: 'string',
              example: 'email must be a valid email address',
            },
          },
        },
        ErrorResponse: {
          type: 'object',
          required: ['success', 'error'],
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            error: {
              type: 'object',
              required: ['message', 'code'],
              properties: {
                message: {
                  type: 'string',
                  example: 'Authentication required.',
                },
                code: {
                  type: 'string',
                  example: 'UNAUTHORIZED',
                },
                details: {
                  oneOf: [
                    { type: 'array', items: { $ref: '#/components/schemas/ValidationIssue' } },
                    { type: 'object' },
                  ],
                },
              },
            },
          },
        },
        ValidationErrorResponse: {
          allOf: [{ $ref: '#/components/schemas/ErrorResponse' }],
          description: 'Validation-related error response.',
        },
        CustomerProfile: {
          type: 'object',
          required: ['id', 'name', 'email', 'role'],
          properties: {
            id: {
              type: 'string',
              example: '64d4a3ff3baf9d2b8a33d1a1',
            },
            name: {
              type: 'string',
              example: 'Alice Customer',
            },
            email: {
              type: 'string',
              format: 'email',
              example: 'alice.customer@example.com',
            },
            address: {
              type: 'string',
              example: '12 Main Street, Colombo',
            },
            phone: {
              type: 'string',
              example: '+94711234567',
            },
            role: {
              type: 'string',
              enum: ['CUSTOMER'],
              example: 'CUSTOMER',
            },
          },
        },
        AuthenticatedUser: {
          type: 'object',
          required: ['id', 'name', 'email', 'role'],
          properties: {
            id: {
              type: 'string',
              example: '64d4a3ff3baf9d2b8a33d1a1',
            },
            name: {
              type: 'string',
              example: 'Alice Customer',
            },
            email: {
              type: 'string',
              format: 'email',
              example: 'alice.customer@example.com',
            },
            address: {
              type: 'string',
              nullable: true,
              example: '12 Main Street, Colombo',
            },
            phone: {
              type: 'string',
              nullable: true,
              example: '+94711234567',
            },
            role: {
              type: 'string',
              example: 'CUSTOMER',
            },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: {
              type: 'string',
              format: 'email',
              example: 'alice.customer@example.com',
            },
            password: {
              type: 'string',
              format: 'password',
              example: 'StrongPass123!',
            },
          },
        },
        RegisterRequest: {
          type: 'object',
          required: ['name', 'email', 'phone', 'password'],
          properties: {
            name: {
              type: 'string',
              example: 'Alice Customer',
            },
            email: {
              type: 'string',
              format: 'email',
              example: 'alice.customer@example.com',
            },
            address: {
              type: 'string',
              nullable: true,
              example: '12 Main Street, Colombo',
            },
            phone: {
              type: 'string',
              example: '+94711234567',
            },
            password: {
              type: 'string',
              format: 'password',
              minLength: 8,
              example: 'StrongPass123!',
            },
          },
        },
        StaffProvisioningRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'email', 'phone', 'address', 'role', 'password'],
          properties: {
            name: { type: 'string', example: 'Jordan Staff' },
            email: { type: 'string', format: 'email', example: 'jordan.staff@example.com' },
            phone: { type: 'string', example: '+94711234567' },
            address: { type: 'string', example: '12 Main Street, Colombo' },
            role: {
              type: 'string',
              enum: [
                'INVENTORY_MANAGER',
                'BRANCH_MANAGER',
                'OPTOMETRIST',
                'MANAGEMENT',
                'SALES_ASSISTANT_CASHIER',
              ],
            },
            password: { type: 'string', format: 'password', minLength: 8 },
            branchId: {
              type: 'string',
              pattern: '^[a-fA-F0-9]{24}$',
              description: 'Optional existing MongoDB Branch identifier.',
            },
          },
        },
        ProvisionedStaff: {
          type: 'object',
          required: ['id', 'name', 'email', 'phone', 'address', 'role', 'branchId'],
          properties: {
            id: { type: 'string', example: '64d4a3ff3baf9d2b8a33d1a1' },
            name: { type: 'string', example: 'Jordan Staff' },
            email: { type: 'string', format: 'email', example: 'jordan.staff@example.com' },
            phone: { type: 'string', example: '+94711234567' },
            address: { type: 'string', example: '12 Main Street, Colombo' },
            role: {
              type: 'string',
              enum: [
                'INVENTORY_MANAGER',
                'BRANCH_MANAGER',
                'OPTOMETRIST',
                'MANAGEMENT',
                'SALES_ASSISTANT_CASHIER',
              ],
            },
            branchId: { type: 'string', nullable: true, example: null },
          },
        },
        LoginResponse: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            data: {
              type: 'object',
              required: ['token', 'user'],
              properties: {
                token: {
                  type: 'string',
                  example: '<signed-jwt>',
                },
                user: {
                  $ref: '#/components/schemas/AuthenticatedUser',
                },
              },
            },
          },
        },
        ProfileUpdateRequest: {
          type: 'object',
          minProperties: 1,
          properties: {
            name: {
              type: 'string',
              example: 'Updated Customer Name',
            },
            email: {
              type: 'string',
              format: 'email',
              example: 'updated.customer@example.com',
            },
            address: {
              type: 'string',
              example: '22 Garden Road, Kandy',
            },
            phone: {
              type: 'string',
              example: '+94770000000',
            },
          },
        },
        Product: {
          type: 'object',
          required: ['id', 'itemName', 'category', 'brand', 'price'],
          properties: {
            id: {
              type: 'string',
              example: '64d4a3ff3baf9d2b8a33d1a1',
            },
            itemName: {
              type: 'string',
              example: 'Austen Classic',
            },
            category: {
              type: 'string',
              example: 'Men',
            },
            brand: {
              type: 'string',
              example: 'Oliver Peoples',
            },
            price: {
              type: 'number',
              format: 'double',
              minimum: 0,
              example: 12500,
            },
          },
        },
        BranchReference: {
          type: 'object',
          required: ['id', 'address', 'contactNumber'],
          properties: {
            id: {
              type: 'string',
              example: '64d4a3ff3baf9d2b8a33d1a1',
              description: 'Stable MongoDB Branch identifier accepted by branch-aware APIs.',
            },
            address: {
              type: 'string',
              example: '100 Galle Road, Colombo 03',
            },
            contactNumber: {
              type: 'string',
              example: '+94 11 250 0000',
            },
          },
        },
        InventoryItem: {
          type: 'object',
          required: ['_id', 'branchId', 'itemName', 'category', 'brand', 'price', 'quantity'],
          properties: {
            _id: {
              type: 'string',
              example: '64d4a3ff3baf9d2b8a33d1a1',
            },
            branchId: {
              type: 'string',
              example: '64d4a3ff3baf9d2b8a33d1a2',
            },
            itemName: {
              type: 'string',
              example: 'Classic Frame',
            },
            category: {
              type: 'string',
              example: 'Men',
            },
            brand: {
              type: 'string',
              example: 'Ray-Ban',
            },
            price: {
              type: 'number',
              minimum: 0,
              example: 12500,
            },
            quantity: {
              type: 'number',
              minimum: 0,
              example: 5,
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              example: '2024-05-01T10:00:00.000Z',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              example: '2024-05-01T10:00:00.000Z',
            },
          },
        },
        InventoryCreateRequest: {
          type: 'object',
          required: ['branchId', 'itemName', 'category', 'brand', 'price', 'quantity'],
          properties: {
            branchId: {
              type: 'string',
              example: '64d4a3ff3baf9d2b8a33d1a2',
            },
            itemName: {
              type: 'string',
              example: 'Classic Frame',
            },
            category: {
              type: 'string',
              example: 'Men',
            },
            brand: {
              type: 'string',
              example: 'Ray-Ban',
            },
            price: {
              type: 'number',
              minimum: 0,
              example: 12500,
            },
            quantity: {
              type: 'number',
              minimum: 0,
              example: 5,
            },
          },
        },
        InventoryUpdateRequest: {
          type: 'object',
          minProperties: 1,
          properties: {
            branchId: {
              type: 'string',
              example: '64d4a3ff3baf9d2b8a33d1a2',
            },
            itemName: {
              type: 'string',
              example: 'Updated Frame',
            },
            category: {
              type: 'string',
              example: 'Women',
            },
            brand: {
              type: 'string',
              example: 'Oakley',
            },
            price: {
              type: 'number',
              minimum: 0,
              example: 16000,
            },
          },
        },
        InventoryQuantityUpdateRequest: {
          type: 'object',
          required: ['quantity'],
          properties: {
            quantity: {
              type: 'number',
              minimum: 0,
              example: 12,
            },
          },
        },
        EyeDistance: {
          type: 'object',
          description: 'ADR-001 approved distance vision measurements for one eye.',
          properties: {
            sph: {
              type: 'number',
              nullable: true,
              example: -1.25,
              description: 'Sphere power. Numeric when supplied.',
            },
            cyl: {
              type: 'number',
              nullable: true,
              example: -0.5,
              description: 'Cylinder power. Numeric when supplied.',
            },
            axis: {
              type: 'number',
              nullable: true,
              minimum: 0,
              maximum: 180,
              example: 90,
              description: 'Axis value. Must be 0–180 when supplied (AC6).',
            },
            va: {
              type: 'string',
              nullable: true,
              example: '6/6',
              description: 'Visual acuity string when supplied.',
            },
          },
        },
        EyeReading: {
          type: 'object',
          description: 'ADR-001 approved reading/near vision measurements for one eye.',
          properties: {
            add: {
              type: 'number',
              nullable: true,
              example: 1.0,
              description: 'Addition power. Numeric when supplied.',
            },
            nearVa: {
              type: 'string',
              nullable: true,
              example: 'N6',
              description: 'Near visual acuity string when supplied.',
            },
          },
        },
        EyePrescription: {
          type: 'object',
          description: 'ADR-001 approved combined eye prescription (distance + reading).',
          properties: {
            distance: {
              $ref: '#/components/schemas/EyeDistance',
            },
            reading: {
              $ref: '#/components/schemas/EyeReading',
            },
          },
        },
        PrescriptionCreateRequest: {
          type: 'object',
          required: ['customerId'],
          description:
            'Clinical prescription creation payload. Restricted to OPTOMETRIST. ' +
            'Do NOT supply recordedBy or recordedAt \u2014 these are server-controlled (AC2, AC7). ' +
            'Do NOT supply isArchived \u2014 archive policy is out of scope (AC12). ' +
            'Appointment linkage is not required (AC19).',
          properties: {
            customerId: {
              type: 'string',
              example: '64d4a3ff3baf9d2b8a33d1a1',
              description:
                'MongoDB ObjectId of the target Customer. Must reference an existing Customer (AC3).',
            },
            rightEye: {
              $ref: '#/components/schemas/EyePrescription',
            },
            leftEye: {
              $ref: '#/components/schemas/EyePrescription',
            },
            remarks: {
              type: 'string',
              nullable: true,
              maxLength: 1000,
              example: 'Patient reports mild photosensitivity.',
              description: 'Optional clinical remarks. Max 1000 characters.',
            },
          },
        },
        RecordedByStaff: {
          type: 'object',
          description: 'Minimum safe Staff fields exposed on a prescription response (AC22).',
          properties: {
            id: {
              type: 'string',
              example: '64d4a3ff3baf9d2b8a33d1a2',
            },
            name: {
              type: 'string',
              example: 'Dr. Nimal Optometrist',
            },
          },
        },
        PrescriptionResponse: {
          type: 'object',
          description:
            'Safe prescription response shape exposing only approved ADR-001 clinical fields (AC22). ' +
            'History is ordered newest-first by recordedAt (AC16). ' +
            'recordedBy exposes only minimum safe Staff fields.',
          required: ['id', 'customerId', 'recordedBy', 'recordedAt'],
          properties: {
            id: {
              type: 'string',
              example: '64d4a3ff3baf9d2b8a33d1a3',
            },
            customerId: {
              type: 'string',
              example: '64d4a3ff3baf9d2b8a33d1a1',
            },
            recordedBy: {
              $ref: '#/components/schemas/RecordedByStaff',
            },
            recordedAt: {
              type: 'string',
              format: 'date-time',
              example: '2024-05-01T10:00:00.000Z',
              description: 'Server-controlled authoritative recording timestamp (AC7).',
            },
            rightEye: {
              $ref: '#/components/schemas/EyePrescription',
            },
            leftEye: {
              $ref: '#/components/schemas/EyePrescription',
            },
            remarks: {
              type: 'string',
              example: 'Patient reports mild photosensitivity.',
            },
            isArchived: {
              type: 'boolean',
              example: false,
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              example: '2024-05-01T10:00:00.000Z',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              example: '2024-05-01T10:00:00.000Z',
            },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Authentication required or invalid token.',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse',
              },
            },
          },
        },
        Forbidden: {
          description: 'The authenticated user does not have the required role or permissions.',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse',
              },
            },
          },
        },
        NotFound: {
          description: 'The requested resource was not found.',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse',
              },
            },
          },
        },
        Conflict: {
          description: 'A duplicate identity or conflicting resource exists.',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse',
              },
            },
          },
        },
        ValidationError: {
          description: 'Validation failed for the request payload or query parameters.',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ValidationErrorResponse',
              },
            },
          },
        },
        InternalServerError: {
          description: 'Unexpected server error.',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse',
              },
            },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.js'],
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = swaggerSpec;
