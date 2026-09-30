// Deterministic toroidal Voronoi mosaic. Fixed upper bound: 48 sites per fragment.
struct Params {
  phase:f32, aspect:f32, sites:f32, seed:f32, stretch:f32, motion:f32,
  law:f32, edge:f32, fill:f32, palette:f32, offset:f32
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

fn hash(value:u32)->f32 {
  var x=value;
  x=(x^(x>>16u))*0x7feb352du;
  x=(x^(x>>15u))*0x846ca68bu;
  x=x^(x>>16u);
  return f32(x&0x00ffffffu)/16777216.0;
}

fn sitePosition(id:u32,t:f32)->vec2f {
  let key=id*11u+u32(params.seed)*131u+97u;
  let origin=vec2f(hash(key),hash(key+1u));
  let theta=hash(key+2u)*6.28318530718;
  let radius=(0.025+0.095*hash(key+3u))*params.motion;
  var drift=vec2f(cos(t+theta),sin(t+theta));
  if(params.law>0.5){drift=vec2f(sin(t+theta),sin(2.0*t+theta))*0.85;}
  if(params.law>1.5){
    let direction=select(-1.0,1.0,(id&1u)==0u);
    drift=vec2f(cos(direction*t+theta),sin(direction*t+theta));
  }
  return fract(origin+radius*drift);
}

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let t=params.phase+params.offset;
  let q=vec2f((uv.x-0.5)*params.aspect/max(params.stretch,0.4),uv.y-0.5);
  let footprint=max(length(fwidth(q))*0.7,0.0001);
  var near=4.0;
  var next=4.0;
  var nearDelta=vec2f(0.0);
  var nextDelta=vec2f(0.0);
  var winner=0u;
  let count=u32(clamp(round(params.sites),8.0,48.0));
  for(var i=0u;i<48u;i++) {
    if(i>=count){break;}
    let delta=fract(sitePosition(i,t)-q+0.5)-0.5;
    let distance=dot(delta,delta);
    if(distance<near){
      next=near;
      nextDelta=nearDelta;
      near=distance;
      nearDelta=delta;
      winner=i;
    }else if(distance<next){
      next=distance;
      nextDelta=delta;
    }
  }
  // Bisector distance, not the unnormalized F2-F1 field: thinner cells keep a readable seam.
  let boundary=max((next-near)/(2.0*max(length(nextDelta-nearDelta),0.0001)),0.0);
  let interior=smoothstep(params.edge,params.edge+footprint,boundary);
  let identity=hash(winner*11u+u32(params.seed)*131u+104u);
  let pigment=mix(colors(0u),colors(1u),identity);
  let lit=mix(pigment,colors(2u),smoothstep(0.72,1.0,identity)*0.7);
  let facet=0.76+0.24*clamp(0.5+dot(nearDelta,vec2f(-3.0,2.0)),0.0,1.0);
  let ink=vec3f(0.008,0.01,0.018);
  // Fill=0 leaves membranes; Fill=1 produces solid stained-glass polygons.
  let membrane=colors(2u)*0.75;
  let edgeColor=mix(membrane,ink,params.fill);
  let centerColor=mix(ink,lit*facet,params.fill);
  return vec4f(mix(edgeColor,centerColor,interior),1.0);
}
