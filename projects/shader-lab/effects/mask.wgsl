struct Params {
  amount:f32, mix:f32, threshold:f32, softness:f32, invert:f32, blend:f32,
  phase:f32, width:f32, height:f32, valid:f32, hasField:f32, hasMask:f32, head:f32, count:f32,
}
@group(0) @binding(0) var src:texture_2d<f32>;
@group(0) @binding(2) var b:texture_2d<f32>;
@group(0) @binding(3) var mask:texture_2d<f32>;
@group(0) @binding(5) var samp:sampler;
@group(0) @binding(6) var<uniform> params:Params;

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let base=textureSampleLevel(src,samp,uv,0);
  if (params.amount <= 0.0 || params.mix <= 0.0) { return base; }
  let layer=textureSampleLevel(b,samp,uv,0);
  var stencil=1.0;
  if (params.hasMask > 0.5) {
    let value=dot(clamp(textureSampleLevel(mask,samp,uv,0).rgb,vec3f(0),vec3f(1)),vec3f(0.2126,0.7152,0.0722));
    // Zero softness is a hard cut; smoothstep must never have equal edges.
    stencil=select(0.0,1.0,value >= params.threshold);
    if (params.softness > 0.0) {
      let halfWidth=max(params.softness*0.5,0.00001);
      stencil=smoothstep(params.threshold-halfWidth,params.threshold+halfWidth,value);
    }
    if (params.invert > 0.5) { stencil=1.0-stencil; }
  }
  var blended=layer.rgb;
  if (params.blend > 1.5) { blended=abs(base.rgb-layer.rgb); }
  else if (params.blend > 0.5) { blended=base.rgb*layer.rgb; }
  // Frames use straight linear RGB. Blend modes affect RGB only; coverage
  // interpolates A/B alpha by the same mask weight as ordinary crossfade.
  let weight=clamp(params.mix*stencil*params.amount,0.0,1.0);
  return mix(base,vec4f(clamp(blended,vec3f(0),vec3f(16)),layer.a),weight);
}
