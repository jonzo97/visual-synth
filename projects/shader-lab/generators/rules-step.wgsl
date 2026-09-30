struct Params {seed:f32,grid:f32,palette:f32,states:f32,threshold:f32,neighborhood:f32,rate:f32,tick:f32,initialize:f32,injectX:f32,injectY:f32,radius:f32,amount:f32}
@group(0) @binding(0) var state:texture_2d<u32>;
@group(0) @binding(1) var<uniform> params:Params;
fn hash(q:vec2u)->u32 {var h=(q.x*1597334677u)^(q.y*3812015801u)^(u32(params.seed)*2798796415u);h=(h^(h>>16u))*2246822519u;return h^(h>>13u);}
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) u32 {
 let size=i32(params.grid); let q=vec2i(clamp(uv,vec2f(0),vec2f(.99999))*params.grid);let states=u32(params.states);
 if(params.initialize>.5&&params.initialize<1.5){return hash(vec2u(q))%states;}
 let old=textureLoad(state,q,0).x;let next=(old+1u)%states;
 if(params.radius>0.0 && params.amount>0.0 && distance(uv,vec2f(params.injectX,params.injectY))<params.radius){return hash(vec2u(q)+vec2u(u32(max(0.0,params.tick))))%states;}
 if(params.initialize>1.5){return old;}
 var sum=0u;
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
   if(x==0&&y==0){continue;}if(params.neighborhood>.5&&abs(x)+abs(y)>1){continue;}
   let n=(q+vec2i(x,y)+vec2i(size))%vec2i(size);if(textureLoad(state,n,0).x==next){sum++;}
 }}
 return select(old,next,sum>=u32(params.threshold));
}
