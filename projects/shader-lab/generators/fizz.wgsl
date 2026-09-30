// Frost Fizz: a chilled aluminium can surface (brushed metal, cylinder shading, a glint
// that sweeps around), torn silver scratches, condensation beads and rising carbonation.
// Every moving part advances by whole turns of phase, so the loop is exact.
struct Params {
  phase:f32, aspect:f32, palette:f32, fizz:f32, bubbleSize:f32, rise:f32, frost:f32, claws:f32,
  clawDepth:f32, slant:f32, brushed:f32, glint:f32, light:f32, offset:f32
}
@group(0) @binding(0) var<uniform> params:Params;

const TAU:f32 = 6.28318530718;

fn hash21(p:vec2f)->f32 { var q=fract(p*vec2f(123.34,456.21)); q+=dot(q,q+45.32); return fract(q.x*q.y); }
fn hash22(p:vec2f)->vec2f { let h=hash21(p); return vec2f(h,hash21(p+h*17.0)); }
fn vnoise(p:vec2f)->f32 {
  let i=floor(p); let f=fract(p); let u=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2f(1,0)),u.x),mix(hash21(i+vec2f(0,1)),hash21(i+vec2f(1,1)),u.x),u.y);
}

struct Look { can:vec3f, claw:vec3f, bubble:vec3f, tint:vec3f }
fn look()->Look {
  let k=u32(round(params.palette));
  if (k==1u) { return Look(vec3f(0.93,0.96,0.99),vec3f(0.45,0.72,0.95),vec3f(0.80,0.93,1.0),vec3f(0.85,0.93,1.0)); }
  if (k==2u) { return Look(vec3f(0.16,0.17,0.19),vec3f(0.86,0.88,0.90),vec3f(0.95,0.97,1.0),vec3f(0.55,0.60,0.66)); }
  return Look(vec3f(0.95,0.95,0.94),vec3f(0.62,0.64,0.66),vec3f(0.97,0.98,1.0),vec3f(0.92,0.94,0.96));
}

// Signed horizontal distance to scratch k: a slanted, torn stroke that tapers toward its ends.
fn claw(p:vec2f, k:f32, n:f32)->vec2f {
  let spacing=0.34;
  let cx=(k-(n-1.0)*0.5)*spacing+params.slant*p.y;
  let tear=0.018*(abs(sin(p.y*23.0+k*3.1))+abs(sin(p.y*57.0+k*1.7))*0.6)+0.01*vnoise(vec2f(k*9.0,p.y*40.0));
  let len=0.78-0.06*abs(k-(n-1.0)*0.5);
  let taper=clamp(1.0-pow(abs(p.y)/len,6.0),0.0,1.0);
  let w=(0.055+0.03*sin(p.y*3.0+k))*taper;
  return vec2f(p.x-cx-tear,w);
}

