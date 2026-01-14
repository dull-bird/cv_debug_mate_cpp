// Simple logger with configurable log level
// Set to false to disable most logs and improve performance
const ENABLE_DEBUG_LOGS = false;
const ENABLE_INFO_LOGS = false;  // Disabled by default to reduce output

export function logDebug(...args: any[]) {
    if (ENABLE_DEBUG_LOGS) {
        console.log('[DEBUG]', ...args);
    }
}

export function logInfo(...args: any[]) {
    if (ENABLE_INFO_LOGS) {
        console.log('[INFO]', ...args);
    }
}

export function logError(...args: any[]) {
    // Always log errors
    console.error('[ERROR]', ...args);
}

export function logWarn(...args: any[]) {
    console.warn('[WARN]', ...args);
}
