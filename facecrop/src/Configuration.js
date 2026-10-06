const DEFAULTS = {
    roi: {smoothingTauMs: 100, scale: 1.5, verticalShiftRatio: 0.15},
    detector: {minConfidence: 0.5},
    pipeline: {analysisWorkerCount: 1},
    persistence: {maxAttempts: 3, retryDelayMs: 100},
    diagnostics: false
};

function object(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
        throw new TypeError(name + ' must be a configuration object');
    }
}
function keys(value, allowed, name) {
    object(value, name);
    Object.keys(value).forEach(key => {
        if (!allowed.includes(key)) throw new TypeError('Unknown configuration setting: ' + name + '.' + key);
    });
}
function number(value, minimum, maximum, integer, name) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum ||
        (integer && !Number.isSafeInteger(value))) throw new RangeError(name + ' must be ' +
            (integer ? 'an integer' : 'a number') + ' between ' + minimum + ' and ' + maximum);
}

/** Validate without coercion. Missing fields use documented defaults; invalid fields never do. */
export function validateConfiguration(config = {}) {
    keys(config, Object.keys(DEFAULTS), 'config');
    const resolved = {};
    Object.keys(DEFAULTS).filter(key => key !== 'diagnostics').forEach(group => {
        const supplied = config[group] === undefined ? {} : config[group];
        keys(supplied, Object.keys(DEFAULTS[group]), 'config.' + group);
        resolved[group] = {...DEFAULTS[group], ...supplied};
    });
    resolved.diagnostics = config.diagnostics === undefined ? false : config.diagnostics;
    if (typeof resolved.diagnostics !== 'boolean') throw new TypeError('config.diagnostics must be boolean');
    number(resolved.roi.smoothingTauMs, 0, 10000, true, 'roi.smoothingTauMs');
    number(resolved.roi.scale, 1, 3, false, 'roi.scale');
    number(resolved.roi.verticalShiftRatio, -1, 1, false, 'roi.verticalShiftRatio');
    number(resolved.detector.minConfidence, 0, 1, false, 'detector.minConfidence');
    number(resolved.pipeline.analysisWorkerCount, 1, 2, true, 'pipeline.analysisWorkerCount');
    number(resolved.persistence.maxAttempts, 1, 10, true, 'persistence.maxAttempts');
    number(resolved.persistence.retryDelayMs, 0, 60000, true, 'persistence.retryDelayMs');
    Object.keys(resolved).filter(key => key !== 'diagnostics').forEach(key => Object.freeze(resolved[key]));
    return Object.freeze(resolved);
}

export function controllerConfiguration(config) {
    return {faceRoiSmoothingTauMs: config.roi.smoothingTauMs, faceRoiScale: config.roi.scale,
        faceRoiVerticalShiftRatio: config.roi.verticalShiftRatio, faceDetectionMinConfidence: config.detector.minConfidence,
        analysisWorkerCount: config.pipeline.analysisWorkerCount, maxAttempts: config.persistence.maxAttempts,
        retryDelayMs: config.persistence.retryDelayMs, diagnostics: config.diagnostics};
}