// One layer of carbonation: a grid of cells scrolled upward a whole number of cells per loop.
fn bubbles(uv:vec2f, rows:f32, rise:f32, t:f32, seed:f32, aspect:f32)->vec4f {
  let cols=rows*aspect;
  var q=vec2f(uv.x*cols,uv.y*rows+rise*rows*t/TAU);
  var acc=vec4f(0.0);
  let base=floor(q);
  for (var dy=-1;dy<=1;dy++) {
    for (var dx=-1;dx<=1;dx++) {
      let cell=base+vec2f(f32(dx),f32(dy));
      // The field scrolls rise*rows cells per loop; hashing cell.y modulo that period makes the
      // same bubbles return after one loop.
      let period=rise*rows;
      let wrapped=vec2f(cell.x,cell.y-floor(cell.y/period)*period);
      let h=hash22(wrapped+seed);
      if (hash21(wrapped+seed*3.1)>params.fizz) { continue; }
      let r=(0.12+0.28*h.y)*params.bubbleSize;
      // Bubbles wobble side to side as they rise: sin(2t) repeats exactly at t + 2π.
      let wob=0.18*sin(wrapped.y*1.7+h.x*TAU+2.0*t);
      let c=cell+vec2f(0.5+(h.x-0.5)*0.5+wob,0.5);
      let d=length(q-c);
      if (d<r) {
        let e=d/r;
        let rim=smoothstep(0.72,0.98,e)*(1.0-smoothstep(0.98,1.0,e));
        let spec=exp(-dot(q-c-vec2f(-0.35,-0.4)*r,q-c-vec2f(-0.35,-0.4)*r)/(r*r*0.02));
        acc=max(acc,vec4f(rim*0.9+spec,0.08+rim*0.5,spec,1.0));
      }
    }
  }
  return acc;
}

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let L=look();
  let t=params.phase+params.offset;
  let a=params.aspect;
  let p=vec2f((uv.x-0.5)*a,0.5-uv.y)*2.0;

  // Cylinder: the frame is the front of a can; normal bends away toward the sides.
  let cx=clamp(p.x/(a*0.98),-0.999,0.999);
  let n=vec3f(cx,0.0,sqrt(1.0-cx*cx));
  let glintAngle=params.light+round(params.glint)*params.phase;
  let lightDir=normalize(vec3f(sin(glintAngle),0.35,cos(glintAngle)));
  let diffuse=0.55+0.45*max(dot(n,lightDir),0.0);
  let spec=pow(max(dot(reflect(-lightDir,n),vec3f(0,0,1)),0.0),40.0);

  // Brushed aluminium: fine circumferential streaks.
  let streak=vnoise(vec2f(p.x*2.0,p.y*420.0))*0.6+vnoise(vec2f(p.x*9.0,p.y*1300.0))*0.4;
  var col=L.can*diffuse*(1.0-0.07*params.brushed*(streak-0.5)*2.0)+vec3f(spec)*0.55;
  // Rim darkening toward the can's silhouette.
  col*=0.78+0.22*n.z;

  // Scratches: embossed silver with a bevel lit from the glint side.
  let count=round(params.claws);
  for (var k=0.0;k<5.0;k+=1.0) {
    if (k>=count) { break; }
    let c=claw(p,k,count);
    let inside=1.0-smoothstep(c.y-0.004,c.y+0.004,abs(c.x));
    if (inside>0.0) {
      let edge=clamp(abs(c.x)/max(c.y,1e-4),0.0,1.0);
      let bevel=sign(c.x)*sign(lightDir.x+1e-3)*smoothstep(0.55,1.0,edge);
      let metal=L.claw*(0.85+0.3*streak)*(1.0+0.35*bevel*params.clawDepth)+vec3f(spec)*0.8;
      col=mix(col,metal,inside);
    }
    // A soft shadow just outside the scratch lip.
    let lip=smoothstep(c.y+0.03,c.y,abs(c.x))*(1.0-inside);
    col*=1.0-0.12*params.clawDepth*lip;
  }

  // Condensation: static beads plus a few runners that slide down whole screens per loop.
  let frost=params.frost;
  let g=vec2f(uv.x*a,uv.y)*22.0;
  let cell=floor(g); let h=hash22(cell);
  if (hash21(cell+7.7)<frost*0.45) {
    let c=cell+0.3+0.4*h; let r=0.18+0.22*hash21(cell+3.3);
    let d=length(g-c)/r;
    if (d<1.0) {
      // A clear bead: slightly brighter body, a thin shadowed lower lip and a sharp highlight.
      let lower=smoothstep(0.75,1.0,d)*step(c.y,g.y);
      let hi=exp(-dot(g-c-vec2f(-0.3,-0.35)*r,g-c-vec2f(-0.3,-0.35)*r)/(r*r*0.03));
      let bead=mix(col*1.04+L.tint*0.04,col*0.8,lower)+vec3f(hi)*0.7;
      col=mix(col,bead,smoothstep(1.0,0.85,d));
    }
  }
  let runnerCols=vec2f(uv.x*a*9.0,0.0);
  let lane=floor(runnerCols.x); let lh=hash21(vec2f(lane,5.0));
  if (lh<frost*0.35) {
    let y=fract(lh*13.0+t/TAU*round(1.0+lh*2.0));
    let dxr=fract(runnerCols.x)-0.5; let dyr=uv.y-y;
    let trail=smoothstep(0.08,0.0,abs(dxr))*smoothstep(0.0,-0.35,dyr)*(1.0-smoothstep(-0.35,-0.36,dyr));
    col=mix(col,L.tint*0.9,trail*0.35);
    let drop=smoothstep(0.02,0.0,length(vec2f(dxr/(9.0),dyr)))*1.0;
    col+=vec3f(drop*0.35);
  }
  // A cold haze near the top and bottom rims.
  col=mix(col,L.tint,frost*0.18*smoothstep(0.55,1.0,abs(p.y)));

  // Carbonation in three parallax layers; tiny fast bubbles in front, large slow ones behind.
  let rise=max(round(params.rise),1.0);
  let b1=bubbles(uv,26.0,rise*2.0,t,1.0,a);
  let b2=bubbles(uv,14.0,rise,t,7.0,a);
  let b3=bubbles(uv,8.0,max(rise-1.0,1.0),t,13.0,a);
  for (var i=0;i<3;i++) {
    var b=b1; if (i==1) { b=b2; } if (i==2) { b=b3; }
    let alpha=clamp(b.x,0.0,1.0)*b.w;
    col=mix(col,L.bubble,alpha*0.75)+vec3f(b.z)*0.5;
    col=mix(col,col*0.94,b.y*b.w*0.5);
  }
  return vec4f(clamp(col,vec3f(0.0),vec3f(1.2)),1.0);
}
