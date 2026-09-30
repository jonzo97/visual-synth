// Two breathing cellular fields. All animation is periodic in the supplied phase.
struct Params { phase:f32, aspect:f32, density:f32, fold:f32, palette:f32, offset:f32, ratio:f32, morph:f32 }
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

fn cell(q:vec2f, pulse:f32)->f32 {
  let local=fract(q+0.5)-0.5;
  let aa=max(length(fwidth(q))*0.55,0.015);
  let grid=1.0-smoothstep(0.028,0.028+aa,min(abs(local.x),abs(local.y)));
  let radius=length(local);
  let dots=1.0-smoothstep(0.07+0.065*pulse,0.07+0.065*pulse+aa,radius);
  let rings=1.0-smoothstep(0.025,0.025+aa,abs(radius-(0.23+0.08*pulse)));
  let shape=mix(mix(grid,dots,smoothstep(0.0,0.5,params.morph)),rings,smoothstep(0.5,1.0,params.morph));
  // Fade subpixel cells toward average coverage to tame distant moiré flicker.
  return mix(shape,0.16,smoothstep(0.5,1.0,aa));
}

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let t=params.phase;
  let p=vec2f((uv.x-0.5)*params.aspect,uv.y-0.5);
  let turn=0.3*sin(t)+params.offset;
  var q=vec2f(cos(turn)*p.x-sin(turn)*p.y,sin(turn)*p.x+cos(turn)*p.y);
  q+=params.fold*0.12*vec2f(sin(p.y*8.0+sin(t)),cos(p.x*7.0+cos(t)));
  let breathe=1.0+0.12*sin(t);
  let a=q*params.density*breathe;
  let b=vec2f(q.x*0.8-q.y*0.6,q.x*0.6+q.y*0.8)*params.density*params.ratio
    +vec2f(sin(t),cos(t))*0.6;
  let pulse=0.5+0.5*sin(length(p)*12.0-t+params.offset);
  let first=cell(a,pulse);
  let second=cell(b,1.0-pulse);
  let interference=0.5+0.5*cos((length(p-vec2f(0.25,0.0))-length(p+vec2f(0.25,0.0)))*22.0+sin(t));
  let vignette=exp(-dot(p,p)*0.9);
  let rgb=vec3f(0.013,0.012,0.035)+vignette*(colors(0u)*first*(0.5+0.35*interference)
    +colors(1u)*second*(0.3+0.35*pulse)+colors(2u)*first*second*0.7);
  return vec4f(rgb,1.0);
}
