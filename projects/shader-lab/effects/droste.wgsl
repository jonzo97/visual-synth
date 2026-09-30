struct Params {
  amount:f32, ratio:f32, arms:f32, zoom:f32, spin:f32, outer:f32, soft:f32,
  phase:f32, width:f32, height:f32, valid:f32, hasField:f32, hasMask:f32, head:f32, count:f32,
}
@group(0) @binding(0) var src:texture_2d<f32>;
@group(0) @binding(5) var samp:sampler;
@group(0) @binding(6) var<uniform> params:Params;

const TAU:f32 = 6.28318530718;

fn cmul(a:vec2f,b:vec2f)->vec2f { return vec2f(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x); }
fn cdiv(a:vec2f,b:vec2f)->vec2f { return vec2f(a.x*b.x+a.y*b.y,a.y*b.x-a.x*b.y)/dot(b,b); }
fn cexp(a:vec2f)->vec2f { return exp(a.x)*vec2f(cos(a.y),sin(a.y)); }
fn reflect01(v:f32)->f32 { return 1.0-abs(2.0*fract(v*0.5)-1.0); }

// Sample the input at a point in frame-height units centred on the frame, mirror-repeating
// outside it so wide rings never read a clamped edge. Explicit-LOD sampling is required: the
// seam crossfade calls tap() inside non-uniform branches, where implicit derivatives are invalid.
fn tap(p:vec2f, aspect:f32)->vec4f {
  let uv=vec2f(0.5+p.x/aspect,0.5-p.y);
  return textureSampleLevel(src,samp,vec2f(reflect01(uv.x),reflect01(uv.y)),0);
}

// Droste Zoom: the log-polar (Escher "Print Gallery") map. The ring between r1 = outer/ratio
// and r2 = outer is repeated at every scale; arms > 0 twists the copies into a spiral. Zoom and
// spin are integer turns per loop, so the effect is periodic in phase (2π per loop).
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let base=textureSampleLevel(src,samp,uv,0);
  if (params.amount <= 0.0) { return base; }
  let aspect=params.width/max(params.height,1.0);
  let p=vec2f((uv.x-0.5)*aspect,0.5-uv.y);
  let r=max(length(p),1e-6);
  let S=max(params.ratio,1.05);
  let L=log(S);
  let arms=round(params.arms);
  let alpha=atan(arms*L/TAU);
  var w=vec2f(log(r),atan2(p.y,p.x));
  w=cdiv(w,cos(alpha)*vec2f(cos(alpha),sin(alpha)));
  let t=params.phase;
  w.y+=round(params.spin)*t;
  // Zooming inward by one ratio per turn: the log-radius slides by L each zoom turn.
  let slide=w.x-log(params.outer)+round(params.zoom)*t/TAU*L;
  let k=slide-floor(slide/L)*L;                 // position inside the ring, 0..L
  let ringPoint=cexp(vec2f(log(params.outer)-L+k,w.y));
  var col=tap(ringPoint,aspect);
  // Soften the ring seam: approaching the outer edge blend toward the inner copy, and leaving the
  // inner edge blend toward the outer one, so both sides are an equal 50/50 mix at the seam.
  let soft=clamp(params.soft,0.0,0.5)*L;
  if (soft > 0.0) {
    let outerEdge=smoothstep(L-soft,L,k)*0.5;
    let innerEdge=(1.0-smoothstep(0.0,soft,k))*0.5;
    if (outerEdge > 0.0) { col=mix(col,tap(ringPoint/S,aspect),outerEdge); }
    if (innerEdge > 0.0) { col=mix(col,tap(ringPoint*S,aspect),innerEdge); }
  }
  // Copies deeper than a pixel collapse toward the centre; fade them to the frame's mean tone.
  let px=1.0/max(params.height,1.0);
  let deep=1.0-smoothstep(px*2.0,px*10.0,r);
  col=mix(col,tap(vec2f(0.0),aspect)*0.8,deep);
  return mix(base,col,clamp(params.amount,0.0,1.0));
}
