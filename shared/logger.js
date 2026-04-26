const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { PATHS } = require('./config');

function makeLogger(name) {
  fs.mkdirSync(PATHS.logs, { recursive: true });
  const file = path.join(PATHS.logs, `${name}.jsonl`);
  const dest = pino.destination({ dest: file, sync: false, mkdir: true });
  return pino(
    {
      name,
      base: { agent: name },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    dest,
  );
}

module.exports = { makeLogger };
