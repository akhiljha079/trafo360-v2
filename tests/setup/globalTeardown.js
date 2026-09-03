// Nothing global to tear down - each test file closes its own DB pool/app
// handles in its own afterAll. `npm test` runs Jest with --forceExit as a
// pragmatic backstop against any connection-pool timers Jest can't detect.
module.exports = async function globalTeardown() {};
