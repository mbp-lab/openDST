import {RGB24_FRAME_BYTES} from './RawPatchProcessor';
import {validateRoiDescriptor} from './RoiProvider';
import {createPatchVideoFilename} from './AviPatchVideoFormat';

export const MAX_FRAMES_PER_PART = 539;

function validateFrame(rgb24) {
    if (!(rgb24 instanceof Uint8Array) && !(rgb24 instanceof Uint8ClampedArray)) {
        throw new Error('RGB24 frame must be a Uint8Array or Uint8ClampedArray');
    }
    if (rgb24.byteLength !== RGB24_FRAME_BYTES) {
        throw new Error(`RGB24 frame must contain exactly ${RGB24_FRAME_BYTES} bytes`);
    }
}

function sameRoi(left, right) {
    return left.coordinateSystem === right.coordinateSystem &&
        left.transformType === right.transformType &&
        left.samplingVersion === right.samplingVersion &&
        left.descriptorVersion === right.descriptorVersion &&
        left.x === right.x &&
        left.y === right.y &&
        left.size === right.size;
}

export class RawPatchPartAccumulator {
    constructor({filename, segmentIndex, partIndex, maxFrames}) {
        this.filename = filename;
        this.segmentIndex = segmentIndex;
        this.partIndex = partIndex;
        this.maxFrames = maxFrames;
        this.frames = [];
    }

    appendFrame({rgb24}) {
        if (this.frames.length >= this.maxFrames) {
            throw new Error('Cannot append to a full raw patch part');
        }
        validateFrame(rgb24);
        this.frames.push(new Uint8Array(rgb24));
    }

    get isFull() {
        return this.frames.length === this.maxFrames;
    }

    seal() {
        if (this.frames.length === 0) {
            return null;
        }

        const bytes = new Uint8Array(this.frames.length * RGB24_FRAME_BYTES);
        this.frames.forEach((frame, index) => bytes.set(frame, index * RGB24_FRAME_BYTES));

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
        this.segments = [];
        this.currentPart = null;
    }

    appendFrame({rgb24, sourceWidth, sourceHeight, roi, dynamicRoi = false}) {
        if (!Number.isSafeInteger(sourceWidth) || sourceWidth < 1 || !Number.isSafeInteger(sourceHeight) || sourceHeight < 1) {
            throw new Error('Source dimensions must be positive integers');
        }
        validateRoiDescriptor(roi);
        if (roi.x + roi.size > sourceWidth || roi.y + roi.size > sourceHeight) {
            throw new Error('ROI extends beyond source dimensions');
        }

        const sealedParts = [];
        let segment = this.segments[this.segments.length - 1];
        const startsSegment = !segment || segment.sourceWidth !== sourceWidth || segment.sourceHeight !== sourceHeight ||
            (!dynamicRoi && !sameRoi(segment.roi, roi));

        if (startsSegment) {
            const sealed = this.sealCurrentPart();
            if (sealed) {
                sealedParts.push(sealed);
            }
            segment = {
                segmentIndex: this.segments.length,
                sourceWidth,
                sourceHeight,
                roi: {...roi},
                parts: []
            };
            this.segments.push(segment);
        }

        if (!this.currentPart) {
            const partIndex = segment.parts.length;
            this.currentPart = new RawPatchPartAccumulator({
                segmentIndex: segment.segmentIndex,
                partIndex,
                maxFrames: this.maxFramesPerPart,
                filename: createPatchVideoFilename({...this.fileIdentity, segmentIndex: segment.segmentIndex, partIndex})
            });
        }

        this.currentPart.appendFrame({rgb24});
        if (this.currentPart.isFull) {
            sealedParts.push(this.sealCurrentPart());
        }

        return sealedParts;
    }

    finish() {
        const sealed = this.sealCurrentPart();
        return sealed ? [sealed] : [];
    }

    getSegments() {
        return this.segments.map(segment => ({
            ...segment,
            roi: {...segment.roi},
            parts: [...segment.parts]
        }));
    }

    sealCurrentPart() {
        if (!this.currentPart) {
            return null;
        }
        const sealed = this.currentPart.seal();
        const segment = this.segments[this.currentPart.segmentIndex];
        if (sealed) {
            segment.parts.push(sealed);
        }
        this.currentPart = null;
        return sealed;
    }
}
