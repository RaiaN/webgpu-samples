# External G-Buffer Implementation

This implementation allows you to use external PNG files as G-Buffers for deferred rendering instead of generating them in real-time.

## Required PNG Files

Place the following PNG files in a folder called `assets/gbuffers/` (relative to your web server root):

### 1. albedo.png
- **Purpose**: Surface color/albedo information
- **Format**: RGBA (8-bit per channel)
- **Usage**: Base material color before lighting calculations
- **Expected Range**: sRGB color space, values [0-1]

### 2. normal.png
- **Purpose**: Surface normal vectors
- **Format**: RGBA (16-bit float or 8-bit per channel)
- **Usage**: Surface orientation for lighting calculations
- **Expected Range**: Normal vectors encoded as (x+1)/2, (y+1)/2, (z+1)/2, range [0-1]

### 3. depth.png
- **Purpose**: Depth buffer information
- **Format**: Red channel (32-bit float or 8-bit)
- **Usage**: World/view space depth for position reconstruction
- **Expected Range**: Normalized depth values [0-1], where 1.0 = far plane

### 4. specular.png
- **Purpose**: Specular reflection color
- **Format**: RGBA (8-bit per channel)
- **Usage**: F0 (Fresnel reflection at normal incidence) for metallic materials
- **Expected Range**: sRGB color space, typically [0.01-1.0] for dielectrics

### 5. metallic.png
- **Purpose**: Metallicity and roughness information
- **Format**: RGBA (8-bit per channel)
- **Usage**: 
  - Red channel: Metallic value [0-1]
  - Green channel: Roughness value [0-1]
  - Blue channel: Reserved for future use
- **Expected Range**: 
  - Metallic: 0.0 = dielectric, 1.0 = metallic
  - Roughness: 0.0 = perfectly smooth, 1.0 = completely rough

## PNG Format Guidelines

### When Creating Your Own G-Buffer PNGs:

1. **Resolution**: All G-buffers should have the same dimensions
2. **Color Space**: Use sRGB for color channels, linear for normal/depth
3. **Precision**: 
   - Use 16-bit PNGs for normal maps when precision is crucial
   - 8-bit PNGs are sufficient for albedo, specular, metallic
4. **Alpha Channels**: Include for future compatibility, set to 1.0 for opaque surfaces

### File Organization:
```
project-root/
├── assets/
│   └── gbuffers/
│       ├── albedo.png
│       ├── normal.png
│       ├── depth.png
│       ├── specular.png
│       └── metallic.png
└── sample/
    └── deferredRendering/
        ├── mainExternal.ts
        ├── fragmentExternalGBuffers.wgsl
        └── ...
```

## Usage

1. **Create the G-Buffer PNGs** using your preferred 3D software or image editor
2. **Place them** in `assets/gbuffers/` directory
3. **Run** `indexExternal.html` in your browser
4. **Switch modes** using the GUI:
   - "rendering": Shows the final lit result
   - "gBuffers view": Shows individual G-buffer channels for debugging

## Features

- **PBR Lighting**: Physically Based Rendering with Cook-Torrance BRDF
- **Multiple Lights**: Supports up to 1024 dynamic point lights
- **Debug View**: Visualize individual G-buffer channels
- **External Pipeline**: No need to generate G-buffers internally
- **Flexible**: Easy to swap G-buffer assets for different scenes

## Troubleshooting

### Common Issues:

1. **File Not Found**: Ensure PNG files exist in the correct directory structure
2. **Format Mismatch**: Verify PNG format matches expected channel layouts
3. **CORS Issues**: Serve files from the same origin or configure CORS headers
4. **Buffer Size**: Reduce canvas size if WebGPU storage buffer limits are exceeded

### Quality Tips:

1. **High-quality normal maps**: Use 16-bit PNGs for normal maps to avoid banding
2. **Proper depth encoding**: Ensure depth values represent realistic scene distances
3. **Consistent resolution**: All G-buffers should match your target render resolution
4. **Material consistency**: Ensure metallic, specular, and albedo values are physically plausible
