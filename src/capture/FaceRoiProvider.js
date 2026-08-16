export const PATCH_SIZE = 72;

export const FACE_COORDINATE_SYSTEM = 'face';
export const AREA_AVERAGE_V1 = 'area-average-v1';
export const FACE_ROI_DESCRIPTOR_VERSION = 2;
export const DYNAMIC_FACE_SQUARE = 'dynamic-face-square';

function requireInteger(value, fieldName, minimum) {
    if (!Number.isInteger(value) || value < minimum) {
        throw new Error(fieldName + ' must be an integer greater than or equal to ' + minimum);
    }
}

/**
 * Validates the resolved face ROI descriptor used by RawPatchProcessor.
 */
export function validateFaceRoiDescriptor(descriptor) {
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
        throw new Error('ROI descriptor must be an object');
    }

    const isFaceRoi = descriptor.coordinateSystem === FACE_COORDINATE_SYSTEM &&
        descriptor.transformType === DYNAMIC_FACE_SQUARE &&
        descriptor.samplingVersion === AREA_AVERAGE_V1 &&
        descriptor.descriptorVersion === FACE_ROI_DESCRIPTOR_VERSION;

    if (descriptor.coordinateSystem !== FACE_COORDINATE_SYSTEM) {
        throw new Error('Unsupported ROI coordinate system: ' + descriptor.coordinateSystem);
    }
    if (!isFaceRoi) {
        throw new Error('Unsupported ROI transform type: ' + descriptor.transformType);
    }
    if (descriptor.samplingVersion !== AREA_AVERAGE_V1) {
        throw new Error('Unsupported ROI sampling version: ' + descriptor.samplingVersion);
    }
    requireInteger(descriptor.x, 'ROI x', 0);
    requireInteger(descriptor.y, 'ROI y', 0);
    requireInteger(descriptor.size, 'ROI size', PATCH_SIZE);

    return descriptor;
}

function isFiniteBoundingBox(box) {
    return box && Number.isFinite(box.originX) && Number.isFinite(box.originY) &&
        Number.isFinite(box.width) && Number.isFinite(box.height) && box.width > 0 && box.height > 0;
}

function detectionScore(detection) {
    const category = detection && Array.isArray(detection.categories) ? detection.categories[0] : null;
    return category && Number.isFinite(category.score) ? category.score : null;
}

function compareEligibleDetections(left, right) {
    if (left.area !== right.area) {
        return right.area - left.area;
    }
    if (left.score !== right.score) {
        return right.score - left.score;
    }
    if (left.box.originX !== right.box.originX) {
        return left.box.originX - right.box.originX;
    }
    if (left.box.originY !== right.box.originY) {
        return left.box.originY - right.box.originY;
    }
    return left.index - right.index;
}

function copyBoundingBox(box) {
    return {originX: box.originX, originY: box.originY, width: box.width, height: box.height};
}

/**
 * Converts MediaPipe face bounding boxes into stable, in-bounds square crops.
 * The largest eligible MediaPipe bounding box is selected independently on
 * every detector run. Once a crop exists, it is retained across missed detections
 * so every subsequently accepted patch frame has source imagery and provenance.
 */
export class FaceRoiProvider {
    constructor({scale = 1.5, verticalShiftRatio = 0.15, smoothingTauMs = 100,
        minDetectionConfidence = 0.5} = {}) {
        requireInteger(smoothingTauMs, 'Face ROI time constant', 0);
        if (!Number.isFinite(scale) || scale < 1 || scale > 3) {
            throw new Error('Face ROI scale must be between 1 and 3');
        }
        if (!Number.isFinite(verticalShiftRatio) || verticalShiftRatio < -1 || verticalShiftRatio > 1) {
            throw new Error('Face ROI vertical shift ratio must be between -1 and 1');
        }
        if (!Number.isFinite(minDetectionConfidence) || minDetectionConfidence < 0 || minDetectionConfidence > 1) {
            throw new Error('Face ROI detection confidence must be between 0 and 1');
        }
        this.scale = scale;
        this.verticalShiftRatio = verticalShiftRatio;
        this.smoothingTauMs = smoothingTauMs;
        this.minDetectionConfidence = minDetectionConfidence;
        this.previous = null;
        this.previousDetectionTimestampMs = null;
        this.hadNoEligibleFace = false;
    }

