/**
 * Utility functions for loading PNG textures from external files
 */

export interface PNGTextureInfo {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Load a PNG file and return its pixel data
 */
export async function loadPNGImage(pngPath: string): Promise<PNGTextureInfo> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      
      resolve({
        width: img.width,
        height: img.height,
        data: imageData.data
      });
    };
    
    img.onerror = () => {
      reject(new Error(`Failed to load PNG: ${pngPath}`));
    };
    
    img.src = pngPath;
  });
}

/**
 * Create a WebGPU texture from PNG data
 */
export async function createTextureFromPNG(
  device: GPUDevice,
  pngInfo: PNGTextureInfo,
  format: GPUTextureFormat = 'rgba8unorm'
): Promise<GPUTexture> {
  const texture = device.createTexture({
    label: 'PNG Texture',
    size: { width: pngInfo.width, height: pngInfo.height },
    format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  await device.queue.writeTexture(
    { texture },
    pngInfo.data.buffer,
    { 
      bytesPerRow: pngInfo.width * 4, 
      rowsPerImage: pngInfo.height 
    },
    { width: pngInfo.width, height: pngInfo.height }
  );

  return texture;
}

/**
 * Load all required G-Buffer PNGs and create WebGPU textures
 */
export interface GBufferTextures {
  albedo: GPUTexture;
  normal: GPUTexture;
  depth: GPUTexture;
  specular: GPUTexture;
  metallic: GPUTexture;
}

export async function loadGBufferTextures(
  device: GPUDevice,
  basePath: string = './assets/gbuffers/'
): Promise<GBufferTextures> {
  const [albedoInfo, normalInfo, depthInfo, specularInfo, metallicInfo] = await Promise.all([
    loadPNGImage(`${basePath}albedo.png`),
    loadPNGImage(`${basePath}normal.png`),
    loadPNGImage(`${basePath}depth.png`),
    loadPNGImage(`${basePath}specular.png`),
    loadPNGImage(`${basePath}metallic.png`)
  ]);

  const [albedoTexture, normalTexture, depthTexture, specularTexture, metallicTexture] = await Promise.all([
    createTextureFromPNG(device, albedoInfo, 'rgba8unorm'),
    createTextureFromPNG(device, normalInfo, 'rgba16float'), // Normal maps typically use higher precision
    createTextureFromPNG(device, depthInfo, 'r32float'), // Depth buffers are single channel
    createTextureFromPNG(device, specularInfo, 'rgba8unorm'),
    createTextureFromPNG(device, metallicInfo, 'rgba8unorm')
  ]);

  return {
    albedo: albedoTexture,
    normal: normalTexture,
    depth: depthTexture,
    specular: specularTexture,
    metallic: metallicTexture
  };
}

/**
 * Convert depth buffer from view space to world space if needed
 */
export function computeDepthLinearizationConstant(near: number, far: number, projection: Float32Array): number {
  // For perspective projection matrices, extract the linearization constant
  // This assumes a standard perspective projection matrix format
  const projEntry11 = projection[11];
  const projEntry15 = projection[15];
  
  return (-projEntry15 - projEntry11) / (projEntry15 - projEntry11);
}
