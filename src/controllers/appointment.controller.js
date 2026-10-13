const catchAsync = require('../utils/catchAsync');
const {
  listProviders,
  listAvailableSessions,
  createDoctorSession,
  updateDoctorSession,
  createAppointment,
  listAppointments,
  getAppointmentById,
  cancelAppointment,
  reassignAppointment,
} = require('../services/appointment.service');

const getProviders = catchAsync(async (req, res) => {
  const providers = await listProviders(req.auth);
  return res.status(200).json({ success: true, data: providers });
});

const getAvailableSessions = catchAsync(async (req, res) => {
  const sessions = await listAvailableSessions(req.auth);
  return res.status(200).json({ success: true, data: sessions });
});

const createDoctorSessionHandler = catchAsync(async (req, res) => {
  const session = await createDoctorSession(req.body, req.auth);
  return res.status(201).json({ success: true, data: session });
});

const updateDoctorSessionHandler = catchAsync(async (req, res) => {
  const session = await updateDoctorSession(req.params.id, req.body, req.auth);
  return res.status(200).json({ success: true, data: session });
});

const createAppointmentHandler = catchAsync(async (req, res) => {
  const appointment = await createAppointment(req.body, req.auth);
  return res.status(201).json({ success: true, data: appointment });
});

const listAppointmentsHandler = catchAsync(async (req, res) => {
  const appointments = await listAppointments(req.auth);
  return res.status(200).json({ success: true, data: appointments });
});

const getAppointmentHandler = catchAsync(async (req, res) => {
  const appointment = await getAppointmentById(req.params.id, req.auth);
  return res.status(200).json({ success: true, data: appointment });
});

const cancelAppointmentHandler = catchAsync(async (req, res) => {
  const result = await cancelAppointment(req.params.id, req.auth);
  return res.status(200).json({ success: true, data: result });
});

const reassignAppointmentHandler = catchAsync(async (req, res) => {
  const result = await reassignAppointment(req.params.id, req.body.sessionId, req.auth);
  return res.status(200).json({ success: true, data: result });
});

module.exports = {
  getProviders,
  getAvailableSessions,
  createDoctorSessionHandler,
  updateDoctorSessionHandler,
  createAppointmentHandler,
  listAppointmentsHandler,
  getAppointmentHandler,
  cancelAppointmentHandler,
  reassignAppointmentHandler,
};
