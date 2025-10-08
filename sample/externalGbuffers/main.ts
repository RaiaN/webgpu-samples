import { mat4, vec3, vec4 } from 'wgpu-matrix';
import { GUI } from 'dat.gui';
import { quitIfWebGPUNotAvailable, quitIfLimitLessThan } from '../util';

// Import external G-Buffer shaders
import vertexTextureQuad from './vertexTextureQuad.wgsl';
import fragmentExternalGBuffers from './fragmentExternalGBuffers.wgsl';
import fragmentExternalGBuffersDirectional from './fragmentExternalGBuffersDirectional.wgsl';
import fragmentExternalGBuffersDebugView from './fragmentExternalGBuffersDebugView.wgsl';

// Import Video loader utilities
import { loadGBufferVideos, VideoGBufferTextures, VideoGBufferConfig, createExternalTexturesFromVideos } from './videoLoader';

// Point lights configuration
const kMaxNumLights = 64; // Reduced for performance - external textures + deferred rendering can be expensive
const lightExtentMin = vec3.fromValues(-50, -30, -50);
const lightExtentMax = vec3.fromValues(50, 50, 50);

// Directional lights configuration
const kMaxNumDirectionalLights = 4; // Typically only need 1-3 directional lights (sun, moon, etc.)

// Helper function to convert yaw/pitch angles to direction vector
function azimuthElevationToDirection(azimuthDeg: number, elevationDeg: number) {
  const azimuthRad = (azimuthDeg * Math.PI) / 180;
  const elevationRad = (elevationDeg * Math.PI) / 180;
  
  // Convert spherical coordinates to Cartesian
  // Yaw (Azimuth): 0° = +X, 90° = +Z, 180° = -X, 270° = -Z (horizontal rotation)
  // Pitch (Elevation): -90° = down, 0° = horizon, +90° = up (vertical rotation)
  const x = Math.cos(elevationRad) * Math.cos(azimuthRad);
  const y = Math.sin(elevationRad);
  const z = Math.cos(elevationRad) * Math.sin(azimuthRad);
  
  return vec3.normalize(vec3.fromValues(x, y, z));
}

const canvas = document.querySelector('canvas') as HTMLCanvasElement;
const adapter = await navigator.gpu?.requestAdapter({
  featureLevel: 'compatibility',
});
const limits: Record<string, GPUSize32> = {};
quitIfLimitLessThan(adapter, 'maxStorageBuffersInFragmentStage', 1, limits);
quitIfLimitLessThan(adapter, 'maxSampledTexturesPerShaderStage', 16, limits);
const device = await adapter?.requestDevice({
  requiredLimits: limits,
});
quitIfWebGPUNotAvailable(adapter, device);

const context = canvas.getContext('webgpu') as GPUCanvasContext;

const devicePixelRatio = window.devicePixelRatio;
canvas.width = canvas.clientWidth * devicePixelRatio;
canvas.height = canvas.clientHeight * devicePixelRatio;
const aspect = canvas.width / canvas.height;
const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
context.configure({
  device,
  format: presentationFormat,
});

// Load external G-Buffer textures (Video only)
let gBufferTextures: VideoGBufferTextures;
let synchronizer: any = null;
let videoElements: any = null;

async function loadGbufferAssets() {
  // Video G-Buffer configuration
  const videoConfig: VideoGBufferConfig = {
    albedo: 'albedo.mp4',
    depth: 'depth.mp4', 
    metallic: 'metallic.mp4',
    normal: 'normal.mp4',
    roughness: 'roughness.mp4'
  };

  try {
    gBufferTextures = await loadGBufferVideos(device, videoConfig, '../../assets/gbuffers/');
    synchronizer = (gBufferTextures as any).synchronizer;
    videoElements = (gBufferTextures as any).videoElements;
    console.log('Successfully loaded G-Buffer video textures');
    console.log('Use GUI controls to adjust video playback');
  } catch (error) {
    console.error('Failed to load G-Buffer video textures:', error);
    console.log('Please ensure the following video files exist in ./assets/gbuffers/:');
    console.log('- albedo.mp4');
    console.log('- normal.mp4');
    console.log('- depth.mp4');
    console.log('- metallic.mp4');
    console.log('- roughness.mp4');
    throw error;
  }
}

await loadGbufferAssets();

