const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const {execFileSync} = require('child_process');

// Compile the optional entry and default core with the consuming app's production Babel settings.
test('the optional React entry works through the consumer bundler', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'facecrop-react-consumer-'));
    const appRoot = path.resolve(__dirname, '../..');
    const packageRoot = path.join(appRoot, 'browser-facecrop');
    const resolveCompiler = name => require.resolve(name, {paths: [path.join(appRoot, 'node_modules/react-scripts')]});
    const configuration = {
        mode: 'production', context: appRoot, optimization: {minimize: false},
        entry: path.join(packageRoot, 'react/index.js'),
        output: {path: directory, filename: 'consumer.js', libraryTarget: 'commonjs2'},
        externals: {react: 'commonjs react'},
        module: {rules: [{include: [path.join(packageRoot, 'react'), path.join(packageRoot, 'dist')],
            use: {loader: resolveCompiler('babel-loader'), options: {
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
        const sandbox = {module: output, exports: output.exports, require, window, self: window, URL, console};
        vm.createContext(sandbox);
        vm.runInContext(fs.readFileSync(path.join(directory, 'consumer.js'), 'utf8'), sandbox);
        expect(typeof output.exports.useFaceCropSession).toBe('function');
        expect(typeof output.exports.createReactHooksWithDefaultCore().useFaceCropSession).toBe('function');
        expect(window.Facecrop).toBeUndefined();
    } finally { fs.rmSync(directory, {recursive: true, force: true}); }
}, 30000);
