// INPUT

struct Uniforms {
  modelMatrix : mat4x4<f32>,
  normalModelMatrix : mat4x4<f32>,
}
struct LightData {
  position : vec4<f32>,
  color : vec3<f32>,
  radius : f32,
}
struct LightsBuffer {
  lights: array<LightData>,
}
struct Config {
  numLights : u32,
}
struct Camera {
  viewProjectionMatrix : mat4x4<f32>,
  invViewProjectionMatrix : mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> nouse1 : Uniforms;
@group(0) @binding(1) var<uniform> nouse2 : Camera;

@group(1) @binding(0) var<storage, read> lightsBuffer: LightsBuffer;
@group(1) @binding(1) var<uniform> config: Config;
@group(1) @binding(2) var<uniform> camera: Camera;


// OUTPUT
struct GBufferOutput {
  @location(0) normal : vec4<f32>,

  // Textures: diffuse color, specular color, smoothness, emissive etc. could go here
  @location(1) albedo : vec4<f32>,

  // Textures: lighting info
  @location(2) lighting : vec4<f32>,

  // Textures: UV mapping (fragUV, screenUV)
  @location(3) uvMapping : vec4<f32>,
}

fn world_from_screen_coord(coord : vec2<f32>, depth_sample: f32) -> vec3<f32> {
  // reconstruct world-space position from the screen coordinate.
  let posClip = vec4(coord.x * 2.0 - 1.0, (1.0 - coord.y) * 2.0 - 1.0, depth_sample, 1.0);
  let posWorldW = camera.invViewProjectionMatrix * posClip;
  let posWorld = posWorldW.xyz / posWorldW.www;
  return posWorld;
}

@fragment
fn main(
  @builtin(front_facing) is_front : bool,
  @builtin(position) coord: vec4<f32>,
  @location(0) fragNormal: vec3<f32>,
  @location(1) fragUV : vec2<f32>
) -> GBufferOutput {
  // faking some kind of checkerboard texture
  let uv = floor(30.0 * fragUV);
  let c = 0.2 + 0.5 * ((uv.x + uv.y) - 2.0 * floor((uv.x + uv.y) / 2.0));

  var result : vec3<f32>;

  let depth = 2.0; 
  /*textureLoad(
    gBufferDepth,
    vec2<i32>(floor(coord.xy)),
    0
  );

  // Don't light the sky.
  if (depth >= 1.0) {
    discard;
  }*/

  let bufferSize = vec2(1024, 1024); // textureDimensions(gBufferDepth);
  let coordUV = coord.xy / vec2<f32>(bufferSize);
  let fragWorldPosition: vec3<f32> = world_from_screen_coord(coordUV, depth);

  var output: GBufferOutput;
  output.normal = vec4(normalize(fragNormal), 1.0);
  output.albedo = vec4(c, c, c, 1.0);

  let normal = output.normal.xyz;
  let albedo = output.albedo.rgb;

  for (var i = 0u; i < config.numLights; i++) {
    let L = lightsBuffer.lights[i].position.xyz - fragWorldPosition;
    let distance = length(L);
    if (distance > lightsBuffer.lights[i].radius) {
      continue;
    }
    let lambert = max(dot(normal, normalize(L)), 0.0);
    result += vec3<f32>(
      lambert * pow(1.0 - distance / lightsBuffer.lights[i].radius, 2.0) * lightsBuffer.lights[i].color * albedo
    );
  }

  // some manual ambient
  result += vec3(0.2);
  output.lighting = vec4(result, 1.0);

  let screenUV: vec2<f32> = coord.xy / vec2<f32>(bufferSize);
  output.uvMapping = vec4(fragUV, screenUV);

  return output;
}
