# Video G-Buffer Implementation Guide

This guide explains how to replace PNGLoader with video inputs for dynamic G-Buffer rendering in WebGPU.

## Overview

The video loader system allows you to use video files as G-Buffer inputs instead of static PNG images. This enables real-time dynamic rendering where material properties, lighting, and geometry can change over time.

## Architecture

### Components

1. **videoLoader.ts**: Core video loading and synchronization system
2. **main.ts**: Updated to demonstrate both PNG and video G-Buffer modes
3. **GUI Controls**: Video playback controls integrated with dat.GUI

### Key Features

- **Video Synchronization**: All G-Buffer videos play in sync
- **Fallback Support**: Gracefully falls back to PNG if videos fail to load  
- **Real-time Control**: Play/pause/seek/rate control via GUI
- **WebGPU External Textures**: Uses GPUExternalTexture for optimal video performance

## Usage

### Basic Setup

```typescript
import { loadGBufferVideos, VideoGBufferConfig } from './videoLoader';

// Configure your video files
const videoConfig: VideoGBufferConfig = {
  albedo: 'albedo.mp4',    // Base color video
  depth: 'depth.mp4',      // Depth buffer video  
  metallic: 'metallic.mp4', // Metallic values video
  normal: 'normal.mp4',    // Normal map video
  roughness: 'roughness.mp4' // Roughness values video
};

// Load videos
const videoTextures = await loadGBufferVideos(device, videoConfig, './assets/gbuffers/');
```

### Switching Between PNG and Video Modes

```typescript
// In GUI settings
settings.useVideo = true;  // Enable video mode
settings.useVideo = false; // Enable PNG mode
```

### Video Controls

The integrated GUI provides:
- **Use Video Toggle**: Switch between PNG and video modes
- **Playback Rate**: Adjust video speed (0.1x to 3.0x)
- **Play/Pause**: Control video playback
- **Reset**: Seek to beginning

## Video Format Requirements

### File Specifications

| G-Buffer Type | Format | Color Space | Channels | Range |
|---------------|--------|-------------|----------|-------|
| Albedo        | MP4/WebM | sRGB | RGB/RGBA | [0-1] |
| Normal        | MP4/WebM | Linear | RGB | Encoded normals |
| Depth         | MP4/WebM | Linear | Single | [0-1] |
| Metallic      | MP4/WebM | Linear | Single/Grayscale | [0-1] |
| Roughness     | MP4/WebM | Linear | Single/Grayscale | [0-1] |

### Video Requirements

1. **Synchronization**: All videos must have identical duration and frame rate
2. **Format**: Recommended MP4 (H.264) or WebM (VP9) for compression quality balance
3. **Resolution**: All videos should match target resolution
4. **Encoding**: Use lossless for normal/depth maps, standard compression for albedo/metallic/roughness

### Content Guidelines

#### Albedo (Base Color)
- Use sRGB color space
- Can be RGB or RGBA (alpha for transparency)
- Should represent diffuse/albedo colors before lighting

#### Normal Maps  
- Use linear color space (no gamma correction)
- Encode normals as (x+1)/2, (y+1)/2, (z+1)/2 to fit [0-1] range
- Store unit vectors for proper lighting calculations

#### Depth Buffer
- Use linear color space
- Single channel (Red channel) sufficient
- Normalized depth values where 1.0 = far plane
- Values should match your camera's near/far planes

#### Metallic Values
- Use linear color space  
- Single channel or grayscale
- 0.0 = dielectric (non-metallic)
- 1.0 = metallic material

#### Roughness Values
- Use linear color space
- Single channel or grayscale  
- 0.0 = perfectly smooth/mirror
- 1.0 = completely rough/diffuse

## Integration Example

```typescript
// In your main.ts
async function setupGBuffers() {
  if (useVideoMode) {
    const videoConfig: VideoGBufferConfig = {
      albedo: 'colors.mp4',
      depth: 'depth.mp4', 
      metallic: 'metallic.mp4',
      normal: 'normal.mp4',
      roughness: 'roughness.mp4'
    };
    
    gBufferTextures = await loadGBufferVideos(device, videoConfig, '../../assets/gbuffers/');
    synchronizer = (gBufferTextures as any).synchronizer;
  } else {
    gBufferTextures = await loadGBufferTextures(device, '../../assets/gbuffers/');
  }
}
```

## Advanced Features

### Custom Synchronization

```typescript
// Access VideoSynchronizer directly
const synchronizer = videoTextures.synchronizer;

// Control playback
await synchronizer.play();
synchronizer.pause();
synchronizer.seek(0.5); // Seek to 50%
synchronizer.setPlaybackRate(2.0); // 2x speed

// Check status
const duration = synchronizer.getDuration();
const currentTime = synchronizer.getCurrentTime();
const allLoaded = synchronizer.allLoaded();
```

### Performance Considerations

1. **External Textures**: Use GPUExternalTexture for best performance
2. **Video Compression**: Balance quality vs. file size
3. **Memory**: Videos are streamed, not fully loaded into memory
4. **Synchronization**: Frame rate should match your target refresh rate

### WebGPU Shader Integration

The video loader seamlessly integrates with existing shaders. External textures can be sampled just like regular textures:

```wgsl
@group(0) @binding(0) var albedoTexture: texture_external;
@group(0) @binding(1) var normalTexture: texture_external;
@group(0) @binding(2) var depthTexture: texture_external;
@group(0) @binding(3) var metallicTexture: texture_external;
@group(0) @binding(4) var roughnessTexture: texture_external;
@group(0) @binding(5) var gBufferSampler: sampler;

// Sample video textures exactly like PNG textures
let albedo = textureSampleBaseClampToEdge(albedoTexture, gBufferSampler, screenUV);
let normal = textureSampleBaseClampToEdge(normalTexture, gBufferSampler, screenUV);
```

## Troubleshooting

### Common Issues

1. **Videos not loading**: Check CORS policy and file paths
2. **Out of sync videos**: Ensure all videos have same duration/rate
3. **Performance issues**: Try lower resolution or different compression
4. **Visual artifacts**: Verify color space encoding (sRGB vs linear)

### Debug Tools

```typescript
// Check video status
console.log('Synchronizer loaded:', synchronizer?.allLoaded());
console.log('Video duration:', synchronizer?.getDuration());
console.log('Current time:', synchronizer?.getCurrentTime());

// Monitor GPU memory
const adapterInfo = await adapter.requestAdapterInfo();
console.log('GPU adapter:', adapterInfo);
```

## Benefits Over PNG

1. **Dynamic Content**: Real-time material animations
2. **Memory Efficiency**: Streamed content vs. full image in memory  
3. **Creative Possibilities**: Time-based material changes
4. **Professional Workflows**: Compatible with cinematic pipelines

## Future Enhancements

- HDR video support
- Audio synchronization
- Multi-view video support for stereo rendering
- Advanced compression codecs
- Real-time video generation integration
