# External G-Buffer Implementation

This implementation allows you to use external image sequences as G-Buffers for deferred rendering instead of generating them in real-time.

## Required Image Sequence Files

Place image sequence files in a folder (e.g., `assets/gbuffers/4/`) with the following naming pattern:

`0000.0xxx.<channel>.jpg`

Where:
- `0xxx` is the frame number (0000, 0001, 0002, etc.)
- `<channel>` is one of: basecolor, normal, depth, metallic, roughness

### 1. basecolor (0000.0xxx.basecolor.jpg)
- **Purpose**: Surface color/albedo information per frame
- **Format**: JPG images with RGB channels (8-bit per channel)
- **Usage**: Base material color before lighting calculations
- **Expected Range**: sRGB color space, values [0-1]

### 2. normal (0000.0xxx.normal.jpg)
- **Purpose**: Surface normal vectors per frame
- **Format**: JPG images with RGB channels (8-bit per channel)
- **Usage**: Surface orientation for lighting calculations
- **Expected Range**: Normal vectors encoded as (x+1)/2, (y+1)/2, (z+1)/2, range [0-1]

### 3. depth (0000.0xxx.depth.jpg)
- **Purpose**: Depth buffer information per frame
- **Format**: JPG images with depth channel
- **Usage**: World/view space depth for position reconstruction
- **Expected Range**: Normalized depth values [0-1], where 1.0 = far plane

### 4. metallic (0000.0xxx.metallic.jpg)
- **Purpose**: Metallic material properties per frame
- **Format**: JPG images (8-bit per channel)
- **Usage**: Metallic workflow for material definition
- **Expected Range**: 
  - Metallic: 0.0 = dielectric, 1.0 = metallic
  - Typically ranges [0.0-1.0] with sharp transitions

### 5. roughness (0000.0xxx.roughness.jpg)
- **Purpose**: Surface roughness information per frame
- **Format**: JPG images (8-bit per channel)
- **Usage**: Surface microsurface detail for lighting calculations
- **Expected Range**: 
  - Roughness: 0.0 = perfectly smooth, 1.0 = completely rough
  - Typically ranges [0.0-1.0] with gradual variations

## Image Sequence Format Guidelines

### When Creating Your Own G-Buffer Image Sequences:

1. **Resolution**: All images in the sequence should have the same dimensions
2. **Format**: Use JPG format for compatibility
3. **Color Space**: Use sRGB for color channels, linear for normal/depth
4. **Naming**: Follow the exact naming pattern: `0000.0xxx.<channel>.jpg`
5. **Frame Numbering**: Zero-padded 4-digit frame numbers (0000, 0001, 0002, etc.)
6. **Consistency**: All channels must have the same number of frames

### Example File Organization:
```
project-root/
├── assets/
│   └── gbuffers/
│       └── 4/
│           ├── 0000.0000.basecolor.jpg
│           ├── 0000.0000.normal.jpg
│           ├── 0000.0000.depth.jpg
│           ├── 0000.0000.metallic.jpg
│           ├── 0000.0000.roughness.jpg
│           ├── 0000.0001.basecolor.jpg
│           ├── 0000.0001.normal.jpg
│           ├── ...
└── sample/
    └── externalGbuffers/
        ├── index.html
        ├── main.ts
        ├── imageLoader.ts
        ├── fragmentExternalGBuffers.wgsl
        └── ...
```

## Usage

1. **Create the G-Buffer image sequences** using your preferred 3D software or rendering tool
2. **Place them** in `assets/gbuffers/4/` directory with the correct naming pattern
3. **Run** `index.html` in your browser
4. **Switch modes** using the GUI:
   - "rendering": Shows the final lit result with sequence playback
   - "gBuffers view": Shows individual G-buffer channels for debugging
5. **Control playback** using the GUI controls:
   - Adjust playback rate (0.1x to 3.0x)
   - Scrub through frames using the frame slider
   - Pause/Play sequence
   - Reset to frame 0
6. **Adjust lighting**:
   - Switch between directional and point lights
   - Adjust light color, intensity, and position
   - Use presets for common lighting scenarios

## Features

- **PBR Lighting**: Physically Based Rendering with Cook-Torrance BRDF
- **Multiple Light Types**: 
  - Point lights with radius and attenuation
  - Directional lights (sun-like) with azimuth/elevation controls
- **Image Sequence Playback**: Real-time G-Buffer animation using image sequences
- **Debug View**: Visualize individual G-buffer channels side-by-side
- **Frame-by-Frame Control**: Precise frame scrubbing and playback
- **External Pipeline**: No need to generate G-Buffers internally
- **Flexible**: Easy to swap G-buffer image sequences for different animated scenes
- **Interactive Controls**: Full playback control, lighting adjustment, and frame export
- **Frame Export**: Export rendered frames as PNG images

## Configuration

The image sequence path is configured in `main.ts`:

```typescript
const result = await loadGBufferImages(device, imageConfig, '../../assets/gbuffers/4/');
```

Change the path to point to your image sequence directory.

## Troubleshooting

### Common Issues:

1. **Images Not Found**: Ensure image files exist in the specified directory with correct naming pattern
2. **Format Issues**: Verify all images are JPG format
3. **CORS Issues**: Serve files from the same origin or configure CORS headers
4. **Missing Frames**: Ensure all channels have the same number of frames
5. **Naming Errors**: Double-check the naming pattern matches exactly: `0000.0xxx.<channel>.jpg`
6. **Performance**: Large image sequences may take time to load; check browser console for progress

### Quality Tips:

1. **Consistent encoding**: Use the same encoding settings for all G-Buffer images
2. **Proper depth encoding**: Ensure depth values represent realistic scene distances
3. **Consistent resolution**: All images should match your target render resolution
4. **Material consistency**: Ensure metallic, roughness, and basecolor values are physically plausible
5. **Frame rate**: The default playback is 30 FPS, adjustable in the GUI
6. **Color accuracy**: Maintain consistent color space across all image channels
7. **Compression**: JPG quality should be high enough to avoid artifacts in lighting calculations

## Converting from Video to Image Sequence

If you have video files and need to convert them to image sequences, you can use FFmpeg:

```bash
# Extract frames from video
ffmpeg -i albedo.mp4 -q:v 2 0000.%04d.basecolor.jpg
ffmpeg -i normal.mp4 -q:v 2 0000.%04d.normal.jpg
ffmpeg -i depth.mp4 -q:v 2 0000.%04d.depth.jpg
ffmpeg -i metallic.mp4 -q:v 2 0000.%04d.metallic.jpg
ffmpeg -i roughness.mp4 -q:v 2 0000.%04d.roughness.jpg
```

Note: The `-q:v 2` flag sets high quality output. Adjust as needed.
