// Quasicrystal: a sum of N plane waves at angles pi*k/N. Periodic in phase (2pi per loop).
struct Params {
  phase:f32, aspect:f32, symmetry:f32, scale:f32, flow:f32, twist:f32, bands:f32,
  spread:f32, rotation:f32, cycles:f32, palette:f32, offset:f32
}
@group(0) @binding(0) var<uniform> params:Params;

const PI:f32 = 3.14159265359;
const TAU:f32 = 6.28318530718;

fn colors(layer:u32)->vec3f {
  var c=array<vec3f,3>(vec3f(25,117,125),vec3f(255,148,110),vec3f(202,237,210));
  if(params.palette>0.5){c=array<vec3f,3>(vec3f(185,44,81),vec3f(255,184,92),vec3f(247,104,64));}
  if(params.palette>1.5){c=array<vec3f,3>(vec3f(69,84,166),vec3f(156,247,199),vec3f(130,177,255));}
  if(params.palette>2.5){c=array<vec3f,3>(vec3f(232,149,42),vec3f(0,212,106),vec3f(255,217,61));}
  if(params.palette>3.5){c=array<vec3f,3>(vec3f(0,139,150),vec3f(127,255,0),vec3f(0,212,106));}
  if(params.palette>4.5){c=array<vec3f,3>(vec3f(139,26,43),vec3f(255,179,71),vec3f(255,217,61));}
  if(params.palette>5.5){c=array<vec3f,3>(vec3f(255,103,200),vec3f(149,132,255),vec3f(92,240,239));}
  if(params.palette>6.5){c=array<vec3f,3>(vec3f(255,109,53),vec3f(48,221,255),vec3f(232,247,126));}
  if(params.palette>7.5){c=array<vec3f,3>(vec3f(255,204,69),vec3f(234,67,131),vec3f(120,243,161));}
  return c[layer]/255.0;
}

fn pal(x:f32)->vec3f {
  if(params.palette>10.5){return vec3f(0.5+0.5*cos(TAU*x));}
  if(params.palette>9.5){return 0.5+0.5*cos(TAU*(vec3f(1.0,1.0,0.5)*x+vec3f(0.8,0.9,0.3)));}
  if(params.palette>8.5){return 0.5+0.5*cos(TAU*(x+vec3f(0.0,0.33,0.67)));}
  let f=fract(x)*3.0;
  let i=u32(f)%3u;
  return mix(colors(i),colors((i+1u)%3u),smoothstep(0.0,1.0,fract(f)));
}

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let t=params.phase+params.offset;
  let c=cos(params.rotation); let s=sin(params.rotation);
  let screen=vec2f((uv.x-0.5)*params.aspect,uv.y-0.5)*2.0;
  let p=vec2f(c*screen.x-s*screen.y,s*screen.x+c*screen.y)*params.scale;
  let n=round(params.symmetry);
  let flow=round(params.flow)*t;
  var v=0.0;
  for(var i=0;i<15;i++){
    let k=f32(i);
    if(k>=n){break;}
    let a=PI*k/n;
    // Twist spreads each wave's phase so the pattern turns instead of only pulsing.
    v+=cos(dot(p,vec2f(cos(a),sin(a)))+flow+params.twist*TAU*k/n);
  }
  let sum=v/n;
  // Filter contour bands that are finer than a pixel.
  let band=sum*params.bands;
  let aa=fwidth(band);
  let contour=mix(0.5+0.5*cos(band),0.5,smoothstep(0.6,2.2,aa));
  let col=pal(sum*params.spread+round(params.cycles)*t/TAU)*contour;
  return vec4f(col,1.0);
}
