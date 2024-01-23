struct Vertex {
  position: vec3<f32>,
  normal: vec3<f32>,
  uv: vec2<f32>
}
struct VertexBuffer {
  vertices: array<Vertex>,
}

@group(0) @binding(0) var<storage, read> vertexBuffer: VertexBuffer;
@group(0) @binding(1) var outNormalMap: texture_storage_2d<rgba16float, write>;
// @group(0) @binding(2) var outAlbedoMap: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var normalMap: texture_2d<f32>;
// @group(0) @binding(4) var albedoMap: texture_2d<f32>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var index = GlobalInvocationID.x;
  if (index >= 64) {
    return;
  }

  let fragNormal : vec4<f32> = textureLoad(normalMap, vec2<u32>(vertexBuffer.vertices[index].uv), 0);

  textureStore(outNormalMap, vec2<u32>(vertexBuffer.vertices[index].uv), fragNormal);
}
