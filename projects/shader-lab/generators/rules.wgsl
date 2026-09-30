struct Params {phase:f32,aspect:f32,seed:f32,grid:f32,palette:f32,states:f32,threshold:f32,neighborhood:f32,rate:f32}
@group(0) @binding(0) var state:texture_2d<u32>;
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

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {let size=vec2i(textureDimensions(state));let q=clamp(vec2i(uv*vec2f(size)),vec2i(0),size-vec2i(1));let v=f32(textureLoad(state,q,0).x)/max(1.0,params.states-1.0);let band=v*2.0;let col=mix(colors(u32(min(1.0,floor(band)))),colors(u32(min(2.0,floor(band)+1.0))),clamp(band-min(1.0,floor(band)),0.0,1.0));return vec4f(mix(vec3f(.014,.02,.028),col,smoothstep(.015,.55,v)),1);}
