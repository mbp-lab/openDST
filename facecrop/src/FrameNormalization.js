export const ORIENTATION_REFERENCE_SIZE = 32;

function requireInteger(value, name, minimum = 0) {
    if (!Number.isSafeInteger(value) || value < minimum) throw new Error(name + ' is invalid');
}

function validateRotation(rotation) {
    if (![0, 90, 180, 270].includes(rotation)) throw new Error('Frame normalization rotation is invalid');
}

function normalizedLayouts(layouts) {
    if (!Array.isArray(layouts) || layouts.length !== 2) throw new Error('NV12 requires Y and UV plane layouts');
    return layouts.map((layout, index) => {
        requireInteger(layout && layout.offset, 'NV12 plane ' + index + ' offset');
        requireInteger(layout && layout.stride, 'NV12 plane ' + index + ' stride', 1);
        return {offset: layout.offset, stride: layout.stride};
    });
}

export function validateNv12Buffer(bytes, width, height, layouts) {
    if (!(bytes instanceof Uint8Array)) throw new Error('NV12 frame buffer is invalid');
    requireInteger(width, 'NV12 width', 2);
    requireInteger(height, 'NV12 height', 2);
    if (width % 2 || height % 2) throw new Error('NV12 dimensions must be even');
    const [y, uv] = normalizedLayouts(layouts);
    if (y.stride < width || uv.stride < width) throw new Error('NV12 plane stride is too small');
    const yEnd = y.offset + y.stride * (height - 1) + width;
    const uvEnd = uv.offset + uv.stride * (height / 2 - 1) + width;
    if (yEnd > bytes.byteLength || uvEnd > bytes.byteLength) throw new Error('NV12 plane layout exceeds its buffer');
    return [y, uv];
}

export function rotatedDimensions(width, height, rotation) {
    validateRotation(rotation);
    return rotation === 90 || rotation === 270 ? {width: height, height: width} : {width, height};
}

function destinationCoordinates(x, y, width, height, rotation) {
    if (rotation === 90) return {x: height - 1 - y, y: x};
    if (rotation === 180) return {x: width - 1 - x, y: height - 1 - y};
    if (rotation === 270) return {x: y, y: width - 1 - x};
    return {x, y};
}

function sourceCoordinates(x, y, width, height, rotation) {
    if (rotation === 90) return {x: y, y: height - 1 - x};
    if (rotation === 270) return {x: width - 1 - y, y: x};
    throw new Error('Pixel-distance calibration requires a quarter turn');
}

function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
}

export function convertFullRangeBt709Nv12ToRgba({bytes, width, height, layouts, rotation = 0}) {
    validateRotation(rotation);
    const [yPlane, uvPlane] = validateNv12Buffer(bytes, width, height, layouts);
    const outputDimensions = rotatedDimensions(width, height, rotation);
    const rgba = new Uint8Array(outputDimensions.width * outputDimensions.height * 4);
    for (let sourceY = 0; sourceY < height; sourceY += 1) {
        for (let sourceX = 0; sourceX < width; sourceX += 1) {
            const luma = bytes[yPlane.offset + sourceY * yPlane.stride + sourceX];
            const chroma = uvPlane.offset + Math.floor(sourceY / 2) * uvPlane.stride + Math.floor(sourceX / 2) * 2;
            const cb = bytes[chroma] - 128;
            const cr = bytes[chroma + 1] - 128;
            const destination = destinationCoordinates(sourceX, sourceY, width, height, rotation);
            const offset = (destination.y * outputDimensions.width + destination.x) * 4;
            rgba[offset] = clampByte(luma + 1.5748 * cr);
            rgba[offset + 1] = clampByte(luma - 0.187324 * cb - 0.468124 * cr);
            rgba[offset + 2] = clampByte(luma + 1.8556 * cb);
            rgba[offset + 3] = 255;
        }
    }
    return {rgbx: rgba, ...outputDimensions};
}

function rotationDistance({bytes, width, height, yLayout, reference, referenceWidth, referenceHeight, rotation}) {
    const output = rotatedDimensions(width, height, rotation);
    let distance = 0;
    let samples = 0;
    for (let referenceY = 2; referenceY < referenceHeight - 2; referenceY += 1) {
        for (let referenceX = 2; referenceX < referenceWidth - 2; referenceX += 1) {
            const outputX = Math.min(output.width - 1, Math.floor((referenceX + 0.5) * output.width / referenceWidth));
            const outputY = Math.min(output.height - 1, Math.floor((referenceY + 0.5) * output.height / referenceHeight));
            const source = sourceCoordinates(outputX, outputY, width, height, rotation);
            const luma = bytes[yLayout.offset + source.y * yLayout.stride + source.x];
            distance += Math.abs(luma - reference[referenceY * referenceWidth + referenceX]);
            samples += 1;
        }
    }
    return distance / samples;
}

export function selectQuarterTurnByLuminance({bytes, width, height, layouts, reference,
    referenceWidth = ORIENTATION_REFERENCE_SIZE, referenceHeight = ORIENTATION_REFERENCE_SIZE}) {
    const [yLayout] = validateNv12Buffer(bytes, width, height, layouts);
    if (!(reference instanceof Uint8Array) || reference.byteLength !== referenceWidth * referenceHeight) {
        throw new Error('Orientation reference luminance is invalid');
    }
    const clockwiseDistance = rotationDistance({bytes, width, height, yLayout, reference, referenceWidth, referenceHeight, rotation: 90});
    const counterclockwiseDistance = rotationDistance({bytes, width, height, yLayout, reference, referenceWidth, referenceHeight, rotation: 270});
    return {rotation: clockwiseDistance <= counterclockwiseDistance ? 90 : 270,
        clockwiseDistance, counterclockwiseDistance};
}
