const { createApp } = require('./app');
const { loadConfig } = require('./config/env');
const temporaryLintFailure = 'CI lint test';

const { port } = loadConfig();
const app = createApp();

app.listen(port, () => {
  console.log(`OSMS backend listening on port ${port}`);
});
