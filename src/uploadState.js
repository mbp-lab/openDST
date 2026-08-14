export const UPLOAD_STATUS = {
    PENDING: 'pending',
    SUCCEEDED: 'succeeded',
    FAILED: 'failed'
};

/**
 * Registers an upload in its initial pending state. IDs are supplied by the
 * caller so they remain stable independently of React state updates.
 */
export function registerUpload(uploads, id) {
    if (uploads.some(upload => upload.id === id)) {
        throw new Error(`Upload ID already registered: ${id}`);
    }

    return [...uploads, {id, status: UPLOAD_STATUS.PENDING}];
}

/**
 * Settles a pending upload. A terminal upload cannot be changed afterwards.
 */
export function settleUpload(uploads, id, status) {
    if (status !== UPLOAD_STATUS.SUCCEEDED && status !== UPLOAD_STATUS.FAILED) {
        throw new Error(`Upload must settle as succeeded or failed, received: ${status}`);
    }

    return uploads.map(upload => (
        upload.id === id && upload.status === UPLOAD_STATUS.PENDING
            ? {...upload, status}
            : upload
    ));
}

export function hasPendingUploads(uploads) {
    return uploads.some(upload => upload.status === UPLOAD_STATUS.PENDING);
}
