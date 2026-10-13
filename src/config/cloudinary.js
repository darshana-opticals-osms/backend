const { v2: cloudinary } = require('cloudinary');
const { loadConfig } = require('./env');

const config = loadConfig();

cloudinary.config({
  cloud_name: config.cloudinaryCloudName,
  api_key: config.cloudinaryApiKey,
  api_secret: config.cloudinaryApiSecret,
  secure: true,
});

module.exports = cloudinary;
