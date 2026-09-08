const { createApp } = require('./app');
const { loadConfig } = require('./config/env');

const { port } = loadConfig();
const app = createApp();

app.listen(port, () => {
  console.log(`OSMS backend listening on port ${port}`);
});
