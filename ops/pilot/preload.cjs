'use strict';
// Guard the real child entry too; never import models or provision indexes.
const path = require('path');
const { inspectRelease } = require('./launch.cjs');
try {
  const approved = inspectRelease(process.env.PILOT_RELEASE_SPEC, process.env.PILOT_PROCESS_ROLE);
  if (path.resolve(process.argv[1]) !== approved.entry) throw new Error('wrong entry');
  const mongoose = require(path.join(approved.root, 'backend/node_modules/mongoose'));
  mongoose.set('autoIndex', false); mongoose.set('autoCreate', false);
} catch { console.error('PILOT_CHILD_GUARD_REFUSED'); process.exit(1); }
