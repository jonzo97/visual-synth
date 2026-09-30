struct Params {
  amount:f32, mode:f32, folds:f32, threshold:f32, offset:f32, channels:f32,
  phase:f32, width:f32, height:f32, valid:f32, hasField:f32, hasMask:f32, head:f32, count:f32,
}
@group(0) @binding(0) var src:texture_2d<f32>;
@group(0) @binding(5) var samp:sampler;
@group(0) @binding(6) var<uniform> params:Params;

fn transfer(value:f32)->f32 {
  let x=clamp(value,0.0,1.0);
  if (params.mode > 0.5) {
    // Triangle transfer is continuous at every fold, with no quantization.
    return 1.0-abs(2.0*fract(x*params.folds+params.offset)-1.0);
  }
  let pivot=clamp(params.threshold,0.05,0.95);
  return select((1.0-x)/(1.0-pivot),x/pivot,x <= pivot);
}
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let base=textureSampleLevel(src,samp,uv,0);
  if (params.amount <= 0.0) { return base; }
  let color=max(base.rgb,vec3f(0));
  var folded=vec3f(transfer(color.r),transfer(color.g),transfer(color.b));
  if (params.channels < 0.5) {
    let luma=dot(color,vec3f(0.2126,0.7152,0.0722));
    let hue=select(vec3f(1),color/max(luma,0.00001),luma > 0.00001);
    folded=hue*transfer(luma);
  }
  return vec4f(mix(base.rgb,clamp(folded,vec3f(0),vec3f(16)),clamp(params.amount,0.0,1.0)),base.a);
}
