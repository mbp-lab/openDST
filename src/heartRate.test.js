import {decodeHeartRateMeasurement} from './heartRate';

function measurement(bytes) {
    const buffer = new Uint8Array(bytes).buffer;
    return new DataView(buffer);
}

describe('decodeHeartRateMeasurement', () => {
    test('decodes 8-bit BPM and RR intervals into pulse epochs', () => {
        const decoded = decodeHeartRateMeasurement(measurement([0x10, 72, 0x00, 0x02, 0x00, 0x02]), 10000);
        expect(decoded.bpm).toBe(72);
        expect(decoded.rrMs).toEqual([500, 500]);
        expect(decoded.pulseEpochMs).toEqual([9500, 10000]);
    });

    test('decodes 16-bit BPM while skipping optional energy expended', () => {
        const decoded = decodeHeartRateMeasurement(measurement([0x09, 0x2c, 0x01, 0x34, 0x12]), 5000);
        expect(decoded.bpm).toBe(300);
        expect(decoded.rrMs).toEqual([]);
        expect(decoded.pulseEpochMs).toEqual([]);
    });

    test('rejects truncated values', () => {
        expect(() => decodeHeartRateMeasurement(measurement([0x01, 0x2c]))).toThrow();
    });
});
