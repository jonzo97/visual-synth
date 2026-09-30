// Filled mechanical stencils. Waveforms move solid geometry; time is loop phase only.
struct Params {
  phase:f32, aspect:f32, waveform:f32, density:f32, duty:f32, hold:f32,
  cut:f32, operation:f32, motion:f32, angle:f32, palette:f32, offset:f32
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

fn drive(cycle:f32)->f32 {
  // Eight short holds per cycle, followed by a continuous advance to the next stop.
  let tick=fract(cycle)*8.0;
  let held=(floor(tick)+max(fract(tick)-params.hold,0.0)/max(1.0-params.hold,0.15))/8.0;
  let duty=clamp(params.duty,0.15,0.85);
  var value=select((1.0-held)/(1.0-duty),held/duty,held<duty);
  if(params.waveform>0.5){value=held;}
  if(params.waveform>1.5){value=select(0.0,1.0,held<0.5);}
  if(params.waveform>2.5){value=select(0.0,1.0,held<duty);}
  return value*2.0-1.0;
}

fn box(p:vec2f,extent:vec2f)->f32 {
  let d=abs(p)-extent;
  return length(max(d,vec2f(0.0)))+min(max(d.x,d.y),0.0);
}

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let p=vec2f((uv.x-0.5)*params.aspect,uv.y-0.5);
  let c=cos(params.angle);
  let s=sin(params.angle);
  var grid=vec2f(c*p.x-s*p.y,s*p.x+c*p.y)*params.density;
  // Compute the footprint before floor/fract introduce tile discontinuities.
  let aa=max(length(fwidth(grid))*0.65,0.001);
  grid.x+=floor(grid.y)*0.5;
  let cell=floor(grid);
  let local=fract(grid)-0.5;
  let stagger=fract(cell.x*0.381966+cell.y*0.236068);
  let wave=drive((params.phase+params.offset)/6.28318530718+stagger);
  let travel=wave*params.motion;
  let a=box(local-vec2f(0.035*travel,0.0),vec2f(0.335,0.31+0.065*travel))-0.015;
  // Cutter stays inside the tile even when it becomes a filled union component.
  let cutter=local-vec2f(travel*0.14,-travel*0.08);
  let radius=0.055+params.cut*0.24;
  let circle=length(cutter)-radius;
  let diamond=(abs(cutter.x)+abs(cutter.y)-radius)*0.70710678;
  let b=mix(circle,diamond,step(0.5,fract(stagger*7.0)));
  var stencil=min(a,b);
  if(params.operation>0.5){stencil=max(a,b);}
  if(params.operation>1.5){stencil=max(a,-b);}
  let ink=1.0-smoothstep(-aa,aa,stencil);
  let pigment=mix(colors(0u),colors(1u),smoothstep(0.1,0.9,stagger));
  let paper=vec3f(0.012,0.011,0.016)+colors(2u)*0.025;
  return vec4f(mix(paper,pigment*0.92+colors(2u)*0.05,ink),1.0);
}
