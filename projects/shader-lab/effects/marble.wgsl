struct Params {
  amount:f32, strength:f32, warp:f32, scale:f32, flow:f32, veins:f32, bands:f32,
  phase:f32, width:f32, height:f32, valid:f32, hasField:f32, hasMask:f32, head:f32, count:f32,
}
@group(0) @binding(0) var src:texture_2d<f32>;
@group(0) @binding(5) var samp:sampler;
@group(0) @binding(6) var<uniform> params:Params;

fn reflect01(v:f32)->f32 { return 1.0-abs(2.0*fract(v*0.5)-1.0); }
fn hash(q:vec2f)->f32 {
  var p=fract(q*vec2f(123.34,456.21));
  p+=dot(p,p+45.32);
  return fract(p.x*p.y);
}
fn noise(p:vec2f)->f32 {
  let i=floor(p); let f=fract(p); let u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2f(1,0)),u.x),mix(hash(i+vec2f(0,1)),hash(i+vec2f(1,1)),u.x),u.y);
}
fn fbm(q:vec2f)->f32 {
  var p=q; var v=0.0; var a=0.5;
  let m=mat2x2f(1.6,1.2,-1.2,1.6);
  for (var i=0;i<5;i++) { v+=a*noise(p); p=m*p; a*=0.5; }
  return v;
}

// Ink marbling (ebru) as a coordinate warp: domain-warped fBm, noise bending noise, displaces
// where the input is sampled, so any source is dragged into marbled veins. Flow walks a closed
// circle through noise space: periodic at phase + 2pi.
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let base=textureSampleLevel(src,samp,uv,0);
  if (params.amount <= 0.0) { return base; }
  let aspect=params.width/max(params.height,1.0);
  let q=(uv-vec2f(0.5))*vec2f(aspect,1.0)*params.scale;
  let orbit=params.flow*vec2f(cos(params.phase),sin(params.phase));
  let w1=vec2f(fbm(q+orbit),fbm(q+vec2f(5.2,1.3)-orbit.yx));
  let w2=vec2f(fbm(q+params.warp*w1+vec2f(1.7,9.2)+orbit*0.5),fbm(q+params.warp*w1+vec2f(8.3,2.8)));
  let f=fbm(q+params.warp*w2);
  // Centered displacement so zero warp strength is the identity.
  let d=(w2-vec2f(0.5))*2.0*params.strength/vec2f(aspect,1.0);
  let s=uv+d;
  var col=textureSampleLevel(src,samp,vec2f(reflect01(s.x),reflect01(s.y)),0).rgb;
  // Ink veins: thin bright/dark lines on the fBm contours, like combed ebru paper.
  let b=f*params.bands;
  let band=fract(b);
  let aa=max(fwidth(b),1e-4);
  let vein=1.0-smoothstep(0.0,aa*1.5,min(band,1.0-band));
  col=mix(col,col*0.35+vec3f(0.06),vein*params.veins);
  col=mix(col,vec3f(0.95,0.92,0.85),vein*params.veins*0.35*step(0.5,fract(floor(b)*0.5)));
  return vec4f(mix(base.rgb,col,clamp(params.amount,0.0,1.0)),base.a);
}
