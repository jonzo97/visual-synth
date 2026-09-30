// Slime Mold Wars, display: each species' trail glows in its palette colour; where species
// meet the colours add, and dense veins bloom toward white.
struct Params {
  phase:f32, aspect:f32, seed:f32, grid:f32, palette:f32, species:f32, agents:f32,
  sensorAngle:f32, sensorDistance:f32, turn:f32, speed:f32, deposit:f32, aggression:f32,
  decay:f32, diffuse:f32, steps:f32, exposure:f32,
}
@group(0) @binding(0) var state:texture_2d<f32>;
@group(0) @binding(1) var<uniform> params:Params;

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

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let size=vec2f(textureDimensions(state));
  // Cover the frame with the square field (crop, no stretch).
  let a=params.aspect;
  var p=uv;
  if (a>1.0) { p.y=0.5+(uv.y-0.5)/a; } else { p.x=0.5+(uv.x-0.5)*a; }
  // Bilinear taps so the field stays smooth when magnified to the screen.
  let f=p*size-0.5;
  let i=vec2i(floor(f)); let w=fract(f);
  let n=vec2i(size);
  let t00=textureLoad(state,(i+n)%n,0); let t10=textureLoad(state,(i+vec2i(1,0)+n)%n,0);
  let t01=textureLoad(state,(i+vec2i(0,1)+n)%n,0); let t11=textureLoad(state,(i+vec2i(1,1)+n)%n,0);
  let s4=mix(mix(t00,t10,w.x),mix(t01,t11,w.x),w.y);
  let v=s4.rgb*params.exposure*0.04;
  let food=1.0-exp(-s4.a*0.04);
  let lit=vec3f(1.0)-exp(-v);
  var col=colors(0u)*lit.r+colors(1u)*lit.g+colors(2u)*lit.b;
  col+=vec3f(1.0)*pow(max(max(lit.r,lit.g),lit.b),6.0)*0.35;
  // Food glows as warm, faint pollen so the drawing stays visible while colonies arrive.
  col+=vec3f(1.0,0.85,0.55)*food*0.35;
  col=1.0-exp(-col*1.6);
  return vec4f(mix(vec3f(0.01,0.008,0.02),col,clamp(length(col)*1.4,0.0,1.0)),1.0);
}
