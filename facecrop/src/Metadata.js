export const CAPTURE_MANIFEST_SCHEMA = 'face-crop-manifest-v1';
export const FACE_EVENTS_SCHEMA = 'face-crop-events-v3';

function finiteOrNull(value) { return Number.isFinite(value) ? value : null; }

/** Compact per-part metadata without dropping frame-level scientific evidence. */
export function buildFaceEvents(input = {}) {
    const frames = Array.isArray(input.frames) ? input.frames : [];
    return {
        schema: FACE_EVENTS_SCHEMA,
        captureId: input.captureId || null,
        context: input.context || {},
        aviFilename: input.aviFilename || null,
        segmentIndex: Number.isSafeInteger(input.segmentIndex) ? input.segmentIndex : null,
        partIndex: Number.isSafeInteger(input.partIndex) ? input.partIndex : null,
        frameCount: Number.isSafeInteger(input.frameCount) ? input.frameCount : frames.length,
        precedingFramePresentationTimeUs: Number.isSafeInteger(input.precedingFramePresentationTimeUs)
            ? input.precedingFramePresentationTimeUs : null,
        validity: {source: input.source || null, selectionConfiguration: input.selectionConfiguration || null},
        analysis: {frames}
    };
}

/** Pure, versioned capture manifest builder. */
export function buildCaptureManifest({captureId, context = {}, filenamePrefix = null, source = null,
    capability = null, configuration = null, frameNormalization = null, status, reason = null, reasonCode,
    statistics = {}, parts = [], diagnostics} = {}) {
    const analysisParts = parts.map(part => ({filename: part.filename, faceEventsFilename: part.faceEventsFilename,
        segmentIndex: part.segmentIndex, partIndex: part.partIndex, frameCount: part.frameCount,
        frameRate: finiteOrNull(part.frameRate), byteLength: finiteOrNull(part.byteLength)}));
    const artifactOutcomes = parts.map(part => ({filename: part.filename, faceEventsFilename: part.faceEventsFilename,
        status: part.status || null, avi: part.avi ? {status: part.avi.status} : null,
        faceEvents: part.faceEvents ? {status: part.faceEvents.status} : null}));
    const resolvedReasonCode = reasonCode || (status === 'unsupported' ? 'CAPABILITY_UNSUPPORTED'
        : status === 'aborted' ? 'CAPTURE_ABORTED' : status === 'incomplete' ? 'CAPTURE_INCOMPLETE' : null);
    const appliedConfiguration = configuration ? {...configuration,
        detector: {...(configuration.detector || {}), implementation: 'blazeface', backend: 'wasm',
            modelVersion: 'blazeface-0.1.0', runtimeVersion: 'tfjs-4.22.0'}} : null;
    return {
        schema: CAPTURE_MANIFEST_SCHEMA,
        capture: {captureId, filenamePrefix, context},
        summary: {status, reasonCode: resolvedReasonCode, reason: reason || null,
            frameCount: statistics.acceptedFrames ?? 0, partCount: parts.length},
        analysis: {output: {format: 'patch-video-avi-gzip-bgr24-v1', container: 'avi.gz', videoCodec: 'DIB',
            pixelFormat: 'bgr24', frameSize: 72,
            sampling: {algorithm: 'area-average-v1', descriptorVersion: 2},
            aviHeaderFrameRatePolicy: 'required-per-part-from-presentationTimeUs-v1'},
            timestampAuthority: 'presentationTimeUs', parts: analysisParts},
        validity: {source: source ? {width: source.width ?? null, height: source.height ?? null} : null,
            configuration: appliedConfiguration, frameNormalization: frameNormalization || null,
            capability: capability ? {status: capability.status || null, failedStage: capability.failedStage || null} : null,
            health: {faceDetections: statistics.faceDetections ?? 0,
            faceDetectionMisses: statistics.faceDetectionMisses ?? 0,
            acceptedFrames: statistics.acceptedFrames ?? 0,
            frameCallbacks: statistics.frameCallbacks ?? 0,
            accounting: statistics.accounting || null,
            frameTimings: statistics.frameTimings || null,
            encodingTimings: statistics.encodingTimings || null,
            detectorWarmup: statistics.detectorWarmup || null}, artifactOutcomes},
        ...(diagnostics ? {diagnostics: {capability, detectorWarmup: statistics.detectorWarmup || null}} : {})
    };
}
