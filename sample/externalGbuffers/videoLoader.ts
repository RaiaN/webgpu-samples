/**
 * Utility functions for loading video G-Buffer textures from external video files
 */

export interface VideoGBufferTextures {
  albedo: GPUExternalTexture;
  normal: GPUExternalTexture;
  depth: GPUExternalTexture;
  metallic: GPUExternalTexture;
  roughness: GPUExternalTexture;
}

/**
 * Configuration for video G-Buffer inputs
 */
export interface VideoGBufferConfig {
  albedo?: string;    // Base color video path
  depth?: string;     // Depth video path  
  metallic?: string;  // Metallic video path
  normal?: string;    // Normal map video path
  roughness?: string; // Roughness video path
}

/**
 * Individual video element configuration
 */
interface VideoElement {
  element: HTMLVideoElement;
  loaded: boolean;
  width: number;
  height: number;
}

/**
 * Video synchronizer to ensure all G-Buffer videos are in sync
 */
export class VideoSynchronizer {
  private videos: Map<string, VideoElement> = new Map();
  private currentTime: number = 0;
  private isPlaying: boolean = false;

  /**
   * Add a video to be synchronized
   */
  addVideo(name: string, videoElement: HTMLVideoElement): void {
    this.videos.set(name, {
      element: videoElement,
      loaded: false,
      width: videoElement.videoWidth || 0,
      height: videoElement.videoHeight || 0
    });

    videoElement.addEventListener('loadedmetadata', () => {
      const video = this.videos.get(name);
      if (video) {
        video.loaded = true;
        video.width = videoElement.videoWidth;
        video.height = videoElement.videoHeight;
      }
    });

    videoElement.addEventListener('timeupdate', () => {
      if (this.isPlaying) {
        this.currentTime = videoElement.currentTime;
      }
    });
  }

  /**
   * Play all synchronized videos
   */
  async play(): Promise<void> {
    this.isPlaying = true;
    const playPromises = Array.from(this.videos.values()).map(video => video.element.play());
    await Promise.all(playPromises);
  }

  /**
   * Pause all synchronized videos
   */
  pause(): void {
    this.isPlaying = false;
    this.videos.forEach(video => video.element.pause());
  }

  /**
   * Seek all videos to the same time
   */
  seek(time: number): void {
    this.currentTime = time;
    this.videos.forEach(video => {
      video.element.currentTime = time;
    });
  }

  /**
   * Check if all videos are loaded and ready
   */
  allLoaded(): boolean {
    return Array.from(this.videos.values()).every(video => video.loaded);
  }

  /**
   * Get duration (assuming all videos have same duration)
   */
  getDuration(): number {
    const firstVideo = Array.from(this.videos.values())[0];
    return firstVideo ? firstVideo.element.duration : 0;
  }

  /**
   * Get current playback time
   */
  getCurrentTime(): number {
    return this.currentTime;
  }

  /**
   * Set playback rate for all videos
   */
  setPlaybackRate(rate: number): void {
    this.videos.forEach(video => {
      video.element.playbackRate = rate;
    });
  }
}

/**
 * Create video element for G-Buffer input
 */
function createVideoElement(videoSrc: string): HTMLVideoElement {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.loop = true;
  video.playsInline = true;
  video.muted = true;
  video.src = videoSrc;
  
  // Preload metadata to ensure dimensions are available
  video.preload = 'metadata';
  
  return video;
}

/**
 * Load all required G-Buffer videos and create WebGPU external textures
 */
