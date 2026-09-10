const { createApp } = require('./app');
const { connectDatabase } = require('./config/database');
const { loadConfig } = require('./config/env');

async function startServer() {
  const { port } = loadConfig();
  const app = createApp();

  try {
    await connectDatabase();
    app.listen(port, () => {
      console.log(`OSMS backend listening on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to start OSMS backend:', error.message);
    process.exit(1);
  }
}

startServer();
