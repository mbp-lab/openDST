import {PATCH_SIZE, validateRoiDescriptor} from './RoiProvider';
import {RGB24_FRAME_BYTES} from './RawPatchProcessor';

export const RAW_PATCH_FORMAT_VERSION = 'raw-patch-v1';

function requirePositiveInteger(value, fieldName) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${fieldName} must be a positive integer`);
    }

    return value;
}

function requireFileToken(value, fieldName) {
    const token = String(value);
    if (!/^[A-Za-z0-9_-]+$/.test(token)) {
        throw new Error(`${fieldName} must contain only letters, numbers, underscores, or hyphens`);
    }
    return token;
}

function paddedIndex(index) {
    if (!Number.isSafeInteger(index) || index < 0) {
        throw new Error('Part and segment indexes must be non-negative integers');
    }
    return String(index).padStart(3, '0');
}

function rightRotate(value, bits) {
    return (value >>> bits) | (value << (32 - bits));
}

const SHA256_CONSTANTS = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

/**
 * Synchronous SHA-256 for deterministic part metadata in browsers and tests.
 */
export function sha256Hex(bytes) {
    if (!(bytes instanceof Uint8Array) && !(bytes instanceof Uint8ClampedArray)) {
        throw new Error('SHA-256 input must be a Uint8Array or Uint8ClampedArray');
    }

    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;

    const bitLength = bytes.length * 8;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(paddedLength - 4, bitLength >>> 0, false);

    let hash0 = 0x6a09e667;
    let hash1 = 0xbb67ae85;
    let hash2 = 0x3c6ef372;
    let hash3 = 0xa54ff53a;
    let hash4 = 0x510e527f;
    let hash5 = 0x9b05688c;
    let hash6 = 0x1f83d9ab;
    let hash7 = 0x5be0cd19;
    const words = new Uint32Array(64);

    for (let chunkOffset = 0; chunkOffset < paddedLength; chunkOffset += 64) {
        for (let index = 0; index < 16; index += 1) {
            words[index] = view.getUint32(chunkOffset + index * 4, false);
        }
        for (let index = 16; index < 64; index += 1) {
            const first = words[index - 15];
            const second = words[index - 2];
            const sigma0 = rightRotate(first, 7) ^ rightRotate(first, 18) ^ (first >>> 3);
            const sigma1 = rightRotate(second, 17) ^ rightRotate(second, 19) ^ (second >>> 10);
            words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
        }

        let a = hash0;
        let b = hash1;
        let c = hash2;
        let d = hash3;
        let e = hash4;
        let f = hash5;
        let g = hash6;
        let h = hash7;

        for (let index = 0; index < 64; index += 1) {
            const sum1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
            const choose = (e & f) ^ (~e & g);
            const temporary1 = (h + sum1 + choose + SHA256_CONSTANTS[index] + words[index]) >>> 0;
            const sum0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temporary2 = (sum0 + majority) >>> 0;

            h = g;
            g = f;
            f = e;
            e = (d + temporary1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temporary1 + temporary2) >>> 0;
        }

        hash0 = (hash0 + a) >>> 0;
        hash1 = (hash1 + b) >>> 0;
        hash2 = (hash2 + c) >>> 0;
        hash3 = (hash3 + d) >>> 0;
        hash4 = (hash4 + e) >>> 0;
        hash5 = (hash5 + f) >>> 0;
        hash6 = (hash6 + g) >>> 0;
        hash7 = (hash7 + h) >>> 0;
    }

    return [hash0, hash1, hash2, hash3, hash4, hash5, hash6, hash7]
        .map(value => value.toString(16).padStart(8, '0'))
        .join('');
}

export function createPartFilename({studyResultId, studyPage, videoCounter, segmentIndex, partIndex}) {
    return `${requireFileToken(studyResultId, 'Study result ID')}_${requireFileToken(studyPage, 'Study page')}_${requirePositiveInteger(videoCounter, 'Video counter')}_patch_s${paddedIndex(segmentIndex)}_p${paddedIndex(partIndex)}.rgb24.gz`;
}

export function createManifestFilename({studyResultId, studyPage, videoCounter}) {
    return `${requireFileToken(studyResultId, 'Study result ID')}_${requireFileToken(studyPage, 'Study page')}_${requirePositiveInteger(videoCounter, 'Video counter')}_patch_manifest.json`;
}

function manifestPart(part) {
    if (!Number.isSafeInteger(part.frameCount) || part.frameCount < 1 || part.timestampsUs.length !== part.frameCount) {
        throw new Error('Part timestamps must have one entry per frame');
    }
    if (part.byteLength !== part.frameCount * RGB24_FRAME_BYTES) {
        throw new Error('Part byte length does not match its frame count');
    }
    if (!/^[a-f0-9]{64}$/.test(part.sha256)) {
        throw new Error('Part SHA-256 must be a lowercase hexadecimal digest');
    }

    return {
        partIndex: part.partIndex,
        filename: part.filename,
        frameCount: part.frameCount,
        byteLength: part.byteLength,
        sha256: part.sha256,
        timestampsUs: [...part.timestampsUs]
    };
}

/**
 * Builds the JSON-serializable v1 manifest from sealed segments and parts.
 */
export function buildRawPatchManifest({studyResultId, studyPage, videoCounter, segments, capture}) {
    if (!Array.isArray(segments)) {
        throw new Error('Manifest segments must be an array');
    }

    const orderedSegments = [...segments].sort((left, right) => left.segmentIndex - right.segmentIndex);
    const manifestSegments = orderedSegments.map((segment, expectedIndex) => {
        if (segment.segmentIndex !== expectedIndex) {
            throw new Error('Segment indexes must be contiguous and zero-based');
        }
        requirePositiveInteger(segment.sourceWidth, 'Segment source width');
        requirePositiveInteger(segment.sourceHeight, 'Segment source height');
        validateRoiDescriptor(segment.roi);
        if (segment.roi.x + segment.roi.size > segment.sourceWidth || segment.roi.y + segment.roi.size > segment.sourceHeight) {
            throw new Error('Segment ROI extends beyond source dimensions');
        }
        if (!Array.isArray(segment.parts)) {
            throw new Error('Segment parts must be an array');
        }

        const parts = [...segment.parts]
            .sort((left, right) => left.partIndex - right.partIndex)
            .map((part, expectedPartIndex) => {
                if (part.partIndex !== expectedPartIndex) {
                    throw new Error('Part indexes must be contiguous and zero-based within a segment');
                }
                return manifestPart(part);
            });

        return {
            segmentIndex: segment.segmentIndex,
            sourceWidth: segment.sourceWidth,
            sourceHeight: segment.sourceHeight,
            roi: {...segment.roi},
            blockSize: segment.roi.size / PATCH_SIZE,
            parts
        };
    });

    return {
        formatVersion: RAW_PATCH_FORMAT_VERSION,
        filename: createManifestFilename({studyResultId, studyPage, videoCounter}),
        frame: {
            width: PATCH_SIZE,
            height: PATCH_SIZE,
            byteLength: RGB24_FRAME_BYTES,
            colorSpace: 'srgb',
            channelOrder: 'RGB'
        },
        segments: manifestSegments,
        ...(capture ? {capture} : {})
    };
}
