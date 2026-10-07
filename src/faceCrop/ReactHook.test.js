import React from 'react';
import ReactDOM from 'react-dom';
import {act} from 'react-dom/test-utils';
const {createReactHooks} = require('../../browser-facecrop/react');

function setup() {
    let handle;
    const calls = [];
    let currentResult = {status: 'new'};
    const core = {
        createCaptureSession: jest.fn(options => {
            calls.push(['create', options]);
            return {
                getResult: () => currentResult,
                prepare: jest.fn(async () => { calls.push(['prepare']); currentResult = {status: 'ready'}; return currentResult; }),
                start: jest.fn(async () => { calls.push(['start']); currentResult = {status: 'recording'}; return currentResult; }),
                stop: jest.fn(async () => { calls.push(['stop']); currentResult = {status: 'complete'}; return currentResult; }),
                abort: jest.fn(async () => { calls.push(['abort']); currentResult = {status: 'aborted'}; return currentResult; })
            };
        })
    };
    const {useFaceCropSession} = createReactHooks(core);
    function Probe(props) {
        handle = useFaceCropSession(props.options);
        return <span>{handle.status}</span>;
    }
    const container = document.createElement('div');
    return {calls, core, render: options => act(() => { ReactDOM.render(<Probe options={options}/>, container); }),
        unmount: () => act(() => { ReactDOM.unmountComponentAtNode(container); }), get handle() { return handle; }, container};
}

test('creates one session when a late video arrives, without preparing or taking camera ownership', async () => {
    const mounted = setup();
    const video = {srcObject: {getTracks: jest.fn()}};
    const onEvent = jest.fn();
    mounted.render({transport: {write: jest.fn()}, assetBaseUrl: 'https://example.test/assets/', video: null, onEvent});
    expect(mounted.handle.session).toBeNull();
    expect(mounted.core.createCaptureSession).not.toHaveBeenCalled();

    mounted.render({transport: {write: jest.fn()}, assetBaseUrl: 'https://ignored.test/', video, onEvent});
    expect(mounted.core.createCaptureSession).toHaveBeenCalledTimes(1);
    expect(mounted.calls.map(call => call[0])).toEqual(['create']);
    expect(mounted.core.createCaptureSession.mock.calls[0][0].assetBaseUrl).toBe('https://example.test/assets/');
    expect(mounted.core.createCaptureSession.mock.calls[0][0].video).toBe(video);
    expect(video.srcObject.getTracks).not.toHaveBeenCalled();
    expect(mounted.handle.status).toBe('new');

    await act(async () => { await mounted.handle.prepare(); });
    expect(mounted.handle.status).toBe('ready');
    expect(mounted.handle.result).toEqual({status: 'ready'});
    expect(mounted.calls.map(call => call[0])).toEqual(['create', 'prepare']);
    mounted.unmount();
});

test('delegates lifecycle calls and aborts without awaiting on unmount', async () => {
    const mounted = setup();
    mounted.render({transport: {write: jest.fn()}, assetBaseUrl: 'https://example.test/assets/', video: {}});
    await act(async () => { await mounted.handle.start(); });
    expect(mounted.handle.status).toBe('recording');
    await act(async () => { await mounted.handle.stop(); });
    expect(mounted.handle.result.status).toBe('complete');

    const abort = jest.fn(() => new Promise(() => {}));
    mounted.handle.session.abort = abort;
    mounted.unmount();
    expect(abort).toHaveBeenCalledTimes(1);
});

test('forwards events through the latest callback', () => {
    const mounted = setup();
    const first = jest.fn();
    const latest = jest.fn();
    mounted.render({transport: {write: jest.fn()}, assetBaseUrl: 'https://example.test/assets/', video: {}, onEvent: first});
    const bridge = mounted.core.createCaptureSession.mock.calls[0][0].onEvent;
    mounted.render({transport: {write: jest.fn()}, assetBaseUrl: 'https://changed.test/', video: {}, onEvent: latest});
    bridge({type: 'status'});
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith({type: 'status'});
    mounted.unmount();
});
