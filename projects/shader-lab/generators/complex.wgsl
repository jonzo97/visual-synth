// Complex Kaleidoscope: domain coloring of f(z) = Π(z − a) / Π(z − b), ported from the Doodle
// Lab page. Zeros and poles drift on integer-frequency Lissajous orbits, and spin/flow are
// integer turns, so the image is exactly periodic in phase (2π per loop).
struct Params {
  phase:f32, aspect:f32, arrangement:f32, style:f32, spread:f32, lines:f32, warp:f32, iterate:f32,
  drift:f32, spin:f32, flow:f32, zoom:f32, hue:f32, offset:f32
}
@group(0) @binding(0) var<uniform> params:Params;

const TAU:f32 = 6.28318530718;
const LN2:f32 = 0.69314718056;
const N:u32 = 5u;

fn cmul(a:vec2f, b:vec2f)->vec2f { return vec2f(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x); }
fn cinv(a:vec2f)->vec2f { return vec2f(a.x,-a.y)/max(dot(a,a),1e-30); }
fn cexp(a:vec2f)->vec2f { return exp(clamp(a.x,-40.0,40.0))*vec2f(cos(a.y),sin(a.y)); }
fn pal(t:f32)->vec3f { return 0.5+0.5*cos(TAU*(t+params.hue+vec3f(0.0,0.33,0.67))); }
fn polar(r:f32, a:f32)->vec2f { return r*vec2f(cos(a),sin(a)); }

struct Handles { z:array<vec2f,5>, p:array<vec2f,5>, nz:u32, np:u32 }

// Integer orbit frequencies per handle keep the drift periodic.
fn orbit(i:u32, t:f32)->vec2f {
  let k1=f32(1u+(i*7u)%3u); let k2=f32(1u+(i*5u+1u)%3u);
  let p1=f32(i)*2.39996; let p2=f32(i)*1.61803+0.7;
  return 0.16*params.drift*vec2f(cos(k1*t+p1), sin(k2*t+p2));
}

fn handles(t:f32)->Handles {
  var h:Handles;
  let s=params.spread;
  let arrangement=u32(round(params.arrangement));
  if (arrangement==1u) {
    h.nz=5u; h.np=5u;
    for (var k=0u;k<5u;k++) {
      h.z[k]=polar(1.25,TAU*0.25+f32(k)*TAU/5.0);
      h.p[k]=polar(0.6,TAU*0.25+(f32(k)+0.5)*TAU/5.0);
    }
  } else if (arrangement==2u) {
    h.nz=4u; h.np=4u;
    h.z[0]=vec2f(0.5,0.2); h.z[1]=vec2f(-0.3,0.55); h.z[2]=vec2f(-0.4,-0.45); h.z[3]=vec2f(0.25,-0.6);
  } else if (arrangement==3u) {
    h.nz=3u; h.np=2u;
    for (var k=0u;k<3u;k++) { h.z[k]=polar(1.0,f32(k)*TAU/3.0); }
    h.p[0]=vec2f(0.3,0.0); h.p[1]=vec2f(-0.15,0.26);
  } else if (arrangement==4u) {
    h.nz=4u; h.np=3u;
    h.z[0]=vec2f(0.9,0.3); h.z[1]=vec2f(-0.4,0.8); h.z[2]=vec2f(-0.7,-0.5); h.z[3]=vec2f(0.3,-0.85);
    h.p[0]=vec2f(0.25,0.1); h.p[1]=vec2f(-0.2,-0.2); h.p[2]=vec2f(0.5,0.55);
  } else {
    h.nz=3u; h.np=2u;
    h.z[0]=vec2f(0.0,1.05); h.z[1]=vec2f(-0.95,-0.55); h.z[2]=vec2f(0.95,-0.55);
    h.p[0]=vec2f(-0.45,0.15); h.p[1]=vec2f(0.45,0.15);
  }
  for (var k=0u;k<N;k++) {
    h.z[k]=h.z[k]*s+orbit(k,t);
    h.p[k]=h.p[k]*s+orbit(k+5u,t);
  }
  // Blaschke product: each pole mirrors its (drifted) zero through the unit circle, |f| = 1 there.
  if (arrangement==2u) { for (var k=0u;k<4u;k++) { h.p[k]=h.z[k]/max(dot(h.z[k],h.z[k]),1e-6); } }
  return h;
}

// log f(z) and D = f'/f. Im(log f) is a sum of principal args; every use below is periodic in it.
fn logf(z:vec2f, h:Handles, L:ptr<function,vec2f>, D:ptr<function,vec2f>) {
  var l=vec2f(0.0); var d=vec2f(0.0);
  for (var i=0u;i<N;i++) {
    if (i<h.nz) { let q=z-h.z[i]; l+=vec2f(0.5*log(max(dot(q,q),1e-30)),atan2(q.y,q.x)); d+=cinv(q); }
    if (i<h.np) { let q=z-h.p[i]; l-=vec2f(0.5*log(max(dot(q,q),1e-30)),atan2(q.y,q.x)); d-=cinv(q); }
  }
  *L=l; *D=d;
}

