import {PipelineWorker} from '../src/FaceCropCapture';

const originalWorker = window.Worker;
afterEach(() => { window.Worker = originalWorker; });

function worker(postMessage = jest.fn()) {
    const native = {postMessage, terminate: jest.fn()};
    window.Worker = jest.fn(() => native);
    return new PipelineWorker('https://example.test/assets/');
}

function frame() { return {close: jest.fn()}; }

test('failed transfer closes the still-owned frame and rejects the request', async () => {
    const error = new Error('transfer rejected');
    const pipeline = worker(jest.fn(() => { throw error; }));
    const source = frame();
    await expect(pipeline.processFrame({frame: source})).rejects.toBe(error);
    expect(source.close).toHaveBeenCalledTimes(1);
});

test('closed worker releases a frame that cannot be submitted', async () => {
    const pipeline = worker();
    pipeline.fail(new Error('worker failed'));
    const source = frame();
    await expect(pipeline.processFrame({frame: source})).rejects.toThrow('closed');
    expect(source.close).toHaveBeenCalledTimes(1);
});

test('worker failure releases queued frames while preserving transferred ownership', async () => {
    const pipeline = worker();
    const submitted = frame(), queued = frame();
    const first = pipeline.processFrame({frame: submitted});
    const second = pipeline.warmup({frame: queued});
    const failure = new Error('worker crashed');
    const firstCheck = expect(first).rejects.toBe(failure);
    const secondCheck = expect(second).rejects.toBe(failure);
    pipeline.fail(failure);
    await Promise.all([firstCheck, secondCheck]);
    expect(submitted.close).not.toHaveBeenCalled();
    expect(queued.close).toHaveBeenCalledTimes(1);
    expect(pipeline.queue).toHaveLength(0);
});
