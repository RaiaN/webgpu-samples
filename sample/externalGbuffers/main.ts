import { mat4, vec3, vec4 } from 'wgpu-matrix';
import { GUI } from 'dat.gui';
import { quitIfWebGPUNotAvailable, quitIfLimitLessThan } from '../util';

// Import external G-Buffer shaders
import vertexTextureQuad from './vertexTextureQuad.wgsl';
import fragmentExternalGBuffers from './fragmentExternalGBuffers.wgsl';
import fragmentExternalGBuffersDebugView from './fragmentExternalGBuffersDebugView.wgsl';

// Import PNG loader utilities
import { loadGBufferTextures, GBufferTextures } from './pngLoader';

const kMaxNumLights = 1024;
const lightExtentMin = vec3.fromValues(-50, -30, -50);
const lightExtentMax = vec3.fromValues(50, 50, 50);

const canvas = document.querySelector('canvas') as HTMLCanvasElement;
const adapter = await navigator.gpu?.requestAdapter({
  featureLevel: 'compatibility',
});
const limits: Record<string, GPUSize32> = {};
quitIfLimitLessThan(adapter, 'maxStorageBuffersInFragmentStage', 1, limits);
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

// Load external G-Buffer textures
let gBufferTextures: GBufferTextures;
try {
  gBufferTextures = await loadGBufferTextures(device, '../../assets/gbuffers/');
  console.log('Successfully loaded external G-Buffer textures');
} catch (error) {
  console.error('Failed to load G-Buffer textures:', error);
  console.log('Please ensure the following PNG files exist in ./assets/gbuffers/:');
  console.log('- albedo.png');
  console.log('- normal.png');
  console.log('- depth.png');
  console.log('- specular.png');
  console.log('- metallic.png');
  throw error;
}

// Create texture views for the G-Buffers
const gBufferTextureViews = [
  gBufferTextures.albedo.createView({ label: 'gbuffer texture albedo' }),
  gBufferTextures.normal.createView({ label: 'gbuffer texture normal' }),
  gBufferTextures.depth.createView({ label: 'gbuffer texture depth' }),
  gBufferTextures.specular.createView({ label: 'gbuffer texture specular' }),
  gBufferTextures.metallic.createView({ label: 'gbuffer texture metallic' }),
];

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
      texture: {
        sampleType: 'float',
      },
    },
    {
      binding: 1,
      visibility: GPUShaderStage.FRAGMENT,
      texture: {
        sampleType: 'float',
      },
    },
    {
      binding: 2,
      visibility: GPUShaderStage.FRAGMENT,
      texture: {
        sampleType: 'float',
      },
    },
    {
      binding: 3,
      visibility: GPUShaderStage.FRAGMENT,
      texture: {
        sampleType: 'float',
      },
    },
    {
      binding: 4,
      visibility: GPUShaderStage.FRAGMENT,
      texture: {
        sampleType: 'float',
      },
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

// External G-Buffers Deferred Rendering Pipeline
const externalGBuffersDeferredRenderPipeline = device.createRenderPipeline({
  label: 'external gbuffers deferred rendering',
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
  numLights: 128,
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
gui
  .add(settings, 'numLights', 1, kMaxNumLights)
  .step(1)
  .onChange(() => {
    device.queue.writeBuffer(
      configUniformBuffer,
      0,
      new Uint32Array([settings.numLights])
    );
  });

const cameraUniformBuffer = device.createBuffer({
  label: 'camera matrix uniform',
  size: 4 * 16 * 2, // two 4x4 matrix
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// G-Buffer textures bind group
const gBufferTexturesBindGroup = device.createBindGroup({
  layout: gBufferTexturesBindGroupLayout,
  entries: [
    {
      binding: 0,
      resource: gBufferTextureViews[0], // albedo
    },
    {
      binding: 1,
      resource: gBufferTextureViews[1], // normal
    },
    {
      binding: 2,
      resource: gBufferTextureViews[2], // depth
    },
    {
      binding: 3,
      resource: gBufferTextureViews[3], // specular
    },
    {
      binding: 4,
      resource: gBufferTextureViews[4], // metallic
    },
    {
      binding: 5,
      resource: gBufferSampler,
    },
  ],
});

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
  // color
  tmpVec4[0] = Math.random() * 2;
  tmpVec4[1] = Math.random() * 2;
  tmpVec4[2] = Math.random() * 2;
  // radius
  tmpVec4[3] = 20.0;
  lightData.set(tmpVec4, offset + 4);
}
lightsBuffer.unmap();

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
      deferredRenderingPass.setPipeline(externalGBuffersDeferredRenderPipeline);
      deferredRenderingPass.setBindGroup(0, gBufferTexturesBindGroup);
      deferredRenderingPass.setBindGroup(1, lightsBufferBindGroup);
      deferredRenderingPass.draw(6);
      deferredRenderingPass.end();
    }
  }
  
  device.queue.submit([commandEncoder.finish()]);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
