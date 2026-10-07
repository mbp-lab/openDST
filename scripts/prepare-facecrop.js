/** Install, build, and stage the browser capture distribution for this app. */
const path = require('path');
const {execFileSync} = require('child_process');

const appRoot = path.resolve(__dirname, '..');
const packageRoot = path.join(appRoot, 'browser-facecrop');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args, cwd) {
    execFileSync(npm, args, {cwd, stdio: 'inherit'});
}

function main() {
    run(['ci'], packageRoot);
    run(['run', 'facecrop:stage'], appRoot);
}

if (require.main === module) {
    try { main(); }
    catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}

module.exports = {main};
