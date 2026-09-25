export function decodeHeartRateMeasurement(value, receivedAtEpochMs = Date.now()) {
    if (!value || value.byteLength < 2) throw new Error('Invalid heart-rate measurement');
    const flags = value.getUint8(0);
    const is16Bit = Boolean(flags & 0x01);
    const energyPresent = Boolean(flags & 0x08);
    const rrPresent = Boolean(flags & 0x10);
    let offset = 1;
    const bpm = is16Bit ? value.getUint16(offset, true) : value.getUint8(offset);
    offset += is16Bit ? 2 : 1;
    if (energyPresent) offset += 2;
    if (offset > value.byteLength) throw new Error('Truncated heart-rate measurement');
    const rrMs = [];
    if (rrPresent) {
        while (offset + 1 < value.byteLength) {
            rrMs.push(value.getUint16(offset, true) * 1000 / 1024);
            offset += 2;
        }
    }
    // The standard carries RR intervals but no sensor timestamp. These are
    // therefore estimates anchored to browser notification-receipt time.
    const total = rrMs.reduce((sum, interval) => sum + interval, 0);
    let pulseEpochMs = receivedAtEpochMs - total;
    const pulseEpochMsList = rrMs.map(interval => {
        pulseEpochMs += interval;
        return Math.round(pulseEpochMs);
    });
    return {bpm, rrMs, pulseEpochMs: pulseEpochMsList};
}

export function heartRateDebugEnabled() {
    return process.env.REACT_APP_HEART_RATE_DEBUG === 'true';
}