// Create texture views/resource arrays for the G-Buffers (Video only)
// NOTE: We pack metallic+roughness into one external texture to stay within the 
// 16 sampled texture limit (4 external textures × 4 planes = 16)
// External textures must be recreated every frame
let gBufferResources: GPUExternalTexture[] = [];

// Create samplers
const gBufferSampler = device.createSampler({
  label: 'gBuffer sampler',
  magFilter: 'linear',
  minFilter: 'linear',
});

// Bind group layout for G-Buffer textures
const gBufferTexturesBindGroupLayout = device.createBindGroupLayout({
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      externalTexture: {},
    },
    {
      binding: 1,
      visibility: GPUShaderStage.FRAGMENT,
      externalTexture: {},
    },
    {
      binding: 2,
      visibility: GPUShaderStage.FRAGMENT,
      externalTexture: {},
    },
    {
      binding: 3,
      visibility: GPUShaderStage.FRAGMENT,
      externalTexture: {},
    },
    {
      binding: 4,
      visibility: GPUShaderStage.FRAGMENT,
      sampler: {},
    },
  ],
});

// Bind group layout for lights buffer
const lightsBufferBindGroupLayout = device.createBindGroupLayout({
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
      buffer: {
        type: 'read-only-storage',
      },
    },
    {
      binding: 1,
      visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
      buffer: {
        type: 'uniform',
      },
    },
    {
      binding: 2,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: {
        type: 'uniform',
      },
    },
  ],
});

const primitive: GPUPrimitiveState = {
  topology: 'triangle-list',
  cullMode: 'back',
};

// External G-Buffers Debug View Pipeline
const externalGBuffersDebugViewPipeline = device.createRenderPipeline({
  label: 'external gbuffers debug view',
  layout: device.createPipelineLayout({
    bindGroupLayouts: [gBufferTexturesBindGroupLayout],
  }),
  vertex: {
    module: device.createShaderModule({
      code: vertexTextureQuad,
    }),
  },
  fragment: {
    module: device.createShaderModule({
      code: fragmentExternalGBuffersDebugView,
    }),
    targets: [
      {
        format: presentationFormat,
      },
    ],
    constants: {
      canvasSizeWidth: canvas.width,
      canvasSizeHeight: canvas.height,
    },
  },
  primitive,
});

// External G-Buffers Deferred Rendering Pipeline (Point Lights)
const externalGBuffersDeferredRenderPipeline = device.createRenderPipeline({
  label: 'external gbuffers deferred rendering - point lights',
  layout: device.createPipelineLayout({
    bindGroupLayouts: [
      gBufferTexturesBindGroupLayout,
      lightsBufferBindGroupLayout,
    ],
  }),
  vertex: {
    module: device.createShaderModule({
      code: vertexTextureQuad,
    }),
  },
  fragment: {
    module: device.createShaderModule({
      code: fragmentExternalGBuffers,
    }),
    targets: [
      {
        format: presentationFormat,
      },
    ],
    constants: {
      canvasSizeWidth: canvas.width,
      canvasSizeHeight: canvas.height,
    },
  },
  primitive,
});

// External G-Buffers Deferred Rendering Pipeline (Directional Lights)
const externalGBuffersDirectionalRenderPipeline = device.createRenderPipeline({
  label: 'external gbuffers deferred rendering - directional lights',
  layout: device.createPipelineLayout({
    bindGroupLayouts: [
      gBufferTexturesBindGroupLayout,
      lightsBufferBindGroupLayout, // Same layout works for directional lights
    ],
  }),
  vertex: {
    module: device.createShaderModule({
      code: vertexTextureQuad,
    }),
  },
  fragment: {
    module: device.createShaderModule({
      code: fragmentExternalGBuffersDirectional,
    }),
    targets: [
      {
        format: presentationFormat,
      },
    ],
    constants: {
      canvasSizeWidth: canvas.width,
      canvasSizeHeight: canvas.height,
    },
  },
  primitive,
});

const textureQuadPassDescriptor: GPURenderPassDescriptor = {
  colorAttachments: [
    {
      // view is acquired and set in render loop.
      view: undefined,
      clearValue: [0, 0, 0, 1],
      loadOp: 'clear',
      storeOp: 'store',
    },
  ],
};

