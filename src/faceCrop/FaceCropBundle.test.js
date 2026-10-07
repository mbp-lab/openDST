const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const {execFileSync} = require('child_process');

// Jest's CommonJS transform misses the production Babel/UMD interoperability bug.
// Compile the actual staged entry with CRA's production preset and Webpack.
let library;
let createSession;
beforeAll(() => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'facecrop-consumer-'));
    const appRoot = path.resolve(__dirname, '../..');
    const resolveCompiler = name => require.resolve(name, {paths: [path.join(appRoot, 'node_modules/react-scripts')]});
    const configuration = {
        mode: 'production', context: appRoot, optimization: {minimize: false},
        entry: path.join(__dirname, 'generated/facecrop.js'),
        output: {path: directory, filename: 'consumer.js', libraryTarget: 'commonjs2'},
        module: {rules: [{include: path.join(__dirname, 'generated'), use: {loader: resolveCompiler('babel-loader'), options: {
            customize: resolveCompiler('babel-preset-react-app/webpack-overrides'),
            babelrc: false, configFile: false,
            presets: [resolveCompiler('babel-preset-react-app')], compact: true
        }}}]}
    };
    try {
        execFileSync(process.execPath, ['-e', `
            const webpack = require(${JSON.stringify(resolveCompiler('webpack'))});
            webpack(${JSON.stringify(configuration)}, (error, stats) => {
                if (error || stats.hasErrors()) {
                    console.error(error || stats.toString({all: false, errors: true}));
                    process.exitCode = 1;
                }
            });
        `], {cwd: appRoot, env: {...process.env, NODE_ENV: 'production', BABEL_ENV: 'production',
            NODE_OPTIONS: '--openssl-legacy-provider'}, stdio: 'pipe', timeout: 25000});
        const output = {exports: {}};
        const sandbox = {module: output, exports: output.exports, window, self: window, URL, console};
        vm.createContext(sandbox);
        vm.runInContext(fs.readFileSync(path.join(directory, 'consumer.js'), 'utf8'), sandbox);
        library = output.exports;
        // Create JSON objects in the module's realm, as a browser consumer does.
        createSession = vm.runInContext(`(input, transport) => {
            const context = JSON.parse(JSON.stringify(input));
            const session = module.exports.createCaptureSession({video: {}, context,
                assetBaseUrl: 'https://example.test/study_assets/facecrop/', transport});
            return {session, context};
        }`, sandbox);
    } finally {
        fs.rmSync(directory, {recursive: true, force: true});
    }
}, 30000);

test('the production consumer exposes the standalone API without global assignment', () => {
    for (const name of ['validateConfiguration', 'createCaptureSession', 'createJatosTransport']) {
        expect(typeof library[name]).toBe('function');
    }
    expect(library.validateConfiguration().roi.scale).toBe(1.5);
    expect(window.Facecrop).toBeUndefined();
});

test('the production consumer preserves context and reports unsupported capture without writes', async () => {
    const context = {studyPage: 'speechTask', trial: {number: 2}};
    const uploadResultFile = jest.fn(() => Promise.resolve());
    const prepared = createSession(context, library.createJatosTransport({uploadResultFile}));
    const {session} = prepared;
    prepared.context.trial.number = 3;
    expect(session.getResult().capture.context.trial.number).toBe(2);
    await expect(session.prepare()).resolves.toMatchObject({status: 'unsupported', reasonCode: 'CAPABILITY_UNSUPPORTED'});
    await session.dispose();
    expect(uploadResultFile).not.toHaveBeenCalled();
});
