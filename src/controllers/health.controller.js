function getHealthStatus(req, res) {
  res.status(200).json({
    status: 'ok',
    service: 'osms-backend',
  });
}

module.exports = {
  getHealthStatus,
};
