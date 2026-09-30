struct Params {
  amount:f32, sides:f32, meet:f32, zoom:f32, drift:f32, spin:f32, scale:f32, rotation:f32,
  edge:f32, surround:f32,
  phase:f32, width:f32, height:f32, valid:f32, hasField:f32, hasMask:f32, head:f32, count:f32,
}
@group(0) @binding(0) var src:texture_2d<f32>;
@group(0) @binding(5) var samp:sampler;
@group(0) @binding(6) var<uniform> params:Params;

const PI:f32 = 3.14159265359;

fn reflect01(v:f32)->f32 { return 1.0-abs(2.0*fract(v*0.5)-1.0); }
fn cmul(a:vec2f,b:vec2f)->vec2f { return vec2f(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x); }
fn cdiv(a:vec2f,b:vec2f)->vec2f { return vec2f(a.x*b.x+a.y*b.y,a.y*b.x-a.x*b.y)/dot(b,b); }
fn rot(v:vec2f,a:f32)->vec2f { let c=cos(a); let s=sin(a); return vec2f(c*v.x-s*v.y,s*v.x+c*v.y); }

// Hyperbolic texture map: each pixel of the Poincare disk is folded by reflections into
// the (pi/p, pi/q, pi/2) triangle, and the input frame is sampled there. Neighbouring
// tiles are mirror images, so any source tiles seamlessly toward the rim. Motion uses
// only phase (2pi per loop).
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let base=textureSampleLevel(src,samp,uv,0);
  if (params.amount <= 0.0) { return base; }
  let aspect=params.width/max(params.height,1.0);
  let zoom=max(params.zoom,0.05);
  var z=(uv-vec2f(0.5))*vec2f(aspect,1.0)*2.0/zoom;
  let r=length(z);
  let px=2.0/(max(params.height,1.0)*zoom);
  let outside=base.rgb*clamp(params.surround,0.0,1.0);
  if (r >= 1.0) { return vec4f(mix(base.rgb,outside,clamp(params.amount,0.0,1.0)),base.a); }

  let p=round(params.sides);
  let q=max(round(params.meet),floor(2.0*p/(p-2.0)+1e-4)+1.0);
  let t=params.phase;
  var a=params.drift*vec2f(sin(t),sin(2.0*t+1.0));
  if (length(a) > 0.92) { a=normalize(a)*0.92; }
  z=cdiv(z+a,vec2f(1.0,0.0)+cmul(vec2f(a.x,-a.y),z));
  z=rot(z,round(params.spin)*t);

  let seg=PI/p;
  let sp=sin(seg); let cq=cos(PI/q);
  let rr=1.0/sqrt(cq*cq/(sp*sp)-1.0);
  let c=vec2f(sqrt(1.0+rr*rr),0.0);
  for (var i=0;i<64;i++) {
    var ang=atan2(z.y,z.x);
    ang-=floor(ang/(2.0*seg))*2.0*seg;
    if (ang > seg) { ang=2.0*seg-ang; }
    z=length(z)*vec2f(cos(ang),sin(ang));
    let w=z-c; let l2=dot(w,w);
    if (l2 < rr*rr) { z=c+w*(rr*rr/l2); } else { break; }
  }
  // The triangle's inradius-scale (origin to edge midpoint) maps to scale x half the frame.
  let reach=max(c.x-rr,0.05);
  let local=rot(z/reach,params.rotation)*0.5*params.scale;
  let q2=local/vec2f(aspect,1.0)+vec2f(0.5);
  // Pixel footprint in hyperbolic units, then in input UV. Tiles shrink toward the rim,
  // so a 4-tap box across the footprint stands in for the mip chain frames lack.
  let w=px*2.0/max(1.0-r*r,0.02);
  let foot=w/reach*0.5*params.scale/vec2f(aspect,1.0)*0.5;
  var col=vec3f(0.0);
  for (var k=0;k<4;k++) {
    let o=vec2f(select(-0.5,0.5,(k&1)==1),select(-0.5,0.5,(k&2)==2))*foot;
    let s2=q2+o;
    col+=textureSampleLevel(src,samp,vec2f(reflect01(s2.x),reflect01(s2.y)),0).rgb*0.25;
  }
  // Optional geodesic seams, antialiased in hyperbolic scale.
  let edgeDist=abs(length(z-c)-rr);
  col*=1.0-clamp(params.edge,0.0,1.0)*(1.0-smoothstep(w*0.5,w*2.5,edgeDist));
  // Rim tiles smaller than a pixel fade to the frame average instead of shimmering.
  let avg=(textureSampleLevel(src,samp,vec2f(0.5),0).rgb+textureSampleLevel(src,samp,vec2f(0.25),0).rgb
    +textureSampleLevel(src,samp,vec2f(0.75),0).rgb+textureSampleLevel(src,samp,vec2f(0.25,0.75),0).rgb
    +textureSampleLevel(src,samp,vec2f(0.75,0.25),0).rgb)*0.2;
  col=mix(col,avg,smoothstep(0.1,0.5,w));
  col=mix(outside,col,(1.0-smoothstep(1.0-px*3.0,1.0,r)));
  return vec4f(mix(base.rgb,col,clamp(params.amount,0.0,1.0)),base.a);
}
