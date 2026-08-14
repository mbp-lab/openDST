import {
    hasPendingUploads,
    registerUpload,
    settleUpload,
    UPLOAD_STATUS
} from './uploadState';

describe('upload state', () => {
    test('tracks stable IDs and treats succeeded and failed uploads as terminal', () => {
        let uploads = [];
        uploads = registerUpload(uploads, 'introduction-1');
        uploads = registerUpload(uploads, 'mathTask-1');

        uploads = settleUpload(uploads, 'mathTask-1', UPLOAD_STATUS.FAILED);

        expect(uploads).toEqual([
            {id: 'introduction-1', status: UPLOAD_STATUS.PENDING},
            {id: 'mathTask-1', status: UPLOAD_STATUS.FAILED}
        ]);
        expect(hasPendingUploads(uploads)).toBe(true);

        uploads = settleUpload(uploads, 'introduction-1', UPLOAD_STATUS.SUCCEEDED);

        expect(uploads).toEqual([
            {id: 'introduction-1', status: UPLOAD_STATUS.SUCCEEDED},
            {id: 'mathTask-1', status: UPLOAD_STATUS.FAILED}
        ]);
        expect(hasPendingUploads(uploads)).toBe(false);

        expect(settleUpload(uploads, 'mathTask-1', UPLOAD_STATUS.SUCCEEDED)).toEqual(uploads);
    });
});
