import {createPatchVideoFilename, PATCH_VIDEO_FORMAT_VERSION} from './AviPatchVideoFormat';
import {buildUncompressedAvi, encodeGzipAvi} from './AviPatchVideoEncoder';
import {BGR24_FRAME_BYTES} from './RawPatchProcessor';
import {AREA_AVERAGE_V1, DYNAMIC_FACE_SQUARE, FACE_COORDINATE_SYSTEM, FACE_ROI_DESCRIPTOR_VERSION} from './FaceRoiProvider';
import {MAX_FRAMES_PER_PART, RawPatchSegmenter} from './RawPatchPartAccumulator';

function textAt(bytes, offset, length = 4) {
    return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function chunkOffset(bytes, type) {
    for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
        if (textAt(bytes, offset) === type) {
            return offset;
        }
    }
    return -1;
}

describe('uncompressed AVI patch video', () => {
    test('muxes top-down BGR frames into an indexed AVI container', () => {
        const frames = new Uint8Array(BGR24_FRAME_BYTES * 2);
        frames.set([1, 2, 3], 0);
        frames.set([4, 5, 6], BGR24_FRAME_BYTES);

        const avi = buildUncompressedAvi({bytes: frames, frameCount: 2});
        const view = new DataView(avi.buffer, avi.byteOffset, avi.byteLength);
        const avih = chunkOffset(avi, 'avih');
        const strf = chunkOffset(avi, 'strf');
        const frame = chunkOffset(avi, '00db');

        expect(textAt(avi, 0)).toBe('RIFF');
        expect(view.getUint32(4, true)).toBe(avi.byteLength - 8);
        expect(textAt(avi, 8)).toBe('AVI ');
        expect(avih).toBeGreaterThan(-1);
        expect(view.getUint32(avih + 24, true)).toBe(2);
        expect(strf).toBeGreaterThan(-1);
        expect(view.getInt32(strf + 16, true)).toBe(-72);
        expect(textAt(avi, frame + 8, 3)).toBe(String.fromCharCode(1, 2, 3));
        expect(chunkOffset(avi, 'idx1')).toBeGreaterThan(frame);
    });

    test('wraps the AVI payload in native gzip for upload', async () => {
        const original = {Blob: window.Blob, CompressionStream: window.CompressionStream, Response: window.Response};
        const pipeThrough = jest.fn(() => 'compressed-stream');
        const compressed = {gzip: true};
        window.Blob = jest.fn(() => ({stream: () => ({pipeThrough})}));
        window.CompressionStream = jest.fn();
        window.Response = jest.fn(() => ({blob: () => Promise.resolve(compressed)}));

        try {
            await expect(encodeGzipAvi({
                bytes: new Uint8Array(BGR24_FRAME_BYTES), frameCount: 1
            })).resolves.toBe(compressed);
            expect(window.CompressionStream).toHaveBeenCalledWith('gzip');
            expect(pipeThrough).toHaveBeenCalledWith(expect.anything());
        } finally {
            window.Blob = original.Blob;
            window.CompressionStream = original.CompressionStream;
            window.Response = original.Response;
        }
    });

    test('uses deterministic AVI filenames and preserves segment boundaries', () => {
        expect(createPatchVideoFilename({
            studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1, segmentIndex: 0, partIndex: 0
        })).toBe('RESULT_introduction_1_patch_s000_p000.avi.gz');
        expect(PATCH_VIDEO_FORMAT_VERSION).toBe('patch-video-avi-gzip-bgr24-v1');

        const segmenter = new RawPatchSegmenter({studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1});
        const firstRoi = {
            coordinateSystem: FACE_COORDINATE_SYSTEM,
            transformType: DYNAMIC_FACE_SQUARE,
            samplingVersion: AREA_AVERAGE_V1,
            descriptorVersion: FACE_ROI_DESCRIPTOR_VERSION,
            x: 0,
            y: 0,
            size: 72
        };
        const frame = new Uint8Array(BGR24_FRAME_BYTES).fill(7);
        let sealedParts = [];
        for (let index = 0; index < MAX_FRAMES_PER_PART; index += 1) {
            sealedParts = segmenter.appendFrame({bgr24: frame, sourceWidth: 72, sourceHeight: 72, roi: firstRoi});
        }

        expect(sealedParts[0]).toMatchObject({frameCount: 539, byteLength: 8382528, filename: 'RESULT_introduction_1_patch_s000_p000.avi.gz'});
        const secondRoi = firstRoi;
        expect(segmenter.appendFrame({
            bgr24: new Uint8Array(BGR24_FRAME_BYTES).fill(8), sourceWidth: 73, sourceHeight: 72, roi: secondRoi
        })).toEqual([]);
        expect(segmenter.finish()[0]).toMatchObject({segmentIndex: 1, partIndex: 0, frameCount: 1});
    });

    test('increments part indexes without retaining segment history', () => {
        const segmenter = new RawPatchSegmenter({
            studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1, maxFramesPerPart: 1
        });
        const roi = {
            coordinateSystem: FACE_COORDINATE_SYSTEM,
            transformType: DYNAMIC_FACE_SQUARE,
            samplingVersion: AREA_AVERAGE_V1,
            descriptorVersion: FACE_ROI_DESCRIPTOR_VERSION,
            x: 0,
            y: 0,
            size: 72
        };
        const frame = new Uint8Array(BGR24_FRAME_BYTES);

        const first = segmenter.appendFrame({bgr24: frame, sourceWidth: 72, sourceHeight: 72, roi})[0];
        const second = segmenter.appendFrame({bgr24: frame, sourceWidth: 72, sourceHeight: 72, roi})[0];

        expect([first.filename, second.filename]).toEqual([
            'RESULT_introduction_1_patch_s000_p000.avi.gz',
            'RESULT_introduction_1_patch_s000_p001.avi.gz'
        ]);
    });
});
