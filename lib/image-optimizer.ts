// lib/image-optimizer.ts
/**
 * Client-side image optimization before upload
 * Reduces file size and generates thumbnails
 */

export interface OptimizedImage {
  original: File;
  compressed: Blob;
  thumbnail: Blob;
  metadata: {
    originalSize: number;
    compressedSize: number;
    thumbnailSize: number;
    width: number;
    height: number;
    compressionRatio: number;
  };
}

export interface CompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0-1
  thumbnailSize?: number;
  format?: 'image/jpeg' | 'image/webp' | 'image/png';
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 0.85,
  thumbnailSize: 400,
  format: 'image/jpeg',
};

/**
 * Compress and optimize an image file
 */
export async function optimizeImage(
  file: File,
  options: CompressionOptions = {}
): Promise<OptimizedImage> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Read the file
  const img = await loadImage(file);

  // Calculate new dimensions maintaining aspect ratio
  const { width, height } = calculateDimensions(
    img.width,
    img.height,
    opts.maxWidth,
    opts.maxHeight
  );

  // Compress main image
  const compressed = await compressImage(img, width, height, opts.quality, opts.format);

  // Generate thumbnail
  const thumbSize = Math.min(opts.thumbnailSize, width, height);
  const { width: thumbWidth, height: thumbHeight } = calculateDimensions(
    img.width,
    img.height,
    thumbSize,
    thumbSize
  );
  const thumbnail = await compressImage(
    img,
    thumbWidth,
    thumbHeight,
    0.8,
    opts.format
  );

  return {
    original: file,
    compressed,
    thumbnail,
    metadata: {
      originalSize: file.size,
      compressedSize: compressed.size,
      thumbnailSize: thumbnail.size,
      width,
      height,
      compressionRatio: Math.round((1 - compressed.size / file.size) * 100),
    },
  };
}

/**
 * Load image from File
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Calculate new dimensions maintaining aspect ratio
 */
function calculateDimensions(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  if (width <= maxWidth && height <= maxHeight) {
    return { width, height };
  }

  const aspectRatio = width / height;

  if (width > height) {
    return {
      width: Math.min(width, maxWidth),
      height: Math.round(Math.min(width, maxWidth) / aspectRatio),
    };
  } else {
    return {
      width: Math.round(Math.min(height, maxHeight) * aspectRatio),
      height: Math.min(height, maxHeight),
    };
  }
}

/**
 * Compress image using Canvas API
 */
function compressImage(
  img: HTMLImageElement,
  width: number,
  height: number,
  quality: number,
  format: string
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    // Use better image smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(img, 0, 0, width, height);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create blob'));
        }
      },
      format,
      quality
    );
  });
}

/**
 * Batch optimize multiple images
 */
export async function optimizeImages(
  files: File[],
  options: CompressionOptions = {},
  onProgress?: (completed: number, total: number) => void
): Promise<OptimizedImage[]> {
  const results: OptimizedImage[] = [];

  for (let i = 0; i < files.length; i++) {
    const optimized = await optimizeImage(files[i], options);
    results.push(optimized);
    onProgress?.(i + 1, files.length);
  }

  return results;
}

/**
 * Get image dimensions without loading full image
 */
export async function getImageDimensions(
  file: File
): Promise<{ width: number; height: number }> {
  const img = await loadImage(file);
  return { width: img.width, height: img.height };
}

/**
 * Check if file is an image
 */
export function isImage(file: File): boolean {
  return file.type.startsWith('image/');
}

/**
 * Check if file is a video
 */
export function isVideo(file: File): boolean {
  return file.type.startsWith('video/');
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
