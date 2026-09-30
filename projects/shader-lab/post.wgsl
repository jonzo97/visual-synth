struct FX { kind:f32, amount:f32, phase:f32, width:f32, height:f32, valid:f32, threshold:f32, scale:f32 }
@group(0) @binding(0) var src:texture_2d<f32>;
@group(0) @binding(1) var hist1:texture_2d<f32>;
@group(0) @binding(2) var hist2:texture_2d<f32>;
@group(0) @binding(3) var hist3:texture_2d<f32>;
@group(0) @binding(4) var samp:sampler;
@group(0) @binding(5) var<uniform> fx:FX;
fn read(uv:vec2f)->vec3f{return textureSampleLevel(src,samp,clamp(uv,vec2f(0),vec2f(1)),0).rgb;}
@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f{
 let base=read(uv); var result=base; let px=vec2f(1.0/fx.width,1.0/fx.height);
 if(fx.kind>0.5 && fx.kind<1.5){
   var halo=vec3f(0);
   for(var i=0;i<12;i++){let a=f32(i)*0.5235988;let d=vec2f(cos(a),sin(a));
     halo+=max(read(uv+d*px*4.0)-vec3f(0.08),vec3f(0))*0.045;
     halo+=max(read(uv+d*px*11.0)-vec3f(0.08),vec3f(0))*0.038;
   }result=base+halo*2.2;
 }
 if(fx.kind>1.5 && fx.kind<2.5){
   let matrix=array<f32,16>(0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
   let cell=vec2u(floor(uv*vec2f(fx.width,fx.height)/max(1.0,fx.scale)))%vec2u(4);
   let threshold=(matrix[cell.y*4u+cell.x]+0.5)/16.0-0.5+fx.threshold;
   result=clamp(floor(base*5.0+vec3f(threshold)+0.5)/5.0,vec3f(0),vec3f(1));
 }
 if(fx.kind>2.5 && fx.kind<3.5){
   let ghost=textureSampleLevel(hist3,samp,uv+vec2f(-0.014,0.007),0).rgb;
   result=base+ghost*0.85*fx.valid;
 }
 if(fx.kind>3.5 && fx.kind<4.5){
   // Three decaying temporal taps: a finite visual impulse response.
   let a=textureSampleLevel(hist1,samp,(uv-0.5)*0.995+0.5+px*3.0,0).rgb;
   let b=textureSampleLevel(hist2,samp,(uv-0.5)*0.985+0.5-px*5.0,0).rgb;
   let c=textureSampleLevel(hist3,samp,(uv-0.5)*0.970+0.5+px*8.0,0).rgb;
   result=base+(a*0.48+b*0.30+c*0.18)*fx.valid;
 }
 if(fx.kind>4.5 && fx.kind<5.5){
   let cell=vec2f(6.0,4.0)*px;
   let blocks=read((floor(uv/cell)+0.5)*cell);
   let compressed=blocks/(vec3f(0.38)+blocks);
   result=floor(compressed*6.0)/6.0;
 }
 if(fx.kind>5.5){
   let band=floor(uv.y*32.0);
   let tick=floor(fx.phase*10.0);
   let n=fract(sin(band*17.13+tick*9.71)*43758.5);
   let tear=select(0.0,(n-0.5)*0.10,n>0.86);
   let wobble=0.002*sin(uv.y*35.0+fx.phase);
   let q=uv+vec2f(tear+wobble,0);
   result=vec3f(read(q+px*vec2f(3,0)).r,read(q).g,read(q-px*vec2f(3,0)).b);
   result*=0.9+0.1*cos(uv.y*fx.height*3.14159265);
   result+=vec3f((n-0.5)*0.045);
 }
 return vec4f(max(mix(base,result,fx.amount),vec3f(0)),1);
}
