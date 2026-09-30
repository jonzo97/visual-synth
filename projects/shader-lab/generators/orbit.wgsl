// Three analytic rosette fields. All motion closes at phase + 2pi.
struct Params {
  phase:f32, aspect:f32, density:f32, petals:f32, morph:f32,
  fold:f32, orbit:f32, glow:f32, palette:f32, offset:f32
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

fn bloom(p:vec2f,t:f32,layer:f32)->f32 {
  let phi=layer*2.0943951;
  let center=params.orbit*0.19*vec2f(cos(t+phi),sin(t+phi));
  let q=p-center;
  let radius=length(q);
  // The small epsilon keeps atan2 defined at the exact central pixel.
  let theta=atan2(q.y,q.x+0.000001);
  let turn=0.18*sin(t+phi)+phi;
  let curl=params.fold*3.0*sin(radius*5.0+sin(t+phi));
  // Integer angular harmonics avoid a seam along atan2's branch cut.
  let petal=cos(round(params.petals)*(theta+turn)+curl);
  let shape=radius/(1.0+0.23*params.morph*petal);
  let shells=shape*params.density*(1.0+0.045*sin(t+phi));
  let distance=abs(fract(shells)-0.5);
  let aa=max(fwidth(shells),0.002);
  let width=0.035;
  let line=1.0-smoothstep(width,width+aa,distance);
  let halo=exp(-distance*distance/0.014)*params.glow*0.28;
  // Unresolvable frequencies become average coverage instead of flickering.
  let filtered=mix(line+halo,0.1+params.glow*0.08,smoothstep(0.25,0.75,aa));
  return filtered*smoothstep(0.012,0.055,radius)*exp(-shape*shape*1.7);
}

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let p=vec2f((uv.x-0.5)*params.aspect,uv.y-0.5)*1.55;
  let t=params.phase+params.offset;
  let a=bloom(p,t,0.0);
  let b=bloom(p,t,1.0);
  let c=bloom(p,t,2.0);
  let overlap=(a*b+b*c+c*a)*0.12;
  let rgb=vec3f(0.009,0.008,0.021)+0.64*(colors(0u)*a+colors(1u)*b+colors(2u)*c)
    +vec3f(0.75,0.8,1.0)*overlap;
  return vec4f(rgb,1.0);
}
