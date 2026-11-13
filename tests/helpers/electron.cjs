const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const launch = promisify(execFile);

module.exports = function runElectron(args, options = {}) {
  const env = { ...process.env, ...options.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // CI and containers may prohibit Chromium's Linux namespaces.
  const flags = process.platform === 'linux' && env.CASEPILOT_ELECTRON_TEST_NO_SANDBOX === '1'
    ? ['--no-sandbox']
    : [];
  return launch(require('electron'), [...flags, ...args], {
    maxBuffer: 200000,
    killSignal: 'SIGKILL',
    ...options,
    env,
  });
};