export async function loadGBufferVideos(
  device: GPUDevice,
  config: VideoGBufferConfig,
  basePath: string = './assets/gbuffers/'
): Promise<VideoGBufferTextures> {
  const synchronizer = new VideoSynchronizer();
  const videos: Partial<VideoGBufferTextures> = {};

  // Create video elements for each G-Buffer type
  const videoElements: { [K in keyof VideoGBufferConfig]-?: HTMLVideoElement } = {};
  
  if (config.albedo) {
    videoElements.albedo = createVideoElement(`${basePath}${config.albedo}`);
    synchronizer.addVideo('albedo', videoElements.albedo);
  }
  
  if (config.depth) {
    videoElements.depth = createVideoElement(`${basePath}${config.depth}`);
    synchronizer.addVideo('depth', videoElements.depth);
  }
  
  if (config.metallic) {
    videoElements.metallic = createVideoElement(`${basePath}${config.metallic}`);
    synchronizer.addVideo('metallic', videoElements.metallic);
  }
  
  if (config.normal) {
    videoElements.normal = createVideoElement(`${basePath}${config.normal}`);
    synchronizer.addVideo('normal', videoElements.normal);
  }
  
  if (config.roughness) {
    videoElements.roughness = createVideoElement(`${basePath}${config.roughness}`);
    synchronizer.addVideo('roughness', videoElements.roughness);
  }

  // Wait for all videos to load metadata
  await new Promise<void>((resolve, reject) => {
    let loadedCount = 0;
    const totalVideos = Object.keys(videoElements).length;
    
    if (totalVideos === 0) {
      reject(new Error('No video configuration provided'));
      return;
    }

    Object.values(videoElements).forEach(video => {
      video.addEventListener('loadedmetadata', () => {
        loadedCount++;
        if (loadedCount === totalVideos) {
          // Start playing all videos
          synchronizer.play().then(resolve).catch(reject);
        }
      });
      
      video.addEventListener('error', () => {
        reject(new Error(`Failed to load video: ${video.src}`));
      });
    });
  });

  // Create GPUExternalTexture for each video
  const createExternalTexture = (name: string, element: HTMLVideoElement) => {
    return device.importExternalTexture({
      source: element,
      colorSpace: name === 'albedo' || name === 'metallic' || name === 'roughness' 
        ? 'srgb' 
        : 'display-p3', // Linear for normal/depth
    });
  };

  // Create external textures
  if (videoElements.albedo) {
    videos.albedo = createExternalTexture('albedo', videoElements.albedo);
  }
  if (videoElements.depth) {
    videos.depth = createExternalTexture('depth', videoElements.depth);
  }
  if (videoElements.metallic) {
    videos.metallic = createExternalTexture('metallic', videoElements.metallic);
  }
  if (videoElements.normal) {
    videos.normal = createExternalTexture('normal', videoElements.normal);
  }
  if (videoElements.roughness) {
    videos.roughness = createExternalTexture('roughness', videoElements.roughness);
  }

  // Store synchronizer for external control
  (videos as any).synchronizer = synchronizer;

  console.log('Successfully loaded G-Buffer video textures');
  return videos as VideoGBufferTextures;
}

/**
 * Convert depth buffer from view space to world space if needed
 * (Same utility as PNG loader)
 */
export function computeDepthLinearizationConstant(near: number, far: number, projection: Float32Array): number {
  // For perspective projection matrices, extract the linearization constant
  // This assumes a standard perspective projection matrix format
  const projEntry11 = projection[11];
  const projEntry15 = projection[15];
  
  return (-projEntry15 - projEntry11) / (projEntry15 - projEntry11);
}

/**
 * Video format recommendations for G-Buffer videos:
 * 
 * For Base Color (Albedo):
 * - Format: MP4 (H.264) or WebM (VP9)
 * - Color Space: sRGB
 * - Channels: RGB or RGBA
 * - Resolution: Match target resolution
 * 
 * For Normal Maps:
 * - Format: MP4 (H.264) or WebM (VP9)  
 * - Color Space: Linear (no gamma correction)
 * - Channels: RGB (encoded as (x+1)/2, (y+1)/2, (z+1)/2)
 * - Should encode unit normals properly
 *
 * For Depth:
 * - Format: MP4 (H.264) or WebM (VP9)
 * - Color Space: Linear
 * - Channels: Single channel (Red)
 * - Range: Normalized depth [0-1], where 1.0 = far plane
 *
 * For Metallic:
 * - Format: MP4 (H.264) or WebM (VP9)
 * - Color Space: Linear
 * - Channels: Single channel (Red) or Grayscale
 * - Range: [0-1], where 0 = dielectric, 1 = metallic
 *
 * For Roughness:
 * - Format: MP4 (H.264) or WebM (VP9)
 * - Color Space: Linear
 * - Channels: Single channel (Red) or Grayscale  
 * - Range: [0-1], where 0 = smooth, 1 = rough
 *
 * Video Requirements:
 * - All videos should have same duration
 * - All videos should have same frame rate
 * - All videos should start at t=0 for synchronization
 * - Consider using lossless compression for normal/depth maps
 * - For better compression, encode metallic and roughness as grayscale
 */
