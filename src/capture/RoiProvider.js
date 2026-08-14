export const PATCH_SIZE = 72;

export const AXIS_ALIGNED_SQUARE = 'axis-aligned-square';
export const CAMERA_COORDINATE_SYSTEM = 'camera';
export const BLOCK_AVERAGE_V1 = 'block-average-v1';
export const ROI_DESCRIPTOR_VERSION = 1;

function requireInteger(value, fieldName, minimum) {
    if (!Number.isInteger(value) || value < minimum) {
        throw new Error(`${fieldName} must be an integer greater than or equal to ${minimum}`);
    }
}

/**
 * Validates the v1 resolved ROI descriptor used by RawPatchProcessor.
 */
export function validateRoiDescriptor(descriptor) {
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
        throw new Error('ROI descriptor must be an object');
    }

    if (descriptor.coordinateSystem !== CAMERA_COORDINATE_SYSTEM) {
        throw new Error(`Unsupported ROI coordinate system: ${descriptor.coordinateSystem}`);
    }
    if (descriptor.transformType !== AXIS_ALIGNED_SQUARE) {
        throw new Error(`Unsupported ROI transform type: ${descriptor.transformType}`);
    }
    if (descriptor.samplingVersion !== BLOCK_AVERAGE_V1) {
        throw new Error(`Unsupported ROI sampling version: ${descriptor.samplingVersion}`);
    }
    if (descriptor.descriptorVersion !== ROI_DESCRIPTOR_VERSION) {
        throw new Error(`Unsupported ROI descriptor version: ${descriptor.descriptorVersion}`);
    }

    requireInteger(descriptor.x, 'ROI x', 0);
    requireInteger(descriptor.y, 'ROI y', 0);
    requireInteger(descriptor.size, 'ROI size', PATCH_SIZE);

    if (descriptor.size % PATCH_SIZE !== 0) {
        throw new Error(`ROI size must be divisible by ${PATCH_SIZE}`);
    }

    return descriptor;
}

/**
 * Contract for resolving a source-frame ROI before deterministic processing.
 */
export class RoiProvider {
    getRoi() {
        throw new Error('RoiProvider implementations must define getRoi');
    }
}

/**
 * Produces the fixed, centered camera-horizontal ROI used by the v1 pipeline.
 */
export class CameraRoiProvider extends RoiProvider {
    getRoi({width, height}) {
        requireInteger(width, 'Source width', PATCH_SIZE);
        requireInteger(height, 'Source height', PATCH_SIZE);

        const blockSize = Math.floor(Math.min(width, height) / PATCH_SIZE);
        const size = PATCH_SIZE * blockSize;

        return validateRoiDescriptor({
            coordinateSystem: CAMERA_COORDINATE_SYSTEM,
            transformType: AXIS_ALIGNED_SQUARE,
            samplingVersion: BLOCK_AVERAGE_V1,
            descriptorVersion: ROI_DESCRIPTOR_VERSION,
            x: Math.floor((width - size) / 2),
            y: Math.floor((height - size) / 2),
            size
        });
    }
}
