import {PATCH_SIZE, validateRoiDescriptor} from './RoiProvider';

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
 * Reference v1 processor: deterministic block averaging from RGBX to RGB24.
 */
export class RawPatchProcessor {
    process({rgbx, width, height, roi}) {
        validateSource(rgbx, width, height);
        validateRoiDescriptor(roi);
        validateRoiBounds(roi, width, height);

        const blockSize = roi.size / PATCH_SIZE;
        const blockArea = blockSize * blockSize;
        const halfArea = Math.floor(blockArea / 2);
        const rgb24 = new Uint8Array(RGB24_FRAME_BYTES);

        for (let patchY = 0; patchY < PATCH_SIZE; patchY += 1) {
            for (let patchX = 0; patchX < PATCH_SIZE; patchX += 1) {
                let red = 0;
                let green = 0;
                let blue = 0;

                for (let sourceY = 0; sourceY < blockSize; sourceY += 1) {
                    const rowOffset = ((roi.y + patchY * blockSize + sourceY) * width + roi.x + patchX * blockSize) * RGBX_BYTES_PER_PIXEL;

                    for (let sourceX = 0; sourceX < blockSize; sourceX += 1) {
                        const offset = rowOffset + sourceX * RGBX_BYTES_PER_PIXEL;
                        red += rgbx[offset];
                        green += rgbx[offset + 1];
                        blue += rgbx[offset + 2];
                    }
                }

                const outputOffset = (patchY * PATCH_SIZE + patchX) * RGB24_BYTES_PER_PIXEL;
                rgb24[outputOffset] = Math.floor((red + halfArea) / blockArea);
                rgb24[outputOffset + 1] = Math.floor((green + halfArea) / blockArea);
                rgb24[outputOffset + 2] = Math.floor((blue + halfArea) / blockArea);
            }
        }

        return rgb24;
    }
}
