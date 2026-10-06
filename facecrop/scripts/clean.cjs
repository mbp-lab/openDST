const fs = require('fs');
const path = require('path');

const dist = path.resolve(__dirname, '..', 'dist');
fs.rmSync(dist, {recursive: true, force: true});
