export const PATCH_VIDEO_FORMAT_VERSION = 'patch-video-avi-gzip-rgb24-v1';
export const PATCH_VIDEO_FRAME_RATE = 30;

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

export function createPatchVideoFilename({studyResultId, studyPage, videoCounter, segmentIndex, partIndex}) {
    return `${requireFileToken(studyResultId, 'Study result ID')}_${requireFileToken(studyPage, 'Study page')}_${requirePositiveInteger(videoCounter, 'Video counter')}_patch_s${paddedIndex(segmentIndex)}_p${paddedIndex(partIndex)}.avi.gz`;
}
