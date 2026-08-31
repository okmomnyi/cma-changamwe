export const OUTPUT_SIZE = 600;
export const TARGET_MAX_BYTES = 300000;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export class ImageError extends Error {
}
export interface CompressedImage {
    blob: Blob;
    width: number;
    height: number;
    originalBytes: number;
    bytes: number;
}
async function decode(file: File): Promise<ImageBitmap> {
    try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
    }
    catch {
        throw new ImageError('That file could not be read as an image.');
    }
}
function drawSquare(bitmap: ImageBitmap): HTMLCanvasElement {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = Math.floor((bitmap.width - side) / 2);
    const sy = Math.floor((bitmap.height - side) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext('2d');
    if (!context)
        throw new ImageError('This browser could not process the image.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    return canvas;
}
function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ImageError('The image could not be encoded.'))), 'image/jpeg', quality);
    });
}
/**
 * A photographed attendance sheet, which is compressed for a different reason
 * than a profile picture.
 *
 * A face survives being reduced to 600 pixels square. A sheet does not: the
 * corner marks are two millimetres across and the pointer code is a symbol,
 * and both have to stay readable. So the aspect ratio is kept, the long edge
 * is held at 2200 pixels, and the quality is only dropped as far as the size
 * ceiling demands. That is still roughly a tenth of what a phone produces.
 */
export const SHEET_LONG_EDGE = 2200;
export const SHEET_MAX_BYTES = 5000000;

export async function compressSheetPhoto(file: File): Promise<CompressedImage> {
    if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) {
        throw new ImageError('Choose a JPEG, PNG or WebP image of the sheet.');
    }
    if (file.size > 40 * 1024 * 1024) {
        throw new ImageError('That photograph is larger than 40 MB. Please take it again.');
    }
    const bitmap = await decode(file);
    try {
        const longest = Math.max(bitmap.width, bitmap.height);
        const factor = longest > SHEET_LONG_EDGE ? SHEET_LONG_EDGE / longest : 1;
        const width = Math.round(bitmap.width * factor);
        const height = Math.round(bitmap.height * factor);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context)
            throw new ImageError('This browser could not process the photograph.');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(bitmap, 0, 0, width, height);

        let blob = await toBlob(canvas, 0.88);
        for (const quality of [0.8, 0.72, 0.65]) {
            if (blob.size <= SHEET_MAX_BYTES)
                break;
            blob = await toBlob(canvas, quality);
        }
        if (blob.size > SHEET_MAX_BYTES) {
            throw new ImageError(
                'That photograph is still too large once compressed. Take it again a little further back.');
        }
        return { blob, width, height, originalBytes: file.size, bytes: blob.size };
    }
    finally {
        bitmap.close();
    }
}

export async function compressProfilePhoto(file: File): Promise<CompressedImage> {
    if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) {
        throw new ImageError('Choose a JPEG, PNG or WebP image.');
    }
    if (file.size > 25 * 1024 * 1024) {
        throw new ImageError('That photo is larger than 25 MB. Please choose a smaller one.');
    }
    const bitmap = await decode(file);
    try {
        const canvas = drawSquare(bitmap);
        let blob = await toBlob(canvas, 0.82);
        for (const quality of [0.7, 0.6, 0.5]) {
            if (blob.size <= TARGET_MAX_BYTES)
                break;
            blob = await toBlob(canvas, quality);
        }
        return {
            blob,
            width: OUTPUT_SIZE,
            height: OUTPUT_SIZE,
            originalBytes: file.size,
            bytes: blob.size,
        };
    }
    finally {
        bitmap.close();
    }
}
