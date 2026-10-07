import React from 'react';
import ReactDOM from 'react-dom';
import {act, Simulate} from 'react-dom/test-utils';

jest.mock('browser-facecrop', () => ({
    createCaptureSession: jest.fn(),
    createJatosTransport: jest.fn(api => ({api}))
}), {virtual: true});
jest.mock('browser-facecrop/react', () => require('../../browser-facecrop/react'), {virtual: true});

import * as Facecrop from 'browser-facecrop';
import {FacecropRecorder} from '../../browser-facecrop/examples/react/FacecropRecorder';

test('React example uses explicit preparation and awaits stop before finalization', async () => {
    let result = {status: 'disabled'};
    const prepare = jest.fn(async () => { result = {status: 'ready'}; return result; });
    const start = jest.fn(async () => { result = {status: 'capturing'}; return result; });
    const stop = jest.fn(async () => { result = {status: 'complete'}; return result; });
    Facecrop.createCaptureSession.mockReturnValue({
        getResult: () => result,
        prepare,
        start,
        stop,
        abort: jest.fn()
    });

    const container = document.createElement('div');
    const video = document.createElement('video');
    const jatosApi = {uploadResultFile: jest.fn()};
    const assetBaseUrl = 'https://example.test/assets/';
    const onFinalized = jest.fn();
    await act(async () => {
        ReactDOM.render(
            <FacecropRecorder video={video} jatosApi={jatosApi} assetBaseUrl={assetBaseUrl}
                onFinalized={onFinalized}/>,
            container
        );
    });

    expect(Facecrop.createCaptureSession).toHaveBeenCalledTimes(1);
    expect(Facecrop.createCaptureSession.mock.calls[0][0]).toMatchObject({
        video,
        assetBaseUrl,
        transport: {api: jatosApi}
    });
    expect(prepare).not.toHaveBeenCalled();

    expect(container.querySelector('button').disabled).toBe(false);
    await act(async () => {
        Simulate.click(container.querySelector('button'));
        await Promise.resolve();
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Facecrop: ready');

    await act(async () => {
        Simulate.click(container.querySelectorAll('button')[1]);
        await Promise.resolve();
    });
    expect(start).toHaveBeenCalledTimes(1);

    await act(async () => {
        Simulate.click(container.querySelectorAll('button')[2]);
        await Promise.resolve();
    });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(onFinalized).toHaveBeenCalledWith({status: 'complete'});
    await act(async () => ReactDOM.unmountComponentAtNode(container));
});
