import {BGR24_FRAME_BYTES} from './RawPatchProcessor';
import {validateFaceRoiDescriptor} from './FaceRoiProvider';
import {createFaceEventsFilename, createPatchVideoFilename, FACE_EVENTS_FORMAT_VERSION} from './AviPatchVideoFormat';

export const MAX_FRAMES_PER_PART = 539;

function validateFrame(bgr24) {
    if (!(bgr24 instanceof Uint8Array) && !(bgr24 instanceof Uint8ClampedArray)) {
        throw new Error('BGR24 frame must be a Uint8Array or Uint8ClampedArray');
    }
    if (bgr24.byteLength !== BGR24_FRAME_BYTES) {
        throw new Error('BGR24 frame must contain exactly ' + BGR24_FRAME_BYTES + ' bytes');
    }
}

function validateBoundingBox(box) {
    return box && Number.isFinite(box.originX) && Number.isFinite(box.originY) &&
        Number.isFinite(box.width) && Number.isFinite(box.height) && box.width > 0 && box.height > 0;
}

function validateProvenance(provenance, timestampUs, wallClockMs) {
    if (!provenance || !['largest', 'held', 'reacquired'].includes(provenance.state) ||
        !Number.isSafeInteger(provenance.candidateCount) || provenance.candidateCount < 0 ||
        !Number.isSafeInteger(timestampUs) || timestampUs < 0 ||
        !Number.isSafeInteger(wallClockMs) || wallClockMs < 0) {
        throw new Error('Patch frame provenance is invalid');
    }
    if (provenance.selectedScore !== null && (!Number.isFinite(provenance.selectedScore) ||
        provenance.selectedScore < 0 || provenance.selectedScore > 1)) {
        throw new Error('Patch frame selection score is invalid');
    }
    if (provenance.selectedBoundingBox !== null && !validateBoundingBox(provenance.selectedBoundingBox)) {
        throw new Error('Patch frame selected bounding box is invalid');
    }
}

function copyProvenance(provenance, frameIndex, timestampUs, wallClockMs, roi) {
    return {
        frameIndex,
        mediaTimeUs: timestampUs,
        wallClockMs,
        state: provenance.state,
        candidateCount: provenance.candidateCount,
        selectedScore: provenance.selectedScore,
        selectedBoundingBox: provenance.selectedBoundingBox ? {...provenance.selectedBoundingBox} : null,
        tieBreakOccurred: Boolean(provenance.tieBreakOccurred),
        roi: {...roi}
    };
}

export class RawPatchPartAccumulator {
    constructor({filename, faceEventsFilename, segmentIndex, partIndex, maxFrames, selectionConfiguration}) {
        this.filename = filename;
        this.faceEventsFilename = faceEventsFilename;
        this.segmentIndex = segmentIndex;
        this.partIndex = partIndex;
        this.maxFrames = maxFrames;
        this.selectionConfiguration = selectionConfiguration;
        this.frames = [];
        this.events = [];
    }

    appendFrame({bgr24, provenance, timestampUs, wallClockMs, roi}) {
        if (this.frames.length >= this.maxFrames) {
            throw new Error('Cannot append to a full raw patch part');
        }
        validateFrame(bgr24);
        validateProvenance(provenance, timestampUs, wallClockMs);
        this.events.push(copyProvenance(provenance, this.frames.length, timestampUs, wallClockMs, roi));
        this.frames.push(new Uint8Array(bgr24));
    }

    get isFull() {
        return this.frames.length === this.maxFrames;
    }

    seal() {
        if (this.frames.length === 0) {
            return null;
        }

        const bytes = new Uint8Array(this.frames.length * BGR24_FRAME_BYTES);
        this.frames.forEach((frame, index) => bytes.set(frame, index * BGR24_FRAME_BYTES));

        return {
            segmentIndex: this.segmentIndex,
            partIndex: this.partIndex,
            filename: this.filename,
            faceEventsFilename: this.faceEventsFilename,
            frameCount: this.frames.length,
            byteLength: bytes.byteLength,
            bytes,
            faceEvents: {
                formatVersion: FACE_EVENTS_FORMAT_VERSION,
                aviFilename: this.filename,
                segmentIndex: this.segmentIndex,
                partIndex: this.partIndex,
                frameCount: this.frames.length,
                selectionConfiguration: {...this.selectionConfiguration},
                frames: this.events
            }
        };
    }
}

/**
 * Segments frames by resolved geometry and seals no more than 539 frames per part.
 */
export class RawPatchSegmenter {
    constructor({studyResultId, studyPage, videoCounter, maxFramesPerPart = MAX_FRAMES_PER_PART, selectionConfiguration = {}}) {
        if (!Number.isSafeInteger(maxFramesPerPart) || maxFramesPerPart < 1 || maxFramesPerPart > MAX_FRAMES_PER_PART) {
            throw new Error('Max frames per part must be between 1 and ' + MAX_FRAMES_PER_PART);
        }
        this.fileIdentity = {studyResultId, studyPage, videoCounter};
        this.maxFramesPerPart = maxFramesPerPart;
        this.selectionConfiguration = {...selectionConfiguration};
        this.sourceDimensions = null;
        this.segmentIndex = -1;
        this.nextPartIndex = 0;
        this.currentPart = null;
    }

    appendFrame({bgr24, sourceWidth, sourceHeight, roi, provenance, timestampUs, wallClockMs}) {
        if (!Number.isSafeInteger(sourceWidth) || sourceWidth < 1 || !Number.isSafeInteger(sourceHeight) || sourceHeight < 1) {
            throw new Error('Source dimensions must be positive integers');
        }
        validateFaceRoiDescriptor(roi);
        if (roi.x + roi.size > sourceWidth || roi.y + roi.size > sourceHeight) {
            throw new Error('ROI extends beyond source dimensions');
        }

        const dimensionsChanged = !this.sourceDimensions || this.sourceDimensions.width !== sourceWidth || this.sourceDimensions.height !== sourceHeight;
        const previousPart = dimensionsChanged ? this.sealCurrentPart() : null;
        if (dimensionsChanged) {
            this.sourceDimensions = {width: sourceWidth, height: sourceHeight};
            this.segmentIndex += 1;
            this.nextPartIndex = 0;
        }
        if (!this.currentPart) {
            const partIndex = this.nextPartIndex;
            const identity = {...this.fileIdentity, segmentIndex: this.segmentIndex, partIndex};
            this.currentPart = new RawPatchPartAccumulator({
                segmentIndex: this.segmentIndex,
                partIndex,
                maxFrames: this.maxFramesPerPart,
                filename: createPatchVideoFilename(identity),
                faceEventsFilename: createFaceEventsFilename(identity),
                selectionConfiguration: this.selectionConfiguration
            });
        }

        this.currentPart.appendFrame({bgr24, provenance, timestampUs, wallClockMs, roi});
        const fullPart = this.currentPart.isFull ? this.sealCurrentPart() : null;
        return [previousPart, fullPart].filter(Boolean);
    }

    finish() {
        const sealed = this.sealCurrentPart();
        return sealed ? [sealed] : [];
    }

    sealCurrentPart() {
        if (!this.currentPart) {
            return null;
        }
        const sealed = this.currentPart.seal();
        this.currentPart = null;
        if (sealed) {
            this.nextPartIndex += 1;
        }
        return sealed;
    }
}
