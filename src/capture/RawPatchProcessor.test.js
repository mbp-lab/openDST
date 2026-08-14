import {CameraRoiProvider, PATCH_SIZE, validateRoiDescriptor} from './RoiProvider';
import {RawPatchProcessor, RGB24_FRAME_BYTES} from './RawPatchProcessor';

const OUTSIDE_ROI = [251, 252, 253];
const HALF_UP_PIXEL = [17, 23];
const HALF_UP_SAMPLES = [
    [1, 1, 0],
    [1, 2, 1],
    [2, 2, 1],
    [2, 3, 2]
];

function pixelColor(x, y) {
    if (x === HALF_UP_PIXEL[0] && y === HALF_UP_PIXEL[1]) {
        return [2, 2, 1];
    }

    return [
        (x * 3 + y) % 256,
        (x * 2 + y * 5) % 256,
        (x + y * 7) % 256
    ];
}

function setPixel(rgbx, width, x, y, color) {
    const offset = (y * width + x) * 4;
    rgbx[offset] = color[0];
    rgbx[offset + 1] = color[1];
    rgbx[offset + 2] = color[2];
    rgbx[offset + 3] = 255;
}

function createRgbxVector(width, height, roi) {
    const rgbx = new Uint8Array(width * height * 4);
    const blockSize = roi.size / PATCH_SIZE;

    for (let sourceY = 0; sourceY < height; sourceY += 1) {
        for (let sourceX = 0; sourceX < width; sourceX += 1) {
            setPixel(rgbx, width, sourceX, sourceY, OUTSIDE_ROI);
        }
    }

    for (let patchY = 0; patchY < PATCH_SIZE; patchY += 1) {
        for (let patchX = 0; patchX < PATCH_SIZE; patchX += 1) {
            const sourceColors = patchX === HALF_UP_PIXEL[0] && patchY === HALF_UP_PIXEL[1] && blockSize === 2
                ? HALF_UP_SAMPLES
                : [pixelColor(patchX, patchY)];

            for (let blockY = 0; blockY < blockSize; blockY += 1) {
                for (let blockX = 0; blockX < blockSize; blockX += 1) {
                    const sampleIndex = blockY * blockSize + blockX;
                    setPixel(
                        rgbx,
                        width,
                        roi.x + patchX * blockSize + blockX,
                        roi.y + patchY * blockSize + blockY,
                        sourceColors[sampleIndex % sourceColors.length]
                    );
                }
            }
        }
    }

    return rgbx;
}

function expectedRgb24(blockSize) {
    const expected = new Uint8Array(RGB24_FRAME_BYTES);

    for (let patchY = 0; patchY < PATCH_SIZE; patchY += 1) {
        for (let patchX = 0; patchX < PATCH_SIZE; patchX += 1) {
            const outputOffset = (patchY * PATCH_SIZE + patchX) * 3;
            const color = patchX === HALF_UP_PIXEL[0] && patchY === HALF_UP_PIXEL[1] && blockSize === 2
                ? [2, 2, 1]
                : pixelColor(patchX, patchY);

            expected[outputOffset] = color[0];
            expected[outputOffset + 1] = color[1];
            expected[outputOffset + 2] = color[2];
        }
    }

    return expected;
}

describe('RawPatchProcessor golden vectors', () => {
    const vectors = [
        {
            name: 'portrait source',
            width: 72,
            height: 100,
            expectedRoi: {x: 0, y: 14, size: 72}
        },
        {
            name: 'landscape source',
            width: 100,
            height: 72,
            expectedRoi: {x: 14, y: 0, size: 72}
        },
        {
            name: 'odd-sized source',
            width: 79,
            height: 83,
            expectedRoi: {x: 3, y: 5, size: 72}
        },
        {
            name: 'non-divisible source with half-up block averaging',
            width: 146,
            height: 149,
            expectedRoi: {x: 1, y: 2, size: 144}
        }
    ];

    test.each(vectors)('$name produces the v1 RGB24 golden vector', ({width, height, expectedRoi}) => {
        const provider = new CameraRoiProvider();
        const roi = provider.getRoi({width, height});
        const blockSize = expectedRoi.size / PATCH_SIZE;

        expect(roi).toEqual({
            coordinateSystem: 'camera',
            transformType: 'axis-aligned-square',
            samplingVersion: 'block-average-v1',
            descriptorVersion: 1,
            ...expectedRoi
        });

        const output = new RawPatchProcessor().process({
            rgbx: createRgbxVector(width, height, roi),
            width,
            height,
            roi
        });

        expect(output).toEqual(expectedRgb24(blockSize));
        expect(output).toHaveLength(RGB24_FRAME_BYTES);
    });

    test('rejects descriptors that cannot be processed by the v1 block-average extractor', () => {
        expect(() => validateRoiDescriptor({
            coordinateSystem: 'camera',
            transformType: 'affine-square',
            samplingVersion: 'block-average-v1',
            descriptorVersion: 1
        })).toThrow('Unsupported ROI transform type');
    });
});
