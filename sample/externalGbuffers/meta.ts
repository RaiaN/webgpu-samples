export default {
    name: 'External G-Buffers',
    description: `This example shows how to do deferred rendering with webgpu.
      Render geometry info to multiple targets in the gBuffers in the first pass.
      In this sample we have EXTERNAL gBuffers for albedo, normals, metallic, specular and a depth texture.
      And then do the lighting in a second pass with per fragment data read from gBuffers so it's independent of scene complexity.
      World-space positions are reconstructed from the depth texture and camera matrix.
      We also update light position in a compute shader, where further operations like tile/cluster culling could happen.
      The debug view shows the depth buffer on the left (flipped and scaled a bit to make it more visible), the normal G buffer
      in the middle, and the albedo G-buffer on the right side of the screen.
      `,
    filename: __DIRNAME__,
    sources: [
      { path: 'main.ts' },
      { path: 'vertexTextureQuad.wgsl' },
      { path: 'fragmentExternalGBuffers.wgsl' },
      { path: 'fragmentExternalGBuffersDebugView.wgsl' },
      { path: 'vertexTextureQuad.wgsl' },
      { path: 'pngLoader.ts' },
      { path: 'videoLoader.ts' },
    ],
  };
  