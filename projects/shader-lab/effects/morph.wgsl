struct Params {
  amount:f32, mode:f32, kernel:f32, radius:f32, lumaOnly:f32,
  phase:f32, width:f32, height:f32, valid:f32, hasField:f32, hasMask:f32, head:f32, count:f32,
}
@group(0) @binding(0) var src:texture_2d<f32>;
@group(0) @binding(5) var samp:sampler;
@group(0) @binding(6) var<uniform> params:Params;

fn luma(color:vec3f)->f32 { return dot(max(color,vec3f(0)),vec3f(0.2126,0.7152,0.0722)); }
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let base=textureSampleLevel(src,samp,uv,0);
  if (params.amount <= 0.0) { return base; }
  let px=clamp(params.radius,1.0,4.0)/vec2f(textureDimensions(src));
  let extent=select(1,2,params.kernel > 0.5);
  var light=base.rgb;
  var dark=base.rgb;
  var lightLuma=luma(light);
  var darkLuma=lightLuma;
  // Fixed 3×3 or 5×5 sample support, selecting pixels by scalar luma. Color
  // mode retains the winning pixel's RGB rather than channelwise maxima.
  for (var y=-2; y<=2; y++) {
    for (var x=-2; x<=2; x++) {
      if (abs(x)>extent || abs(y)>extent) { continue; }
      let sample=textureSampleLevel(src,samp,clamp(uv+vec2f(f32(x),f32(y))*px,vec2f(0),vec2f(1)),0).rgb;
      let value=luma(sample);
      if (value>lightLuma) { light=sample; lightLuma=value; }
      if (value<darkLuma) { dark=sample; darkLuma=value; }
    }
  }
  var result=light;
  var value=lightLuma;
  if (params.mode > 1.5) {
    value=max(0.0,lightLuma-darkLuma);
    result=light*(value/max(lightLuma,0.00001));
  } else if (params.mode > 0.5) { result=dark; value=darkLuma; }
  if (params.lumaOnly > 0.5) { result=vec3f(value); }
  return vec4f(mix(base.rgb,clamp(result,vec3f(0),vec3f(16)),clamp(params.amount,0.0,1.0)),base.a);
}
