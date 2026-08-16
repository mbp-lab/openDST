import {AREA_AVERAGE_V1, DYNAMIC_FACE_SQUARE, FACE_COORDINATE_SYSTEM, FACE_ROI_DESCRIPTOR_VERSION, PATCH_SIZE, validateRoiDescriptor} from './RoiProvider';
import {RawPatchProcessor, RGB24_FRAME_BYTES} from './RawPatchProcessor';

function setPixel(rgbx, width, x, y, color) {
    const offset = (y * width + x) * 4;
    rgbx[offset] = color[0];
    rgbx[offset + 1] = color[1];
    rgbx[offset + 2] = color[2];
    rgbx[offset + 3] = 255;
}

describe('RawPatchProcessor', () => {
    test('rejects the removed camera ROI descriptor', () => {
        expect(() => validateRoiDescriptor({coordinateSystem: 'camera'})).toThrow('Unsupported ROI coordinate system');
    });
    test('area-resamples an arbitrary source-pixel crop with integer half-up rounding', () => {
        const width = 73;
        const rgbx = new Uint8Array(width * width * 4);
        setPixel(rgbx, width, 72, 72, [255, 255, 255]);
        const roi = {
            coordinateSystem: FACE_COORDINATE_SYSTEM,
            transformType: DYNAMIC_FACE_SQUARE,
            samplingVersion: AREA_AVERAGE_V1,
            descriptorVersion: FACE_ROI_DESCRIPTOR_VERSION,
            x: 0,
            y: 0,
            size: 73
        };

        const output = new RawPatchProcessor().process({rgbx, width, height: width, roi});

        expect(output.slice((71 * PATCH_SIZE + 71) * 3, (71 * PATCH_SIZE + 72) * 3)).toEqual(new Uint8Array([248, 248, 248]));
        expect(output.slice((70 * PATCH_SIZE + 71) * 3, (70 * PATCH_SIZE + 72) * 3)).toEqual(new Uint8Array([0, 0, 0]));
    });
});
