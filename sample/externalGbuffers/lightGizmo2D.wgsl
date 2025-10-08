// Light Gizmo 2D Cross and Depth Ring - Simple 2D controls for light positioning

struct Camera {
  viewProjectionMatrix: mat4x4f,
  invViewProjectionMatrix: mat4x4f,
}

struct GizmoUniforms {
  position: vec3f,
  _padding: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> gizmo: GizmoUniforms;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) gizmoType: f32, // 0=cross, 1=depth ring
}

// Create 2D cross for X/Z control
@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;
  
  // 2D Cross: 4 rectangles (up, down, left, right) = 24 vertices
  
  // 2D CROSS (billboarded to face camera)
  let armVertices = 6u; // 6 vertices per arm
  let armIndex = vertexIndex / armVertices; // 0=up, 1=down, 2=left, 3=right
  let vertInArm = vertexIndex % armVertices;
  
  // Each arm is a rectangle (2 triangles = 6 vertices)
  var vertices = array<vec2f, 6>(
    vec2f(-1.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(-1.0, 10.0),
    vec2f(-1.0, 10.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 10.0),
  );
  
  var localPos = vertices[vertInArm];
  
  // Rotate based on arm direction
  var rotatedPos: vec2f;
  if (armIndex == 0u) {
    // Up arm (yellow)
    rotatedPos = localPos;
    output.color = vec3f(1.0, 1.0, 0.0);
  } else if (armIndex == 1u) {
    // Down arm (yellow)
    rotatedPos = vec2f(localPos.x, -localPos.y);
    output.color = vec3f(1.0, 1.0, 0.0);
  } else if (armIndex == 2u) {
    // Left arm (cyan)
    rotatedPos = vec2f(-localPos.y, localPos.x);
    output.color = vec3f(0.0, 1.0, 1.0);
  } else {
    // Right arm (cyan)
    rotatedPos = vec2f(localPos.y, localPos.x);
    output.color = vec3f(0.0, 1.0, 1.0);
  }
  
  // Transform to world space (billboarded)
  let clipPos = camera.viewProjectionMatrix * vec4f(gizmo.position, 1.0);
  
  // Apply billboard offset in clip space
  let offset = rotatedPos * 0.015; // Scale for screen size
  output.position = clipPos;
  output.position.x += offset.x * clipPos.w;
  output.position.y += offset.y * clipPos.w;
  
  output.gizmoType = 0.0; // cross
  
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  // Brighten the colors
  let finalColor = input.color * 1.2;
  return vec4f(finalColor, 1.0);
}

