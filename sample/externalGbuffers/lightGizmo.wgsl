// Light Gizmo Shader - Renders a billboard sphere at the light position

struct Camera {
  viewProjectionMatrix: mat4x4f,
  invViewProjectionMatrix: mat4x4f,
}

struct LightGizmoUniforms {
  position: vec3f,
  radius: f32,
  color: vec3f,
  _padding: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> lightGizmo: LightGizmoUniforms;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
}

// Create a billboard quad that always faces the camera
@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;
  
  // Define a quad in clip space [-1, 1]
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0),
  );
  
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 1.0),
  );
  
  let localPos = positions[vertexIndex];
  output.uv = uvs[vertexIndex];
  output.color = lightGizmo.color;
  
  // Size of the gizmo in world space (small sphere representation)
  let gizmoSize = 3.0;
  
  // Transform light position to clip space
  let lightWorldPos = vec4f(lightGizmo.position, 1.0);
  let lightClipPos = camera.viewProjectionMatrix * lightWorldPos;
  
  // Create billboard offset in clip space
  let offset = localPos * gizmoSize * 0.02; // Scale factor for screen-space size
  
  // Apply offset in clip space (billboard effect)
  output.position = lightClipPos;
  output.position.x += offset.x * lightClipPos.w;
  output.position.y += offset.y * lightClipPos.w;
  
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  // Create a circular disk (sphere when viewed from front)
  let center = vec2f(0.5, 0.5);
  let dist = distance(input.uv, center);
  
  // Discard fragments outside the circle
  if (dist > 0.5) {
    discard;
  }
  
  // Create a gradient to give it depth
  let sphereEffect = 1.0 - (dist * 2.0);
  let lighting = mix(0.5, 1.0, sphereEffect);
  
  // Add a bright center
  let centerGlow = 1.0 - smoothstep(0.0, 0.3, dist);
  let finalColor = input.color * lighting + vec3f(centerGlow * 0.5);
  
  // Add some transparency at edges
  let alpha = smoothstep(0.5, 0.4, dist);
  
  return vec4f(finalColor, alpha);
}

