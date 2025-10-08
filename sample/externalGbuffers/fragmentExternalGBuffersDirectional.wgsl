@group(0) @binding(0) var gBufferBasecolor: texture_2d<f32>;
@group(0) @binding(1) var gBufferNormal: texture_2d<f32>;
@group(0) @binding(2) var gBufferDepth: texture_2d<f32>;
@group(0) @binding(3) var gBufferMetallic: texture_2d<f32>;
@group(0) @binding(4) var gBufferRoughness: texture_2d<f32>;
@group(0) @binding(5) var gBufferSampler: sampler;

// Directional Light (like Unreal's Directional Light / Sun)
struct DirectionalLightData {
  direction: vec3f,  // Direction TO the light (opposite of light ray direction)
  intensity: f32,    // Light intensity multiplier
  color: vec3f,      // Light color (RGB)
  _padding: f32,     // Padding for alignment
}

struct DirectionalLightsBuffer {
  lights: array<DirectionalLightData>,
}
@group(1) @binding(0) var<storage, read> directionalLightsBuffer: DirectionalLightsBuffer;

struct Config {
  numLights: u32,
}
struct Camera {
  viewProjectionMatrix: mat4x4f,
  invViewProjectionMatrix: mat4x4f,
}
@group(1) @binding(1) var<uniform> config: Config;
@group(1) @binding(2) var<uniform> camera: Camera;

override canvasSizeWidth: f32;
override canvasSizeHeight: f32;

fn world_from_screen_coord(coord : vec2f, depth_sample: f32) -> vec3f {
  // Reconstruct world-space position from the screen coordinate.
  let posClip = vec4(coord.x * 2.0 - 1.0, (1.0 - coord.y) * 2.0 - 1.0, depth_sample, 1.0);
  let posWorldW = camera.invViewProjectionMatrix * posClip;
  let posWorld = posWorldW.xyz / posWorldW.www;
  return posWorld;
}

// PBR lighting functions
fn calculateFresnel(f0: vec3f, cosTheta: f32) -> vec3f {
  return f0 + (1.0 - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

fn calculateNormalDistribution(roughness: f32, NdotH: f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let NdotH2 = NdotH * NdotH;
  let numerator = a2;
  let denominator = (NdotH2 * (a2 - 1.0) + 1.0);
  return numerator / max(PI * denominator * denominator, 0.001);
}

fn calculateGeometryFunction(roughness: f32, NdotV: f32, NdotL: f32) -> f32 {
  let r = roughness + 1.0;
  let k = (r * r) / 8.0;
  let ggx2_l = NdotL / (NdotL * (1.0 - k) + k);
  let ggx2_v = NdotV / (NdotV * (1.0 - k) + k);
  return ggx2_l * ggx2_v;
}

fn toLinear(color: vec3f) -> vec3f {
  return pow(color, vec3f(2.2));
}

fn toSRGB(color: vec3f) -> vec3f {
  return pow(color, vec3f(0.4545));
}

const PI: f32 = 3.14159265359;

@fragment
fn main(
  @builtin(position) coord: vec4f
) -> @location(0) vec4f {
  // Use normalized coordinates for texture sampling
  let coordUV = coord.xy / vec2f(canvasSizeWidth, canvasSizeHeight);
  
  // Sample all G-Buffer data
  let basecolor_raw = textureSample(gBufferBasecolor, gBufferSampler, coordUV);
  let normal_raw = textureSample(gBufferNormal, gBufferSampler, coordUV);
  let depth_raw = textureSample(gBufferDepth, gBufferSampler, coordUV);
  let metallic_raw = textureSample(gBufferMetallic, gBufferSampler, coordUV);
  let roughness_raw = textureSample(gBufferRoughness, gBufferSampler, coordUV);
  
  // Extract material properties
  let albedo = toLinear(basecolor_raw.rgb);
  let normal = normalize(normal_raw.xyz * 2.0 - 1.0); // Convert from [0,1] to [-1,1]
  let depth = depth_raw.r; // Depth stored in red channel
  let metallic = metallic_raw.r; // Metallic in red channel
  let roughness = roughness_raw.r; // Roughness in red channel
  
  // Don't light the sky (depth = 1.0 indicates sky)
  if (depth >= 1.0) {
    discard;
  }
  
  // Reconstruct world position (needed for view direction)
  let position = world_from_screen_coord(coordUV, depth);
  
  var result: vec3f = vec3f(0.0);
  
  // Surface normal in world space
  let N = normal;
  
  // View direction (from surface to camera)
  let V = normalize(vec3f(0.0, 50.0, -100.0) - position); // Camera position
  
  // Material properties for PBR
  let f0 = mix(vec3f(0.04), albedo, metallic); // F0 for dielectrics, albedo for metals
  
  // Ambient lighting (reduced to make directional lights more visible)
  let ambient = albedo * 0.01;
  result += ambient;
  
  // Directional lights accumulation
  for (var i: u32 = 0u; i < config.numLights; i++) {
    let light = directionalLightsBuffer.lights[i];
    
    // Light direction (normalized, pointing TO the light source)
    let L = normalize(light.direction);
    
    // Half vector for specular
    let H = normalize(V + L);
    
    // Geometric terms
    let NdotL = max(dot(N, L), 0.0);
    let NdotV = max(dot(N, V), 0.0);
    let NdotH = max(dot(N, H), 0.0);
    let VdotH = max(dot(V, H), 0.0);
    
    // Skip if surface facing away from light
    if (NdotL <= 0.0) {
      continue;
    }
    
    // Fresnel (specular reflection)
    let F = calculateFresnel(f0, VdotH);
    
    // Normal Distribution Function (specular highlights)
    let D = calculateNormalDistribution(roughness, NdotH);
    
    // Geometry function (self-shadowing)
    let G = calculateGeometryFunction(roughness, NdotV, NdotL);
    
    // Cook-Torrance specular BRDF
    let numerator = D * G * F;
    let denominator = 4.0 * NdotV * NdotL + 0.001;
    let specular = numerator / denominator;
    
    // Energy conservation: kS + kD = 1
    // kS is F (Fresnel), kD is what's left for diffuse
    let kS = F;
    let kD = (vec3f(1.0) - kS) * (1.0 - metallic);
    
    // Lambert diffuse BRDF
    let diffuseBRDF = kD * albedo / PI;
    
    // Combine diffuse and specular
    let brdf = diffuseBRDF + specular;
    
    // Final radiance for this directional light
    // No attenuation - directional lights affect everything equally
    let radiance = brdf * light.color * light.intensity * NdotL;
    result += radiance;
  }
  
  // Convert back to sRGB for display
  let finalColor = toSRGB(result);
  
  return vec4(finalColor, 1.0);
}

