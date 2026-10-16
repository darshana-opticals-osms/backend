/**
 * @openapi
 * components:
 *   schemas:
 *     Doctor:
 *       type: object
 *       required: [id, name, specialization]
 *       properties:
 *         id:
 *           type: string
 *           example: 66c5d2a9d7e2b8f2d7c4ff12
 *         name:
 *           type: string
 *           example: Dr. Nimal Perera
 *         specialization:
 *           type: string
 *           example: Ophthalmologist
 *       description: Authoritative external Doctor directory profile without system credentials or roles.
 *     DoctorCreateRequest:
 *       type: object
 *       required: [name, specialization]
 *       additionalProperties: false
 *       properties:
 *         name:
 *           type: string
 *           maxLength: 100
 *           example: Dr. Nimal Perera
 *         specialization:
 *           type: string
 *           maxLength: 100
 *           example: Ophthalmologist
 *     DoctorResponse:
 *       type: object
 *       required: [success, data]
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           $ref: '#/components/schemas/Doctor'
 *     DoctorListResponse:
 *       type: object
 *       required: [success, data]
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Doctor'
 */

/**
 * @openapi
 * /doctors:
 *   post:
 *     summary: Register a new external Doctor
 *     description: SYSTEM_ADMIN only. Registers an authoritative external Doctor in OSMS with only name and specialization. No login accounts or credentials are created.
 *     tags:
 *       - Doctors
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DoctorCreateRequest'
 *     responses:
 *       201:
 *         description: Doctor registered successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DoctorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Access forbidden for non-SYSTEM_ADMIN roles.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *   get:
 *     summary: List all registered Doctors
 *     description: Retrieve all external Doctors in deterministic sort order (name ASC, _id ASC). Accessible by all canonical authenticated roles.
 *     tags:
 *       - Doctors
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Deterministically ordered list of all registered Doctors.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DoctorListResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Access forbidden for unauthenticated or non-canonical roles.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
