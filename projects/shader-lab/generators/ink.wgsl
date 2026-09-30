// Ink in Water, display: luminous dye in dark water, bilinear-filtered, cropped (not stretched)
// from the square tank to the frame.
struct Params {
  phase:f32, aspect:f32, seed:f32, grid:f32, palette:f32, curl:f32, stir:f32, emitters:f32,
  swirl:f32, drag:f32, fade:f32, ink:f32, exposure:f32,
}
@group(0) @binding(0) var state:texture_2d<f32>;
@group(0) @binding(1) var<uniform> params:Params;

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let size=vec2f(textureDimensions(state));
  let a=params.aspect;
  var p=uv;
  if (a>1.0) { p.y=0.5+(uv.y-0.5)/a; } else { p.x=0.5+(uv.x-0.5)*a; }
  let f=p*size-0.5; let i=vec2i(floor(f)); let w=fract(f); let n=vec2i(size);
  let t00=textureLoad(state,(i+n)%n,0).rgb; let t10=textureLoad(state,(i+vec2i(1,0)+n)%n,0).rgb;
  let t01=textureLoad(state,(i+vec2i(0,1)+n)%n,0).rgb; let t11=textureLoad(state,(i+vec2i(1,1)+n)%n,0).rgb;
  let dye=mix(mix(t00,t10,w.x),mix(t01,t11,w.x),w.y)*params.exposure;
  var col=vec3f(1.0)-exp(-dye*1.3);
  col+=vec3f(1.0)*pow(max(max(col.r,col.g),col.b),5.0)*0.25;
  return vec4f(mix(vec3f(0.008,0.012,0.022),col,clamp(max(max(col.r,col.g),col.b)*1.5,0.0,1.0)),1.0);
}
