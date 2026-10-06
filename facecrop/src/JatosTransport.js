/** Adapter has no global lookup, study selection, camera policy, or deletion side effects. */
export function createJatosTransport(jatosApi) {
    if (!jatosApi || typeof jatosApi.uploadResultFile !== 'function') throw new TypeError('JATOS uploadResultFile is required');
    return Object.freeze({write: ({filename, payload}) => Promise.resolve().then(() => jatosApi.uploadResultFile(payload, filename))});
}
