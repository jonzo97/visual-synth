// Breathing Julia: a sphere-traced quaternion Julia set (or a Mandelbulb). The Julia constant
// orbits with integer frequencies and the camera turns an integer number of times per loop, so
// the image is exactly periodic in phase (2π per loop).
struct Params {
  phase:f32, aspect:f32, shape:f32, cx:f32, cy:f32, cz:f32, breathe:f32, slice:f32, power:f32,
  orbit:f32, distance:f32, tilt:f32, glow:f32, hue:f32, spread:f32, offset:f32
}
@group(0) @binding(0) var<uniform> params:Params;

const TAU:f32 = 6.28318530718;
const STEPS:i32 = 110;
const ITER:i32 = 10;

fn qmul(a:vec4f, b:vec4f)->vec4f {
  return vec4f(a.x*b.x-dot(a.yzw,b.yzw), a.x*b.yzw+b.x*a.yzw+cross(a.yzw,b.yzw));
}
fn pal(t:f32)->vec3f { return 0.5+0.5*cos(TAU*(t+params.hue+vec3f(0.0,0.33,0.67))); }

fn juliaC(t:f32)->vec4f {
  let b=params.breathe;
  return vec4f(params.cx+0.12*b*cos(t), params.cy+0.12*b*sin(2.0*t), params.cz+0.1*b*sin(t+1.3), 0.08*b*cos(3.0*t));
}

// Distance estimate plus an orbit trap (minimum |q|²) used for colour.
struct Hit { d:f32, trap:f32 }

fn deJulia(p:vec3f, c:vec4f)->Hit {
  var q=vec4f(p,params.slice);
  var dq=vec4f(1.0,0.0,0.0,0.0);
  var trap=1e9;
  var m=dot(q,q);
  for (var i=0;i<ITER;i++) {
    dq=2.0*qmul(q,dq);
    q=qmul(q,q)+c;
    m=dot(q,q);
    trap=min(trap,m);
    if (m>16.0) { break; }
  }
  let r=sqrt(m);
  return Hit(0.5*r*log(max(r,1e-6))/max(length(dq),1e-6), trap);
}

fn deBulb(p:vec3f, t:f32)->Hit {
  let n=params.power+params.breathe*0.8*sin(t);
  var z=p; var dr=1.0; var r=0.0; var trap=1e9;
  for (var i=0;i<ITER;i++) {
    r=length(z);
    if (r>2.0) { break; }
    let th=acos(clamp(z.z/max(r,1e-6),-1.0,1.0))*n;
    let ph=atan2(z.y,z.x)*n;
    dr=pow(r,n-1.0)*n*dr+1.0;
    z=pow(r,n)*vec3f(sin(th)*cos(ph),sin(th)*sin(ph),cos(th))+p;
    trap=min(trap,dot(z,z));
  }
  return Hit(0.5*log(max(r,1e-6))*r/dr, trap);
}

fn scene(p:vec3f, t:f32, c:vec4f)->Hit {
  if (params.shape>0.5) { return deBulb(p,t); }
  return deJulia(p,c);
}

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let t=params.phase+params.offset;
  let c=juliaC(t);
  // Camera on a circle around the set, tilted; `orbit` whole turns per loop.
  let yaw=round(params.orbit)*params.phase+params.offset;
  let pitch=params.tilt;
  let ro=params.distance*vec3f(cos(pitch)*sin(yaw), sin(pitch), cos(pitch)*cos(yaw));
  let fw=normalize(-ro);
  let rt=normalize(cross(vec3f(0.0,1.0,0.0),fw));
  let up=cross(fw,rt);
  let s=vec2f((uv.x-0.5)*params.aspect,0.5-uv.y)*2.0;
  let rd=normalize(fw*1.8+rt*s.x+up*s.y);

  var dist=0.0; var hit=false; var steps=0; var glow=0.0; var trap=1.0;
  for (var i=0;i<STEPS;i++) {
    let h=scene(ro+rd*dist,t,c);
    glow+=exp(-h.d*18.0)*0.02;
    if (h.d<0.0008*dist) { hit=true; trap=h.trap; steps=i; break; }
    dist+=h.d*0.9;
    if (dist>params.distance+3.0) { break; }
    steps=i;
  }
  let bg=pal(0.62+0.1*s.y)*0.05*(1.0-0.4*dot(s,s)*0.25);
  var col=bg+pal(0.15+t/TAU)*glow*params.glow;
  if (hit) {
    let p=ro+rd*dist;
    let e=vec2f(0.0008*max(dist,1.0),0.0);
    let n=normalize(vec3f(
      scene(p+e.xyy,t,c).d-scene(p-e.xyy,t,c).d,
      scene(p+e.yxy,t,c).d-scene(p-e.yxy,t,c).d,
      scene(p+e.yyx,t,c).d-scene(p-e.yyx,t,c).d));
    let light=normalize(vec3f(0.6,0.8,0.4));
    let diff=max(dot(n,light),0.0);
    let rim=pow(1.0-max(dot(n,-rd),0.0),3.0);
    let ao=1.0-f32(steps)/f32(STEPS);
    let base=pal(params.spread*sqrt(trap)+t/TAU);
    col=base*(0.15+0.85*diff)*ao*1.2+pal(0.5+params.spread*trap)*rim*0.8+vec3f(1.0)*pow(max(dot(reflect(rd,n),light),0.0),24.0)*0.35;
    col+=pal(0.15+t/TAU)*glow*params.glow*0.3;
  }
  col=1.0-exp(-col*1.5);
  return vec4f(pow(col,vec3f(0.9)),1.0);
}
