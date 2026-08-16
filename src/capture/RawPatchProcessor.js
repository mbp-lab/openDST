import {PATCH_SIZE, validateRoiDescriptor} from './RoiProvider';
import {AreaRgbxDownsampler} from './AreaRgbxDownsampler';

export const RGBX_BYTES_PER_PIXEL = 4;
export const RGB24_BYTES_PER_PIXEL = 3;
export const RGB24_FRAME_BYTES = PATCH_SIZE * PATCH_SIZE * RGB24_BYTES_PER_PIXEL;

function validateSource(rgbx, width, height) {
    if (!(rgbx instanceof Uint8Array) && !(rgbx instanceof Uint8ClampedArray)) {
        throw new Error('RGBX source must be a Uint8Array or Uint8ClampedArray');
    }
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
        throw new Error('Source dimensions must be positive integers');
    }
    if (rgbx.byteLength !== width * height * RGBX_BYTES_PER_PIXEL) {
        throw new Error('RGBX source must be tightly packed for the supplied dimensions');
    }
}

function validateRoiBounds(roi, width, height) {
    if (roi.x + roi.size > width || roi.y + roi.size > height) {
        throw new Error('ROI extends beyond source dimensions');
    }
}

/**
 * Resolves an already-selected source crop into deterministic 72 by 72 RGB24.
 */
export class RawPatchProcessor {
    constructor() {
        this.areaDownsampler = new AreaRgbxDownsampler();
    }

    process({rgbx, width, height, roi}) {
        validateSource(rgbx, width, height);
        validateRoiDescriptor(roi);
        validateRoiBounds(roi, width, height);

        return this.areaDownsampler.downsample({rgbx, width, roi});
    }
}
