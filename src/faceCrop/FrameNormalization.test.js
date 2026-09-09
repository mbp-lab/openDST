import {convertFullRangeBt709Nv12ToRgba, selectQuarterTurnByLuminance} from './FrameNormalization';

function nv12Fixture({width, height, yValues, yOffset = 0, yStride = width, uvOffset = yOffset + yStride * height,
    uvStride = width, cb = 128, cr = 128}) {
    const size = uvOffset + uvStride * (height / 2);
    const bytes = new Uint8Array(size);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) bytes[yOffset + y * yStride + x] = yValues[y * width + x];
    }
    for (let y = 0; y < height / 2; y += 1) {
        for (let x = 0; x < width; x += 2) {
            bytes[uvOffset + y * uvStride + x] = cb;
            bytes[uvOffset + y * uvStride + x + 1] = cr;
        }
    }
    return {bytes, layouts: [{offset: yOffset, stride: yStride}, {offset: uvOffset, stride: uvStride}]};
}

function redValues(rgbx) {
    const values = [];
    for (let offset = 0; offset < rgbx.length; offset += 4) values.push(rgbx[offset]);
    return values;
}

describe('NV12 frame normalization', () => {
    test('converts full-range BT.709 neutral chroma exactly', () => {
        const fixture = nv12Fixture({width: 2, height: 2, yValues: [0, 64, 128, 255]});
        const result = convertFullRangeBt709Nv12ToRgba({...fixture, width: 2, height: 2});
        expect(result).toMatchObject({width: 2, height: 2});
        expect(Array.from(result.rgbx)).toEqual([0, 0, 0, 255, 64, 64, 64, 255,
            128, 128, 128, 255, 255, 255, 255, 255]);
    });

    test('honors padded planes while rotating clockwise into one RGBA output', () => {
        const fixture = nv12Fixture({width: 4, height: 2, yValues: [10, 20, 30, 40, 50, 60, 70, 80],
            yOffset: 1, yStride: 6, uvOffset: 14, uvStride: 6});
        const result = convertFullRangeBt709Nv12ToRgba({...fixture, width: 4, height: 2, rotation: 90});
        expect(result).toMatchObject({width: 2, height: 4});
        expect(redValues(result.rgbx)).toEqual([50, 10, 60, 20, 70, 30, 80, 40]);
        expect(result.rgbx.filter((value, index) => index % 4 === 3).every(value => value === 255)).toBe(true);
    });

    test('selects the rotation closest to presented luminance', () => {
        const width = 8, height = 6, referenceWidth = 6, referenceHeight = 8;
        const yValues = Array.from({length: width * height}, (_, index) => (index * 5 + Math.floor(index / width) * 17) % 256);
        const fixture = nv12Fixture({width, height, yValues});
        const reference = new Uint8Array(referenceWidth * referenceHeight);
        for (let y = 0; y < referenceHeight; y += 1) {
            for (let x = 0; x < referenceWidth; x += 1) {
                const outputX = Math.min(height - 1, Math.floor((x + 0.5) * height / referenceWidth));
                const outputY = Math.min(width - 1, Math.floor((y + 0.5) * width / referenceHeight));
                const sourceX = outputY;
                const sourceY = height - 1 - outputX;
                reference[y * referenceWidth + x] = yValues[sourceY * width + sourceX];
            }
        }
        const selected = selectQuarterTurnByLuminance({...fixture, width, height, reference, referenceWidth, referenceHeight});
        expect(selected.rotation).toBe(90);
        expect(selected.clockwiseDistance).toBe(0);
        expect(selected.counterclockwiseDistance).toBeGreaterThan(0);
    });

    test('chooses clockwise deterministically when distances tie', () => {
        const fixture = nv12Fixture({width: 8, height: 6, yValues: new Array(48).fill(100)});
        const selected = selectQuarterTurnByLuminance({...fixture, width: 8, height: 6,
            reference: new Uint8Array(8 * 8).fill(100), referenceWidth: 8, referenceHeight: 8});
        expect(selected).toMatchObject({rotation: 90, clockwiseDistance: 0, counterclockwiseDistance: 0});
    });
});
