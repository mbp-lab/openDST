import {UPLOAD_STATUS} from '../uploadState';
import {JatosPatchSink, PatchSinkOverflowError} from './JatosPatchSink';

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
    return {
        filename: `RESULT_introduction_1_patch_s000_p${String(partIndex).padStart(3, '0')}.avi.gz`,
        frameCount: 1,
        byteLength: 3,
        bytes: new Uint8Array([partIndex, partIndex + 1, partIndex + 2])
    };
}

function tracker() {
    return {
        registerUpload: jest.fn(),
        settleUpload: jest.fn()
    };
}

describe('JatosPatchSink', () => {
    test('owns at most one active and one queued part, then finalizes after parts settle', async () => {
        const encoding = deferred();
        const uploads = jest.fn(() => Promise.resolve());
        const uploadTracker = tracker();
        const sink = new JatosPatchSink({
            uploadResultFile: uploads,
            uploadTracker,
            encode: jest.fn(() => encoding.promise),
            sleep: jest.fn(() => Promise.resolve())
        });
        const first = sealedPart(0);
        const second = sealedPart(1);

        const firstCompletion = sink.enqueuePart(first);
        const secondCompletion = sink.enqueuePart(second);

        expect(() => sink.enqueuePart(sealedPart(2))).toThrow(PatchSinkOverflowError);
        expect(first.bytes).toBeInstanceOf(Uint8Array);
        expect(second.bytes).toBeInstanceOf(Uint8Array);

        const finalization = sink.finalize();
        expect(uploads).not.toHaveBeenCalled();

        encoding.resolve(new Uint8Array([31]));

        await Promise.all([firstCompletion, secondCompletion]);
        await finalization;

        expect(first.bytes).toBeNull();
        expect(second.bytes).toBeNull();
        expect(uploads.mock.calls.map(call => call[1])).toEqual([
            'RESULT_introduction_1_patch_s000_p000.avi.gz',
            'RESULT_introduction_1_patch_s000_p001.avi.gz'
        ]);
        expect(uploadTracker.settleUpload.mock.calls.map(call => call[1])).toEqual([
            UPLOAD_STATUS.SUCCEEDED,
            UPLOAD_STATUS.SUCCEEDED
        ]);
    });

    test('retries a part three times and reports one terminal failure', async () => {
        const uploads = jest.fn(() => Promise.reject(new Error('unavailable')));
        const uploadTracker = tracker();
        const sink = new JatosPatchSink({
            uploadResultFile: uploads,
            uploadTracker,
            encode: jest.fn(() => Promise.resolve(new Uint8Array([31]))),
            sleep: jest.fn(() => Promise.resolve())
        });

        const result = await sink.enqueuePart(sealedPart(0));

        expect(uploads).toHaveBeenCalledTimes(3);
        expect(uploadTracker.registerUpload).toHaveBeenCalledTimes(1);
        expect(uploadTracker.settleUpload).toHaveBeenCalledWith(
            'patch-part-RESULT_introduction_1_patch_s000_p000.avi.gz',
            UPLOAD_STATUS.FAILED
        );
        expect(result).toMatchObject({status: UPLOAD_STATUS.FAILED, attempts: 3});
    });
});
