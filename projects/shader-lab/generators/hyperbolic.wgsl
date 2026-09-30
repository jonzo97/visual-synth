// Hyperbolic {p,q} tiling in the Poincare disk, folded into the (pi/p, pi/q, pi/2)
// triangle by reflections. Every temporal input is periodic in phase (2pi per loop).
struct Params {
  phase:f32, aspect:f32, sides:f32, meet:f32, drift:f32, spin:f32, rotation:f32,
  zoom:f32, edge:f32, spread:f32, cycles:f32, palette:f32, offset:f32
}
@group(0) @binding(0) var<uniform> params:Params;

const PI:f32 = 3.14159265359;
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

// Continuous cyclic gradient. 0-8 blend the shared three stops; 9-11 are the page's
// iridescent, stained-glass and luma-only cosine palettes.
fn pal(x:f32)->vec3f {
  if(params.palette>10.5){return vec3f(0.5+0.5*cos(TAU*x));}
  if(params.palette>9.5){return 0.5+0.5*cos(TAU*(vec3f(1.0,1.0,0.5)*x+vec3f(0.8,0.9,0.3)));}
  if(params.palette>8.5){return 0.5+0.5*cos(TAU*(x+vec3f(0.0,0.33,0.67)));}
  let f=fract(x)*3.0;
  let i=u32(f)%3u;
  return mix(colors(i),colors((i+1u)%3u),smoothstep(0.0,1.0,fract(f)));
}

fn cmul(a:vec2f,b:vec2f)->vec2f { return vec2f(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x); }
fn cdiv(a:vec2f,b:vec2f)->vec2f { return vec2f(a.x*b.x+a.y*b.y,a.y*b.x-a.x*b.y)/dot(b,b); }
fn rot(v:vec2f,a:f32)->vec2f { let c=cos(a); let s=sin(a); return vec2f(c*v.x-s*v.y,s*v.x+c*v.y); }

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let t=params.phase+params.offset;
  // Screen height spans [-1,1]; zoom scales the disk.
  let screen=vec2f((uv.x-0.5)*params.aspect,uv.y-0.5)*2.0;
  // Derivatives stay in uniform control flow.
  let px=max(fwidth(screen.y),1e-5)/params.zoom;
  var z=screen/params.zoom;
  let r=length(z);
  if(r>=1.0){return vec4f(0.0,0.0,0.0,1.0);}

  let p=round(params.sides);
  // Hyperbolic needs 1/p + 1/q < 1/2; raise q to the smallest valid value.
  let q=max(round(params.meet),floor(2.0*p/(p-2.0)+1e-4)+1.0);
  // Mobius translation on a closed integer-harmonic path drifts the tiling through the disk.
  var a=params.drift*vec2f(sin(t),sin(2.0*t+1.0));
  if(length(a)>0.92){a=normalize(a)*0.92;}
  z=cdiv(z+a,vec2f(1.0,0.0)+cmul(vec2f(a.x,-a.y),z));
  z=rot(z,params.rotation+round(params.spin)*t);

  let seg=PI/p;
  let sp=sin(seg); let cq=cos(PI/q);
  let rr=1.0/sqrt(cq*cq/(sp*sp)-1.0);      // edge geodesic radius
  let c=vec2f(sqrt(1.0+rr*rr),0.0);         // circle orthogonal to the unit circle
  var inv=0.0; var flips=0.0;
  for(var i=0;i<64;i++){
    var ang=atan2(z.y,z.x);
    ang-=floor(ang/(2.0*seg))*2.0*seg;
    if(ang>seg){ang=2.0*seg-ang; flips+=1.0;}
    z=length(z)*vec2f(cos(ang),sin(ang));
    let w=z-c; let l2=dot(w,w);
    if(l2<rr*rr){z=c+w*(rr*rr/l2); inv+=1.0;} else {break;}
  }
  let parity=inv+flips-2.0*floor((inv+flips)*0.5);
  let edge=abs(length(z-c)-rr);
  let spoke=min(abs(z.y),abs(dot(z,vec2f(-sin(seg),cos(seg)))));
  // Antialias in hyperbolic scale: the metric grows toward the rim.
  let scale=px*2.0*params.edge/max(1.0-r*r,0.02);
  var col=pal(inv*params.spread+round(params.cycles)*t/TAU+parity*0.12);
  col*=0.55+0.45*smoothstep(0.0,0.25,length(z));
  col=mix(col,col*0.35,(1.0-smoothstep(0.0,scale*2.0,spoke))*0.5);
  col=mix(col,vec3f(0.02),(1.0-smoothstep(scale*0.5,scale*2.5,edge)));
  // Tiles smaller than a pixel near the rim average instead of shimmering.
  col=mix(col,pal(round(params.cycles)*t/TAU)*0.3,smoothstep(0.08,0.4,scale));
  return vec4f(col*(1.0-smoothstep(1.0-px*3.0,1.0,r)),1.0);
}
