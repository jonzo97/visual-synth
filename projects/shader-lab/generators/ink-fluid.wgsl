// Ink in Water, velocity passes (fragment). Texture channels: xy velocity in cells per tick,
// z pressure. mode 0 = advect + stirrer forces + vorticity confinement + touch push,
// 1 = one Jacobi pressure iteration, 2 = subtract the pressure gradient, 3 = clear.
struct Params {
  grid:f32, curl:f32, stir:f32, emitters:f32, swirl:f32, drag:f32, tick:f32, mode:f32,
  injectX:f32, injectY:f32, radius:f32, amount:f32,
}
@group(0) @binding(0) var vel:texture_2d<f32>;
@group(0) @binding(1) var<uniform> params:Params;

const TAU:f32 = 6.28318530718;

fn at(q:vec2i)->vec4f { let n=i32(params.grid); return textureLoad(vel,(q%vec2i(n)+vec2i(n))%vec2i(n),0); }
// Bilinear sample in cell coordinates, wrapping (the tank is a torus).
fn bilerp(p:vec2f)->vec4f {
  let f=p-0.5; let i=vec2i(floor(f)); let w=fract(f);
  return mix(mix(at(i),at(i+vec2i(1,0)),w.x),mix(at(i+vec2i(0,1)),at(i+vec2i(1,1)),w.x),w.y);
}
fn curlAt(q:vec2i)->f32 { return (at(q+vec2i(1,0)).y-at(q-vec2i(1,0)).y-at(q+vec2i(0,1)).x+at(q-vec2i(0,1)).x)*0.5; }

// Stirrer k: a point orbiting on an integer-ratio Lissajous path, and its velocity.
fn stirrer(k:u32, t:f32)->vec4f {
  let n=max(round(params.emitters),1.0);
  let o=f32(k)*TAU/n;
  let a=vec2f(1.0+f32(k%2u),1.0+f32((k+1u)%3u));
  let pos=vec2f(0.5)+0.3*vec2f(cos(a.x*t+o),sin(a.y*t+o*1.3));
  let v=0.3*vec2f(-a.x*sin(a.x*t+o),a.y*cos(a.y*t+o*1.3));
  return vec4f(pos,v);
}

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let g=params.grid;
  let q=vec2i(clamp(uv,vec2f(0.0),vec2f(0.99999))*g);
  let here=at(q);
  let mode=u32(round(params.mode));
  if (mode==3u) { return vec4f(0.0); }
  if (mode==1u) {
    let div=(at(q+vec2i(1,0)).x-at(q-vec2i(1,0)).x+at(q+vec2i(0,1)).y-at(q-vec2i(0,1)).y)*0.5;
    let p=(at(q+vec2i(1,0)).z+at(q-vec2i(1,0)).z+at(q+vec2i(0,1)).z+at(q-vec2i(0,1)).z-div)*0.25;
    return vec4f(here.xy,p,0.0);
  }
  if (mode==2u) {
    let grad=vec2f(at(q+vec2i(1,0)).z-at(q-vec2i(1,0)).z,at(q+vec2i(0,1)).z-at(q-vec2i(0,1)).z)*0.5;
    return vec4f(here.xy-grad,here.z,0.0);
  }
  // Semi-Lagrangian advection: fetch the velocity that arrives here this tick.
  let cell=vec2f(q)+0.5;
  var v=bilerp(cell-here.xy).xy*params.drag;
  // Vorticity confinement pushes swirls back up, keeping small eddies alive.
  let c=curlAt(q);
  let grad=vec2f(abs(curlAt(q+vec2i(1,0)))-abs(curlAt(q-vec2i(1,0))),abs(curlAt(q+vec2i(0,1)))-abs(curlAt(q-vec2i(0,1))))*0.5;
  let len=length(grad);
  if (len>1e-5) { v+=params.curl*0.02*vec2f(grad.y,-grad.x)/len*c; }
  // Orbiting stirrers drag the water along their paths.
  let t=params.tick/60.0*params.swirl;
  let p=uv;
  for (var k=0u;k<4u;k++) {
    if (f32(k)>=round(params.emitters)) { break; }
    let s=stirrer(k,t);
    var d=p-s.xy; d-=round(d);
    let w=exp(-dot(d,d)/(0.0025));
    v+=s.zw*params.stir*w*g*0.004;
  }
  if (params.radius>0.0) {
    var d=p-vec2f(params.injectX,params.injectY); d-=round(d);
    let w=exp(-dot(d,d)/(params.radius*params.radius));
    // Touch spins the water around the pointer.
    v+=vec2f(-d.y,d.x)/max(length(d),1e-4)*w*params.amount*2.0;
  }
  let speed=length(v);
  if (speed>4.0) { v*=4.0/speed; }
  // Keep last tick's pressure: it warm-starts this tick's Jacobi solve (deterministic).
  return vec4f(v,here.z,0.0);
}