    smoothingCoefficient(timestampMs) {
        if (!this.previous || !Number.isFinite(timestampMs) || !Number.isFinite(this.previousDetectionTimestampMs) || this.smoothingTauMs === 0) {
            return 1;
        }
        const elapsedMs = Math.max(0, timestampMs - this.previousDetectionTimestampMs);
        return 1 - Math.exp(-elapsedMs / this.smoothingTauMs);
    }

    eligibleDetections(detections) {
        return (detections || []).map((detection, index) => {
            const box = detection && detection.boundingBox;
            const score = detectionScore(detection);
            return {box, score, index, area: box && box.width * box.height};
        }).filter(candidate => isFiniteBoundingBox(candidate.box) &&
            Number.isFinite(candidate.score) && candidate.score >= this.minDetectionConfidence)
            .sort(compareEligibleDetections);
    }

    selectionForMiss({width, height, candidateCount}) {
        const canHold = this.previous && this.previous.x + this.previous.size <= width && this.previous.y + this.previous.size <= height;
        this.hadNoEligibleFace = true;
        if (canHold) {
            return {roi: {...this.previous}, state: 'held', candidateCount, selectedScore: null, selectedBoundingBox: null, tieBreakOccurred: false};
        }
        this.previous = null;
        this.previousDetectionTimestampMs = null;
        return {roi: null, state: 'skipped', candidateCount, selectedScore: null, selectedBoundingBox: null, tieBreakOccurred: false};
    }

    getSelection({width, height, detections, timestampMs}) {
        requireInteger(width, 'Source width', PATCH_SIZE);
        requireInteger(height, 'Source height', PATCH_SIZE);
        const eligible = this.eligibleDetections(detections);

        if (eligible.length === 0) {
            return this.selectionForMiss({width, height, candidateCount: 0});
        }

        const selected = eligible[0];
        const box = selected.box;
        const smoothing = this.smoothingCoefficient(timestampMs);
        const rawSize = Math.max(box.width, box.height) * this.scale;
        const maximumSize = Math.min(width, height);
        const targetSize = Math.max(PATCH_SIZE, Math.min(maximumSize, Math.ceil(rawSize)));
        const smoothedSize = this.previous ? this.previous.size + (targetSize - this.previous.size) * smoothing : targetSize;
        const size = Math.max(PATCH_SIZE, Math.min(maximumSize, Math.round(smoothedSize)));
        const targetX = Math.max(0, Math.min(width - size, box.originX + box.width / 2 - size / 2));
        const targetY = Math.max(0, Math.min(height - size, box.originY + box.height / 2 - size / 2 - size * this.verticalShiftRatio));
        const x = this.previous ? this.previous.x + (targetX - this.previous.x) * smoothing : targetX;
        const y = this.previous ? this.previous.y + (targetY - this.previous.y) * smoothing : targetY;

        this.previous = validateFaceRoiDescriptor({
            coordinateSystem: FACE_COORDINATE_SYSTEM,
            transformType: DYNAMIC_FACE_SQUARE,
            samplingVersion: AREA_AVERAGE_V1,
            descriptorVersion: FACE_ROI_DESCRIPTOR_VERSION,
            x: Math.max(0, Math.min(width - size, Math.round(x))),
            y: Math.max(0, Math.min(height - size, Math.round(y))),
            size
        });
        this.previousDetectionTimestampMs = Number.isFinite(timestampMs) ? timestampMs : null;
        const state = this.hadNoEligibleFace ? 'reacquired' : 'largest';
        this.hadNoEligibleFace = false;
        const tieBreakOccurred = eligible.length > 1 && eligible[0].area === eligible[1].area;
        return {
            roi: {...this.previous},
            state,
            candidateCount: eligible.length,
            selectedScore: selected.score,
            selectedBoundingBox: copyBoundingBox(box),
            tieBreakOccurred
        };
    }

    getRoi(input) {
        return this.getSelection(input).roi;
    }
}
