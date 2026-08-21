import {
    consoleLogUploadState,
    flushConsoleLog,
    installConsoleLogCapture,
    resetConsoleLogUploadForTests,
    startConsoleLogUpload
} from './consoleLog';

describe('console log upload queue', () => {
    let consoleObject;

    beforeEach(() => {
        jest.useFakeTimers();
        resetConsoleLogUploadForTests();
        consoleObject = {debug: jest.fn(), info: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn()};
        installConsoleLogCapture(consoleObject);
    });

    afterEach(() => {
        resetConsoleLogUploadForTests();
        jest.useRealTimers();
    });

    test('uploads queued logs after the uploader starts', async () => {
        consoleObject.info('recording began');
        const upload = jest.fn(() => Promise.resolve());
        startConsoleLogUpload(upload, '171');

        await flushConsoleLog();

        expect(upload).toHaveBeenCalledTimes(1);
        expect(upload.mock.calls[0][1]).toBe('171_consoleLog_000001.json');
        expect(JSON.parse(upload.mock.calls[0][0])[0].args).toEqual(['recording began']);
        expect(consoleLogUploadState()).toEqual({entries: 0, pendingChunks: 0, queuedBytes: 0, draining: false});
    });

    test('retains a failed chunk and retries it in order', async () => {
        consoleObject.warn('first diagnostic');
        const upload = jest.fn()
            .mockRejectedValueOnce(new Error('temporary upload failure'))
            .mockResolvedValueOnce(undefined);
        startConsoleLogUpload(upload, '171');

        await flushConsoleLog();
        expect(consoleLogUploadState().pendingChunks).toBe(1);

        jest.advanceTimersByTime(1000);
        await Promise.resolve();
        await Promise.resolve();
        await flushConsoleLog();

        expect(upload).toHaveBeenCalledTimes(2);
        expect(upload.mock.calls[1][1]).toBe('171_consoleLog_000001.json');
        expect(consoleLogUploadState()).toEqual({entries: 0, pendingChunks: 0, queuedBytes: 0, draining: false});
    });
});
