export const PATCH_SIZE = 72;

export const FACE_COORDINATE_SYSTEM = 'face';
export const AREA_AVERAGE_V1 = 'area-average-v1';
export const FACE_ROI_DESCRIPTOR_VERSION = 2;
export const DYNAMIC_FACE_SQUARE = 'dynamic-face-square';

function requireInteger(value, fieldName, minimum) {
    if (!Number.isInteger(value) || value < minimum) {
        throw new Error(`${fieldName} must be an integer greater than or equal to ${minimum}`);
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
        throw new Error(`Unsupported ROI coordinate system: ${descriptor.coordinateSystem}`);
    }
    if (!isFaceRoi) {
        throw new Error(`Unsupported ROI transform type: ${descriptor.transformType}`);
    }
    if (descriptor.samplingVersion !== AREA_AVERAGE_V1) {
        throw new Error(`Unsupported ROI sampling version: ${descriptor.samplingVersion}`);
    }
    requireInteger(descriptor.x, 'ROI x', 0);
    requireInteger(descriptor.y, 'ROI y', 0);
    requireInteger(descriptor.size, 'ROI size', PATCH_SIZE);

    return descriptor;
}


/**
 * Converts MediaPipe face bounding boxes into stable, in-bounds square crops.
 * The previous crop is retained briefly across missed detections and smoothed
 * to avoid visible jitter. Crop geometry remains in source pixels; arbitrary
 * crop sizes are reduced by the deterministic area downsampler.
 */
export class FaceRoiProvider {
    constructor({scale = 1.5, upwardOffsetRatio = 0.15, smoothingWindowMs = 167, maxMissedFrames = 15} = {}) {
        requireInteger(smoothingWindowMs, 'Face ROI smoothing window', 0);
        if (!Number.isFinite(scale) || scale < 1 || scale > 3) {
            throw new Error('Face ROI scale must be between 1 and 3');
        }
        if (!Number.isFinite(upwardOffsetRatio) || upwardOffsetRatio < 0 || upwardOffsetRatio > 0.5) {
            throw new Error('Face ROI upward offset ratio must be between 0 and 0.5');
        }
        this.scale = scale;
        this.upwardOffsetRatio = upwardOffsetRatio;
        this.smoothingWindowMs = smoothingWindowMs;
        this.maxMissedFrames = maxMissedFrames;
        this.previous = null;
        this.previousDetectionTimestampMs = null;
        this.missedFrames = 0;
    }

    smoothingCoefficient(timestampMs) {
        if (!this.previous || !Number.isFinite(timestampMs) || !Number.isFinite(this.previousDetectionTimestampMs) || this.smoothingWindowMs === 0) {
            return 1;
        }
        const elapsedMs = Math.max(0, timestampMs - this.previousDetectionTimestampMs);
        return 1 - Math.exp((-2 * elapsedMs) / this.smoothingWindowMs);
    }

    getRoi({width, height, detections, timestampMs}) {
        requireInteger(width, 'Source width', PATCH_SIZE);
        requireInteger(height, 'Source height', PATCH_SIZE);
        const detection = detections && detections.find(item => item && item.boundingBox);

        if (!detection) {
            this.missedFrames += 1;
            if (this.previous && this.previous.x + this.previous.size <= width && this.previous.y + this.previous.size <= height &&
                this.missedFrames <= this.maxMissedFrames) {
                return {...this.previous};
            }
            this.previous = null;
            this.previousDetectionTimestampMs = null;
            return null;
        }

        const box = detection.boundingBox;
        const smoothing = this.smoothingCoefficient(timestampMs);
        const rawSize = Math.max(box.width, box.height) * this.scale;
        const maximumSize = Math.min(width, height);
        const targetSize = Math.max(PATCH_SIZE, Math.min(maximumSize, Math.ceil(rawSize)));
        const smoothedSize = this.previous ? this.previous.size + (targetSize - this.previous.size) * smoothing : targetSize;
        const size = Math.max(PATCH_SIZE, Math.min(maximumSize, Math.round(smoothedSize)));
        const targetX = Math.max(0, Math.min(width - size, box.originX + box.width / 2 - size / 2));
        const targetY = Math.max(0, Math.min(height - size, box.originY + box.height / 2 - size / 2 - size * this.upwardOffsetRatio));
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
        this.missedFrames = 0;
        return {...this.previous};
    }
}
