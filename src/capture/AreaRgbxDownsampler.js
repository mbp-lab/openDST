import {PATCH_SIZE} from './FaceRoiProvider';

const RGBX_BYTES_PER_PIXEL = 4;
const BGR24_BYTES_PER_PIXEL = 3;

function buildAxisWeights(sourceSize) {
    return Array.from({length: PATCH_SIZE}, (_, outputIndex) => {
        const outputStart = outputIndex * sourceSize;
        const outputEnd = outputStart + sourceSize;
        const firstSourcePixel = Math.floor(outputStart / PATCH_SIZE);
        const lastSourcePixel = Math.ceil(outputEnd / PATCH_SIZE);
        const weights = [];

        for (let sourceIndex = firstSourcePixel; sourceIndex < lastSourcePixel; sourceIndex += 1) {
            const sourceStart = sourceIndex * PATCH_SIZE;
            const sourceEnd = sourceStart + PATCH_SIZE;
            const weight = Math.min(outputEnd, sourceEnd) - Math.max(outputStart, sourceStart);
            if (weight > 0) {
                weights.push({sourceIndex, weight});
            }
        }

        return weights;
    });
}

/**
 * Deterministically area-resamples an integer square RGBX crop to 72 by 72 BGR24.
 * Axis weights are represented in 1/72-pixel units, which keeps accumulation and
 * half-up rounding entirely integer based.
 */
export class AreaRgbxDownsampler {
    constructor() {
        this.sourceSize = null;
        this.axisWeights = null;
    }

    downsample({rgbx, width, roi}) {
        if (roi.size !== this.sourceSize) {
            this.sourceSize = roi.size;
            this.axisWeights = buildAxisWeights(roi.size);
        }

        const output = new Uint8Array(PATCH_SIZE * PATCH_SIZE * BGR24_BYTES_PER_PIXEL);
        const totalWeight = roi.size * roi.size;
        const halfWeight = Math.floor(totalWeight / 2);

        for (let outputY = 0; outputY < PATCH_SIZE; outputY += 1) {
            const verticalWeights = this.axisWeights[outputY];
            for (let outputX = 0; outputX < PATCH_SIZE; outputX += 1) {
                const horizontalWeights = this.axisWeights[outputX];
                let red = 0;
                let green = 0;
                let blue = 0;

                verticalWeights.forEach(vertical => {
                    horizontalWeights.forEach(horizontal => {
                        const offset = ((roi.y + vertical.sourceIndex) * width + roi.x + horizontal.sourceIndex) * RGBX_BYTES_PER_PIXEL;
                        const weight = vertical.weight * horizontal.weight;
                        red += rgbx[offset] * weight;
                        green += rgbx[offset + 1] * weight;
                        blue += rgbx[offset + 2] * weight;
                    });
                });

                const outputOffset = (outputY * PATCH_SIZE + outputX) * BGR24_BYTES_PER_PIXEL;
                output[outputOffset] = Math.floor((blue + halfWeight) / totalWeight);
                output[outputOffset + 1] = Math.floor((green + halfWeight) / totalWeight);
                output[outputOffset + 2] = Math.floor((red + halfWeight) / totalWeight);
            }
        }

        return output;
    }
}
