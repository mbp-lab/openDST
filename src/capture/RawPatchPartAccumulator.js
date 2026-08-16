import {BGR24_FRAME_BYTES} from './RawPatchProcessor';
import {validateFaceRoiDescriptor} from './FaceRoiProvider';
import {createPatchVideoFilename} from './AviPatchVideoFormat';

export const MAX_FRAMES_PER_PART = 539;

function validateFrame(bgr24) {
    if (!(bgr24 instanceof Uint8Array) && !(bgr24 instanceof Uint8ClampedArray)) {
        throw new Error('BGR24 frame must be a Uint8Array or Uint8ClampedArray');
    }
    if (bgr24.byteLength !== BGR24_FRAME_BYTES) {
        throw new Error(`BGR24 frame must contain exactly ${BGR24_FRAME_BYTES} bytes`);
    }
}


export class RawPatchPartAccumulator {
    constructor({filename, segmentIndex, partIndex, maxFrames}) {
        this.filename = filename;
        this.segmentIndex = segmentIndex;
        this.partIndex = partIndex;
        this.maxFrames = maxFrames;
        this.frames = [];
    }

    appendFrame({bgr24}) {
        if (this.frames.length >= this.maxFrames) {
            throw new Error('Cannot append to a full raw patch part');
        }
        validateFrame(bgr24);
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
            frameCount: this.frames.length,
            byteLength: bytes.byteLength,
            bytes
        };
    }
}

/**
 * Segments frames by resolved geometry and seals no more than 539 frames per part.
 */
export class RawPatchSegmenter {
    constructor({studyResultId, studyPage, videoCounter, maxFramesPerPart = MAX_FRAMES_PER_PART}) {
        if (!Number.isSafeInteger(maxFramesPerPart) || maxFramesPerPart < 1 || maxFramesPerPart > MAX_FRAMES_PER_PART) {
            throw new Error(`Max frames per part must be between 1 and ${MAX_FRAMES_PER_PART}`);
        }
        this.fileIdentity = {studyResultId, studyPage, videoCounter};
        this.maxFramesPerPart = maxFramesPerPart;
        this.sourceDimensions = null;
        this.segmentIndex = -1;
        this.nextPartIndex = 0;
        this.currentPart = null;
    }

    appendFrame({bgr24, sourceWidth, sourceHeight, roi}) {
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
            this.currentPart = new RawPatchPartAccumulator({
                segmentIndex: this.segmentIndex,
                partIndex,
                maxFrames: this.maxFramesPerPart,
                filename: createPatchVideoFilename({...this.fileIdentity, segmentIndex: this.segmentIndex, partIndex})
            });
        }

        this.currentPart.appendFrame({bgr24});
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
