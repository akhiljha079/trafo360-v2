// Structured (JSON) logger, ships to any log aggregator without extra config.
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
});

module.exports = logger;
