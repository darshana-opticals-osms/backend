const catchAsync = require('../utils/catchAsync');
const { createDoctor, listDoctors } = require('../services/doctor.service');

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

module.exports = {
  createDoctorHandler,
  getDoctorsHandler,
};
