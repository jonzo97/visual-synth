struct Params {
  amount:f32, segments:f32, rotation:f32, zoom:f32, twist:f32,
  phase:f32, width:f32, height:f32, valid:f32, hasField:f32, hasMask:f32, head:f32, count:f32,
}
@group(0) @binding(0) var src:texture_2d<f32>;
@group(0) @binding(5) var samp:sampler;
@group(0) @binding(6) var<uniform> params:Params;

const TAU:f32 = 6.28318530718;

// Mirror-repeat a coordinate into [0,1] so samples past the edge reflect instead of clamping to a streak.
fn reflect01(v:f32)->f32 { return 1.0-abs(2.0*fract(v*0.5)-1.0); }

// Spatial kaleidoscope: the frame is cut into N wedges about the centre and each
// wedge is a mirror of its neighbour, so any source becomes N-fold symmetric.
// Zoom scales the radius; twist rotates the sample angle with radius (a spiral).
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let base=textureSampleLevel(src,samp,uv,0);
  if (params.amount <= 0.0) { return base; }
  let aspect=params.width/max(params.height,1.0);
  let p=(uv-vec2f(0.5))*vec2f(aspect,1.0);
  let r=length(p);
  let n=max(floor(params.segments+0.5),1.0);
  let wedge=TAU/n;
  var a=atan2(p.y,p.x)-params.rotation;
  a=a-wedge*floor(a/wedge);           // angle within the wedge, [0, wedge)
  a=min(a,wedge-a);                    // mirror the second half of the wedge onto the first
  a=a+params.rotation+params.twist*r*TAU*0.5;
  let rr=r/max(params.zoom,0.05);
  let q=vec2f(cos(a),sin(a))*rr/vec2f(aspect,1.0)+vec2f(0.5);
  let sampled=textureSampleLevel(src,samp,vec2f(reflect01(q.x),reflect01(q.y)),0);
  return vec4f(mix(base.rgb,sampled.rgb,clamp(params.amount,0.0,1.0)),base.a);
}
