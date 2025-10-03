@group(0) @binding(0) var gBufferAlbedo: texture_external;
@group(0) @binding(1) var gBufferNormal: texture_external;
@group(0) @binding(2) var gBufferDepth: texture_external;
@group(0) @binding(3) var gBufferMetallicRoughness: texture_external;
@group(0) @binding(4) var gBufferSampler: sampler;

struct LightData {
  position :vec4f,
  color: vec3f,
  radius: f32,
}

struct LightsBuffer {
  lights: array<LightData>,
}
@group(1) @binding(0) var<storage, read> lightsBuffer: LightsBuffer;

struct Config {
  numLights : u32,
}
struct Camera {
  viewProjectionMatrix: mat4x4f,
  invViewProjectionMatrix: mat4x4f,
}
@group(1) @binding(1) var<uniform> config: Config;
@group(1) @binding(2) var<uniform> camera: Camera;

// Configuration for lighting model
struct LightingConfig {
  near: f32,
  far: f32,
  ambientStrength: f32,
  specularStrength: f32,
}

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
  return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
}

fn calculateNormalDistribution(roughness: f32, NdotNH: f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let NdotNH2 = NdotNH * NdotNH;
  let numerator = a2;
  let denominator = (NdotNH2 * (a2 - 1.0) + 1.0);
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
  // Use normalized coordinates for external textures
  let coordUV = coord.xy / vec2f(canvasSizeWidth, canvasSizeHeight);
  
  // Sample all G-Buffer data
  let albedo_raw = textureSampleBaseClampToEdge(gBufferAlbedo, gBufferSampler, coordUV);
  let normal_raw = textureSampleBaseClampToEdge(gBufferNormal, gBufferSampler, coordUV);
  let depth_raw = textureSampleBaseClampToEdge(gBufferDepth, gBufferSampler, coordUV);
  let metallicRoughness_raw = textureSampleBaseClampToEdge(gBufferMetallicRoughness, gBufferSampler, coordUV);
  
  // Extract material properties
  let albedo = toLinear(albedo_raw.rgb);
  let normal = normalize(normal_raw.xyz * 2.0 - 1.0); // Convert from [0,1] to [-1,1]
  let depth = depth_raw.r; // Assuming depth is stored in red channel
  let metallic = metallicRoughness_raw.r; // Metallic in red channel
  let roughness = metallicRoughness_raw.g; // Roughness in green channel
  
  // Don't light the sky (assuming depth = 1.0 indicates sky)
  if (depth >= 1.0) {
    discard;
  }
  
  // Reconstruct world position
  let position = world_from_screen_coord(coordUV, depth);
  
  var result: vec3f = vec3f(0.0);
  
  // Surface normal in world space
  let N = normal;
  let V = normalize(vec3f(0.0, 50.0, -100.0) - position); // Camera position
  
  // Material properties for PBR
  let f0 = mix(vec3f(0.04), albedo, metallic); // F0 for dielectrics, albedo for metals
  let diffuse = (1.0 - metallic) * albedo * (1.0 - f0);
  
  // Ambient lighting (basic)
  let ambient = albedo * 0.05;
  result += ambient;
  
  // Light accumulation
  for (var i: u32 = 0u; i < config.numLights; i++) {
    let light = lightsBuffer.lights[i];
    let L = light.position.xyz - position;
    let distance = length(L);
    
    if (distance > light.radius) {
      continue;
    }
    
    let L_norm = L / distance;
    let H = normalize(V + L_norm);
    
    // Geometric terms
    let NdotL = max(dot(N, L_norm), 0.0);
    let NdotV = max(dot(N, V), 0.0);
    let NdotH = max(dot(N, H), 0.0);
    let VdotH = max(dot(V, H), 0.0);
    
    if (NdotL <= 0.0) {
      continue;
    }
    
    // Attenuation
    let attenuation = pow(1.0 - distance / light.radius, 2.0);
    
    // Fresnel
    let F = calculateFresnel(f0, VdotH);
    
    // Normal Distribution
    let D = calculateNormalDistribution(roughness, NdotH);
    
    // Geometry function
    let G = calculateGeometryFunction(roughness, NdotV, NdotL);
    
    // Cook-Torrance specular BRDF
    let numerator = D * G * F;
    let denominator = 4.0 * NdotV * NdotL + 0.001;
    let specular = numerator / denominator;
    
    // Diffuse contribution (only for non-metallic materials)
    let diffuseContribution = diffuse * NdotL;
    
    // Specular contribution
    let specularContribution = specular * NdotL * light.color;
    
    // Final radiance
    let radiance = light.color * attenuation * (diffuseContribution + specularContribution);
    result += radiance;
  }
  
  // Convert back to sRGB for display
  let finalColor = toSRGB(result);
  
  return vec4(finalColor, 1.0);
}
