struct Uniforms {
  modelMatrix : mat4x4<f32>,
  normalModelMatrix : mat4x4<f32>,
}
struct Camera {
  viewProjectionMatrix : mat4x4<f32>,
  invViewProjectionMatrix : mat4x4<f32>,
}
@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var<uniform> camera : Camera;

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

@group(1) @binding(0) var<storage, read> a: LightsBuffer;
@group(1) @binding(1) var<uniform> b: Config;
@group(1) @binding(2) var<uniform> c: Camera;


struct VertexOutput {
  @builtin(position) Position : vec4<f32>,
  @location(0) fragNormal: vec3<f32>,    // normal in world space
  @location(1) fragUV: vec2<f32>,
}

@vertex
fn main(
  @builtin(vertex_index) vInd: u32,
  @location(0) position : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv : vec2<f32>
) -> VertexOutput {
  var output : VertexOutput;

  let cameraDirection: vec3<f32> = -camera.viewProjectionMatrix[2].xyz;
  let fragNormal: vec3<f32> = normalize((uniforms.normalModelMatrix * vec4(normal, 1.0)).xyz);

  let dotRes = dot(cameraDirection, fragNormal);

  // if (dotRes > 0.0) {
  //   return output;
  // }

  let newViewProjMatrix: mat4x4<f32> = camera.viewProjectionMatrix;
  
  let worldPosition = (uniforms.modelMatrix * vec4(position, 1.0)).xyz;
  output.Position = newViewProjMatrix * vec4(worldPosition, 1.0);
  output.fragNormal = fragNormal;
  output.fragUV = uv;
  return output;
}
