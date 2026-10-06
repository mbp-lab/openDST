import React, {useEffect, useRef, useState} from 'react';
const Facecrop = require('../../dist/facecrop');
const EMPTY_CONTEXT = Object.freeze({});

/** Application supplies a playing video and absolute distribution URL; await onFinalized before navigating. */
export function FacecropRecorder({video, jatosApi, assetBaseUrl, context = EMPTY_CONTEXT, onFinalized}) {
    const session = useRef(null);
    const [status, setStatus] = useState('idle');
    useEffect(() => {
        if (!video || !jatosApi || !assetBaseUrl) return undefined;
        let active = true;
        const capture = Facecrop.createCaptureSession({video, filenamePrefix: 'example', context, assetBaseUrl,
            transport: Facecrop.createJatosTransport(jatosApi),
            onEvent: event => { if (active && event.type === 'status') setStatus(event.status); }});
        session.current = capture;
        capture.prepare().then(result => { if (active) setStatus(result.status); });
        return () => {
            active = false;
            capture.dispose(); // Fallback only: React does not await unmount cleanup.
            if (session.current === capture) session.current = null;
        };
    }, [video, jatosApi, assetBaseUrl, context]);
    async function start() {
        if (session.current) setStatus((await session.current.start()).status);
    }
    async function stop() {
        const capture = session.current;
        if (!capture) return;
        const result = await capture.stop();
        if (session.current === capture) setStatus(result.status);
        if (onFinalized) await onFinalized(result);
    }
    return <div>
        <span>Facecrop: {status}</span>
        <button type="button" onClick={start} disabled={status !== 'ready'}>Start facecrop</button>
        <button type="button" onClick={stop} disabled={status !== 'capturing'}>Stop and save</button>
    </div>;
}
