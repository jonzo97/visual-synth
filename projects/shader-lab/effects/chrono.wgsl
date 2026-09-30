struct Params {
  amount:f32, seconds:f32, mode:f32, spread:f32,
  phase:f32, width:f32, height:f32, valid:f32, hasField:f32, hasMask:f32, head:f32, count:f32,
}
@group(0) @binding(0) var src:texture_2d<f32>;
@group(0) @binding(4) var history:texture_2d<f32>;
@group(0) @binding(5) var samp:sampler;
@group(0) @binding(6) var<uniform> params:Params;

fn timeSample(uv:vec2f,seconds:f32)->vec4f {
  if (seconds <= 0.0) { return textureSampleLevel(src,samp,uv,0); }
  // Atlas is 8 columns × 4 rows, sampled at 15 Hz. Head is NEXT write;
  // head-1 is newest. Clamp age to available history during warmup.
  let count=u32(clamp(params.count,1.0,32.0));
  let age=u32(clamp(round(seconds*15.0),0.0,f32(count-1u)));
  let head=u32(clamp(params.head,0.0,31.0));
  let tile=(head+31u-age)%32u;
  let cell=vec2f(f32(tile%8u),f32(tile/8u));
  let atlasSize=vec2f(textureDimensions(history));
  let tileSize=atlasSize/vec2f(8,4);
  // Interpolation cannot cross a tile boundary, even for UV 0 and 1.
  let local=clamp(uv*tileSize,vec2f(0.5),tileSize-vec2f(0.5));
  return textureSampleLevel(history,samp,(cell*tileSize+local)/atlasSize,0);
}
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let base=textureSampleLevel(src,samp,uv,0);
  if (params.amount <= 0.0 || params.valid < 0.5 || params.count < 1.0) { return base; }
  var position=uv.x;
  if (params.mode > 1.5) { position=clamp(length((uv-0.5)*2.0)/sqrt(2.0),0.0,1.0); }
  else if (params.mode > 0.5) { position=uv.y; }
  let seconds=position*params.seconds;
  let center=timeSample(uv,seconds);
  let earlier=timeSample(uv,seconds+params.spread*0.5);
  let later=timeSample(uv,max(0.0,seconds-params.spread*0.5));
  let woven=vec4f(earlier.r,center.g,later.b,center.a);
  return mix(base,woven,clamp(params.amount,0.0,1.0));
}
