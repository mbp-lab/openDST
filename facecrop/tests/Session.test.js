import {createCaptureSession} from '../src/Session';
import {validateConfiguration} from '../src/Configuration';
import {createJatosTransport} from '../src/JatosTransport';

function options(extra = {}) {
    return {video: {}, assetBaseUrl: 'https://example.test/study_assets/test/facecrop/',
        transport: {write: jest.fn(() => Promise.resolve())}, ...extra};
}

describe('public configuration and construction', () => {
    test('provides frozen localized defaults without coercion', () => {
        const config = validateConfiguration();
        expect(config.roi).toEqual({scale: 1.5, verticalShiftRatio: 0.15, smoothingTauMs: 100});
        expect(Object.isFrozen(config.roi)).toBe(true);
        expect(() => validateConfiguration({roi: {scale: '1.5'}})).toThrow();
        expect(() => validateConfiguration({roi: {scale: 0.5}})).toThrow();
        expect(() => validateConfiguration({detector: {delegate: 'GPU'}})).toThrow(/Unknown/);
        expect(() => validateConfiguration({pipeline: {analysisWorkerCount: 3}})).toThrow();
        expect(() => validateConfiguration({diagnostics: 'false'})).toThrow();
    });
    test('invalid construction never allocates workers or persists', () => {
        const originalWorker = window.Worker;
        window.Worker = jest.fn();
        const input = options();
        try {
            expect(() => createCaptureSession({...input, config: {unknown: true}})).toThrow();
            expect(() => createCaptureSession({...input, filenamePrefix: '../bad'})).toThrow();
            expect(() => createCaptureSession({...input, assetBaseUrl: '/relative/'})).toThrow();
            expect(() => createCaptureSession({...input, context: {invalid: undefined}})).toThrow();
            expect(window.Worker).not.toHaveBeenCalled();
            expect(input.transport.write).not.toHaveBeenCalled();
        } finally { window.Worker = originalWorker; }
    });
    test('construction preserves host context without mutable aliasing', () => {
        const context = {task: 'speech', trial: {number: 2}};
        const input = options({context, filenamePrefix: 'p42_speech_trial2', captureId: 'unique'});
        const session = createCaptureSession(input);
        context.trial.number = 3;
        const result = session.getResult();
        expect(result.capture.context.trial.number).toBe(2);
        result.capture.context.trial.number = 9;
        expect(session.getResult().capture.context.trial.number).toBe(2);
        expect(input.transport.write).not.toHaveBeenCalled();
    });
});

describe('public lifecycle', () => {
    test('unsupported preparation is structured and never writes even on dispose', async () => {
        const input = options();
        const session = createCaptureSession(input);
        expect(await session.prepare()).toMatchObject({status: 'unsupported', reasonCode: 'CAPABILITY_UNSUPPORTED'});
        await session.dispose();
        expect(input.transport.write).not.toHaveBeenCalled();
    });
    test('repeated stop shares one terminal result and does not repeat persistence', async () => {
        const input = options();
        const session = createCaptureSession(input);
        const first = session.stop();
        const second = session.stop();
        expect(second).toBe(first);
        await expect(second).resolves.toMatchObject({status: 'disabled'});
        expect(input.transport.write).not.toHaveBeenCalled();
    });
    test('abort cancels a pending preparation callback and never owns tracks', async () => {
        const track = {stop: jest.fn()};
        const video = {requestVideoFrameCallback: jest.fn(() => 7), cancelVideoFrameCallback: jest.fn(),
            srcObject: {getVideoTracks: () => [track]}};
        const input = options({video});
        const session = createCaptureSession(input);
        const preparing = session.prepare();
        const aborting = session.abort();
        expect(await preparing).toMatchObject({status: 'aborted'});
        expect(await aborting).toMatchObject({status: 'aborted', reasonCode: 'CAPTURE_ABORTED'});
        expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(7);
        expect(track.stop).not.toHaveBeenCalled();
        expect(input.transport.write).not.toHaveBeenCalled();
        expect(await session.start()).toMatchObject({status: 'aborted'});
        expect(await session.stop()).toMatchObject({status: 'aborted'});
    });
    test('abort supersedes stop while preparation is pending', async () => {
        const video = {requestVideoFrameCallback: jest.fn(() => 1), cancelVideoFrameCallback: jest.fn()};
        const input = options({video});
        const session = createCaptureSession(input);
        session.start();
        const stopped = session.stop();
        const aborted = session.abort();
        expect(await aborted).toMatchObject({status: 'aborted'});
        expect(await stopped).toMatchObject({status: 'aborted'});
        expect(input.transport.write).not.toHaveBeenCalled();
    });
    test('observer exceptions are reported without breaking lifecycle', async () => {
        const session = createCaptureSession(options({onEvent: () => { throw new Error('host callback'); }}));
        const result = await session.prepare();
        expect(result.status).toBe('unsupported');
        expect(result.observerErrors).toEqual([expect.objectContaining({message: 'host callback'})]);
    });
});

test('JATOS adapter preserves receiver and delegates only explicitly', async () => {
    const api = {uploadResultFile: jest.fn(function () { expect(this).toBe(api); return Promise.resolve(); })};
    const transport = createJatosTransport(api);
    expect(api.uploadResultFile).not.toHaveBeenCalled();
    await transport.write({filename: 'part.avi.gz', payload: 'blob'});
    expect(api.uploadResultFile).toHaveBeenCalledWith('blob', 'part.avi.gz');
});
