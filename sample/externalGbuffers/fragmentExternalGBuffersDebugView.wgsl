@group(0) @binding(0) var gBufferBasecolor: texture_2d<f32>;
@group(0) @binding(1) var gBufferNormal: texture_2d<f32>;
@group(0) @binding(2) var gBufferDepth: texture_2d<f32>;
@group(0) @binding(3) var gBufferMetallic: texture_2d<f32>;
@group(0) @binding(4) var gBufferRoughness: texture_2d<f32>;
@group(0) @binding(5) var gBufferSampler: sampler;

override canvasSizeWidth: f32;
override canvasSizeHeight: f32;

@fragment
fn main(
  @builtin(position) coord: vec4f
) -> @location(0) vec4f {
  // Use normalized coordinates for texture sampling
  let coordUV = coord.xy / vec2f(canvasSizeWidth, canvasSizeHeight);
  
  // Sample all textures unconditionally for uniform control flow
  let basecolor = textureSample(gBufferBasecolor, gBufferSampler, coordUV);
  let normal = textureSample(gBufferNormal, gBufferSampler, coordUV);
  let depth = textureSample(gBufferDepth, gBufferSampler, coordUV);
  let metallic = textureSample(gBufferMetallic, gBufferSampler, coordUV);
  let roughness = textureSample(gBufferRoughness, gBufferSampler, coordUV);
  
  // Divide screen into 5 horizontal sections to view each G-Buffer
  let sectionWidth = canvasSizeWidth / 5.0;
  let sectionIndex = floor(coord.x / sectionWidth);
  
  // Initialize result vectors for each section
  let basecolor_result = basecolor;
  let normal_result = vec4((normal.xyz + 1.0) * 0.5, 1.0); // Convert from [-1,1] to [0,1]
  let depth_remapped = (1.0 - depth.x) * 50.0;
  let depth_result = vec4(depth_remapped, depth_remapped, depth_remapped, 1.0);
  let metallic_result = vec4(metallic.r, metallic.r, metallic.r, 1.0);
  let roughness_result = vec4(roughness.r, roughness.r, roughness.r, 1.0);
  
  // Use linear interpolation to blend between sections based on sectionIndex
  var result: vec4f = basecolor_result;
  
  // Smooth transitions between sections based on distance from section centers
  let transitionWidth = sectionWidth * 0.1; // 10% transition zone
  
  // Calculate weights for each section
  let dist_from_section_0 = abs(coord.x - sectionWidth * 0.5);
  let dist_from_section_1 = abs(coord.x - sectionWidth * 1.5);
  let dist_from_section_2 = abs(coord.x - sectionWidth * 2.5);
  let dist_from_section_3 = abs(coord.x - sectionWidth * 3.5);
  let dist_from_section_4 = abs(coord.x - sectionWidth * 4.5);
  
  let weight_0 = max(0.0, 1.0 - dist_from_section_0 / transitionWidth);
  let weight_1 = max(0.0, 1.0 - dist_from_section_1 / transitionWidth);
  let weight_2 = max(0.0, 1.0 - dist_from_section_2 / transitionWidth);
  let weight_3 = max(0.0, 1.0 - dist_from_section_3 / transitionWidth);
  let weight_4 = max(0.0, 1.0 - dist_from_section_4 / transitionWidth);
  
  // Normalize weights
  let total_weight = weight_0 + weight_1 + weight_2 + weight_3 + weight_4;
  let inv_total_weight = select(1.0 / total_weight, 1.0, total_weight == 0.0);
  
  result = (basecolor_result * weight_0 + 
            normal_result * weight_1 + 
            depth_result * weight_2 + 
            metallic_result * weight_3 + 
            roughness_result * weight_4) * inv_total_weight;
  
  return result;
}
