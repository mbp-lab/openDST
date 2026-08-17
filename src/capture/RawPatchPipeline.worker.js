import {FaceRoiProvider} from './FaceRoiProvider';
import {RawPatchProcessor} from './RawPatchProcessor';
import {RawPatchSegmenter} from './RawPatchPartAccumulator';
import {createMediaPipeFaceDetector} from './MediaPipeFaceDetector';

/* eslint-disable no-restricted-globals */

let detector = null;
let roiProvider = null;
let processor = null;
let segmenter = null;

function requireInitialized() {
    if (!detector || !roiProvider || !processor || !segmenter) {
        throw new Error('Raw patch worker is not initialized');
    }
}

async function initialize(payload) {
    const {configuration, identity} = payload;
    detector = await createMediaPipeFaceDetector({
        minDetectionConfidence: configuration.faceDetectionMinConfidence,
        minSuppressionThreshold: configuration.faceDetectionMinSuppressionThreshold
    });
    roiProvider = new FaceRoiProvider({
        smoothingTauMs: configuration.faceRoiSmoothingTauMs,
        scale: configuration.faceRoiScale,
        verticalShiftRatio: configuration.faceRoiVerticalShiftRatio,
        minDetectionConfidence: configuration.faceDetectionMinConfidence
    });
    processor = new RawPatchProcessor();
    segmenter = new RawPatchSegmenter({
        ...identity,
        selectionConfiguration: {
            minDetectionConfidence: configuration.faceDetectionMinConfidence,
            minSuppressionThreshold: configuration.faceDetectionMinSuppressionThreshold,
            policy: 'largest-eligible-bounding-box-v1'
        }
    });
    return {};
}

async function processFrame(payload) {
    requireInitialized();
    const {frame, width, height, timestampUs, wallClockMs} = payload;
    try {
        const result = detector.detectForVideo(frame, timestampUs / 1000);
        const selection = roiProvider.getSelection({width, height, detections: result.detections, timestampMs: timestampUs / 1000});
        if (!selection.roi) {
            return {accepted: false, detectionState: 'skipped', parts: []};
        }

        const rgbx = new Uint8Array(width * height * 4);
        await frame.copyTo(rgbx, {format: 'RGBX', colorSpace: 'srgb'});
        const bgr24 = processor.process({width, height, rgbx, roi: selection.roi});
        const parts = segmenter.appendFrame({
            bgr24,
            sourceWidth: width,
            sourceHeight: height,
            roi: selection.roi,
            provenance: selection,
            timestampUs,
            wallClockMs
        });
        return {accepted: true, detectionState: selection.state, parts};
    } finally {
        frame.close();
    }
}

function finish() {
    requireInitialized();
    return {parts: segmenter.finish()};
}

function close() {
    if (detector) {
        detector.close();
    }
    detector = null;
    roiProvider = null;
    processor = null;
    segmenter = null;
    return {};
}

const handlers = {initialize, processFrame, finish, close};

self.onmessage = async event => {
    const {id, type, payload} = event.data || {};
    try {
        if (!handlers[type]) {
            throw new Error('Unknown raw patch worker request: ' + type);
        }
        const result = await handlers[type](payload || {});
        const transfers = (result.parts || []).map(part => part.bytes.buffer);
        self.postMessage({id, result}, transfers);
    } catch (error) {
        self.postMessage({id, error: {
            name: error && error.name ? error.name : 'Error',
            message: error && error.message ? error.message : 'Raw patch worker failed'
        }});
    }
};
