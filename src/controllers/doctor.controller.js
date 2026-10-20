const catchAsync = require('../utils/catchAsync');
const {
  createDoctor,
  listDoctors,
  listAllDoctorsAdmin,
  updateDoctor,
  updateDoctorStatus,
} = require('../services/doctor.service');

const createDoctorHandler = catchAsync(async (req, res) => {
  const doctor = await createDoctor(req.body);

  return res.status(201).json({
    success: true,
    data: doctor,
  });
});

const getDoctorsHandler = catchAsync(async (_req, res) => {
  const doctors = await listDoctors();

  return res.status(200).json({
    success: true,
    data: doctors,
  });
});

const getAdminDoctorsHandler = catchAsync(async (req, res) => {
  const doctors = await listAllDoctorsAdmin(req.query);

  return res.status(200).json({
    success: true,
    data: doctors,
  });
});

const updateDoctorHandler = catchAsync(async (req, res) => {
  const doctor = await updateDoctor(req.params.id, req.body, req.auth);

  return res.status(200).json({
    success: true,
    data: doctor,
  });
});

const updateDoctorStatusHandler = catchAsync(async (req, res) => {
  const statusValue =
    req.body && req.body.isActive !== undefined ? req.body.isActive : req.body && req.body.status;
  const doctor = await updateDoctorStatus(req.params.id, statusValue, req.auth);

  return res.status(200).json({
    success: true,
    data: doctor,
  });
});

module.exports = {
  createDoctorHandler,
  getDoctorsHandler,
  getAdminDoctorsHandler,
  updateDoctorHandler,
  updateDoctorStatusHandler,
};
