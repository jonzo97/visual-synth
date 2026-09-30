// Spatial PM and signed ring modulation, before palette mapping. Time loops at 2π.
struct Params {
 phase:f32, aspect:f32, mode:f32, carrier:f32, modulator:f32,
 frequency:f32, ratio:f32, depth:f32, angle:f32, crossing:f32,
 offset:f32, smoothing:f32, width:f32, palette:f32
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
// Finite Fourier waveforms. Suppress unresolved harmonics using pixel footprint.
fn wave(phase:f32, shape:f32, footprint:f32)->f32 {
 var value=0.0;
 for(var n=1; n<=9; n++) {
  let h=f32(n);
  var coefficient=select(0.0,1.0,n==1);
  if(shape>0.5 && shape<1.5) {
   coefficient=select(0.0,0.810569*cos((h-1.0)*1.570796)/(h*h),n%2==1);
  }
  if(shape>1.5 && shape<2.5) {coefficient=0.63662*select(-1.0,1.0,n%2==1)/h;}
  if(shape>2.5) {coefficient=select(0.0,1.27324/h,n%2==1);}
  let cutoff=1.0-smoothstep(1.4,3.141593,footprint*h);
  value+=sin(phase*h)*coefficient*cutoff*exp(-params.smoothing*(h-1.0)*0.6);
 }
 return value;
}
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
 let p=(uv-0.5)*vec2f(params.aspect,1.0);
 let carrierPhase=dot(p,vec2f(cos(params.angle),sin(params.angle)))*params.frequency*6.283185-params.phase;
 let modPhase=dot(p,vec2f(cos(params.crossing),sin(params.crossing)))*params.frequency*params.ratio*6.283185+params.phase+params.offset;
 let modulation=wave(modPhase,params.modulator,fwidth(modPhase));
 let bentPhase=carrierPhase+params.depth*modulation;
 let pm=wave(bentPhase,params.carrier,fwidth(bentPhase));
 let carrier=wave(carrierPhase,params.carrier,fwidth(carrierPhase));
 // Depth is radians for PM; in ring mode 0..1 introduces multiplication, >1 drives it.
 let ring=carrier*mix(1.0,modulation,min(params.depth,1.0))*max(params.depth,1.0);
 let value=select(pm,ring,params.mode>0.5);
 let aa=max(fwidth(value),0.002);
 let ink=1.0-smoothstep(params.width,params.width+aa,abs(value));
 let pigment=mix(colors(0u),colors(1u),0.5+0.5*modulation);
 let ground=vec3f(0.008,0.009,0.018)+colors(2u)*0.018;
 return vec4f(ground+ink*pigment+colors(2u)*0.07*exp(-abs(value)*3.0),1.0);
}
