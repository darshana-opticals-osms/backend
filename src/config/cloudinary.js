const { v2: cloudinary } = require('cloudinary');
const { loadConfig } = require('./env');

let config = {};
try {
  config = loadConfig();
} catch {
  config = {
    cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
    cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
    cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,
  };
}

cloudinary.config({
  cloud_name: config.cloudinaryCloudName || process.env.CLOUDINARY_CLOUD_NAME,
  api_key: config.cloudinaryApiKey || process.env.CLOUDINARY_API_KEY,
  api_secret: config.cloudinaryApiSecret || process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

module.exports = cloudinary;
