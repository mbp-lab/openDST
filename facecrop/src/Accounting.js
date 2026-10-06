/** Stage equations describe integrity, not whether a face was freshly detected. */
export function reconcileAccounting(accounting, acceptedFrames) {
    const checks = {
        submitted: accounting.submittedFrames === accounting.processedFrames + accounting.failedProcessingFrames,
        assembly: acceptedFrames === accounting.sealedFrames,
        encoding: accounting.sealedFrames === accounting.encodedFrames + accounting.failedEncodingFrames,
        persistence: accounting.encodedFrames === accounting.persistedFrames + accounting.failedPersistenceFrames
    };
    return {status: Object.values(checks).every(Boolean) ? 'consistent' : 'inconsistent', checks,
        callbackGapsInterpretation: 'Browser presentation gaps; cause is not attributable from callback metadata'};
}
