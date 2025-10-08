/**
 * Utility functions for loading image sequence G-Buffer textures
 */

export interface ImageGBufferTextures {
  basecolor: GPUTexture;
  normal: GPUTexture;
  depth: GPUTexture;
  metallic: GPUTexture;
  roughness: GPUTexture;
}

export interface ImageGBufferConfig {
  basecolor?: boolean;
  depth?: boolean;
  metallic?: boolean;
  normal?: boolean;
  roughness?: boolean;
}

/**
 * Image sequence controller to manage frame-by-frame loading
 */
export class ImageSequenceController {
  private basePath: string;
  private currentFrame: number = 0;
  private totalFrames: number = 0;
  private fps: number = 30;
  private isPlaying: boolean = false;
  private lastUpdateTime: number = 0;
  private device: GPUDevice;
  private textures: ImageGBufferTextures;
  private channels: string[];

  constructor(
    device: GPUDevice,
    textures: ImageGBufferTextures,
    basePath: string,
    totalFrames: number,
    channels: string[],
    fps: number = 30
  ) {
    this.device = device;
    this.textures = textures;
    this.basePath = basePath;
    this.totalFrames = totalFrames;
    this.channels = channels;
    this.fps = fps;
  }

  /**
   * Load a specific frame for all channels
   */
  async loadFrame(frameNumber: number): Promise<void> {
    if (frameNumber < 0 || frameNumber >= this.totalFrames) {
      console.warn(`Frame ${frameNumber} out of range [0, ${this.totalFrames - 1}]`);
      return;
    }

    const frameString = frameNumber.toString().padStart(4, '0');
    const loadPromises: Promise<void>[] = [];

    for (const channel of this.channels) {
      const imagePath = `${this.basePath}0000.${frameString}.${channel}.jpg`;
      loadPromises.push(this.loadImageToTexture(imagePath, channel));
    }

    await Promise.all(loadPromises);
    this.currentFrame = frameNumber;
  }

  /**
   * Load an image and copy it to the corresponding GPU texture
   */
  private async loadImageToTexture(imagePath: string, channel: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = async () => {
        try {
          // Create an ImageBitmap for efficient GPU upload
          const imageBitmap = await createImageBitmap(img);

          // Get the corresponding texture
          const texture = this.textures[channel as keyof ImageGBufferTextures];
          if (!texture) {
            throw new Error(`No texture found for channel: ${channel}`);
          }

          // Copy the image to the texture
          this.device.queue.copyExternalImageToTexture(
            { source: imageBitmap },
            { texture: texture },
            { width: imageBitmap.width, height: imageBitmap.height }
          );

          imageBitmap.close();
          resolve();
        } catch (error) {
          console.error(`Failed to load image ${imagePath}:`, error);
          reject(error);
        }
      };

      img.onerror = () => {
        reject(new Error(`Failed to load image: ${imagePath}`));
      };

      img.src = imagePath;
    });
  }

  /**
   * Play the sequence
   */
  play(): void {
    this.isPlaying = true;
    this.lastUpdateTime = performance.now();
  }

  /**
   * Pause the sequence
   */
  pause(): void {
    this.isPlaying = false;
  }

  /**
   * Seek to a specific time in seconds
   */
  async seek(time: number): Promise<void> {
    const frameNumber = Math.floor(time * this.fps);
    await this.loadFrame(Math.min(frameNumber, this.totalFrames - 1));
  }

  /**
   * Seek to a specific frame
   */
  async seekToFrame(frameNumber: number): Promise<void> {
    await this.loadFrame(frameNumber);
  }

  /**
   * Update - should be called every frame to advance the sequence if playing
   */
  async update(currentTime: number): Promise<boolean> {
    if (!this.isPlaying) {
      return false;
    }

    const deltaTime = (currentTime - this.lastUpdateTime) / 1000;
    const frameStep = deltaTime * this.fps;

    if (frameStep >= 1.0) {
      const nextFrame = (this.currentFrame + Math.floor(frameStep)) % this.totalFrames;
      await this.loadFrame(nextFrame);
      this.lastUpdateTime = currentTime;
      return true;
    }

    return false;
  }

  /**
   * Get current frame number
   */
  getCurrentFrame(): number {
    return this.currentFrame;
  }

  /**
   * Get total number of frames
   */
  getTotalFrames(): number {
    return this.totalFrames;
  }

  /**
   * Get duration in seconds
   */
  getDuration(): number {
    return this.totalFrames / this.fps;
  }

  /**
   * Get current time in seconds
   */
  getCurrentTime(): number {
    return this.currentFrame / this.fps;
  }

  /**
   * Set playback rate (FPS multiplier)
   */
  setPlaybackRate(rate: number): void {
    this.fps = 30 * rate; // Base FPS is 30
  }

  /**
   * Check if playing
   */
  isPlayingNow(): boolean {
    return this.isPlaying;
  }

  /**
   * Get FPS
   */
  getFPS(): number {
    return this.fps;
  }
}

