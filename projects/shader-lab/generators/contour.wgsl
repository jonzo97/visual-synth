// Analytic liquid height field: no history, noise texture, or wall clock.
// Every temporal input is a periodic function of phase (radians, 2pi per loop).
struct Params {
  phase:f32, aspect:f32, density:f32, scale:f32, fold:f32, drift:f32,
  thickness:f32, fill:f32, offset:f32, palette:f32
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

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let t=params.phase+params.offset;
  let p=vec2f((uv.x-0.5)*params.aspect,uv.y-0.5);
  var q=p*(4.0*params.scale);
  let orbit=params.drift*vec2f(sin(t),cos(t));
  q+=params.fold*1.1*vec2f(
    sin(q.y*1.15+orbit.x)+0.35*cos(q.x*0.9-orbit.y),
    cos(q.x*1.05-orbit.y)+0.35*sin(q.y*0.8+orbit.x)
  );
  let hillA=q-vec2f(-1.2,0.25)-orbit*0.7;
  let hillB=q-vec2f(1.1,-0.6)+vec2f(orbit.y,orbit.x)*0.6;
  let hills=0.72*exp(-dot(hillA,hillA)*0.42)-0.62*exp(-dot(hillB,hillB)*0.5);
  let height=hills+0.48*sin(q.x*0.86+orbit.x*0.55)*cos(q.y*0.91-orbit.y*0.55)
    +0.21*sin(q.x*0.48+q.y*0.71+orbit.y*0.3);
  let bands=height*params.density;
  // Differentiate continuous height, never the discontinuous fract() bands.
  let footprint=max(fwidth(bands),0.0001);
  let aa=max(footprint*0.65,0.008);
  let distance=abs(fract(bands+0.5)-0.5);
  let line=1.0-smoothstep(params.thickness,params.thickness+aa,distance);
  // Fade unresolved contours toward their coverage instead of sparkling.
  let coverage=clamp(params.thickness*2.0,0.0,1.0);
  let contours=mix(line,coverage,smoothstep(0.45,1.1,footprint));
  let coast=0.5+0.5*sin(height*3.5+q.y*0.23);
  let lineColor=mix(colors(0u),colors(1u),coast);
  let poolColor=mix(colors(0u),colors(2u),0.5+0.5*sin(height*5.0+0.8));
  let pool=0.045+0.16*(0.5+0.5*cos(height*4.0));
  let vignette=exp(-dot(p,p)*0.35);
  let rgb=vec3f(0.008,0.011,0.023)+vignette*(lineColor*contours*0.9
    +poolColor*params.fill*pool+colors(2u)*contours*pow(coast,8.0)*0.18);
  return vec4f(rgb,1.0);
}
