// Slime Mold Wars, agent kernels (compute). Up to three species of physarum agents sense the
// trail field, steer toward their own species' trail and away from rivals', move, and deposit.
// Deposits are integer atomics, so the result is independent of thread order (deterministic).
struct Params {
  seed:f32, grid:f32, species:f32, agents:f32, sensorAngle:f32, sensorDistance:f32, turn:f32,
  speed:f32, deposit:f32, aggression:f32, tick:f32, maxAgents:f32,
}
@group(0) @binding(0) var<storage, read_write> agents:array<vec4f>;
@group(0) @binding(1) var<storage, read_write> deposits:array<atomic<u32>>;
@group(0) @binding(2) var trail:texture_2d<f32>;
@group(0) @binding(3) var<uniform> params:Params;

const TAU:f32 = 6.28318530718;
const FIXED:f32 = 256.0;

fn hash(a:u32, b:u32)->u32 {
  var h=a*747796405u+b*2891336453u+u32(params.seed)*277803737u;
  h=((h>>((h>>28u)+4u))^h)*277803737u;
  return (h>>22u)^h;
}
fn rand(a:u32, b:u32)->f32 { return f32(hash(a,b))/4294967295.0; }

fn liveAgents()->u32 { return u32(clamp(params.agents,0.0,1.0)*params.maxAgents); }

@compute @workgroup_size(256)
fn init_agents(@builtin(global_invocation_id) id:vec3u) {
  let i=id.x;
  if (i>=u32(params.maxAgents)) { return; }
  let n=max(u32(round(params.species)),1u);
  let s=i%n;
  // Uniform scatter with random headings: the classic start from which networks self-organise.
  let a=rand(i,1u)*TAU;
  let p=vec2f(rand(i,2u),rand(i,3u));
  agents[i]=vec4f(p,a,f32(s));
}

@compute @workgroup_size(256)
fn clear_deposits(@builtin(global_invocation_id) id:vec3u) {
  let g=u32(params.grid);
  if (id.x<g*g*3u) { atomicStore(&deposits[id.x],0u); }
}

fn sense(p:vec2f, heading:f32, own:vec3f)->f32 {
  let g=params.grid;
  let q=fract(p+vec2f(cos(heading),sin(heading))*params.sensorDistance/g);
  let t4=textureLoad(trail,vec2i(q*g)%vec2i(i32(g)),0);
  let v=t4.rgb;
  // Own trail attracts; rival trails repel in proportion to aggression; food draws everyone.
  return dot(v,own)-params.aggression*dot(v,vec3f(1.0)-own)+t4.a*3.0;
}

@compute @workgroup_size(256)
fn move_agents(@builtin(global_invocation_id) id:vec3u) {
  let i=id.x;
  if (i>=liveAgents()) { return; }
  var a=agents[i];
  let s=u32(a.w);
  let own=vec3f(select(0.0,1.0,s==0u),select(0.0,1.0,s==1u),select(0.0,1.0,s==2u));
  let sa=params.sensorAngle;
  let F=sense(a.xy,a.z,own); let L=sense(a.xy,a.z+sa,own); let R=sense(a.xy,a.z-sa,own);
  let jitter=rand(i,u32(params.tick)*3u+7u);
  if (F>L && F>R) {
  } else if (F<L && F<R) {
    a.z+=select(-1.0,1.0,jitter>0.5)*params.turn;
  } else if (L>R) {
    a.z+=params.turn*(0.6+0.4*jitter);
  } else if (R>L) {
    a.z-=params.turn*(0.6+0.4*jitter);
  }
  a=vec4f(fract(a.xy+vec2f(cos(a.z),sin(a.z))*params.speed/params.grid),a.z,a.w);
  agents[i]=a;
  let g=u32(params.grid);
  let cell=vec2u(a.xy*params.grid)%vec2u(g);
  atomicAdd(&deposits[(cell.y*g+cell.x)*3u+s],u32(params.deposit*FIXED));
}
