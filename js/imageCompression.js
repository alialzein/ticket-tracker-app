// js/imageCompression.js
// Image compression utility to reduce file sizes before upload

/**
 * Compress an image file before upload
 * @param {File} file - The image file to compress
 * @param {Object} options - Compression options
 * @returns {Promise<File>} - Compressed image file
 */
export async function compressImage(file, options = {}) {
    const {
        maxWidth = 1920,        // Max width (Full HD)
        maxHeight = 1080,       // Max height (Full HD)
        quality = 0.8,          // JPEG quality (0.1 - 1.0)
        maxSizeMB = 1,          // Target max size in MB
        maintainAspectRatio = true
    } = options;

    // Only compress images
    if (!file.type.startsWith('image/')) {
        console.log('[Image Compression] Not an image, skipping compression:', file.name);
        return file;
    }

    // Skip GIFs (might be animated)
    if (file.type === 'image/gif') {
        console.log('[Image Compression] Skipping GIF (might be animated):', file.name);
        return file;
    }

    // Skip SVGs (vector graphics, already small)
    if (file.type === 'image/svg+xml') {
        console.log('[Image Compression] Skipping SVG (vector graphics):', file.name);
        return file;
    }

    const originalSize = (file.size / 1024 / 1024).toFixed(2);
    console.log(`[Image Compression] Original: ${file.name} (${originalSize} MB)`);

    try {
        // Create image element
        const img = await createImageFromFile(file);

        // Calculate new dimensions
        let { width, height } = calculateDimensions(img.width, img.height, maxWidth, maxHeight, maintainAspectRatio);

        // Create canvas and compress
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');

        // Enable image smoothing for better quality
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw image on canvas
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to blob with compression
        const blob = await canvasToBlob(canvas, file.type, quality);

        // Check if we need to compress more
        let finalBlob = blob;
        let currentQuality = quality;

        // If still too large, reduce quality further
        while (finalBlob.size > maxSizeMB * 1024 * 1024 && currentQuality > 0.1) {
            currentQuality -= 0.1;
            finalBlob = await canvasToBlob(canvas, file.type, currentQuality);
            console.log(`[Image Compression] Reducing quality to ${(currentQuality * 100).toFixed(0)}%`);
        }

        // Create new file from blob
        const compressedFile = new File([finalBlob], file.name, {
            type: file.type,
            lastModified: Date.now()
        });

        const compressedSize = (compressedFile.size / 1024 / 1024).toFixed(2);
        const reduction = ((1 - compressedFile.size / file.size) * 100).toFixed(1);

        console.log(`[Image Compression] Compressed: ${file.name} (${compressedSize} MB) - Reduced by ${reduction}%`);

        return compressedFile;

    } catch (error) {
        console.error('[Image Compression] Failed to compress image, using original:', error);
        return file;
    }
}

/**
 * Create an image element from a file
 */
function createImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image'));
        };

        img.src = url;
    });
}

/**
 * Calculate new dimensions while maintaining aspect ratio
 */
function calculateDimensions(originalWidth, originalHeight, maxWidth, maxHeight, maintainAspectRatio) {
    if (!maintainAspectRatio) {
        return { width: maxWidth, height: maxHeight };
    }

    let width = originalWidth;
    let height = originalHeight;

    // Only resize if image is larger than max dimensions
    if (width > maxWidth || height > maxHeight) {
        const aspectRatio = width / height;

        if (width > height) {
            width = maxWidth;
            height = width / aspectRatio;
        } else {
            height = maxHeight;
            width = height * aspectRatio;
        }
    }

    return { width: Math.round(width), height: Math.round(height) };
}

/**
 * Convert canvas to blob with specified quality
 */
function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Failed to create blob'));
                }
            },
            mimeType,
            quality
        );
    });
}

/**
 * Compress multiple images
 */
export async function compressImages(files, options = {}) {
    const compressed = [];

    for (const file of files) {
        const compressedFile = await compressImage(file, options);
        compressed.push(compressedFile);
    }

    return compressed;
}

/**
 * Get recommended compression settings based on use case
 */
export function getCompressionPresets() {
    return {
        // For ticket attachments (balance quality and size)
        attachment: {
            maxWidth: 1920,
            maxHeight: 1080,
            quality: 0.85,
            maxSizeMB: 2
        },

        // For note images (embedded in notes, can be more compressed)
        note: {
            maxWidth: 1280,
            maxHeight: 720,
            quality: 0.8,
            maxSizeMB: 1
        },

        // For thumbnails (small previews)
        thumbnail: {
            maxWidth: 400,
            maxHeight: 300,
            quality: 0.7,
            maxSizeMB: 0.2
        },

        // For profile images
        profile: {
            maxWidth: 500,
            maxHeight: 500,
            quality: 0.85,
            maxSizeMB: 0.5
        }
    };
}
