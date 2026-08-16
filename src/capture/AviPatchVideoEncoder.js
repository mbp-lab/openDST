import {PATCH_VIDEO_FRAME_RATE} from './AviPatchVideoFormat';
import {BGR24_FRAME_BYTES} from './RawPatchProcessor';

const PATCH_WIDTH = 72;
const PATCH_HEIGHT = 72;
const AVI_HAS_INDEX = 0x10;
const AVI_KEYFRAME = 0x10;

function fourCC(value) {
    if (typeof value !== 'string' || value.length !== 4) {
        throw new Error('AVI FourCC values must contain exactly four characters');
    }
    const bytes = new Uint8Array(4);
    for (let index = 0; index < 4; index += 1) {
        bytes[index] = value.charCodeAt(index);
    }
    return bytes;
}

function uint32(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    return bytes;
}

function concat(chunks) {
    const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const bytes = new Uint8Array(length);
    let offset = 0;
    chunks.forEach(chunk => {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    });
    return bytes;
}

function chunk(type, payload) {
    const padding = payload.byteLength % 2;
    return concat([
        fourCC(type),
        uint32(payload.byteLength),
        payload,
        ...(padding ? [new Uint8Array([0])] : [])
    ]);
}

function list(type, chunks) {
    return chunk('LIST', concat([fourCC(type), ...chunks]));
}

function mainHeader(frameCount, frameByteLength) {
    const bytes = new Uint8Array(56);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, Math.round(1000000 / PATCH_VIDEO_FRAME_RATE), true);
    view.setUint32(4, frameByteLength * PATCH_VIDEO_FRAME_RATE, true);
    view.setUint32(12, AVI_HAS_INDEX, true);
    view.setUint32(16, frameCount, true);
    view.setUint32(24, 1, true);
    view.setUint32(28, frameByteLength, true);
    view.setUint32(32, PATCH_WIDTH, true);
    view.setUint32(36, PATCH_HEIGHT, true);
    return bytes;
}

function streamHeader(frameCount, frameByteLength) {
    const bytes = new Uint8Array(56);
    const view = new DataView(bytes.buffer);
    bytes.set(fourCC('vids'), 0);
    bytes.set(fourCC('DIB '), 4);
    view.setUint32(20, 1, true);
    view.setUint32(24, PATCH_VIDEO_FRAME_RATE, true);
    view.setUint32(32, frameCount, true);
    view.setUint32(36, frameByteLength, true);
    view.setUint32(40, 0xffffffff, true);
    view.setUint16(52, PATCH_WIDTH, true);
    view.setUint16(54, PATCH_HEIGHT, true);
    return bytes;
}

function bitmapHeader(frameByteLength) {
    const bytes = new Uint8Array(40);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 40, true);
    view.setInt32(4, PATCH_WIDTH, true);
    view.setInt32(8, -PATCH_HEIGHT, true);
    view.setUint16(12, 1, true);
    view.setUint16(14, 24, true);
    view.setUint32(20, frameByteLength, true);
    return bytes;
}


function indexChunk(frameChunks) {
    const entries = new Uint8Array(frameChunks.length * 16);
    const view = new DataView(entries.buffer);
    let offset = 4;

    frameChunks.forEach((frameChunk, index) => {
        const entryOffset = index * 16;
        entries.set(fourCC('00db'), entryOffset);
        view.setUint32(entryOffset + 4, AVI_KEYFRAME, true);
        view.setUint32(entryOffset + 8, offset, true);
        view.setUint32(entryOffset + 12, frameChunk.byteLength - 8, true);
        offset += frameChunk.byteLength;
    });

    return chunk('idx1', entries);
}

function validateInput(bytes, frameCount) {
    if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(frameCount) || frameCount < 1 ||
        bytes.byteLength !== frameCount * BGR24_FRAME_BYTES) {
        throw new Error('AVI encoder requires complete 72x72 BGR24 frames');
    }
}

/**
 * Builds a standards-compliant, uncompressed 24-bit DIB AVI. The negative
 * bitmap height declares top-down rows, so the input BGR24 frame order remains
 * unchanged while each pixel is stored as the AVI-required BGR24 triplet.
 */
export function buildUncompressedAvi({bytes, frameCount}) {
    validateInput(bytes, frameCount);

    const frameChunks = [];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        const start = frameIndex * BGR24_FRAME_BYTES;
        frameChunks.push(chunk('00db', bytes.subarray(start, start + BGR24_FRAME_BYTES)));
    }

    const header = list('hdrl', [
        chunk('avih', mainHeader(frameCount, BGR24_FRAME_BYTES)),
        list('strl', [
            chunk('strh', streamHeader(frameCount, BGR24_FRAME_BYTES)),
            chunk('strf', bitmapHeader(BGR24_FRAME_BYTES))
        ])
    ]);
    const movi = list('movi', frameChunks);
    const index = indexChunk(frameChunks);

    return chunk('RIFF', concat([fourCC('AVI '), header, movi, index]));
}


/**
 * Muxes a self-contained AVI then wraps it in native gzip for upload. This
 * remains lossless and avoids FFmpeg, Wasm, and shared-memory requirements.
 */
export async function encodeGzipAvi(part) {
    if (typeof window.CompressionStream !== 'function' || typeof window.Blob !== 'function' || typeof window.Response !== 'function') {
        throw new Error('Native Blob, Response, and CompressionStream APIs are required for gzip AVI encoding');
    }

    const avi = new window.Blob([buildUncompressedAvi(part)], {type: 'video/avi'});
    const stream = avi.stream().pipeThrough(new window.CompressionStream('gzip'));
    return new window.Response(stream).blob();
}
