// Develops the attractor exposure computed by attractor-splat.wgsl: log density with a soft
// tone curve, inked between "slow" and "fast" colors by the average speed through each bin,
// on a paper color with a fixed tooth. Palettes 0-3 are the page's print processes.
struct Params {
  phase:f32, aspect:f32, kind:f32, a:f32, b:f32, c:f32, d:f32, orbit:f32, zoom:f32,
  exposure:f32, print:f32, offset:f32
}
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage, read> bins:array<u32>;
@group(0) @binding(2) var<storage, read> peak:array<u32, 1>;

const RES:u32 = 1024u;

fn inks(i:u32)->vec3f {
  // paper, slow ink, fast ink per print process
  var c=array<vec3f,3>(vec3f(15,46,76),vec3f(232,241,242),vec3f(120,186,214));          // cyanotype
  if (params.print>0.5){c=array<vec3f,3>(vec3f(236,226,208),vec3f(58,34,24),vec3f(140,82,50));}   // van Dyke
  if (params.print>1.5){c=array<vec3f,3>(vec3f(218,222,220),vec3f(28,34,44),vec3f(104,66,96));}   // platinum
  if (params.print>2.5){c=array<vec3f,3>(vec3f(43,15,18),vec3f(242,214,176),vec3f(217,120,88));}  // oxblood
  if (params.print>3.5){c=array<vec3f,3>(vec3f(0,0,0),vec3f(255,255,255),vec3f(160,160,160));}    // luma only
  if (params.print>4.5){c=array<vec3f,3>(vec3f(8,4,20),vec3f(255,79,216),vec3f(62,240,255));}     // neon
  return c[i]/255.0;
}

fn tooth(p:vec2f)->f32 {
  var q=fract(p*vec2f(123.34,456.21)); q+=dot(q,q+45.32); return fract(q.x*q.y)-0.5;
}

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  // Square exposure fitted to the frame height; paper beyond it.
  let s=vec2f((uv.x-0.5)*params.aspect+0.5,1.0-uv.y);
  var col=inks(0u)+tooth(floor(uv*vec2f(params.aspect,1.0)*1400.0))*0.02;
  if (all(s>=vec2f(0.0)) && all(s<vec2f(1.0))) {
    let k=(u32(s.y*f32(RES))*RES+u32(s.x*f32(RES)))*2u;
    let hits=f32(bins[k]);
    let top=max(f32(peak[0]),1.0);
    if (hits>0.0) {
      let v=min(pow(log(1.0+hits)/log(1.0+top),0.8)*params.exposure,1.0);
      let t=f32(bins[k+1u])/(hits*255.0);
      col=mix(col,mix(inks(1u),inks(2u),t),v);
    }
  }
  return vec4f(col,1.0);
}
