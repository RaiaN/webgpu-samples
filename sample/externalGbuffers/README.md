# External G-Buffer Implementation

This implementation allows you to use external video files as G-Buffers for deferred rendering instead of generating them in real-time.

## Required Video Files

Place the following video files in a folder called `assets/gbuffers/` (relative to your web server root):

### 1. albedo_colors.mp4
- **Purpose**: Surface color/albedo information over time
- **Format**: Video file with RGBA frames (8-bit per channel)
- **Usage**: Base material color before lighting calculations
- **Expected Range**: sRGB color space, values [0-1]

### 2. normal_maps.mp4
- **Purpose**: Surface normal vectors over time
- **Format**: Video file with RGBA frames (8-bit per channel)
- **Usage**: Surface orientation for lighting calculations
- **Expected Range**: Normal vectors encoded as (x+1)/2, (y+1)/2, (z+1)/2, range [0-1]

### 3. depth_buffer.mp4
- **Purpose**: Depth buffer information over time
- **Format**: Video file with depth channel
- **Usage**: World/view space depth for position reconstruction
- **Expected Range**: Normalized depth values [0-1], where 1.0 = far plane

### 4. metallic_values.mp4
- **Purpose**: Metallic material properties over time
- **Format**: Video file with RGBA frames (8-bit per channel)
- **Usage**: Metallic workflow for material definition
- **Expected Range**: 
  - Metallic: 0.0 = dielectric, 1.0 = metallic
  - Typically ranges [0.0-1.0] with sharp transitions

### 5. roughness_values.mp4
- **Purpose**: Surface roughness information over time
- **Format**: Video file with RGBA frames (8-bit per channel)
- **Usage**: Surface microsurface detail for lighting calculations
- **Expected Range**: 
  - Roughness: 0.0 = perfectly smooth, 1.0 = completely rough
  - Typically ranges [0.0-1.0] with gradual variations

## Video Format Guidelines

### When Creating Your Own G-Buffer Videos:

1. **Resolution**: All videos should have the same dimensions and frame rate
2. **Format**: Use MP4 with H.264 encoding for compatibility
3. **Color Space**: Use sRGB for color channels, linear for normal/depth
4. **Precision**: 
   - Use 8-bit per channel for video frames
   - Maintain consistent encoding across all videos
5. **Synchronization**: All videos must have the same duration and frame rate for proper playback

### File Organization:
```
project-root/
├── assets/
│   └── videos/
│       ├── albedo.mp4
│       ├── normal.mp4
│       ├── depth.mp4
│       ├── metallic.mp4
│       └── roughness.mp4
└── sample/
    └── externalGbuffers/
        ├── index.html
        ├── main.ts
        ├── videoLoader.ts
        ├── fragmentExternalGBuffers.wgsl
        └── ...
```

## Usage

1. **Create the G-Buffer videos** using your preferred 3D software or video editor
2. **Place them** in `assets/gbuffers/` directory with the correct filenames
3. **Run** `index.html` in your browser
4. **Switch modes** using the GUI:
   - "rendering": Shows the final lit result with video playback
   - "gBuffers view": Shows individual G-buffer channels for debugging
5. **Control playback** using the GUI controls:
   - Adjust playback rate (0.1x to 3.0x)
   - Pause/Play videos
   - Reset to beginning

## Features

- **PBR Lighting**: Physically Based Rendering with Cook-Torrance BRDF
- **Multiple Lights**: Supports up to 1024 dynamic point lights
- **Video Playback**: Real-time G-Buffer animation using video textures
- **Debug View**: Visualize individual G-buffer channels
- **Video Synchronization**: All G-Buffer videos are perfectly synchronized
- **External Pipeline**: No need to generate G-Buffers internally
- **Flexible**: Easy to swap G-buffer videos for different animated scenes
- **Interactive Controls**: Playback rate, pause/play, and seek capabilities

## Troubleshooting

### Common Issues:

1. **File Not Found**: Ensure video files exist in `assets/gbuffers/` directory
2. **Format Mismatch**: Verify video format (MP4/H.264) and codec compatibility
3. **CORS Issues**: Serve files from the same origin or configure CORS headers
4. **Synchronization Issues**: Ensure all videos have the same duration and frame rate
5. **Video Loading**: Check browser console for video loading errors
6. **Buffer Size**: Reduce canvas size if WebGPU storage buffer limits are exceeded

### Quality Tips:

1. **Consistent encoding**: Use the same encoding settings for all G-Buffer videos
2. **Proper depth encoding**: Ensure depth values represent realistic scene distances
3. **Consistent resolution**: All videos should match your target render resolution
4. **Material consistency**: Ensure metallic, roughness, and albedo values are physically plausible
5. **Frame rate**: Use high frame rates (30-60 FPS) for smooth animation
6. **Color accuracy**: Maintain consistent color space across all video channels
