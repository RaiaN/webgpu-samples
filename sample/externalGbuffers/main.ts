import { mat4, vec3, vec4 } from 'wgpu-matrix';
import { GUI } from 'dat.gui';
import { quitIfWebGPUNotAvailable, quitIfLimitLessThan } from '../util';

// Import external G-Buffer shaders
import vertexTextureQuad from './vertexTextureQuad.wgsl';
import fragmentExternalGBuffers from './fragmentExternalGBuffers.wgsl';
import fragmentExternalGBuffersDirectional from './fragmentExternalGBuffersDirectional.wgsl';
import fragmentExternalGBuffersDebugView from './fragmentExternalGBuffersDebugView.wgsl';
import lightGizmoShader from './lightGizmo.wgsl';
import lightGizmo2DShader from './lightGizmo2D.wgsl';

// Import Image sequence loader utilities
import { loadGBufferImages, ImageGBufferTextures, ImageGBufferConfig, ImageSequenceController } from './imageLoader';
import { FrameExporter } from './frameExporter';

// Point lights configuration
const kMaxNumLights = 1; // Single point light for precise control
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

// Load external G-Buffer textures (Image sequence)
let gBufferTextures: ImageGBufferTextures;
let imageSequenceController: ImageSequenceController;

async function loadGbufferAssets() {
  // Image sequence G-Buffer configuration
  const imageConfig: ImageGBufferConfig = {
    basecolor: true,
    depth: true,
    metallic: true,
    normal: true,
    roughness: true
  };

  try {
    const result = await loadGBufferImages(device, imageConfig, '../../assets/gbuffers/4/');
    gBufferTextures = result.textures;
    imageSequenceController = result.controller;
    console.log('Successfully loaded G-Buffer image sequence');
    console.log(`Total frames: ${imageSequenceController.getTotalFrames()}`);
    console.log('Use GUI controls to adjust playback');
  } catch (error) {
    console.error('Failed to load G-Buffer image sequence:', error);
    console.log('Please ensure image sequence files exist in ./assets/gbuffers/4/:');
    console.log('- 0000.0xxx.basecolor.jpg');
    console.log('- 0000.0xxx.normal.jpg');
    console.log('- 0000.0xxx.depth.jpg');
    console.log('- 0000.0xxx.metallic.jpg');
    console.log('- 0000.0xxx.roughness.jpg');
    throw error;
  }
}

await loadGbufferAssets();

// Initialize frame exporter
const frameExporter = new FrameExporter(canvas, device);

// Create samplers
const gBufferSampler = device.createSampler({
  label: 'gBuffer sampler',
  magFilter: 'linear',
  minFilter: 'linear',
});

