// Slime Mold Wars, trail step (fragment): diffuse and decay the previous trail, add this tick's
// deposits, and paint touch/injected food. One channel per species.
struct Params {
  seed:f32, grid:f32, palette:f32, species:f32, agents:f32, sensorAngle:f32, sensorDistance:f32,
  turn:f32, speed:f32, deposit:f32, aggression:f32, decay:f32, diffuse:f32, steps:f32, exposure:f32, tick:f32,
  initialize:f32, injectX:f32, injectY:f32, radius:f32, amount:f32,
}
@group(0) @binding(0) var state:texture_2d<f32>;
@group(0) @binding(1) var<uniform> params:Params;
@group(0) @binding(2) var<storage, read> deposits:array<u32>;

const FIXED:f32 = 256.0;

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let size=i32(params.grid);
  let q=vec2i(clamp(uv,vec2f(0.0),vec2f(0.99999))*params.grid);
  if (params.initialize>0.5 && params.initialize<1.5) { return vec4f(0.0); }
  let old4=textureLoad(state,q,0);
  let old=old4.rgb;
  var v=old;
  // Alpha holds food laid by touch: half-life about 4 s, unlike the trails.
  var food=old4.a*0.997;
  if (params.initialize<0.5) {
    var blur=vec3f(0.0);
    for (var dy=-1;dy<=1;dy++) {
      for (var dx=-1;dx<=1;dx++) {
        blur+=textureLoad(state,(q+vec2i(dx,dy)+vec2i(size))%vec2i(size),0).rgb;
      }
    }
    let i=u32(q.y*size+q.x)*3u;
    let fresh=vec3f(f32(deposits[i]),f32(deposits[i+1u]),f32(deposits[i+2u]))/FIXED;
    v=mix(old,blur/9.0,clamp(params.diffuse,0.0,1.0))*params.decay+fresh;
  }
  if (params.radius>0.0) {
    // Touch lays down food every species follows.
    let d=distance(uv,vec2f(params.injectX,params.injectY));
    let brush=1.0-smoothstep(params.radius*0.5,params.radius,d);
    food+=brush*clamp(params.amount,0.0,1.0)*30.0;
  }
  return vec4f(min(v,vec3f(4000.0)),min(food,200.0));
}