const settings = {
  mode: 'rendering',
  lightType: 'directional', // 'point' or 'directional'
  numLights: 2, // Used differently: directional uses fixed lights, point lights uses this for count
  videoPlaybackRate: 1.0,
  debugLights: false, // Toggle to visualize where lights are active
  // Directional light 0 controls (main sun)
  light0Azimuth: 135, // Horizontal angle in degrees (0 = +X, 90 = +Z, 180 = -X, 270 = -Z)
  light0Elevation: 45, // Vertical angle in degrees (-90 = down, 0 = horizon, 90 = up)
  light0Intensity: 3.0,
  light0ColorR: 1.0,
  light0ColorG: 0.95,
  light0ColorB: 0.9,
};

const configUniformBuffer = (() => {
  const buffer = device.createBuffer({
    label: 'config uniforms',
    size: Uint32Array.BYTES_PER_ELEMENT,
    mappedAtCreation: true,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  new Uint32Array(buffer.getMappedRange())[0] = settings.numLights;
  buffer.unmap();
  return buffer;
})();

const gui = new GUI();
gui.add(settings, 'mode', ['rendering', 'gBuffers view']);

// Number of lights control (only for point lights)
const numLightsControl = gui
  .add(settings, 'numLights', 1, kMaxNumLights)
  .step(1)
  .name('Num Point Lights')
  .onChange(() => {
    device.queue.writeBuffer(
      configUniformBuffer,
      0,
      new Uint32Array([settings.numLights])
    );
  });

// Directional Light Controls (Main Sun/Light 0)
const dirLightFolder = gui.addFolder('Directional Light 0');
dirLightFolder.add(settings, 'light0Azimuth', 0, 360).name('Yaw (°)').listen();
dirLightFolder.add(settings, 'light0Elevation', -90, 90).name('Pitch (°)').listen();
dirLightFolder.add(settings, 'light0Intensity', 0, 10).name('Intensity').listen();
dirLightFolder.addColor(
  {
    color: [
      settings.light0ColorR * 255,
      settings.light0ColorG * 255,
      settings.light0ColorB * 255
    ]
  },
  'color'
).name('Color').onChange((value: number[]) => {
  settings.light0ColorR = value[0] / 255;
  settings.light0ColorG = value[1] / 255;
  settings.light0ColorB = value[2] / 255;
});

// Quick presets for common sun positions
dirLightFolder.add({
  preset: () => {
    settings.light0Azimuth = 90;
    settings.light0Elevation = 5;
    settings.light0Intensity = 2.5;
    settings.light0ColorR = 1.0;
    settings.light0ColorG = 0.7;
    settings.light0ColorB = 0.5;
  }
}, 'preset').name('☀️ Sunrise');

dirLightFolder.add({
  preset: () => {
    settings.light0Azimuth = 180;
    settings.light0Elevation = 60;
    settings.light0Intensity = 4.0;
    settings.light0ColorR = 1.0;
    settings.light0ColorG = 1.0;
    settings.light0ColorB = 0.95;
  }
}, 'preset').name('☀️ Noon');

dirLightFolder.add({
  preset: () => {
    settings.light0Azimuth = 270;
    settings.light0Elevation = 5;
    settings.light0Intensity = 2.0;
    settings.light0ColorR = 1.0;
    settings.light0ColorG = 0.5;
    settings.light0ColorB = 0.3;
  }
}, 'preset').name('🌅 Sunset');

dirLightFolder.add({
  preset: () => {
    settings.light0Azimuth = 0;
    settings.light0Elevation = -30;
    settings.light0Intensity = 1.5;
    settings.light0ColorR = 0.2;
    settings.light0ColorG = 0.3;
    settings.light0ColorB = 0.6;
  }
}, 'preset').name('🌙 Night/Moon');

dirLightFolder.open();

// Light type selector
gui.add(settings, 'lightType', ['point', 'directional']).name('Light Type').onChange((value: string) => {
  // Show/hide controls based on light type using DOM
  const numLightsElement = numLightsControl.domElement.parentElement?.parentElement;
  const dirLightFolderElement = dirLightFolder.domElement.parentElement;
  
  if (value === 'directional') {
    // Hide point light controls, show directional light controls
    if (numLightsElement) numLightsElement.style.display = 'none';
    if (dirLightFolderElement) dirLightFolderElement.style.display = '';
    settings.numLights = Math.min(settings.numLights, kMaxNumDirectionalLights);
  } else {
    // Show point light controls, hide directional light controls
    if (numLightsElement) numLightsElement.style.display = '';
    if (dirLightFolderElement) dirLightFolderElement.style.display = 'none';
    // Set a reasonable default for point lights if currently low
    if (settings.numLights < 8) {
      settings.numLights = 16;
    }
  }
  
  device.queue.writeBuffer(
    configUniformBuffer,
    0,
    new Uint32Array([settings.numLights])
  );
});

// Initially show/hide controls based on light type
if (settings.lightType === 'directional') {
  const numLightsElement = numLightsControl.domElement.parentElement?.parentElement;
  if (numLightsElement) {
    numLightsElement.style.display = 'none';
  }
} else {
  const dirLightFolderElement = dirLightFolder.domElement.parentElement;
  if (dirLightFolderElement) {
    dirLightFolderElement.style.display = 'none';
  }
}

// Video-specific controls
const videoFolder = gui.addFolder('Video Controls');
videoFolder.add(settings, 'videoPlaybackRate', 0.1, 3.0).onChange(() => {
  if (synchronizer) {
    synchronizer.setPlaybackRate(settings.videoPlaybackRate);
  }
});

videoFolder.add({
  button: () => synchronizer?.pause(),
}, 'button').name('Pause Videos');

videoFolder.add({
  button: () => synchronizer?.play(),
}, 'button').name('Play Videos');

videoFolder.add({
  button: () => synchronizer?.seek(0),
}, 'button').name('Reset Videos');

const cameraUniformBuffer = device.createBuffer({
  label: 'camera matrix uniform',
  size: 4 * 16 * 2, // two 4x4 matrix
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// G-Buffer textures bind group - needs to be recreated when switching modes
function createGBufferBindGroup() {
  // Validate all resources are present
  if (gBufferResources.length !== 4 || gBufferResources.some(r => !r)) {
    throw new Error('Invalid G-Buffer resources: expected 4 valid external textures');
  }
  
  return device.createBindGroup({
    layout: gBufferTexturesBindGroupLayout,
    entries: [
      {
        binding: 0,
        resource: gBufferResources[0], // albedo
      },
      {
        binding: 1,
        resource: gBufferResources[1], // normal
      },
      {
        binding: 2,
        resource: gBufferResources[2], // depth
      },
      {
        binding: 3,
        resource: gBufferResources[3], // metallic+roughness
      },
      {
        binding: 4,
        resource: gBufferSampler,
      },
    ],
  });
}

let gBufferTexturesBindGroup: GPUBindGroup;

// Lights data are uploaded in a storage buffer
const extent = vec3.sub(lightExtentMax, lightExtentMin);
const lightDataStride = 8;
const bufferSizeInByte =
  Float32Array.BYTES_PER_ELEMENT * lightDataStride * kMaxNumLights;
const lightsBuffer = device.createBuffer({
  label: 'lights storage',
  size: bufferSizeInByte,
  usage: GPUBufferUsage.STORAGE,
  mappedAtCreation: true,
});

// Randomly populate lights in a box range
const lightData = new Float32Array(lightsBuffer.getMappedRange());
const tmpVec4 = vec4.create();
let offset = 0;
for (let i = 0; i < kMaxNumLights; i++) {
  offset = lightDataStride * i;
  // position
  for (let i = 0; i < 3; i++) {
    tmpVec4[i] = Math.random() * extent[i] + lightExtentMin[i];
  }
  tmpVec4[3] = 1;
  lightData.set(tmpVec4, offset);
  // color (increased intensity for more visible lighting)
  tmpVec4[0] = Math.random() * 5 + 1; // 1-6 range
  tmpVec4[1] = Math.random() * 5 + 1;
  tmpVec4[2] = Math.random() * 5 + 1;
  // radius (increased from 20 to 50 for broader coverage)
  tmpVec4[3] = 250.0;
  lightData.set(tmpVec4, offset + 4);
}
lightsBuffer.unmap();

console.log(`Initialized ${kMaxNumLights} point lights with radius 250 units and intensity 1-6`);

// ===== Directional Lights Buffer =====
// Directional light data: vec3 direction, f32 intensity, vec3 color, f32 padding = 8 floats
const directionalLightDataStride = 8;
const directionalBufferSizeInByte =
  Float32Array.BYTES_PER_ELEMENT * directionalLightDataStride * kMaxNumDirectionalLights;
const directionalLightsBuffer = device.createBuffer({
  label: 'directional lights storage',
  size: directionalBufferSizeInByte,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, // Allow updates
  mappedAtCreation: true,
});

// Populate directional lights (like Unreal's Directional Light / Sun)
const directionalLightData = new Float32Array(directionalLightsBuffer.getMappedRange());

// Pre-calculate initial direction for light 0 from settings
const initialDirection0 = azimuthElevationToDirection(settings.light0Azimuth, settings.light0Elevation);

const directionalLights = [
  {
    direction: initialDirection0, // Main sun light (controlled by user)
    intensity: settings.light0Intensity,
    color: vec3.fromValues(settings.light0ColorR, settings.light0ColorG, settings.light0ColorB),
  },
  {
    direction: vec3.normalize(vec3.fromValues(-0.3, -0.5, -0.8)), // Fill light (from opposite direction)
    intensity: 1.0,
    color: vec3.fromValues(0.5, 0.6, 0.8), // Cool blue fill
  },
  {
    direction: vec3.normalize(vec3.fromValues(0.0, 0.8, -0.6)), // Rim/back light
    intensity: 0.8,
    color: vec3.fromValues(0.9, 0.9, 1.0), // Slight blue rim
  },
  {
    direction: vec3.normalize(vec3.fromValues(0.0, -1.0, 0.0)), // Top-down light
    intensity: 0.5,
    color: vec3.fromValues(1.0, 1.0, 1.0), // White fill
  },
];

for (let i = 0; i < kMaxNumDirectionalLights; i++) {
  const lightOffset = directionalLightDataStride * i;
  const light = directionalLights[i];
  
  // Direction (vec3)
  directionalLightData[lightOffset + 0] = light.direction[0];
  directionalLightData[lightOffset + 1] = light.direction[1];
  directionalLightData[lightOffset + 2] = light.direction[2];
  // Intensity (f32)
  directionalLightData[lightOffset + 3] = light.intensity;
  // Color (vec3)
  directionalLightData[lightOffset + 4] = light.color[0];
  directionalLightData[lightOffset + 5] = light.color[1];
  directionalLightData[lightOffset + 6] = light.color[2];
  // Padding (f32)
  directionalLightData[lightOffset + 7] = 0.0;
}
directionalLightsBuffer.unmap();

console.log(`Initialized ${kMaxNumDirectionalLights} directional lights (sun-like)`);

// Function to update directional lights from settings
function updateDirectionalLightsFromSettings() {
  const tempData = new Float32Array(directionalBufferSizeInByte / Float32Array.BYTES_PER_ELEMENT);
  
  // Update light 0 from user settings
  const direction0 = azimuthElevationToDirection(settings.light0Azimuth, settings.light0Elevation);
  tempData[0] = direction0[0];
  tempData[1] = direction0[1];
  tempData[2] = direction0[2];
  tempData[3] = settings.light0Intensity;
  tempData[4] = settings.light0ColorR;
  tempData[5] = settings.light0ColorG;
  tempData[6] = settings.light0ColorB;
  tempData[7] = 0.0; // padding
  
  // Keep other lights as originally configured
  for (let i = 1; i < kMaxNumDirectionalLights; i++) {
    const lightOffset = directionalLightDataStride * i;
    const light = directionalLights[i];
    
    tempData[lightOffset + 0] = light.direction[0];
    tempData[lightOffset + 1] = light.direction[1];
    tempData[lightOffset + 2] = light.direction[2];
    tempData[lightOffset + 3] = light.intensity;
    tempData[lightOffset + 4] = light.color[0];
    tempData[lightOffset + 5] = light.color[1];
    tempData[lightOffset + 6] = light.color[2];
    tempData[lightOffset + 7] = 0.0;
  }
  
  device.queue.writeBuffer(directionalLightsBuffer, 0, tempData);
}

const lightExtentBuffer = device.createBuffer({
  label: 'light extent uniform',
  size: 4 * 8,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const lightExtentData = new Float32Array(8);
lightExtentData.set(lightExtentMin, 0);
lightExtentData.set(lightExtentMax, 4);
device.queue.writeBuffer(
  lightExtentBuffer,
  0,
  lightExtentData.buffer,
  lightExtentData.byteOffset,
  lightExtentData.byteLength
);

// Bind group for point lights
const lightsBufferBindGroup = device.createBindGroup({
  layout: lightsBufferBindGroupLayout,
  entries: [
    {
      binding: 0,
      resource: {
        buffer: lightsBuffer,
      },
    },
    {
      binding: 1,
      resource: {
        buffer: configUniformBuffer,
      },
    },
    {
      binding: 2,
      resource: {
        buffer: cameraUniformBuffer,
      },
    },
  ],
});

// Bind group for directional lights
const directionalLightsBufferBindGroup = device.createBindGroup({
  layout: lightsBufferBindGroupLayout, // Same layout works for both
  entries: [
    {
      binding: 0,
      resource: {
        buffer: directionalLightsBuffer,
      },
    },
    {
      binding: 1,
      resource: {
        buffer: configUniformBuffer,
      },
    },
    {
      binding: 2,
      resource: {
        buffer: cameraUniformBuffer,
      },
    },
  ],
});

// Scene matrices
const eyePosition = vec3.fromValues(0, 50, -100);
const upVector = vec3.fromValues(0, 1, 0);
const origin = vec3.fromValues(0, 0, 0);

const projectionMatrix = mat4.perspective((2 * Math.PI) / 5, aspect, 1, 2000.0);

// Rotates the camera around the origin based on time.
function getCameraViewProjMatrix() {
  const rad = Math.PI * (Date.now() / 5000);
  const rotation = mat4.rotateY(mat4.translation(origin), rad);
  const rotatedEyePosition = vec3.transformMat4(eyePosition, rotation);

  const viewMatrix = mat4.lookAt(rotatedEyePosition, origin, upVector);

  return mat4.multiply(projectionMatrix, viewMatrix);
}

function frame() {
  // Recreate external textures every frame (they expire quickly)
  if (videoElements) {
    const newTextures = createExternalTexturesFromVideos(device, videoElements);
    // Only proceed if we got valid textures (videos are ready)
    if (newTextures.length === 4) {
      gBufferResources = newTextures;
      gBufferTexturesBindGroup = createGBufferBindGroup();
    } else {
      // Videos not ready yet, skip rendering this frame
      requestAnimationFrame(frame);
      return;
    }
  } else {
    // Video elements not loaded yet
    requestAnimationFrame(frame);
    return;
  }

  const cameraViewProj = getCameraViewProjMatrix();
  device.queue.writeBuffer(
    cameraUniformBuffer,
    0,
    cameraViewProj.buffer,
    cameraViewProj.byteOffset,
    cameraViewProj.byteLength
  );
  const cameraInvViewProj = mat4.invert(cameraViewProj);
  device.queue.writeBuffer(
    cameraUniformBuffer,
    64,
    cameraInvViewProj.buffer,
    cameraInvViewProj.byteOffset,
    cameraInvViewProj.byteLength
  );

  // Update directional lights from user settings (if using directional lights)
  if (settings.lightType === 'directional') {
    updateDirectionalLightsFromSettings();
  }

  try {
    const commandEncoder = device.createCommandEncoder();
    
    {
      textureQuadPassDescriptor.colorAttachments[0].view = context
        .getCurrentTexture()
        .createView();
      
      if (settings.mode === 'gBuffers view') {
        // External G-Buffers debug view
        const debugViewPass = commandEncoder.beginRenderPass(
          textureQuadPassDescriptor
        );
        debugViewPass.setPipeline(externalGBuffersDebugViewPipeline);
        debugViewPass.setBindGroup(0, gBufferTexturesBindGroup);
        debugViewPass.draw(6);
        debugViewPass.end();
      } else {
        // External G-Buffers deferred rendering
        const deferredRenderingPass = commandEncoder.beginRenderPass(
          textureQuadPassDescriptor
        );
        
        // Use the appropriate pipeline and bind group based on light type
        if (settings.lightType === 'directional') {
          deferredRenderingPass.setPipeline(externalGBuffersDirectionalRenderPipeline);
          deferredRenderingPass.setBindGroup(0, gBufferTexturesBindGroup);
          deferredRenderingPass.setBindGroup(1, directionalLightsBufferBindGroup);
        } else {
          deferredRenderingPass.setPipeline(externalGBuffersDeferredRenderPipeline);
          deferredRenderingPass.setBindGroup(0, gBufferTexturesBindGroup);
          deferredRenderingPass.setBindGroup(1, lightsBufferBindGroup);
        }
        
        deferredRenderingPass.draw(6);
        deferredRenderingPass.end();
      }
    }
    
    device.queue.submit([commandEncoder.finish()]);
  } catch (error) {
    console.error('Error during rendering:', error);
    // Clear the bind group to force recreation next frame
    gBufferTexturesBindGroup = undefined as any;
  }
  
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
