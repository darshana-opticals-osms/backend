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