/**
 * Detect available frames in the directory
 */
async function detectFrameCount(basePath: string, channel: string): Promise<number> {
  // Try to load frames sequentially until one fails
  let frameCount = 0;
  const maxFrames = 10000; // Safety limit

  for (let i = 0; i < maxFrames; i++) {
    const frameString = i.toString().padStart(4, '0');
    const imagePath = `${basePath}0000.${frameString}.${channel}.jpg`;

    try {
      const response = await fetch(imagePath, { method: 'HEAD' });
      if (!response.ok) {
        break;
      }
      frameCount = i + 1;
    } catch {
      break;
    }
  }

  return frameCount;
}

/**
 * Load first frame to determine dimensions
 */
async function loadFirstFrame(basePath: string, channel: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      resolve({ width: img.width, height: img.height });
    };

    img.onerror = () => {
      reject(new Error(`Failed to load first frame for channel: ${channel}`));
    };

    img.src = `${basePath}0000.0000.${channel}.jpg`;
  });
}

/**
 * Load all required G-Buffer image sequences and create WebGPU textures
 */
export async function loadGBufferImages(
  device: GPUDevice,
  config: ImageGBufferConfig,
  basePath: string = '../../assets/gbuffers/4/',
  totalFrames?: number
): Promise<{ textures: ImageGBufferTextures; controller: ImageSequenceController }> {
  const channels = Object.keys(config).filter(key => config[key as keyof ImageGBufferConfig]);

  if (channels.length === 0) {
    throw new Error('No channels specified in config');
  }

  // Detect frame count if not provided
  let frameCount = totalFrames;
  if (!frameCount) {
    console.log('Detecting frame count...');
    frameCount = await detectFrameCount(basePath, channels[0]);
    console.log(`Detected ${frameCount} frames`);
  }

  if (frameCount === 0) {
    throw new Error('No frames found in the specified directory');
  }

  // Load first frame to get dimensions
  const firstChannel = channels[0];
  const { width, height } = await loadFirstFrame(basePath, firstChannel);
  console.log(`Image dimensions: ${width}x${height}`);

  // Create GPU textures for each channel
  const textures: Partial<ImageGBufferTextures> = {};

  for (const channel of channels) {
    const texture = device.createTexture({
      label: `gBuffer ${channel}`,
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    textures[channel as keyof ImageGBufferTextures] = texture;
  }

  // Create controller
  const controller = new ImageSequenceController(
    device,
    textures as ImageGBufferTextures,
    basePath,
    frameCount,
    channels,
    30 // Default 30 FPS
  );

  // Load first frame
  console.log('Loading initial frame...');
  await controller.loadFrame(0);
  console.log('Image sequence loaded successfully');

  return { textures: textures as ImageGBufferTextures, controller };
}

