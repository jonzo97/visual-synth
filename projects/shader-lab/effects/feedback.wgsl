struct Params {
  amount:f32, zoom:f32, rotate:f32, shiftX:f32, shiftY:f32, decay:f32, injection:f32,
  hue:f32, lighten:f32, centerX:f32, centerY:f32,
  phase:f32, width:f32, height:f32, valid:f32, hasField:f32, hasMask:f32, head:f32, count:f32,
}
@group(0) @binding(0) var src:texture_2d<f32>;
@group(0) @binding(4) var history:texture_2d<f32>;
@group(0) @binding(5) var samp:sampler;
@group(0) @binding(6) var<uniform> params:Params;

// Rotate a color about the grey axis (Rodrigues); zero angle returns c unchanged.
fn hueRotate(c:vec3f,a:f32)->vec3f {
  let k=vec3f(0.57735027);
  let ca=cos(a);
  return c*ca+cross(k,c)*sin(a)+k*dot(k,c)*(1.0-ca);
}

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let base=textureSampleLevel(src,samp,uv,0);
  if (params.amount <= 0.0 || params.valid < 0.5) { return base; }
  // Host captures this node's prior OUTPUT at fixed simulation ticks.
  // Inverse transform yields outward motion for zoom > 1.
  let aspect=max(params.width,1.0)/max(params.height,1.0);
  // Tunnel pivot: zoom and rotation turn about (centerX, centerY); 0.5 is the original centre.
  let pivot=vec2f(params.centerX,params.centerY);
  let point=(uv-pivot-vec2f(params.shiftX,params.shiftY))*vec2f(aspect,1);
  let c=cos(params.rotate);
  let s=sin(params.rotate);
  let turned=vec2f(c*point.x+s*point.y,-s*point.x+c*point.y)/max(params.zoom,0.1);
  let previousUV=turned/vec2f(aspect,1)+pivot;
  let inside=all(previousUV>=vec2f(0)) && all(previousUV<=vec2f(1));
  let previous=textureSampleLevel(history,samp,clamp(previousUV,vec2f(0),vec2f(1)),0);
  var retained=select(vec3f(0),previous.rgb,inside)*clamp(params.decay,0.0,0.999);
  // Tunnel colour drift: history hue turns a little every tick, so trails become rainbows.
  if (params.hue != 0.0) { retained=max(hueRotate(retained,params.hue),vec3f(0)); }
  // Convex injection prevents runaway accumulation; the HDR ceiling is a
  // final safety bound, not the mechanism keeping the recurrence stable.
  var chamber=mix(retained,max(base.rgb,vec3f(0)),clamp(params.injection,0.0,1.0));
  // Lighten composite: fresh light stacks over memory at full strength instead of crossfading.
  if (params.lighten > 0.5) { chamber=max(retained,max(base.rgb,vec3f(0))*clamp(params.injection*8.0,0.0,1.0)); }
  return vec4f(mix(base.rgb,clamp(chamber,vec3f(0),vec3f(16)),clamp(params.amount,0.0,1.0)),base.a);
}
