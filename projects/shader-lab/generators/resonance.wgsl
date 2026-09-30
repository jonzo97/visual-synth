// Modal artwork inspired by standing plates, not a material/sand simulation.
// Spatial nodes are phase-independent. Persisted ADSR -> gain supplies real strikes.
struct Params {
  phase:f32, aspect:f32, modeX:f32, modeY:f32, balance:f32, exciteX:f32,
  exciteY:f32, damping:f32, width:f32, gain:f32, palette:f32, offset:f32
}
@group(0) @binding(0) var<uniform> params:Params;

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

fn mode(p:vec2f,m:f32,n:f32)->f32 {
  return cos(m*3.14159265359*p.x)*cos(n*3.14159265359*p.y);
}

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  // Use a square metric in the image; crop/reveal the plate with the viewport aspect.
  let p=vec2f((uv.x-0.5)*params.aspect+0.5,uv.y);
  let m=clamp(round(params.modeX),1.0,12.0);
  let n=clamp(round(params.modeY),1.0,12.0);
  // A nonzero base component preserves a useful pattern even when both indices match.
  let a=mode(p,m,n);
  let b=mode(p,n,m);
  let distinct=select(1.0,0.0,m==n);
  let field=(a-distinct*params.balance*b)/(1.0+distinct*params.balance);
  let footprint=max(fwidth(field),0.0001);
  let aa=max(footprint*0.7,0.0005);
  let seams=1.0-smoothstep(params.width,params.width+aa,abs(field));
  // When modal lines exceed pixel resolution, replace them by mean field coverage.
  let resolved=mix(seams,clamp(params.width*2.0,0.0,1.0),smoothstep(0.4,1.0,footprint));
  let excitation=vec2f(params.exciteX,params.exciteY);
  let coupling=abs(mode(excitation,m,n)-distinct*params.balance*mode(excitation,n,m))/(1.0+distinct*params.balance);
  // Damping attenuates higher modes; event decay belongs to a recorded envelope, not a clock here.
  let energy=params.gain*(0.35+0.65*coupling)*exp(-params.damping*sqrt(m*m+n*n)*0.2);
  let vibration=cos(params.phase+params.offset);
  let lobe=mix(colors(0u),colors(1u),0.5+0.5*field*vibration);
  let plate=lobe*(0.055+0.24*abs(field)*(0.65+0.35*abs(vibration)));
  let rgb=energy*(plate+resolved*(colors(2u)*0.9+colors(1u)*0.16));
  return vec4f(rgb,1.0);
}
