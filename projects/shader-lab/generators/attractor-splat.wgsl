// Strange-attractor exposure, recomputed from scratch every frame: seeded walkers iterate a
// Clifford or de Jong map and atomically add hits and a fixed-point speed sum into square
// bins. Integer sums are order-independent, so each frame is deterministic for its params.
struct Splat {
  a:f32, b:f32, c:f32, d:f32, kind:f32, zoom:f32, res:f32, seed:f32,
}
@group(0) @binding(0) var<storage, read_write> bins:array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> peak:array<atomic<u32>, 1>;
@group(0) @binding(2) var<uniform> splat:Splat;

const WARMUP:u32 = 24u;
const HITS:u32 = 192u;

fn hash(x:u32)->u32 {
  var h=x*747796405u+2891336453u;
  h=((h>>((h>>28u)+4u))^h)*277803737u;
  return (h>>22u)^h;
}

fn step(p:vec2f)->vec2f {
  if (splat.kind < 0.5) {
    return vec2f(sin(splat.a*p.y)+splat.c*cos(splat.a*p.x), sin(splat.b*p.x)+splat.d*cos(splat.b*p.y));
  }
  return vec2f(sin(splat.a*p.y)-cos(splat.b*p.x), sin(splat.c*p.x)-cos(splat.d*p.y));
}

// Analytic bound of the map's image, so framing needs no CPU measurement pass.
fn extent()->vec2f {
  if (splat.kind < 0.5) { return vec2f(1.0+abs(splat.c), 1.0+abs(splat.d)); }
  return vec2f(2.0);
}

@compute @workgroup_size(256)
fn clear_bins(@builtin(global_invocation_id) id:vec3u) {
  let n=u32(splat.res)*u32(splat.res)*2u;
  if (id.x < n) { atomicStore(&bins[id.x], 0u); }
  if (id.x == 0u) { atomicStore(&peak[0], 0u); }
}

@compute @workgroup_size(256)
fn walk(@builtin(global_invocation_id) id:vec3u) {
  let res=u32(splat.res);
  let h1=hash(id.x*2u+u32(splat.seed)*1315423911u);
  let h2=hash(h1^0x9e3779b9u);
  var p=vec2f(f32(h1&0xffffu),f32(h2&0xffffu))/65535.0*2.0-1.0;
  for (var i=0u;i<WARMUP;i++) { p=step(p); }
  let ext=max(extent().x,extent().y)*1.04/max(splat.zoom,0.05);
  let invSpan=1.0/(2.0*ext);
  for (var i=0u;i<HITS;i++) {
    let next=step(p);
    let speed=min(length(next-p)*0.55,1.0);
    p=next;
    let q=(p+vec2f(ext))*invSpan;
    if (all(q>=vec2f(0.0)) && all(q<vec2f(1.0))) {
      let k=(u32(q.y*f32(res))*res+u32(q.x*f32(res)))*2u;
      atomicAdd(&bins[k],1u);
      atomicAdd(&bins[k+1u],u32(speed*255.0));
    }
  }
}

@compute @workgroup_size(256)
fn find_peak(@builtin(global_invocation_id) id:vec3u) {
  let n=u32(splat.res)*u32(splat.res);
  if (id.x < n) { atomicMax(&peak[0], atomicLoad(&bins[id.x*2u])); }
}
