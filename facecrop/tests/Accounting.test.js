import {reconcileAccounting} from '../src/Accounting';

test('accounts for failed processing, encoding, and persistence without attributing browser gaps', () => {
    const counts = {submittedFrames: 12, processedFrames: 11, failedProcessingFrames: 1,
        sealedFrames: 11, encodedFrames: 10, failedEncodingFrames: 1,
        persistedFrames: 8, failedPersistenceFrames: 2, callbackGaps: 5};
    expect(reconcileAccounting(counts, 11)).toMatchObject({status: 'consistent'});
    expect(reconcileAccounting(counts, 11).callbackGapsInterpretation).toMatch(/not attributable/);
});

test('reports a lost frame at the boundary where counts cease to reconcile', () => {
    const counts = {submittedFrames: 10, processedFrames: 10, failedProcessingFrames: 0,
        sealedFrames: 10, encodedFrames: 9, failedEncodingFrames: 0,
        persistedFrames: 9, failedPersistenceFrames: 0};
    expect(reconcileAccounting(counts, 10)).toMatchObject({status: 'inconsistent', checks: {
        submitted: true, assembly: true, encoding: false, persistence: true}});
});

test.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid frame counts even when stage arithmetic can balance: %s', value => {
        const counts = {submittedFrames: value, processedFrames: value, failedProcessingFrames: 0,
            sealedFrames: 0, encodedFrames: 0, failedEncodingFrames: 0,
            persistedFrames: 0, failedPersistenceFrames: 0};
        expect(reconcileAccounting(counts, 0)).toMatchObject({status: 'inconsistent', checks: {counts: false}});
    });

test('rejects an invalid accepted-frame domain on an otherwise empty capture', () => {
    const counts = {submittedFrames: 0, processedFrames: 0, failedProcessingFrames: 0,
        sealedFrames: 0, encodedFrames: 0, failedEncodingFrames: 0,
        persistedFrames: 0, failedPersistenceFrames: 0};
    expect(reconcileAccounting(counts, -1)).toMatchObject({status: 'inconsistent', checks: {counts: false}});
    expect(reconcileAccounting(counts, 0)).toMatchObject({status: 'consistent', checks: {counts: true}});
});
