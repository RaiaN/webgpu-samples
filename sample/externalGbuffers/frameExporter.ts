/**
 * Frame exporter utility for capturing rendered frames as PNG files
 */

export interface FrameExportOptions {
  totalFrames: number;
  outputPrefix: string;
  onProgress?: (current: number, total: number) => void;
  onComplete?: () => void;
  quality?: number; // 0-1 for JPEG, ignored for PNG
}

export class FrameExporter {
  private canvas: HTMLCanvasElement;
  private device: GPUDevice;
  private isExporting: boolean = false;
  private currentFrame: number = 0;
  private options: FrameExportOptions;
  private capturedFrames: Blob[] = [];
  private exportStartTime: number = 0;

  constructor(canvas: HTMLCanvasElement, device: GPUDevice) {
    this.canvas = canvas;
    this.device = device;
  }

  /**
   * Start exporting frames
   */
  async startExport(options: FrameExportOptions): Promise<void> {
    if (this.isExporting) {
      console.warn('Export already in progress');
      return;
    }

    this.isExporting = true;
    this.currentFrame = 0;
    this.options = options;
    this.capturedFrames = [];
    this.exportStartTime = performance.now();

    console.log(`Starting frame export: ${options.totalFrames} frames`);
  }

  /**
   * Check if currently exporting
   */
  isActive(): boolean {
    return this.isExporting;
  }

  /**
   * Get current frame number
   */
  getCurrentFrame(): number {
    return this.currentFrame;
  }

  /**
   * Capture the current frame
   * Call this after rendering each frame
   */
  async captureFrame(): Promise<boolean> {
    if (!this.isExporting) {
      return false;
    }

    if (this.currentFrame >= this.options.totalFrames) {
      await this.finishExport();
      return false;
    }

    try {
      // Wait for GPU work to complete
      await this.device.queue.onSubmittedWorkDone();

      // Capture canvas as blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        this.canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create blob from canvas'));
            }
          },
          'image/png'
        );
      });

      // Store blob for batch download
      this.capturedFrames.push(blob);

      this.currentFrame++;

      // Report progress
      if (this.options.onProgress) {
        this.options.onProgress(this.currentFrame, this.options.totalFrames);
      }

      // Log progress every 10 frames
      if (this.currentFrame % 10 === 0 || this.currentFrame === this.options.totalFrames) {
        const elapsed = (performance.now() - this.exportStartTime) / 1000;
        const fps = this.currentFrame / elapsed;
        console.log(
          `Captured frame ${this.currentFrame}/${this.options.totalFrames} (${fps.toFixed(1)} fps)`
        );
      }

      return true;
    } catch (error) {
      console.error('Error capturing frame:', error);
      this.stopExport();
      return false;
    }
  }

  /**
   * Finish export and download all frames
   */
  private async finishExport(): Promise<void> {
    const totalTime = (performance.now() - this.exportStartTime) / 1000;
    console.log(`Frame capture complete! Total time: ${totalTime.toFixed(2)}s`);
    console.log(`Average FPS: ${(this.options.totalFrames / totalTime).toFixed(1)}`);
    console.log('Starting download of all frames...');

    // Download all frames
    for (let i = 0; i < this.capturedFrames.length; i++) {
      const blob = this.capturedFrames[i];
      const frameNumber = String(i).padStart(6, '0');
      const filename = `${this.options.outputPrefix}_${frameNumber}.png`;
      
      await this.downloadBlob(blob, filename);
      
      // Add small delay between downloads to prevent browser throttling
      if (i % 50 === 0 && i > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`Successfully downloaded ${this.capturedFrames.length} frames`);

    this.isExporting = false;
    this.capturedFrames = [];

    if (this.options.onComplete) {
      this.options.onComplete();
    }
  }

  /**
   * Download a blob as a file
   */
  private async downloadBlob(blob: Blob, filename: string): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      
      // Clean up after a short delay
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        resolve();
      }, 100);
    });
  }

  /**
   * Stop export
   */
  stopExport(): void {
    if (this.isExporting) {
      console.log('Export stopped');
      this.isExporting = false;
      this.capturedFrames = [];
    }
  }

  /**
   * Get export progress (0-1)
   */
  getProgress(): number {
    if (!this.options) return 0;
    return this.currentFrame / this.options.totalFrames;
  }
}

/**
 * Calculate total frames in a video
 */
export function calculateVideoFrames(video: HTMLVideoElement, fps: number = 30): number {
  return Math.floor(video.duration * fps);
}

/**
 * Get video frame rate (approximate, based on common standards)
 */
export function estimateVideoFrameRate(video: HTMLVideoElement): number {
  // Try to detect common frame rates
  // This is approximate - for exact frame rate, you'd need to analyze the video file
  const duration = video.duration;
  
  // Common frame rates: 24, 25, 30, 60
  const commonFPS = [24, 25, 30, 60];
  
  // Default to 30 fps if we can't determine
  return 30;
}

