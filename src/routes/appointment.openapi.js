/**
 * @openapi
 * components:
 *   schemas:
 *     AppointmentProvider:
 *       type: object
 *       required: [id, name, role, branchId]
 *       properties:
 *         id: { type: string, example: 66c5d2a9d7e2b8f2d7c4ff12 }
 *         name: { type: string, example: Dr. Gampaha }
 *         role: { type: string, enum: [OPTOMETRIST] }
 *         branchId: { type: string, example: 66c5d2a9d7e2b8f2d7c4ff13 }
 *       description: Returned to CUSTOMERS and authorized Gampaha SALES_ASSISTANT_CASHIER staff so staff can create doctor sessions. Email, phone, address, and credentials are not exposed.
 *     AppointmentCustomerContact:
 *       type: object
 *       required: [id, name, phone]
 *       properties:
 *         id: { type: string }
 *         name: { type: string }
 *         phone: { type: string }
 *       description: Included only for authorized Gampaha cashiers on appointment list/detail responses. Not returned to customers or Branch Managers.
 *     DoctorSession:
 *       type: object
 *       required: [id, staffId, branchId, startAt, endAt, capacity, confirmedCount, remainingCapacity]
 *       properties:
 *         id: { type: string }
 *         staffId: { type: string }
 *         branchId: { type: string }
 *         startAt: { type: string, format: date-time, example: '2026-11-01T09:00:00.000Z' }
 *         endAt: { type: string, format: date-time, example: '2026-11-01T10:00:00.000Z' }
 *         capacity: { type: integer, minimum: 1, example: 8 }
 *         confirmedCount: { type: integer, minimum: 0, example: 3 }
 *         remainingCapacity: { type: integer, minimum: 0, example: 5 }
 *       description: Bookable scheduling period at the approved Gampaha Main Branch.
 *     Appointment:
 *       type: object
 *       description: Privacy-safe appointment fields. The optional customer contact projection is present only for authorized Gampaha cashiers; it is omitted for customers and Branch Managers.
 *       required: [id, staffId, dateTime, status]
 *       properties:
 *         id: { type: string }
 *         staffId: { type: string }
 *         providerName: { type: string, description: Display name only. }
 *         sessionId: { type: string, nullable: true }
 *         branchId: { type: string, nullable: true, description: Historical branch snapshot; null for legacy data without authoritative branch provenance. }
 *         dateTime: { type: string, format: date-time, description: Mirrors the authoritative session startAt when session-linked. }
 *         status: { type: string, enum: [CONFIRMED, CANCELLED] }
 *         position: { type: integer, minimum: 1, nullable: true, description: Active queue position; null when cancelled. }
 *         customer: { $ref: '#/components/schemas/AppointmentCustomerContact', description: Cashier-only contact projection; omitted from customer and Branch Manager responses. }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *     DoctorSessionCreateRequest:
 *       type: object
 *       additionalProperties: false
 *       required: [staffId, branchId, startAt, endAt, capacity]
 *       properties:
 *         staffId: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *         branchId: { type: string, pattern: '^[a-fA-F0-9]{24}$', description: Must identify GAMPAHA_CENTRAL. }
 *         startAt: { type: string, format: date-time, description: Valid ISO-8601 timestamp with explicit Z or ±HH:MM timezone. }
 *         endAt: { type: string, format: date-time, description: Valid ISO-8601 timestamp with explicit Z or ±HH:MM timezone. }
 *         capacity: { type: integer, minimum: 1 }
 *     DoctorSessionUpdateRequest:
 *       type: object
 *       additionalProperties: false
 *       minProperties: 1
 *       properties:
 *         staffId: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *         branchId: { type: string, pattern: '^[a-fA-F0-9]{24}$', description: Must identify GAMPAHA_CENTRAL. }
 *         startAt: { type: string, format: date-time, description: Valid ISO-8601 timestamp with explicit timezone. }
 *         endAt: { type: string, format: date-time, description: Valid ISO-8601 timestamp with explicit timezone. }
 *         capacity: { type: integer, minimum: 1, description: Cannot be lower than confirmed active bookings. }
 *     AppointmentCreateRequest:
 *       type: object
 *       additionalProperties: false
 *       required: [sessionId]
 *       properties:
 *         sessionId: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *       description: Customer identity, status, position, provider, timing, and branch are server-controlled.
 *     AppointmentReassignRequest:
 *       type: object
 *       additionalProperties: false
 *       required: [sessionId]
 *       properties:
 *         sessionId: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *     AppointmentResponse:
 *       type: object
 *       required: [success, data]
 *       properties:
 *         success: { type: boolean, example: true }
 *         data: { $ref: '#/components/schemas/Appointment' }
 *     DoctorSessionResponse:
 *       type: object
 *       required: [success, data]
 *       properties:
 *         success: { type: boolean, example: true }
 *         data: { $ref: '#/components/schemas/DoctorSession' }
 *     AppointmentListResponse:
 *       type: object
 *       required: [success, data]
 *       properties:
 *         success: { type: boolean, example: true }
 *         data:
 *           type: array
 *           items: { $ref: '#/components/schemas/Appointment' }
 *     DoctorSessionListResponse:
 *       type: object
 *       required: [success, data]
 *       properties:
 *         success: { type: boolean, example: true }
 *         data:
 *           type: array
 *           items: { $ref: '#/components/schemas/DoctorSession' }
 *   responses:
 *     AppointmentInternalError:
 *       description: Internal persistence error; transaction was rolled back where its outcome is known.
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ErrorResponse' }
 *     AppointmentTransactionUnavailable:
 *       description: MongoDB replica-set transaction support is unavailable or a transaction outcome could not be confirmed.
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ErrorResponse' }
 * paths:
 *   /appointments/providers:
 *     get:
 *       summary: List eligible Gampaha Optometrists
 *       description: CUSTOMER and SALES_ASSISTANT_CASHIER assigned to the approved Gampaha branch. Returns eligible Gampaha Optometrists with provider ID and approved branch ID. Cashiers use these IDs to create doctor sessions. No staff directory access is granted.
 *       tags: [Appointments]
 *       security: [{ bearerAuth: [] }]
 *       responses:
 *         '200':
 *           description: Eligible providers with safe display fields and the IDs needed for session creation.
 *           content:
 *             application/json:
 *               schema:
 *                 type: object
 *                 properties:
 *                   success: { type: boolean }
 *                   data:
 *                     type: array
 *                     items: { $ref: '#/components/schemas/AppointmentProvider' }
 *         '401': { $ref: '#/components/responses/Unauthorized' }
 *         '403': { $ref: '#/components/responses/Forbidden' }
 *         '422': { $ref: '#/components/responses/ValidationError' }
 *         '500': { $ref: '#/components/responses/InternalServerError' }
 *   /doctor-sessions/available:
 *     get:
 *       summary: List customer-bookable doctor sessions
 *       description: CUSTOMER-only. Includes future GAMPAHA_CENTRAL sessions with eligible Optometrists, available capacity, and at least 24 hours lead time. Booking revalidates availability.
 *       tags: [Appointments]
 *       security: [{ bearerAuth: [] }]
 *       responses:
 *         '200':
 *           description: Bookable sessions and remaining capacity.
 *           content:
 *             application/json:
 *               schema: { $ref: '#/components/schemas/DoctorSessionListResponse' }
 *         '401': { $ref: '#/components/responses/Unauthorized' }
 *         '403': { $ref: '#/components/responses/Forbidden' }
 *         '422': { $ref: '#/components/responses/ValidationError' }
 *         '500': { $ref: '#/components/responses/InternalServerError' }
 *   /doctor-sessions:
 *     get:
 *       summary: List branch doctor sessions
 *       description: SALES_ASSISTANT_CASHIER and same-branch BRANCH_MANAGER. Managers have read-only visibility. Only the approved Gampaha branch is supported. Query parameters are rejected.
 *       tags: [Appointments]
 *       security: [{ bearerAuth: [] }]
 *       responses:
 *         '200':
 *           description: Sessions ordered by start time descending.
 *           content:
 *             application/json:
 *               schema: { $ref: '#/components/schemas/DoctorSessionListResponse' }
 *         '401': { $ref: '#/components/responses/Unauthorized' }
 *         '403': { $ref: '#/components/responses/Forbidden' }
 *         '422': { $ref: '#/components/responses/ValidationError' }
 *         '500': { $ref: '#/components/responses/InternalServerError' }
 *     post:
 *       summary: Create a doctor session
 *       description: SALES_ASSISTANT_CASHIER only. Requires an eligible Gampaha Optometrist, non-overlapping ISO-8601 interval, positive capacity, explicit timezone, and GAMPAHA_CENTRAL branch. Scheduling writes are transactional.
 *       tags: [Appointments]
 *       security: [{ bearerAuth: [] }]
 *       requestBody:
 *         required: true
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/DoctorSessionCreateRequest' }
 *       responses:
 *         '201':
 *           description: Session created.
 *           content:
 *             application/json:
 *               schema: { $ref: '#/components/schemas/DoctorSessionResponse' }
 *         '400': { description: Malformed JSON payload. }
 *         '401': { $ref: '#/components/responses/Unauthorized' }
 *         '403': { $ref: '#/components/responses/Forbidden' }
 *         '404': { $ref: '#/components/responses/NotFound' }
 *         '409': { $ref: '#/components/responses/Conflict' }
 *         '422': { $ref: '#/components/responses/ValidationError' }
 *         '500': { $ref: '#/components/responses/InternalServerError' }
 *         '503': { $ref: '#/components/responses/AppointmentTransactionUnavailable' }
 *   /doctor-sessions/{id}:
 *     patch:
 *       summary: Update or reschedule a doctor session
 *       description: SALES_ASSISTANT_CASHIER only. Rejects overlapping sessions and capacity below active bookings. Existing linked records, including cancelled appointments, follow the authoritative provider, timing, and branch snapshot.
 *       tags: [Appointments]
 *       security: [{ bearerAuth: [] }]
 *       parameters:
 *         - in: path
 *           name: id
 *           required: true
 *           schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *       requestBody:
 *         required: true
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/DoctorSessionUpdateRequest' }
 *       responses:
 *         '200':
 *           description: Updated session.
 *           content:
 *             application/json:
 *               schema: { $ref: '#/components/schemas/DoctorSessionResponse' }
 *         '400': { description: Malformed JSON payload. }
 *         '401': { $ref: '#/components/responses/Unauthorized' }
 *         '403': { $ref: '#/components/responses/Forbidden' }
 *         '404': { $ref: '#/components/responses/NotFound' }
 *         '409': { $ref: '#/components/responses/Conflict' }
 *         '422': { $ref: '#/components/responses/ValidationError' }
 *         '500': { $ref: '#/components/responses/InternalServerError' }
 *         '503': { $ref: '#/components/responses/AppointmentTransactionUnavailable' }
 *   /appointments:
 *     get:
 *       summary: List appointments visible to the authenticated user
 *       description: CUSTOMER sees only their own records, including legacy history, without unnecessary customer contact data. Authorized Gampaha SALES_ASSISTANT_CASHIER staff receive only customer ID, name, and phone to support rescheduling contact. BRANCH_MANAGER receives read-only appointment data without customer contact details. Staff scope requires authoritative Gampaha session or branch provenance; unscoped legacy records are not assigned a branch by inference.
 *       tags: [Appointments]
 *       security: [{ bearerAuth: [] }]
 *       responses:
 *         '200':
 *           description: Visible appointments; an empty list is valid.
 *           content:
 *             application/json:
 *               schema: { $ref: '#/components/schemas/AppointmentListResponse' }
 *         '401': { $ref: '#/components/responses/Unauthorized' }
 *         '403': { $ref: '#/components/responses/Forbidden' }
 *         '422': { $ref: '#/components/responses/ValidationError' }
 *         '500': { $ref: '#/components/responses/InternalServerError' }
 *     post:
 *       summary: Book a doctor session
 *       description: CUSTOMER-only. Server derives customer, provider, branch, timing, CONFIRMED status, and queue position. Booking requires GAMPAHA_CENTRAL, an eligible Optometrist, capacity, and session start at least 24 hours from server time. Position and capacity reservation are atomic. Submit only sessionId.
 *       tags: [Appointments]
 *       security: [{ bearerAuth: [] }]
 *       requestBody:
 *         required: true
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AppointmentCreateRequest' }
 *       responses:
 *         '201':
 *           description: Confirmed appointment and assigned queue position.
 *           content:
 *             application/json:
 *               schema: { $ref: '#/components/schemas/AppointmentResponse' }
 *         '400': { description: Malformed JSON payload. }
 *         '401': { $ref: '#/components/responses/Unauthorized' }
 *         '403': { $ref: '#/components/responses/Forbidden' }
 *         '404': { $ref: '#/components/responses/NotFound' }
 *         '409': { $ref: '#/components/responses/Conflict' }
 *         '422': { $ref: '#/components/responses/ValidationError' }
 *         '500': { $ref: '#/components/responses/InternalServerError' }
 *         '503': { $ref: '#/components/responses/AppointmentTransactionUnavailable' }
 *   /appointments/{id}:
 *     get:
 *       summary: Retrieve one appointment
 *       description: CUSTOMER may read only their own appointment without customer contact fields. Authorized Gampaha cashiers receive minimum customer ID, name, and phone for operational contact. Branch Managers remain read-only and receive no customer contact details. System Admin and Optometrist access is not granted by this API.
 *       tags: [Appointments]
 *       security: [{ bearerAuth: [] }]
 *       parameters:
 *         - in: path
 *           name: id
 *           required: true
 *           schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *       responses:
 *         '200':
 *           description: Appointment.
 *           content:
 *             application/json:
 *               schema: { $ref: '#/components/schemas/AppointmentResponse' }
 *         '401': { $ref: '#/components/responses/Unauthorized' }
 *         '403': { $ref: '#/components/responses/Forbidden' }
 *         '404': { $ref: '#/components/responses/NotFound' }
 *         '422': { $ref: '#/components/responses/ValidationError' }
 *         '500': { $ref: '#/components/responses/InternalServerError' }
 *   /appointments/{id}/cancel:
 *     patch:
 *       summary: Cancel a confirmed appointment
 *       description: Customer may cancel only their own booking before the session starts; SALES_ASSISTANT_CASHIER may cancel within Gampaha scope. Branch Manager is read-only. Cancellation preserves the record, releases capacity, and compacts positions transactionally. The endpoint accepts no request body or query parameters.
 *       tags: [Appointments]
 *       security: [{ bearerAuth: [] }]
 *       parameters:
 *         - in: path
 *           name: id
 *           required: true
 *           schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *       responses:
 *         '200':
 *           description: Appointment cancelled.
 *           content:
 *             application/json:
 *               schema:
 *                 type: object
 *                 properties:
 *                   success: { type: boolean }
 *                   data: { type: object, properties: { success: { type: boolean } } }
 *         '401': { $ref: '#/components/responses/Unauthorized' }
 *         '403': { $ref: '#/components/responses/Forbidden' }
 *         '404': { $ref: '#/components/responses/NotFound' }
 *         '409': { $ref: '#/components/responses/Conflict' }
 *         '422': { $ref: '#/components/responses/ValidationError' }
 *         '500': { $ref: '#/components/responses/InternalServerError' }
 *         '503': { $ref: '#/components/responses/AppointmentTransactionUnavailable' }
 *   /appointments/{id}/reassign:
 *     patch:
 *       summary: Reassign an appointment to another session
 *       description: SALES_ASSISTANT_CASHIER only. Source and target must be approved Gampaha sessions; target requires an eligible Gampaha Optometrist, at least 24 hours lead time, available capacity, and no duplicate customer booking. Source and target positions and counters are updated atomically. No query parameters are accepted.
 *       tags: [Appointments]
 *       security: [{ bearerAuth: [] }]
 *       parameters:
 *         - in: path
 *           name: id
 *           required: true
 *           schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *       requestBody:
 *         required: true
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AppointmentReassignRequest' }
 *       responses:
 *         '200':
 *           description: Appointment reassigned.
 *           content:
 *             application/json:
 *               schema:
 *                 type: object
 *                 properties:
 *                   success: { type: boolean }
 *                   data: { type: object, properties: { success: { type: boolean } } }
 *         '400': { description: Malformed JSON payload. }
 *         '401': { $ref: '#/components/responses/Unauthorized' }
 *         '403': { $ref: '#/components/responses/Forbidden' }
 *         '404': { $ref: '#/components/responses/NotFound' }
 *         '409': { $ref: '#/components/responses/Conflict' }
 *         '422': { $ref: '#/components/responses/ValidationError' }
 *         '500': { $ref: '#/components/responses/InternalServerError' }
 *         '503': { $ref: '#/components/responses/AppointmentTransactionUnavailable' }
 */
module.exports = {};