// Box-filtered sawtooth fract(x) over footprint w, fading to its mean when dense.
fn sawAA(x:f32, w0:f32)->f32 {
  let w=max(w0,1e-4);
  let a=x-0.5*w; let b=x+0.5*w;
  let Fa=floor(a)*0.5+0.5*fract(a)*fract(a);
  let Fb=floor(b)*0.5+0.5*fract(b)*fract(b);
  return mix((Fb-Fa)/w,0.5,smoothstep(0.5,1.0,w));
}
fn stripe(x:f32, fx:f32)->f32 {
  let s=clamp(0.5+(0.25-abs(fract(x)-0.5))/max(fx,1e-5),0.0,1.0);
  return mix(s,0.5,smoothstep(0.25,0.7,fx));
}
// Line at every integer of x: a core about wpx pixels wide plus a soft glow.
fn neon(x:f32, fx0:f32, wpx:f32, glowPx:f32)->f32 {
  let fx=max(fx0,1e-6);
  let d=abs(fract(x+0.5)-0.5)/fx;
  let core=1.0-smoothstep(wpx*0.5-0.6,wpx*0.5+0.6,d);
  let glow=exp(-d/glowPx)*0.5;
  return mix(0.25,core+glow,1.0-smoothstep(0.1,0.35,fx));
}

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let t=params.phase+params.offset;
  let screen=vec2f((uv.x-0.5)*params.aspect,0.5-uv.y)*2.0;
  let z=screen*params.zoom;
  let pix=max(length(fwidth(z))*0.7071,1e-6);
  let h=handles(t);

  // Optional warp z -> z^k (k-fold copies); chain factor d(z^k)/dz = k z^k / z.
  var zz=z; var chain=vec2f(1.0,0.0);
  let k=round(params.warp);
  if (k>1.5) {
    let r=max(length(z),1e-12); let a=atan2(z.y,z.x);
    zz=pow(r,k)*vec2f(cos(k*a),sin(k*a));
    chain=k*cmul(zz,cinv(z));
  }
  var L:vec2f; var D:vec2f;
  logf(zz,h,&L,&D);
  D=cmul(D,chain);
  if (params.iterate>0.5) {
    // f(f(z)): (f∘f)'/(f∘f) = (f'/f)(w) · f'(z), with w = f(z) and f'(z) = f(z) · D.
    let w=cexp(L);
    var L2:vec2f; var D2:vec2f;
    logf(w,h,&L2,&D2);
    D=cmul(D2,cmul(w,D));
    L=L2;
  }
  let g=length(D)*pix;
  let lines=params.lines;
  let ph=L.y/TAU+round(params.spin)*t/TAU;
  let m=L.x/LN2-round(params.flow)*t/TAU;
  let fm=g/LN2; let fq=g*max(lines,1.0)/TAU;
  let hue=pal(ph);
  var col:vec3f;
  let style=u32(round(params.style));
  if (style==0u) {
    // Neon grid: dark glass, glowing modulus contours and phase rays in the local hue.
    let saw=sawAA(m,fm);
    let mo=neon(m,fm,2.2,5.0);
    var phl=0.0; if (lines>0.5) { phl=neon(ph*lines,fq,1.6,3.0); }
    col=hue*(0.06+0.32*saw*saw)+hue*mo*1.1+pal(ph+0.5)*phl*0.7;
    col+=vec3f(1.0)*max(mo-0.9,0.0)*0.6;
  } else if (style==1u) {
    // Enhanced phase portrait.
    let saw=sawAA(m,fm);
    var sq=0.5; if (lines>0.5) { sq=sawAA(ph*lines,fq); }
    col=hue*(0.45+0.55*saw)*(0.7+0.45*sq);
  } else {
    // Acid checker: the conformal grid (log|f|, arg f) makes little squares everywhere.
    let n=max(lines,2.0);
    let cu=stripe(m,fm); let cv=stripe(ph*n,fq);
    let chk=cu+cv-2.0*cu*cv;
    let h2=pal(3.0*ph+0.35*floor(m));
    col=mix(hue*0.12,h2*1.15,chk)+pal(ph+0.5)*neon(m,fm,1.4,2.5)*0.35;
  }
  let q=uv-0.5;
  col*=1.0-0.45*dot(q,q);
  col=1.0-exp(-col*1.4);
  return vec4f(pow(col,vec3f(0.92)),1.0);
}
