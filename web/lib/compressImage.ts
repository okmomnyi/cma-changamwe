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
