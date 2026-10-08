const path = require('path');

/*
 * Prepare browser-facecrop for this CRA/JATOS consumer before start or build:
 * CRA imports a generated module bridge from src, while the browser loads the
 * worker, model, and WASM files from public under the deployed study URL.
 * The package helper validates and stages both outputs; this wrapper supplies
 * openDST's source, public, and URL paths.
 */
const distributionRoot = path.resolve(__dirname, '../node_modules/browser-facecrop/dist');
const generatedDirectory = path.resolve(__dirname, '../src/facecrop-generated');
const publicRoot = path.resolve(__dirname, '../public/assets/facecrop');
const workRoot = path.resolve(__dirname, '..');
const {stageDistribution} = require('browser-facecrop/scripts/stage-distribution.cjs');

stageDistribution(distributionRoot, {
    generatedDirectory,
    publicRoot,
    publicSubpath: '/assets/facecrop/',
    workRoot
});