// Bind group layout for G-Buffer textures (regular textures)
const gBufferTexturesBindGroupLayout = device.createBindGroupLayout({
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: 'float' },
    },
    {
      binding: 1,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: 'float' },
    },
    {
      binding: 2,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: 'float' },
    },
    {
      binding: 3,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: 'float' },
    },
    {
      binding: 4,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: 'float' },
    },
    {
      binding: 5,
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

// Light Gizmo Pipeline
const lightGizmoShaderModule = device.createShaderModule({
  code: lightGizmoShader,
});

const lightGizmoUniformBuffer = device.createBuffer({
  label: 'light gizmo uniforms',
  size: Float32Array.BYTES_PER_ELEMENT * 8, // vec3 pos + f32 radius + vec3 color + f32 padding
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const lightGizmoBindGroupLayout = device.createBindGroupLayout({
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: {
        type: 'uniform',
      },
    },
    {
      binding: 1,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: {
        type: 'uniform',
      },
    },
  ],
});

const lightGizmoPipeline = device.createRenderPipeline({
  label: 'light gizmo',
  layout: device.createPipelineLayout({
    bindGroupLayouts: [lightGizmoBindGroupLayout],
  }),
  vertex: {
    module: lightGizmoShaderModule,
    entryPoint: 'vertexMain',
  },
  fragment: {
    module: lightGizmoShaderModule,
    entryPoint: 'fragmentMain',
    targets: [
      {
        format: presentationFormat,
        blend: {
          color: {
            srcFactor: 'src-alpha',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
          },
          alpha: {
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
          },
        },
      },
    ],
  },
  primitive: {
    topology: 'triangle-list',
    cullMode: 'none',
  },
});

// Light Gizmo 2D Cross + Depth Ring Pipeline
const lightGizmo2DShaderModule = device.createShaderModule({
  code: lightGizmo2DShader,
});

const lightGizmo2DUniformBuffer = device.createBuffer({
  label: 'light gizmo 2d uniforms',
  size: Float32Array.BYTES_PER_ELEMENT * 4, // vec3 position + padding
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const lightGizmo2DBindGroupLayout = device.createBindGroupLayout({
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: {
        type: 'uniform',
      },
    },
    {
      binding: 1,
      visibility: GPUShaderStage.VERTEX,
      buffer: {
        type: 'uniform',
      },
    },
  ],
});

const lightGizmo2DPipeline = device.createRenderPipeline({
  label: 'light gizmo 2d',
  layout: device.createPipelineLayout({
    bindGroupLayouts: [lightGizmo2DBindGroupLayout],
  }),
  vertex: {
    module: lightGizmo2DShaderModule,
    entryPoint: 'vertexMain',
  },
  fragment: {
    module: lightGizmo2DShaderModule,
    entryPoint: 'fragmentMain',
    targets: [
      {
        format: presentationFormat,
      },
    ],
  },
  primitive: {
    topology: 'triangle-list',
    cullMode: 'none',
  },
  depthStencil: undefined,
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
  numLights: 1, // Single point light
  playbackRate: 1.0,
  debugLights: false, // Toggle to visualize where lights are active
  currentFrame: 0,
  // Frame export settings
  exportFrames: false,
  exportFPS: 30,
  exportPrefix: 'frame',
  exportTotalFrames: 0, // Will be calculated from image sequence
  // Directional light 0 controls (main sun)
  light0Azimuth: 135, // Horizontal angle in degrees (0 = +X, 90 = +Z, 180 = -X, 270 = -Z)
  light0Elevation: 45, // Vertical angle in degrees (-90 = down, 0 = horizon, 90 = up)
  light0Intensity: 3.0,
  light0ColorR: 1.0,
  light0ColorG: 0.95,
  light0ColorB: 0.9,
  // Point light controls
  // X = horizontal (left/right) - cyan cross arms
  // Y = depth (forward/back) - manual control only
  // Z = vertical (up/down) - yellow cross arms
  pointLightX: 0,
  pointLightY: -30,  // Closer to camera (negative depth)
  pointLightZ: 30,   // Up
  pointLightIntensity: 5.0,
  pointLightRadius: 200.0,
  pointLightColorR: 1.0,
  pointLightColorG: 1.0,
  pointLightColorB: 1.0,
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

// Point Light Controls
const pointLightFolder = gui.addFolder('Point Light');
// Add helpful text
const gizmoHelp = document.createElement('div');
gizmoHelp.style.cssText = 'padding: 5px; font-size: 10px; color: #888; line-height: 1.3;';
gizmoHelp.innerHTML = 'Drag the gizmo:<br>• Cyan cross = Horizontal (X)<br>• Yellow cross = Vertical (Z)<br>• Center = Free 3D movement';
pointLightFolder.domElement.appendChild(gizmoHelp);

pointLightFolder.add(settings, 'pointLightX', -100, 100).name('X - Horizontal (Cyan ←→)').listen();
pointLightFolder.add(settings, 'pointLightY', -100, 100).name('Y - Depth (Manual)').listen();
pointLightFolder.add(settings, 'pointLightZ', -100, 100).name('Z - Vertical (Yellow ↑↓)').listen();
pointLightFolder.add(settings, 'pointLightIntensity', 0, 20).name('Intensity').listen();
pointLightFolder.add(settings, 'pointLightRadius', 10, 500).name('Radius').listen();
pointLightFolder.addColor(
  {
    color: [
      settings.pointLightColorR * 255,
      settings.pointLightColorG * 255,
      settings.pointLightColorB * 255
    ]
  },
  'color'
).name('Color').onChange((value: number[]) => {
  settings.pointLightColorR = value[0] / 255;
  settings.pointLightColorG = value[1] / 255;
  settings.pointLightColorB = value[2] / 255;
});

// Quick presets for point lights
pointLightFolder.add({
  preset: () => {
    settings.pointLightX = 0;      // Center
    settings.pointLightY = -30;    // Depth (closer to camera)
    settings.pointLightZ = 30;     // Up
    settings.pointLightIntensity = 5.0;
    settings.pointLightRadius = 200.0;
    settings.pointLightColorR = 1.0;
    settings.pointLightColorG = 1.0;
    settings.pointLightColorB = 1.0;
  }
}, 'preset').name('💡 Center Front');

pointLightFolder.add({
  preset: () => {
    settings.pointLightX = 40;     // Right side
    settings.pointLightY = 0;      // Mid depth
    settings.pointLightZ = 20;     // Mid height
    settings.pointLightIntensity = 8.0;
    settings.pointLightRadius = 150.0;
    settings.pointLightColorR = 1.0;
    settings.pointLightColorG = 0.7;
    settings.pointLightColorB = 0.4;
  }
}, 'preset').name('🔥 Warm Side');

pointLightFolder.add({
  preset: () => {
    settings.pointLightX = 0;      // Center
    settings.pointLightY = 0;      // Mid depth
    settings.pointLightZ = 50;     // High up
    settings.pointLightIntensity = 10.0;
    settings.pointLightRadius = 300.0;
    settings.pointLightColorR = 1.0;
    settings.pointLightColorG = 1.0;
    settings.pointLightColorB = 1.0;
  }
}, 'preset').name('💡 Top Light');

// Light type selector
gui.add(settings, 'lightType', ['point', 'directional']).name('Light Type').onChange((value: string) => {
  // Show/hide controls based on light type using DOM
  const pointLightFolderElement = pointLightFolder.domElement.parentElement;
  const dirLightFolderElement = dirLightFolder.domElement.parentElement;
  
  if (value === 'directional') {
    // Hide point light controls, show directional light controls
    if (pointLightFolderElement) pointLightFolderElement.style.display = 'none';
    if (dirLightFolderElement) dirLightFolderElement.style.display = '';
  } else {
    // Show point light controls, hide directional light controls
    if (pointLightFolderElement) pointLightFolderElement.style.display = '';
    if (dirLightFolderElement) dirLightFolderElement.style.display = 'none';
  }
});

// Initially show/hide controls based on light type
if (settings.lightType === 'directional') {
  const pointLightFolderElement = pointLightFolder.domElement.parentElement;
  if (pointLightFolderElement) {
    pointLightFolderElement.style.display = 'none';
  }
} else {
  const dirLightFolderElement = dirLightFolder.domElement.parentElement;
  if (dirLightFolderElement) {
    dirLightFolderElement.style.display = 'none';
  }
}

// Image sequence controls
const sequenceFolder = gui.addFolder('Sequence Controls');
sequenceFolder.add(settings, 'playbackRate', 0.1, 3.0).name('Playback Rate').onChange(() => {
  if (imageSequenceController) {
    imageSequenceController.setPlaybackRate(settings.playbackRate);
  }
});

sequenceFolder.add(settings, 'currentFrame', 0, imageSequenceController.getTotalFrames() - 1, 1).name('Frame').listen().onChange((value: number) => {
  if (imageSequenceController) {
    imageSequenceController.seekToFrame(Math.floor(value));
  }
});

sequenceFolder.add({
  button: () => imageSequenceController?.pause(),
}, 'button').name('Pause');

sequenceFolder.add({
  button: () => imageSequenceController?.play(),
}, 'button').name('Play');

sequenceFolder.add({
  button: () => {
    imageSequenceController?.seekToFrame(0);
    settings.currentFrame = 0;
  },
}, 'button').name('Reset to Frame 0');

// Calculate total frames from image sequence
settings.exportTotalFrames = imageSequenceController.getTotalFrames();

// Frame Export Controls
const exportFolder = gui.addFolder('Frame Export (PNG)');
exportFolder.add(settings, 'exportFPS', 1, 60, 1).name('Target FPS');
exportFolder.add(settings, 'exportTotalFrames').name('Total Frames').listen();
exportFolder.add(settings, 'exportPrefix').name('Filename Prefix');

let exportProgressText: HTMLElement | null = null;

exportFolder.add({
  startExport: async () => {
    if (frameExporter.isActive()) {
      console.warn('Export already in progress');
      return;
    }

    if (!imageSequenceController) {
      alert('Image sequence not loaded yet!');
      return;
    }

    // Pause and seek to start
    imageSequenceController.pause();
    await imageSequenceController.seekToFrame(0);
    settings.currentFrame = 0;
    
    // Wait for images to be ready
    await new Promise(resolve => setTimeout(resolve, 200));

    // Use the total frames from the image sequence
    const totalFrames = imageSequenceController.getTotalFrames();
    settings.exportTotalFrames = totalFrames;

    console.log(`Starting export of ${totalFrames} frames`);
    console.log(`Sequence duration: ${imageSequenceController.getDuration().toFixed(2)}s`);

    // Create progress indicator
    if (!exportProgressText) {
      exportProgressText = document.createElement('div');
      exportProgressText.style.cssText = 'padding: 5px; font-size: 11px; color: #4CAF50; font-weight: bold;';
      exportFolder.domElement.appendChild(exportProgressText);
    }
    exportProgressText.textContent = 'Starting export...';

    // Start export
    await frameExporter.startExport({
      totalFrames: totalFrames,
      outputPrefix: settings.exportPrefix,
      onProgress: (current, total) => {
        if (exportProgressText) {
          const percent = ((current / total) * 100).toFixed(1);
          exportProgressText.textContent = `Exporting: ${current}/${total} (${percent}%)`;
        }
      },
      onComplete: () => {
        if (exportProgressText) {
          exportProgressText.textContent = `Export complete! ${totalFrames} frames saved`;
          exportProgressText.style.color = '#4CAF50';
        }
        console.log('Export finished! All frames have been downloaded.');
        // Resume normal playback
        imageSequenceController.seekToFrame(0);
        settings.currentFrame = 0;
        imageSequenceController.play();
      }
    });
  }
}, 'startExport').name('▶ Start Export');

exportFolder.add({
  stopExport: () => {
    frameExporter.stopExport();
    if (exportProgressText) {
      exportProgressText.textContent = 'Export stopped';
      exportProgressText.style.color = '#FF5722';
    }
    // Resume normal playback
    if (imageSequenceController) {
      imageSequenceController.play();
    }
  }
}, 'stopExport').name('⏹ Stop Export');

// Add divider
const divider = document.createElement('div');
divider.style.cssText = 'height: 1px; background: #333; margin: 8px 0;';
exportFolder.domElement.appendChild(divider);

// Quick export button (reset + start)
exportFolder.add({
  quickExport: async () => {
    if (frameExporter.isActive()) {
      console.warn('Export already in progress');
      return;
    }

    if (!imageSequenceController) {
      alert('Image sequence not loaded yet!');
      return;
    }

    // Pause and reset
    imageSequenceController.pause();
    await imageSequenceController.seekToFrame(0);
    settings.currentFrame = 0;
    
    // Wait for images to be ready at frame 0
    await new Promise(resolve => setTimeout(resolve, 200));

    // Get total frames
    const totalFrames = imageSequenceController.getTotalFrames();
    settings.exportTotalFrames = totalFrames;

    console.log(`Quick Export: ${totalFrames} frames`);
    console.log(`Sequence duration: ${imageSequenceController.getDuration().toFixed(2)}s`);

    // Create progress indicator if needed
    if (!exportProgressText) {
      exportProgressText = document.createElement('div');
      exportProgressText.style.cssText = 'padding: 5px; font-size: 11px; color: #4CAF50; font-weight: bold;';
      exportFolder.domElement.appendChild(exportProgressText);
    }
    exportProgressText.textContent = 'Quick export starting...';
    exportProgressText.style.color = '#4CAF50';

    // Start export immediately
    await frameExporter.startExport({
      totalFrames: totalFrames,
      outputPrefix: settings.exportPrefix,
      onProgress: (current, total) => {
        if (exportProgressText) {
          const percent = ((current / total) * 100).toFixed(1);
          exportProgressText.textContent = `Exporting: ${current}/${total} (${percent}%)`;
        }
      },
      onComplete: () => {
        if (exportProgressText) {
          exportProgressText.textContent = `Export complete! ${totalFrames} frames saved`;
          exportProgressText.style.color = '#4CAF50';
        }
        console.log('Quick export finished! All frames have been downloaded.');
        // Resume normal playback
        imageSequenceController.seekToFrame(0);
        settings.currentFrame = 0;
        imageSequenceController.play();
      }
    });
  }
}, 'quickExport').name('🚀 Reset & Export All');

const exportHelp = document.createElement('div');
exportHelp.style.cssText = 'padding: 8px; font-size: 10px; color: #888; line-height: 1.4; border-top: 1px solid #333; margin-top: 5px;';
exportHelp.innerHTML = '<b>Quick Export:</b><br>• Click "🚀 Reset & Export All" for one-click export<br><br><b>Manual Export:</b><br>1. Set desired FPS<br>2. Position video where you want<br>3. Click "▶ Start Export"<br>4. Frames auto-download';
exportFolder.domElement.appendChild(exportHelp);

const cameraUniformBuffer = device.createBuffer({
  label: 'camera matrix uniform',
  size: 4 * 16 * 2, // two 4x4 matrix
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// Light Gizmo Bind Group (created after cameraUniformBuffer)
const lightGizmoBindGroup = device.createBindGroup({
  layout: lightGizmoBindGroupLayout,
  entries: [
    {
      binding: 0,
      resource: {
        buffer: cameraUniformBuffer,
      },
    },
    {
      binding: 1,
      resource: {
        buffer: lightGizmoUniformBuffer,
      },
    },
  ],
});

// Light Gizmo 2D Bind Group (created after cameraUniformBuffer)
const lightGizmo2DBindGroup = device.createBindGroup({
  layout: lightGizmo2DBindGroupLayout,
  entries: [
    {
      binding: 0,
      resource: {
        buffer: cameraUniformBuffer,
      },
    },
    {
      binding: 1,
      resource: {
        buffer: lightGizmo2DUniformBuffer,
      },
    },
  ],
});

// G-Buffer textures bind group - created once with regular textures
function createGBufferBindGroup() {
  if (!gBufferTextures) {
    throw new Error('G-Buffer textures not loaded');
  }
  
  return device.createBindGroup({
    layout: gBufferTexturesBindGroupLayout,
    entries: [
      {
        binding: 0,
        resource: gBufferTextures.basecolor.createView(),
      },
      {
        binding: 1,
        resource: gBufferTextures.normal.createView(),
      },
      {
        binding: 2,
        resource: gBufferTextures.depth.createView(),
      },
      {
        binding: 3,
        resource: gBufferTextures.metallic.createView(),
      },
      {
        binding: 4,
        resource: gBufferTextures.roughness.createView(),
      },
      {
        binding: 5,
        resource: gBufferSampler,
      },
    ],
  });
}

let gBufferTexturesBindGroup: GPUBindGroup = createGBufferBindGroup();

// Lights data are uploaded in a storage buffer
const extent = vec3.sub(lightExtentMax, lightExtentMin);
const lightDataStride = 8;
const bufferSizeInByte =
  Float32Array.BYTES_PER_ELEMENT * lightDataStride * kMaxNumLights;
const lightsBuffer = device.createBuffer({
  label: 'lights storage',
  size: bufferSizeInByte,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, // Allow updates via writeBuffer
  mappedAtCreation: true,
});

// Initialize single point light from settings
const lightData = new Float32Array(lightsBuffer.getMappedRange());
const tmpVec4 = vec4.create();

// Position (map user coordinates to world coordinates)
// User: X=left/right, Y=depth, Z=up/down
// World: X=left/right, Y=up/down, Z=depth
tmpVec4[0] = settings.pointLightX;  // X stays as X
tmpVec4[1] = settings.pointLightZ;  // User Z -> World Y
tmpVec4[2] = settings.pointLightY;  // User Y -> World Z
tmpVec4[3] = 1;
lightData.set(tmpVec4, 0);

// Color and radius
tmpVec4[0] = settings.pointLightColorR * settings.pointLightIntensity;
tmpVec4[1] = settings.pointLightColorG * settings.pointLightIntensity;
tmpVec4[2] = settings.pointLightColorB * settings.pointLightIntensity;
tmpVec4[3] = settings.pointLightRadius;
lightData.set(tmpVec4, 4);
lightsBuffer.unmap();

console.log(`Initialized single point light at X:${settings.pointLightX}, Y(depth):${settings.pointLightY}, Z(up/down):${settings.pointLightZ}`);

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

// Function to update point light from settings
function updatePointLightFromSettings() {
  const tempData = new Float32Array(lightDataStride);
  
  // Position (map user coordinates to world coordinates)
  // User: X=left/right, Y=depth, Z=up/down
  // World: X=left/right, Y=up/down, Z=depth
  tempData[0] = settings.pointLightX;  // X stays as X
  tempData[1] = settings.pointLightZ;  // User Z -> World Y
  tempData[2] = settings.pointLightY;  // User Y -> World Z
  tempData[3] = 1;
  
  // Color and radius
  tempData[4] = settings.pointLightColorR * settings.pointLightIntensity;
  tempData[5] = settings.pointLightColorG * settings.pointLightIntensity;
  tempData[6] = settings.pointLightColorB * settings.pointLightIntensity;
  tempData[7] = settings.pointLightRadius;
  
  device.queue.writeBuffer(lightsBuffer, 0, tempData);
}

// Function to update light gizmo uniforms
function updateLightGizmoUniforms() {
  const gizmoData = new Float32Array(8);
  
  // Position (map user coordinates to world coordinates)
  // User: X=left/right, Y=depth, Z=up/down
  // World: X=left/right, Y=up/down, Z=depth
  gizmoData[0] = settings.pointLightX;  // X stays as X
  gizmoData[1] = settings.pointLightZ;  // User Z -> World Y
  gizmoData[2] = settings.pointLightY;  // User Y -> World Z
  gizmoData[3] = settings.pointLightRadius; // radius
  
  // Color (normalized)
  gizmoData[4] = settings.pointLightColorR;
  gizmoData[5] = settings.pointLightColorG;
  gizmoData[6] = settings.pointLightColorB;
  gizmoData[7] = 0.0; // padding
  
  device.queue.writeBuffer(lightGizmoUniformBuffer, 0, gizmoData);
}

// Function to update light gizmo 2D uniforms
function updateLightGizmo2DUniforms() {
  const gizmo2DData = new Float32Array(4);
  
  // Position (map user coordinates to world coordinates)
  gizmo2DData[0] = settings.pointLightX;  // X stays as X
  gizmo2DData[1] = settings.pointLightZ;  // User Z -> World Y
  gizmo2DData[2] = settings.pointLightY;  // User Y -> World Z
  gizmo2DData[3] = 0.0; // padding
  
  device.queue.writeBuffer(lightGizmo2DUniformBuffer, 0, gizmo2DData);
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

// Camera stays fixed for easy light manipulation
function getCameraViewProjMatrix() {
  const viewMatrix = mat4.lookAt(eyePosition, origin, upVector);
  return mat4.multiply(projectionMatrix, viewMatrix);
}

async function frame() {
  // Update image sequence if playing
  if (imageSequenceController && imageSequenceController.isPlayingNow()) {
    const currentTime = performance.now();
    const updated = await imageSequenceController.update(currentTime);
    if (updated) {
      settings.currentFrame = imageSequenceController.getCurrentFrame();
    }
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

  // Update lights from user settings
  if (settings.lightType === 'directional') {
    updateDirectionalLightsFromSettings();
  } else {
    updatePointLightFromSettings();
    updateLightGizmoUniforms();
    updateLightGizmo2DUniforms();
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
        
        // Render light gizmo for point lights
        if (settings.lightType === 'point') {
          const gizmoPass = commandEncoder.beginRenderPass({
            colorAttachments: [
              {
                view: context.getCurrentTexture().createView(),
                loadOp: 'load', // Don't clear, draw on top
                storeOp: 'store',
              },
            ],
          });
          
          // Draw center sphere gizmo
          gizmoPass.setPipeline(lightGizmoPipeline);
          gizmoPass.setBindGroup(0, lightGizmoBindGroup);
          gizmoPass.draw(6);
          
          // Draw 2D cross controls
          gizmoPass.setPipeline(lightGizmo2DPipeline);
          gizmoPass.setBindGroup(0, lightGizmo2DBindGroup);
          gizmoPass.draw(24); // Cross only (4 arms * 6 vertices)
          
          gizmoPass.end();
        }
      }
    }
    
    device.queue.submit([commandEncoder.finish()]);
  } catch (error) {
    console.error('Error during rendering:', error);
    // Clear the bind group to force recreation next frame
    gBufferTexturesBindGroup = undefined as any;
  }
  
  // Handle frame export
  if (frameExporter.isActive()) {
    // Capture the current frame
    const captured = await frameExporter.captureFrame();
    
    if (captured) {
      // Advance to next frame
      const nextFrame = frameExporter.getCurrentFrame();
      
      // Seek to next frame in image sequence
      if (imageSequenceController && nextFrame < imageSequenceController.getTotalFrames()) {
        await imageSequenceController.seekToFrame(nextFrame);
        settings.currentFrame = nextFrame;
        // Wait for image to be ready
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Continue to next frame immediately
      requestAnimationFrame(frame);
    } else {
      // Export finished or stopped
      requestAnimationFrame(frame);
    }
  } else {
    // Normal playback
    requestAnimationFrame(frame);
  }
}

// Mouse interaction for light manipulation
let isDraggingLight = false;
let dragPlaneDistance = 0;
let dragStartCameraPos = vec3.create();
let dragStartCameraViewProj = mat4.create();
let dragStartCameraInvViewProj = mat4.create();
let dragAxis: 'none' | 'horizontal' | 'vertical' = 'none'; // Which control is being dragged
// 'horizontal' = X axis (left/right), 'vertical' = Z axis (up/down)
let dragStartLightPos = vec3.create();
let dragStartMouseX = 0;
let dragStartMouseY = 0;

// Helper function to check if mouse is near the gizmo controls
function getGizmoHitType(mouseX: number, mouseY: number, lightPosWorld: Float32Array, cameraViewProj: Float32Array): 'none' | 'horizontal' | 'vertical' | 'center' {
  // Project light position to screen
  const lightClipPos = vec4.transformMat4(vec4.fromValues(lightPosWorld[0], lightPosWorld[1], lightPosWorld[2], 1), cameraViewProj);
  const lightScreenX = (lightClipPos[0] / lightClipPos[3] + 1) * 0.5;
  const lightScreenY = (1 - lightClipPos[1] / lightClipPos[3]) * 0.5;
  
  const dx = mouseX - lightScreenX;
  const dy = mouseY - lightScreenY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  // Check vertical cross arms (yellow - up/down for Z)
  if (Math.abs(dx) < 0.015 && Math.abs(dy) < 0.15) {
    return 'vertical';
  }
  
  // Check horizontal cross arms (cyan - left/right for X)
  if (Math.abs(dy) < 0.015 && Math.abs(dx) < 0.15) {
    return 'horizontal';
  }
  
  // Check center sphere
  if (dist < 0.05) {
    return 'center';
  }
  
  return 'none';
}

canvas.addEventListener('mousedown', (event) => {
  if (settings.lightType !== 'point') return;
  
  // Check if clicking near the light gizmo
  const rect = canvas.getBoundingClientRect();
  const mouseX = (event.clientX - rect.left) / rect.width;
  const mouseY = (event.clientY - rect.top) / rect.height;
  const mouseScreen = vec3.fromValues(mouseX, mouseY, 0);
  
  // Get light position in world space
  const lightPosWorld = vec3.fromValues(settings.pointLightX, settings.pointLightZ, settings.pointLightY);
  const cameraViewProj = getCameraViewProjMatrix();
  
  // Check what part of the gizmo was clicked
  const hitType = getGizmoHitType(mouseX, mouseY, lightPosWorld, cameraViewProj);
  
  if (hitType !== 'none') {
    isDraggingLight = true;
    dragAxis = hitType === 'center' ? 'none' : hitType;
    // Store the current distance from origin for plane projection
    dragPlaneDistance = vec3.length(lightPosWorld);
    dragStartLightPos = vec3.copy(lightPosWorld);
    dragStartMouseX = mouseX;
    dragStartMouseY = mouseY;
    
    // Capture camera state at drag start (camera is static for point lights)
    dragStartCameraPos = vec3.copy(eyePosition);
    dragStartCameraViewProj = mat4.copy(cameraViewProj);
    dragStartCameraInvViewProj = mat4.invert(dragStartCameraViewProj);
    
    canvas.style.cursor = 'grab';
  }
});

canvas.addEventListener('mousemove', (event) => {
  if (!isDraggingLight) {
    // Update cursor when hovering over the light
    if (settings.lightType === 'point') {
      const rect = canvas.getBoundingClientRect();
      const mouseX = (event.clientX - rect.left) / rect.width;
      const mouseY = (event.clientY - rect.top) / rect.height;
      
      const lightPos = vec3.fromValues(settings.pointLightX, settings.pointLightZ, settings.pointLightY);
      const cameraViewProj = getCameraViewProjMatrix();
      
      const hitType = getGizmoHitType(mouseX, mouseY, lightPos, cameraViewProj);
      canvas.style.cursor = hitType !== 'none' ? 'pointer' : 'default';
    }
    return;
  }
  
  canvas.style.cursor = 'grabbing';
  
  // Convert mouse position to normalized coordinates
  const rect = canvas.getBoundingClientRect();
  const mouseX = (event.clientX - rect.left) / rect.width;
  const mouseY = (event.clientY - rect.top) / rect.height;
  
  // Calculate mouse delta from drag start
  const deltaX = (mouseX - dragStartMouseX) * 200; // Scale factor for movement speed
  const deltaY = (mouseY - dragStartMouseY) * 200;
  
  let newLightPosWorld: Float32Array;
  
  if (dragAxis === 'none') {
    // Free movement - use mouse delta to move in screen space
    const mouseNDC = vec3.fromValues(mouseX * 2 - 1, (1 - mouseY) * 2 - 1, 0);
    const nearPoint = vec4.fromValues(mouseNDC[0], mouseNDC[1], -1, 1);
    const farPoint = vec4.fromValues(mouseNDC[0], mouseNDC[1], 1, 1);
    
    const nearWorld = vec4.transformMat4(nearPoint, dragStartCameraInvViewProj);
    const farWorld = vec4.transformMat4(farPoint, dragStartCameraInvViewProj);
    
    const nearPos = vec3.fromValues(
      nearWorld[0] / nearWorld[3],
      nearWorld[1] / nearWorld[3],
      nearWorld[2] / nearWorld[3]
    );
    
    const farPos = vec3.fromValues(
      farWorld[0] / farWorld[3],
      farWorld[1] / farWorld[3],
      farWorld[2] / farWorld[3]
    );
    
    const rayDir = vec3.normalize(vec3.sub(farPos, nearPos));
    const t = dragPlaneDistance;
    newLightPosWorld = vec3.add(dragStartCameraPos, vec3.mulScalar(rayDir, t));
  } else {
    // Constrained movement using screen space deltas
    newLightPosWorld = vec3.copy(dragStartLightPos);
    
    if (dragAxis === 'horizontal') {
      // Horizontal cross arm (X axis): use horizontal mouse movement (INVERTED)
      newLightPosWorld[0] = dragStartLightPos[0] - deltaX; // World X (left/right) - inverted
    } else if (dragAxis === 'vertical') {
      // Vertical cross arm (Z axis): use vertical mouse movement
      newLightPosWorld[1] = dragStartLightPos[1] - deltaY; // World Y (up/down)
    }
  }
  
  // Update settings with correct coordinate mapping
  // World space: X=left/right, Y=up/down, Z=depth
  // User space: X=left/right, Z=up/down, Y=depth
  settings.pointLightX = newLightPosWorld[0];  // X stays as X (left/right)
  settings.pointLightZ = newLightPosWorld[1];  // World Y -> User Z (up/down)
  settings.pointLightY = newLightPosWorld[2];  // World Z -> User Y (depth)
});

canvas.addEventListener('mouseup', () => {
  if (isDraggingLight) {
    isDraggingLight = false;
    dragAxis = 'none';
    canvas.style.cursor = 'pointer';
  }
});

canvas.addEventListener('mouseleave', () => {
  if (isDraggingLight) {
    isDraggingLight = false;
    dragAxis = 'none';
    canvas.style.cursor = 'default';
  }
});

requestAnimationFrame(frame);
