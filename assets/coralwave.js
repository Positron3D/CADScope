// ABOUTME: Coral Wave easter egg — renders Accent parts as dual-extruded
// ABOUTME: teal/magenta filament split about each part's centerline.

const hexToRgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

export const CORAL_TEAL = hexToRgb('0177a1');
export const CORAL_MAGENTA = hexToRgb('c22376');

const BLEND_FRACTION = 0.08;     // blend band as a fraction of part width
const WAVE_CYCLES = 6;           // boundary undulations over the part's height
const WAVE_AMP_FRACTION = 0.35;  // wave amplitude relative to the blend half-width

export function coralWaveRequested(urlParams) {
  return (urlParams.get('filament') || '').toLowerCase() === 'coralwave';
}

export function splitUniformsForBox(box) {
  const width = box.max.x - box.min.x;
  const height = Math.max(box.max.y - box.min.y, box.max.z - box.min.z);
  const blendHalf = Math.max((width * BLEND_FRACTION) / 2, 1e-4);
  return {
    splitX: (box.min.x + box.max.x) / 2,
    blendHalf,
    waveFreq: height > 0 ? (WAVE_CYCLES * 2 * Math.PI) / height : 1,
    waveAmp: blendHalf * WAVE_AMP_FRACTION,
  };
}

// Injected into MeshStandardMaterial. The vertex chunk forwards world position;
// the fragment chunk replaces the diffuse color with the two-filament mix.
export const CORAL_GLSL = `
  float boundary = uSplitX
    + uWaveAmp * sin(vCoralWorldPos.y * uWaveFreq)
    + uWaveAmp * 0.5 * sin(vCoralWorldPos.z * uWaveFreq * 1.7 + 1.3);
  float t = smoothstep(boundary - uBlendHalf, boundary + uBlendHalf, vCoralWorldPos.x);
  diffuseColor.rgb = mix(uCoralTeal, uCoralMagenta, t);
`;

export function patchMaterial(material, uniforms) {
  material._coralWave = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSplitX = { value: uniforms.splitX };
    shader.uniforms.uBlendHalf = { value: uniforms.blendHalf };
    shader.uniforms.uWaveFreq = { value: uniforms.waveFreq };
    shader.uniforms.uWaveAmp = { value: uniforms.waveAmp };
    shader.uniforms.uCoralTeal = { value: CORAL_TEAL };
    shader.uniforms.uCoralMagenta = { value: CORAL_MAGENTA };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCoralWorldPos;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvCoralWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        `#include <common>
         varying vec3 vCoralWorldPos;
         uniform float uSplitX; uniform float uBlendHalf;
         uniform float uWaveFreq; uniform float uWaveAmp;
         uniform vec3 uCoralTeal; uniform vec3 uCoralMagenta;`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${CORAL_GLSL}`);
  };
  material.needsUpdate = true;
}
