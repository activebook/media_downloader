// logger.js
// -------------------------
const DEBUG_MODE = false; // Global debug setting

class ExtensionLogger {
    constructor(context) {
        this.context = context;
        this.debugMode = DEBUG_MODE;
        this.prefix = `[${context}]`;
    }

    info(...args) {
        if (this.debugMode) console.log(this.prefix, 'ℹ️', ...args);
    }

    success(...args) {
        if (this.debugMode) console.log(this.prefix, '✅', ...args);
    }

    warn(...args) {
        if (this.debugMode) console.warn(this.prefix, '⚠️', ...args);
    }

    error(...args) {
        console.error(this.prefix, '❌', ...args);
    }

    progress(current, total, message = '') {
        if (this.debugMode) {
            console.log(this.prefix, `📊 ${current}/${total}`, message);
        }
    }
}
