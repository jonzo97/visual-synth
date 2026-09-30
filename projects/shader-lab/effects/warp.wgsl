struct Params {
  amount:f32, strength:f32, mode:f32, boundary:f32,
  phase:f32, width:f32, height:f32, valid:f32, hasField:f32, hasMask:f32, head:f32, count:f32,
}
@group(0) @binding(0) var src:texture_2d<f32>;
@group(0) @binding(1) var field:texture_2d<f32>;
@group(0) @binding(5) var samp:sampler;
@group(0) @binding(6) var<uniform> params:Params;

fn boundaryUV(uv:vec2f)->vec2f {
  if (params.boundary > 1.5) { return 1.0-abs(1.0-2.0*fract(uv*0.5)); }
  if (params.boundary > 0.5) { return fract(uv); }
  return clamp(uv,vec2f(0),vec2f(1));
}
fn fieldLuma(uv:vec2f)->f32 {
  return dot(clamp(textureSampleLevel(field,samp,boundaryUV(uv),0).rgb,vec3f(0),vec3f(1)),vec3f(0.2126,0.7152,0.0722));
}
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let base=textureSampleLevel(src,samp,uv,0);
  if (params.amount <= 0.0 || params.strength <= 0.0 || params.hasField < 0.5) { return base; }
  var displacement=vec2f(0);
  if (params.mode > 0.5) {
    // Centered RG is an artistic vector: (0.5,0.5) is stationary.
    displacement=clamp(textureSampleLevel(field,samp,boundaryUV(uv),0).rg,vec2f(0),vec2f(1))*2.0-1.0;
  } else {
    // Central luma differences per UV unit, capped to unit length. Strength
    // therefore bounds displacement in normalized image coordinates.
    let px=1.0/vec2f(textureDimensions(field));
    let gradient=vec2f(fieldLuma(uv+vec2f(px.x,0))-fieldLuma(uv-vec2f(px.x,0)),
      fieldLuma(uv+vec2f(0,px.y))-fieldLuma(uv-vec2f(0,px.y)))/(2.0*px);
    displacement=gradient/max(1.0,length(gradient));
  }
  let warped=textureSampleLevel(src,samp,boundaryUV(uv+displacement*params.strength),0);
  return mix(base,warped,clamp(params.amount,0.0,1.0));
}
