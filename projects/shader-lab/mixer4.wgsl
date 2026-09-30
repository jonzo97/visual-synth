struct Params { levelA:f32, levelB:f32, levelC:f32, levelD:f32, master:f32, blend:f32 }
@group(0) @binding(0) var a:texture_2d<f32>;
@group(0) @binding(1) var b:texture_2d<f32>;
@group(0) @binding(2) var c:texture_2d<f32>;
@group(0) @binding(3) var d:texture_2d<f32>;
@group(0) @binding(4) var samp:sampler;
@group(0) @binding(5) var<uniform> params:Params;
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let colors=array<vec3f,4>(textureSampleLevel(a,samp,uv,0).rgb,textureSampleLevel(b,samp,uv,0).rgb,
    textureSampleLevel(c,samp,uv,0).rgb,textureSampleLevel(d,samp,uv,0).rgb);
  let levels=array<f32,4>(params.levelA,params.levelB,params.levelC,params.levelD);
  var result=vec3f(0); var total=0.0; var engaged=false;
  for(var i=0u;i<4u;i++) {
    let weight=clamp(levels[i],0.0,1.0);
    if(weight<=0.0){continue;}
    let color=max(colors[i],vec3f(0));
    if(params.blend<1.5){result+=color*weight;}
    else if(params.blend<2.5){result=vec3f(1)-(vec3f(1)-result)*(vec3f(1)-clamp(color,vec3f(0),vec3f(1))*weight);}
    else if(params.blend<3.5){
      if(!engaged){result=vec3f(1);}
      result*=mix(vec3f(1),clamp(color,vec3f(0),vec3f(1)),weight);
    } else {
      if(!engaged){result=color*weight;}else{result=abs(result-color*weight);}
    }
    total+=weight; engaged=true;
  }
  if(params.blend<0.5 && total>0.0){result/=total;}
  return vec4f(clamp(result*params.master,vec3f(0),vec3f(16)),1);
}
