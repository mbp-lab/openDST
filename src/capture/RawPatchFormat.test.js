import {CameraRoiProvider} from './RoiProvider';
import {RGB24_FRAME_BYTES} from './RawPatchProcessor';
import {
    buildRawPatchManifest,
    createManifestFilename,
    createPartFilename,
    sha256Hex
} from './RawPatchFormat';
import {MAX_FRAMES_PER_PART, RawPatchSegmenter} from './RawPatchPartAccumulator';

function rgb24(value) {
    return new Uint8Array(RGB24_FRAME_BYTES).fill(value);
}

describe('raw patch part format', () => {
    test('uses deterministic versioned filenames and standard SHA-256', () => {
        expect(createPartFilename({
            studyResultId: 'RESULT',
            studyPage: 'introduction',
            videoCounter: 1,
            segmentIndex: 0,
            partIndex: 0
        })).toBe('RESULT_introduction_1_patch_s000_p000.rgb24.gz');
        expect(createManifestFilename({studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1}))
            .toBe('RESULT_introduction_1_patch_manifest.json');
        expect(sha256Hex(new Uint8Array([97, 98, 99])))
            .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    test('seals at the 539-frame boundary and starts a new segment for changed dimensions', () => {
        const provider = new CameraRoiProvider();
        const firstRoi = provider.getRoi({width: 72, height: 72});
        const segmenter = new RawPatchSegmenter({
            studyResultId: 'RESULT',
            studyPage: 'introduction',
            videoCounter: 1
        });
        const frame = rgb24(7);
        let sealedParts = [];

        for (let frameIndex = 0; frameIndex < MAX_FRAMES_PER_PART; frameIndex += 1) {
            sealedParts = segmenter.appendFrame({
                rgb24: frame,
                timestampUs: frameIndex,
                sourceWidth: 72,
                sourceHeight: 72,
                roi: firstRoi
            });
        }

        expect(sealedParts).toHaveLength(1);
        expect(sealedParts[0]).toMatchObject({
            segmentIndex: 0,
            partIndex: 0,
            frameCount: MAX_FRAMES_PER_PART,
            byteLength: 8382528,
            filename: 'RESULT_introduction_1_patch_s000_p000.rgb24.gz'
        });
        expect(sealedParts[0].timestampsUs).toHaveLength(MAX_FRAMES_PER_PART);

        const secondRoi = provider.getRoi({width: 73, height: 72});
        expect(segmenter.appendFrame({
            rgb24: rgb24(8),
            timestampUs: MAX_FRAMES_PER_PART,
            sourceWidth: 73,
            sourceHeight: 72,
            roi: secondRoi
        })).toEqual([]);
        expect(segmenter.finish()).toHaveLength(1);

        const manifest = buildRawPatchManifest({
            studyResultId: 'RESULT',
            studyPage: 'introduction',
            videoCounter: 1,
            segments: segmenter.getSegments()
        });

        expect(manifest).toMatchObject({
            formatVersion: 'raw-patch-v1',
            filename: 'RESULT_introduction_1_patch_manifest.json',
            frame: {width: 72, height: 72, byteLength: RGB24_FRAME_BYTES, colorSpace: 'srgb', channelOrder: 'RGB'}
        });
        expect(manifest.segments).toHaveLength(2);
        expect(manifest.segments[0].parts[0]).not.toHaveProperty('bytes');
        expect(manifest.segments[1]).toMatchObject({
            segmentIndex: 1,
            sourceWidth: 73,
            sourceHeight: 72,
            blockSize: 1,
            parts: [{partIndex: 0, frameCount: 1, timestampsUs: [MAX_FRAMES_PER_PART]}]
        });
    });
});
