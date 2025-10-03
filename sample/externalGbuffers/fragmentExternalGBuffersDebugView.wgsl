@group(0) @binding(0) var gBufferAlbedo: texture_2d<f32>;
@group(0) @binding(1) var gBufferNormal: texture_2d<f32>;
@group(0) @binding(2) var gBufferDepth: texture_2d<f32>;
@group(0) @binding(3) var gBufferSpecular: texture_2d<f32>;
@group(0) @binding(4) var gBufferMetallic: texture_2d<f32>;
@group(0) @binding(5) var gBufferSampler: sampler;

override canvasSizeWidth: f32;
override canvasSizeHeight: f32;

@fragment
fn main(
  @builtin(position) coord: vec4f
) -> @location(0) vec4f {
  var result: vec4f;
  let bufferSize = textureDimensions(gBufferAlbedo);
  let coordUV = coord.xy / vec2f(bufferSize);
  
  // Divide screen into 5 horizontal sections to view each G-Buffer
  let sectionWidth = canvasSizeWidth / 5.0;
  let sectionIndex = floor(coord.x / sectionWidth);
  
  if (sectionIndex == 0u) {
    // Albedo
    result = textureSample(gBufferAlbedo, gBufferSampler, coordUV);
  } else if (sectionIndex == 1u) {
    // Normal (convert from [-1,1] to [0,1] for visualization)
    let normal = textureSample(gBufferNormal, gBufferSampler, coordUV);
    result = vec4((normal.xyz + 1.0) * 0.5, 1.0);
  } else if (sectionIndex == 2u) {
    // Depth (remap for visibility)
    let depth = textureSample(gBufferDepth, gBufferSampler, coordUV);
    let remappedDepth = (1.0 - depth.x) * 50.0;
    result = vec4(remappedDepth, remappedDepth, remappedDepth, 1.0);
  } else if (sectionIndex == 3u) {
    // Specular
    let specular = textureSample(gBufferSpecular, gBufferSampler, coordUV);
    result = vec4(specular.rgb, 1.0);
  } else {
    // Metallic (both metallic and roughness channels)
    let metallic = textureSample(gBufferMetallic, gBufferSampler, coordUV);
    // Red = metallic, Green = roughness, Blue = unused
    result = vec4(metallic.rg, 0.0, 1.0);
  }
  
  return result;
}
