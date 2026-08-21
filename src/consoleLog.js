const MAX_ENTRIES = 1000;
const MAX_STRING_LENGTH = 2000;
const MAX_ENTRY_BYTES = 8192;
const MAX_TOTAL_BYTES = 250000;
const MAX_SERIALIZE_DEPTH = 4;
const MAX_CHUNK_BYTES = 32768;
const MAX_QUEUED_BYTES = 250000;
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_ENTRY_COUNT = 25;
const RETRY_DELAY_MS = 1000;
const entries = [];
let totalBytes = 0;
const pendingChunks = [];
let uploadQueue = Promise.resolve();
let queuedBytes = 0;
let draining = false;
let retryTimer = null;
let nextChunkNumber = 1;
let uploadTimer = null;
let uploadResultFile = null;
let studyResultId = null;

function serialize(value, seen = new WeakSet(), depth = 0) {
    if (value instanceof Error) return {name: value.name, message: value.message, stack: value.stack || null};
    if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
    if (value === null || typeof value !== 'object') return value;
    if (depth >= MAX_SERIALIZE_DEPTH) return '[Nested value omitted]';
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 50).map(item => serialize(item, seen, depth + 1));
    return Object.keys(value).slice(0, 50).reduce((result, key) => {
        try {
            result[key] = serialize(value[key], seen, depth + 1);
        } catch (error) {
            result[key] = '[Unreadable value]';
        }
        return result;
    }, {});
}

function captureEntry(level, args) {
    let entry;
    try {
        entry = {timestamp: new Date().toISOString(), level, args: args.map(arg => serialize(arg))};
    } catch (error) {
        entry = {timestamp: new Date().toISOString(), level, args: ['[Console arguments could not be captured]']};
    }
    let entryBytes = JSON.stringify(entry).length;
    if (entryBytes > MAX_ENTRY_BYTES) {
        entry = {timestamp: entry.timestamp, level, args: ['[Console entry truncated]']};
        entryBytes = JSON.stringify(entry).length;
    }
    entries.push({entry, entryBytes});
    totalBytes += entryBytes;
    while (entries.length > MAX_ENTRIES || totalBytes > MAX_TOTAL_BYTES) totalBytes -= entries.shift().entryBytes;
    if (entries.length >= FLUSH_ENTRY_COUNT) flushConsoleLog();
}

function scheduleDrain() {
    if (retryTimer || !uploadResultFile || pendingChunks.length === 0) return;
    retryTimer = setTimeout(() => {
        retryTimer = null;
        drainConsoleLog();
    }, RETRY_DELAY_MS);
}

function drainConsoleLog() {
    if (draining || !uploadResultFile || pendingChunks.length === 0) return uploadQueue;
    draining = true;
    uploadQueue = (async () => {
        while (pendingChunks.length > 0) {
            const chunk = pendingChunks[0];
            try {
                await uploadResultFile(chunk.payload, chunk.filename);
                pendingChunks.shift();
                queuedBytes -= chunk.bytes;
            } catch (error) {
                // Keep the chunk until JATOS accepts it. The timer retries later so
                // temporary upload failures cannot silently erase diagnostics.
                chunk.attempts += 1;
                scheduleDrain();
                break;
            }
        }
    })().finally(() => { draining = false; });
    return uploadQueue;
}

function enqueueChunk(chunk) {
    const payload = JSON.stringify(chunk);
    const bytes = payload.length;
    if (queuedBytes + bytes > MAX_QUEUED_BYTES) return false;
    pendingChunks.push({
        payload,
        bytes,
        attempts: 0,
        filename: studyResultId + '_consoleLog_' + String(nextChunkNumber++).padStart(6, '0') + '.json'
    });
    queuedBytes += bytes;
    drainConsoleLog();
    return true;
}

export function flushConsoleLog() {
    if (!uploadResultFile || entries.length === 0) return drainConsoleLog();
    while (entries.length > 0 && queuedBytes < MAX_QUEUED_BYTES) {
        const chunk = [];
        let chunkBytes = 2;
        let entryCount = 0;
        while (entryCount < entries.length) {
            const candidate = entries[entryCount].entry;
            const candidateBytes = JSON.stringify(candidate).length + (chunk.length ? 1 : 0);
            if (chunk.length > 0 && chunkBytes + candidateBytes > MAX_CHUNK_BYTES) break;
            chunk.push(candidate);
            chunkBytes += candidateBytes;
            entryCount += 1;
        }
        if (!enqueueChunk(chunk)) break;
        const removedEntries = entries.splice(0, entryCount);
        for (const removedEntry of removedEntries) totalBytes -= removedEntry.entryBytes;
    }
    return uploadQueue;
}

export function consoleLogUploadState() {
    return {entries: entries.length, pendingChunks: pendingChunks.length, queuedBytes, draining};
}

export function resetConsoleLogUploadForTests() {
    if (uploadTimer) clearInterval(uploadTimer);
    if (retryTimer) clearTimeout(retryTimer);
    entries.splice(0); pendingChunks.splice(0);
    totalBytes = 0; queuedBytes = 0; nextChunkNumber = 1;
    uploadTimer = null; retryTimer = null; uploadResultFile = null; studyResultId = null;
    uploadQueue = Promise.resolve(); draining = false;
}

export function startConsoleLogUpload(uploadFunction, resultId) {
    if (uploadTimer || typeof uploadFunction !== 'function' || !resultId) return;
    uploadResultFile = uploadFunction;
    studyResultId = resultId;
    uploadTimer = setInterval(flushConsoleLog, FLUSH_INTERVAL_MS);
}

export function installConsoleLogCapture(consoleObject = console) {
    if (consoleObject.__openDstLogCaptureInstalled) return;
    ['debug', 'info', 'log', 'warn', 'error'].forEach(level => {
        const original = typeof consoleObject[level] === 'function' ? consoleObject[level].bind(consoleObject) : () => {};
        consoleObject[level] = (...args) => {
            captureEntry(level, args);
            original(...args);
        };
    });
    Object.defineProperty(consoleObject, '__openDstLogCaptureInstalled', {value: true});
}

