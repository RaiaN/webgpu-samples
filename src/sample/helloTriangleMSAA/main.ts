import { makeSample, SampleInit } from '../../components/SampleLayout';

import triangleVertWGSL from '../../shaders/triangle.vert.wgsl';
import redFragWGSL from '../../shaders/red.frag.wgsl';

const init: SampleInit = async ({ canvasRef }) => {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  if (canvasRef.current === null) return;
  const context = canvasRef.current.getContext('gpupresent');

  const swapChainFormat = 'bgra8unorm';

  const swapChain = context.configureSwapChain({
    device,
    format: swapChainFormat,
  });

  const sampleCount = 4;

  const pipeline = device.createRenderPipeline({
    vertex: {
      module: device.createShaderModule({
        code: triangleVertWGSL,
      }),
      entryPoint: 'main',
    },
    fragment: {
      module: device.createShaderModule({
        code: redFragWGSL,
      }),
      entryPoint: 'main',
      targets: [
        {
          format: swapChainFormat,
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
    },
    multisample: {
      count: 4,
    },
  });

  const texture = device.createTexture({
    size: {
      width: canvasRef.current.width,
      height: canvasRef.current.height,
    },
    sampleCount,
    format: swapChainFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const view = texture.createView();

  function frame() {
    const commandEncoder = device.createCommandEncoder();

    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view,
          resolveTarget: swapChain.getCurrentTexture().createView(),
          loadValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          storeOp: 'store',
        },
      ],
    };

    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.draw(3, 1, 0, 0);
    passEncoder.endPass();

    device.queue.submit([commandEncoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
};

const HelloTriangleMSAA: () => JSX.Element = () =>
  makeSample({
    name: 'Hello Triangle MSAA',
    description: 'Shows multisampled rendering a basic triangle.',
    init,
    sources: [
      {
        name: __filename.substr(__dirname.length + 1),
        contents: __SOURCE__,
      },
      {
        name: '../../shaders/triangle.vert.wgsl',
        contents: triangleVertWGSL,
        editable: true,
      },
      {
        name: '../../shaders/red.frag.wgsl',
        contents: redFragWGSL,
        editable: true,
      },
    ],
    filename: __filename,
  });

export default HelloTriangleMSAA;
