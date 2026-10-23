export const WEB_API_VERSION = 1;
export const WEB_API_PORT = 'tandix-web-v1';
export const WEB_DISCOVERY_REQUEST = 'tandix:discover:v1';
export const WEB_DISCOVERY_RESPONSE = 'tandix:discovered:v1';
export const WEB_LIMITS = {
    maxFiles: 10,
    maxFileBytes: 25 * 1024 * 1024,
    maxImageBytes: 10 * 1024 * 1024,
    maxTotalBytes: 25 * 1024 * 1024,
    chunkBytes: 192 * 1024,
    maxPromptChars: 64_000,
    maxResultChars: 1_000_000,
    maxTaskMs: 10 * 60_000
};
export const WEB_MEDIA_TYPES = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif'
];
export class WebApiError extends Error {
    code;
    constructor(code, message){
        super(message), this.code = code;
        this.name = 'WebApiError';
    }
}
export function webRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function webpageOrigin(value) {
    try {
        const url = new URL(value);
        if (url.protocol === 'https:' || url.protocol === 'http:' && [
            'localhost',
            '127.0.0.1'
        ].includes(url.hostname)) return url.origin;
    } catch  {}
    return null;
}
