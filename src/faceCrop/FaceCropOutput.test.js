import {createPatchVideoFilename, PATCH_VIDEO_FORMAT_VERSION, FaceCropSink} from './FaceCropOutput';
import {buildUncompressedAvi, encodeGzipAvi} from './FaceCropOutput';
import {BGR24_FRAME_BYTES} from './FaceCropPipeline.worker';
import {AREA_AVERAGE_V1, DYNAMIC_FACE_SQUARE, FACE_COORDINATE_SYSTEM, FACE_ROI_DESCRIPTOR_VERSION} from './FaceCropPipeline.worker';
import {UPLOAD_STATUS} from '../uploadState';
import {MAX_FRAMES_PER_PART, FaceCropSegmenter} from './FaceCropPipeline.worker';

// Output tests pin the byte-level AVI contract and the upload invariant that
// every AVI part has a matching face-event sidecar with its own terminal state.
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

function provenance() {
    return {state: 'largest', candidateCount: 1, selectedScore: 0.9, selectedBoundingBox: {originX: 0, originY: 0, width: 72, height: 72}, tieBreakOccurred: false};
}

describe('uncompressed AVI patch video', () => {
    // AVI remains deliberately uncompressed and top-down so downstream tools
    // receive a simple, stable BGR24 container before gzip transport.
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
        const index = chunkOffset(avi, 'idx1');
        expect(index).toBeGreaterThan(frame);
        expect(view.getUint32(index + 4, true)).toBe(32);
        expect(textAt(avi, index + 8)).toBe('00db');
        expect(view.getUint32(index + 16, true)).toBe(4);
        expect(view.getUint32(index + 32, true)).toBe(4 + BGR24_FRAME_BYTES + 8);
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

        const segmenter = new FaceCropSegmenter({studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1});
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
            sealedParts = segmenter.appendFrame({bgr24: frame, sourceWidth: 72, sourceHeight: 72, roi: firstRoi, provenance: provenance(), timestampUs: index * 1000, wallClockMs: 1700000000000 + index});
        }

        expect(sealedParts[0]).toMatchObject({frameCount: 539, byteLength: 8382528, filename: 'RESULT_introduction_1_patch_s000_p000.avi.gz', faceEventsFilename: 'RESULT_introduction_1_patch_s000_p000.face-events.json'});
        expect(sealedParts[0].faceEvents.frames).toHaveLength(MAX_FRAMES_PER_PART);
        expect(sealedParts[0].faceEvents.frames[0]).toMatchObject({frameIndex: 0, mediaTimeUs: 0, wallClockMs: 1700000000000});
        const secondRoi = firstRoi;
        expect(segmenter.appendFrame({
            bgr24: new Uint8Array(BGR24_FRAME_BYTES).fill(8), sourceWidth: 73, sourceHeight: 72, roi: secondRoi, provenance: provenance(), timestampUs: MAX_FRAMES_PER_PART * 1000, wallClockMs: 1700000000000 + MAX_FRAMES_PER_PART
        })).toEqual([]);
        expect(segmenter.finish()[0]).toMatchObject({segmentIndex: 1, partIndex: 0, frameCount: 1});
    });

    test('writes a frame directly into the active part buffer', () => {
        const segmenter = new FaceCropSegmenter({
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
        const writeBgr24 = jest.fn(output => {
            expect(output.byteLength).toBe(BGR24_FRAME_BYTES);
            output.fill(9);
        });

        const [part] = segmenter.appendFrame({writeBgr24, sourceWidth: 72, sourceHeight: 72, roi,
            provenance: provenance(), timestampUs: 0, wallClockMs: 1700000000000});

        expect(writeBgr24).toHaveBeenCalledTimes(1);
        expect(part.bytes).toEqual(new Uint8Array(BGR24_FRAME_BYTES).fill(9));
    });

    test('increments part indexes without retaining segment history', () => {
        const segmenter = new FaceCropSegmenter({
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

        const first = segmenter.appendFrame({bgr24: frame, sourceWidth: 72, sourceHeight: 72, roi, provenance: provenance(), timestampUs: 0, wallClockMs: 1700000000000})[0];
        const second = segmenter.appendFrame({bgr24: frame, sourceWidth: 72, sourceHeight: 72, roi, provenance: provenance(), timestampUs: 0, wallClockMs: 1700000000000})[0];

        expect([first.filename, second.filename]).toEqual([
            'RESULT_introduction_1_patch_s000_p000.avi.gz',
            'RESULT_introduction_1_patch_s000_p001.avi.gz'
        ]);
    });
});

function deferred() {
    let resolve;
    return {
        promise: new Promise(nextResolve => {
            resolve = nextResolve;
        }),
        resolve
    };
}

function sealedPart(partIndex) {
    const filename = `RESULT_introduction_1_patch_s000_p${String(partIndex).padStart(3, '0')}.avi.gz`;
    const faceEventsFilename = filename.replace(/\.avi\.gz$/, '.face-events.json');
    return {
        filename,
        faceEventsFilename,
        frameCount: 1,
        byteLength: 3,
        bytes: new Uint8Array([partIndex, partIndex + 1, partIndex + 2]),
        faceEvents: {aviFilename: filename, frameCount: 1, frames: []}
    };
}

function tracker() {
    return {
        registerUpload: jest.fn(),
        settleUpload: jest.fn()
    };
}

describe('FaceCropSink', () => {
    // The sink admits only bounded work, uploads AVI before its sidecar, and
    // settles every artifact independently while returning one logical result.
    test('owns at most one active and one queued part, then finalizes after parts settle', async () => {
        const encoding = deferred();
        const uploads = jest.fn(() => Promise.resolve());
        const uploadTracker = tracker();
        const sink = new FaceCropSink({
            uploadResultFile: uploads,
            uploadTracker,
            encode: jest.fn(() => encoding.promise),
            sleep: jest.fn(() => Promise.resolve())
        });
        const first = sealedPart(0);
        const second = sealedPart(1);

        await sink.enqueuePart(first);
        await sink.enqueuePart(second);

        const third = sealedPart(2);
        let thirdAdmitted = false;
        const thirdAdmission = sink.enqueuePart(third).then(() => { thirdAdmitted = true; });
        await Promise.resolve();
        expect(thirdAdmitted).toBe(false);
        expect(first.bytes).toBeInstanceOf(Uint8Array);
        expect(second.bytes).toBeInstanceOf(Uint8Array);

        expect(uploads).not.toHaveBeenCalled();

        encoding.resolve(new Uint8Array([31]));

        await thirdAdmission;
        expect(thirdAdmitted).toBe(true);
        await sink.finalize();

        expect(first.bytes).toBeNull();
        expect(second.bytes).toBeNull();
        expect(third.bytes).toBeNull();
        expect(uploads.mock.calls.map(call => call[1])).toEqual([
            'RESULT_introduction_1_patch_s000_p000.avi.gz',
            'RESULT_introduction_1_patch_s000_p000.face-events.json',
            'RESULT_introduction_1_patch_s000_p001.avi.gz',
            'RESULT_introduction_1_patch_s000_p001.face-events.json',
            'RESULT_introduction_1_patch_s000_p002.avi.gz',
            'RESULT_introduction_1_patch_s000_p002.face-events.json'
        ]);
        expect(uploadTracker.settleUpload.mock.calls.map(call => call[1])).toEqual([
            UPLOAD_STATUS.SUCCEEDED,
            UPLOAD_STATUS.SUCCEEDED,
            UPLOAD_STATUS.SUCCEEDED,
            UPLOAD_STATUS.SUCCEEDED,
            UPLOAD_STATUS.SUCCEEDED,
            UPLOAD_STATUS.SUCCEEDED
        ]);
    });

    test('marks the logical part incomplete when its JSON sidecar fails', async () => {
        const uploads = jest.fn((payload, filename) => filename.endsWith('.face-events.json')
            ? Promise.reject(new Error('sidecar unavailable'))
            : Promise.resolve());
        const uploadTracker = tracker();
        const sink = new FaceCropSink({
            uploadResultFile: uploads,
            uploadTracker,
            encode: jest.fn(() => Promise.resolve(new Uint8Array([31]))),
            sleep: jest.fn(() => Promise.resolve())
        });

        await sink.enqueuePart(sealedPart(0));
        const [result] = (await sink.finalize()).parts;

        expect(uploads).toHaveBeenCalledTimes(4);
        expect(result).toMatchObject({status: UPLOAD_STATUS.FAILED, avi: {status: UPLOAD_STATUS.SUCCEEDED}, faceEvents: {attempts: 3}});
        expect(uploadTracker.settleUpload).toHaveBeenCalledWith(
            'patch-events-1-RESULT_introduction_1_patch_s000_p000.face-events.json',
            UPLOAD_STATUS.FAILED
        );
    });

    test('retries a part three times and reports one terminal failure', async () => {
        const uploads = jest.fn(() => Promise.reject(new Error('unavailable')));
        const uploadTracker = tracker();
        const sink = new FaceCropSink({
            uploadResultFile: uploads,
            uploadTracker,
            encode: jest.fn(() => Promise.resolve(new Uint8Array([31]))),
            sleep: jest.fn(() => Promise.resolve())
        });

        await sink.enqueuePart(sealedPart(0));
        const [result] = (await sink.finalize()).parts;

        expect(uploads).toHaveBeenCalledTimes(3);
        expect(uploadTracker.registerUpload).toHaveBeenCalledTimes(2);
        expect(uploadTracker.settleUpload).toHaveBeenCalledWith(
            'patch-part-2-RESULT_introduction_1_patch_s000_p000.avi.gz',
            UPLOAD_STATUS.FAILED
        );
        expect(uploadTracker.settleUpload).toHaveBeenCalledWith(
            'patch-events-2-RESULT_introduction_1_patch_s000_p000.face-events.json',
            UPLOAD_STATUS.FAILED
        );
        expect(result).toMatchObject({status: UPLOAD_STATUS.FAILED, avi: {attempts: 3}});
    });

    test('uses distinct tracking IDs for repeated captures with the same filename', async () => {
        const firstTracker = tracker();
        const secondTracker = tracker();
        const options = {
            uploadResultFile: jest.fn(() => Promise.resolve()),
            encode: jest.fn(() => Promise.resolve(new Uint8Array([31]))),
            sleep: jest.fn(() => Promise.resolve())
        };
        const firstSink = new FaceCropSink({...options, uploadTracker: firstTracker});
        const secondSink = new FaceCropSink({...options, uploadTracker: secondTracker});

        await firstSink.enqueuePart(sealedPart(0));
        await secondSink.enqueuePart(sealedPart(0));
        await Promise.all([firstSink.finalize(), secondSink.finalize()]);

        const firstIds = firstTracker.registerUpload.mock.calls.map(call => call[0]);
        const secondIds = secondTracker.registerUpload.mock.calls.map(call => call[0]);
        expect(firstIds).not.toEqual(secondIds);
        expect(new Set([...firstIds, ...secondIds]).size).toBe(4);
    });
});
