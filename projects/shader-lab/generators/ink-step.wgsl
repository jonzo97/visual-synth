// Ink in Water, dye pass (fragment): advect the dye through the velocity field, fade it, and let
// each orbiting stirrer and touch point release ink in its palette colour.
struct Params {
  seed:f32, grid:f32, palette:f32, curl:f32, stir:f32, emitters:f32, swirl:f32, drag:f32,
  fade:f32, ink:f32, exposure:f32, tick:f32, initialize:f32, injectX:f32, injectY:f32,
  radius:f32, amount:f32,
}
@group(0) @binding(0) var state:texture_2d<f32>;
@group(0) @binding(1) var<uniform> params:Params;
@group(0) @binding(2) var vel:texture_2d<f32>;

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
fn dyeAt(q:vec2i)->vec3f { let n=i32(params.grid); return textureLoad(state,(q%vec2i(n)+vec2i(n))%vec2i(n),0).rgb; }
fn bilerp(p:vec2f)->vec3f {
  let f=p-0.5; let i=vec2i(floor(f)); let w=fract(f);
  return mix(mix(dyeAt(i),dyeAt(i+vec2i(1,0)),w.x),mix(dyeAt(i+vec2i(0,1)),dyeAt(i+vec2i(1,1)),w.x),w.y);
}
// Catmull-Rom bicubic sample, clamped to the 2×2 neighbourhood's range: far less smearing than
// bilinear advection, without overshoot rings.
fn cubic(p:vec2f)->vec3f {
  let f=p-0.5; let i=vec2i(floor(f)); let t=fract(f);
  let t2=t*t; let t3=t2*t;
  let w0=-0.5*t3+t2-0.5*t; let w1=1.5*t3-2.5*t2+1.0; let w2=-1.5*t3+2.0*t2+0.5*t; let w3=0.5*t3-0.5*t2;
  var rows=array<vec3f,4>();
  for (var y=0;y<4;y++) {
    let j=i+vec2i(-1,y-1);
    rows[y]=dyeAt(j)*w0.x+dyeAt(j+vec2i(1,0))*w1.x+dyeAt(j+vec2i(2,0))*w2.x+dyeAt(j+vec2i(3,0))*w3.x;
  }
  let c=rows[0]*w0.y+rows[1]*w1.y+rows[2]*w2.y+rows[3]*w3.y;
  let a=dyeAt(i); let b=dyeAt(i+vec2i(1,0)); let d=dyeAt(i+vec2i(0,1)); let e=dyeAt(i+vec2i(1,1));
  return clamp(c,min(min(a,b),min(d,e)),max(max(a,b),max(d,e)));
}
fn stirrer(k:u32, t:f32)->vec2f {
  let n=max(round(params.emitters),1.0);
  let o=f32(k)*TAU/n;
  let a=vec2f(1.0+f32(k%2u),1.0+f32((k+1u)%3u));
  return vec2f(0.5)+0.3*vec2f(cos(a.x*t+o),sin(a.y*t+o*1.3));
}

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let g=params.grid; let n=i32(g);
  let q=vec2i(clamp(uv,vec2f(0.0),vec2f(0.99999))*g);
  if (params.initialize>0.5 && params.initialize<1.5) { return vec4f(0.0); }
  var dye=dyeAt(q);
  if (params.initialize<0.5) {
    let v=textureLoad(vel,q,0).xy;
    dye=cubic(vec2f(q)+0.5-v)*params.fade;
    let t=params.tick/60.0*params.swirl;
    for (var k=0u;k<4u;k++) {
      if (f32(k)>=round(params.emitters)) { break; }
      var d=uv-stirrer(k,t); d-=round(d);
      dye+=colors(k%3u)*exp(-dot(d,d)/0.0012)*params.ink*0.08;
    }
  }
  if (params.radius>0.0) {
    var d=uv-vec2f(params.injectX,params.injectY); d-=round(d);
    let w=exp(-dot(d,d)/(params.radius*params.radius*0.5));
    // Touch ink cycles through the palette over time.
    let k=u32(params.tick/40.0)%3u;
    dye+=colors(k)*w*params.amount*0.8;
  }
  return vec4f(min(dye,vec3f(8.0)),1.0);
}
