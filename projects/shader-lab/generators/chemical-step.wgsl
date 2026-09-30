struct Params {seed:f32,grid:f32,palette:f32,feed:f32,kill:f32,diffusionU:f32,diffusionV:f32,steps:f32,tick:f32,initialize:f32,injectX:f32,injectY:f32,radius:f32,amount:f32}
@group(0) @binding(0) var state:texture_2d<f32>;
@group(0) @binding(1) var<uniform> params:Params;
fn hash(q:vec2u)->u32 {var h=(q.x*1597334677u)^(q.y*3812015801u)^(u32(params.seed)*2798796415u);h=(h^(h>>16u))*2246822519u;return h^(h>>13u);}
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec2f {
 let size=i32(params.grid);let q=vec2i(clamp(uv,vec2f(0),vec2f(.99999))*params.grid);
 if(params.initialize>.5&&params.initialize<1.5){let block=vec2u(q)/14u;let seed=hash(block)%10u>3u&&q.x%14<5&&q.y%14<5;return select(vec2f(1,0),vec2f(.5,.26),seed);}
 let old=textureLoad(state,q,0).rg;var lap=-4.0*old;
 lap+=textureLoad(state,(q+vec2i(-1,0)+vec2i(size))%vec2i(size),0).rg;
 lap+=textureLoad(state,(q+vec2i(1,0))%vec2i(size),0).rg;
 lap+=textureLoad(state,(q+vec2i(0,-1)+vec2i(size))%vec2i(size),0).rg;
 lap+=textureLoad(state,(q+vec2i(0,1))%vec2i(size),0).rg;
 let reaction=old.x*old.y*old.y;
 var v=clamp(old+vec2f(params.diffusionU,params.diffusionV)*lap+vec2f(-reaction+params.feed*(1.0-old.x),reaction-(params.feed+params.kill)*old.y),vec2f(0),vec2f(1));
 if(params.initialize>1.5){v=old;}
 if(params.radius>0.0){let brush=1.0-smoothstep(params.radius*.7,params.radius,distance(uv,vec2f(params.injectX,params.injectY)));v=mix(v,vec2f(.45,.5),brush*clamp(params.amount,0.0,1.0));}
 return v;
}
