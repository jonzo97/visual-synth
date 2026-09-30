// Regular 4D polytopes rotated in 4D, projected 4D -> 3D -> 2D, edges drawn as glowing
// lines. Vertices and edges are rebuilt per pixel from their definitions, so the source
// needs no vertex buffer. Rotation angles are integer turns of phase: periodic at 2pi.
struct Params {
  phase:f32, aspect:f32, shape:f32, turns:f32, tumble:f32, tilt:f32, perspective:f32,
  zoom:f32, thickness:f32, halo:f32, depth:f32, cycles:f32, palette:f32, offset:f32
}
@group(0) @binding(0) var<uniform> params:Params;

const TAU:f32 = 6.28318530718;

fn colors(layer:u32)->vec3f {
  var c=array<vec3f,3>(vec3f(25,117,125),vec3f(255,148,110),vec3f(202,237,210));
  if(params.palette>0.5){c=array<vec3f,3>(vec3f(185,44,81),vec3f(255,184,92),vec3f(247,104,64));}
  if(params.palette>1.5){c=array<vec3f,3>(vec3f(69,84,166),vec3f(156,247,199),vec3f(130,177,255));}
  if(params.palette>2.5){c=array<vec3f,3>(vec3f(232,149,42),vec3f(0,212,106),vec3f(255,217,61));}
  if(params.palette>3.5){c=array<vec3f,3>(vec3f(0,139,150),vec3f(127,255,0),vec3f(0,212,106));}
  if(params.palette>4.5){c=array<vec3f,3>(vec3f(139,26,43),vec3f(255,179,71),vec3f(255,217,61));}
  if(params.palette>5.5){c=array<vec3f,3>(vec3f(255,103,200),vec3f(149,132,255),vec3f(92,240,239));}
  if(params.palette>6.5){c=array<vec3f,3>(vec3f(255,109,53),vec3f(48,221,255),vec3f(232,247,126));}
  if(params.palette>7.5){c=array<vec3f,3>(vec3f(255,204,69),vec3f(234,67,131),vec3f(120,243,161));}
  return c[layer]/255.0;
}

fn pal(x:f32)->vec3f {
  if(params.palette>10.5){return vec3f(0.5+0.5*cos(TAU*x));}
  if(params.palette>9.5){return 0.5+0.5*cos(TAU*(vec3f(1.0,1.0,0.5)*x+vec3f(0.8,0.9,0.3)));}
  if(params.palette>8.5){return 0.5+0.5*cos(TAU*(x+vec3f(0.0,0.33,0.67)));}
  let f=fract(x)*3.0;
  let i=u32(f)%3u;
  return mix(colors(i),colors((i+1u)%3u),smoothstep(0.0,1.0,fract(f)));
}

// Rotate components i and j of v by angle a.
fn rot4(v:vec4f,i:u32,j:u32,a:f32)->vec4f {
  var o=v; let c=cos(a); let s=sin(a);
  o[i]=c*v[i]-s*v[j]; o[j]=s*v[i]+c*v[j];
  return o;
}

// Vertex k of the chosen polytope, scaled to unit circumradius. Returns w=9 past the count.
fn vertex(shape:u32,k:u32)->vec4f {
  if(shape==0u){                        // 16-cell: +-e_i
    if(k>=8u){return vec4f(9.0);}
    var v=vec4f(0.0); v[k/2u]=select(1.0,-1.0,(k&1u)==1u); return v;
  }
  if(shape==1u){                        // tesseract: all sign combinations / 2
    if(k>=16u){return vec4f(9.0);}
    return (vec4f(f32(k&1u),f32((k>>1u)&1u),f32((k>>2u)&1u),f32((k>>3u)&1u))*2.0-1.0)*0.5;
  }
  if(k>=24u){return vec4f(9.0);}        // 24-cell: permutations of (+-1,+-1,0,0) / sqrt2
  var pairs=array<vec2u,6>(vec2u(0u,1u),vec2u(0u,2u),vec2u(0u,3u),vec2u(1u,2u),vec2u(1u,3u),vec2u(2u,3u));
  let pr=pairs[k/4u];
  var v=vec4f(0.0);
  v[pr.x]=select(1.0,-1.0,(k&1u)==1u);
  v[pr.y]=select(1.0,-1.0,(k&2u)==2u);
  return v*0.70710678;
}

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let t=params.phase+params.offset;
  let p=vec2f((uv.x-0.5)*params.aspect,uv.y-0.5)*2.0;
  let shape=u32(clamp(round(params.shape),0.0,2.0));
  let count=select(select(24u,16u,shape==1u),8u,shape==0u);
  // Squared edge length at unit circumradius: 16-cell 2, tesseract and 24-cell 1.
  let edge2=select(1.0,2.0,shape==0u);
  let a4=round(params.turns)*t;
  let a3=round(params.tumble)*t;
  let cam=params.perspective;

  var screen:array<vec3f,24>;
  var source:array<vec4f,24>;
  for(var k=0u;k<count;k++){
    let v0=vertex(shape,k);
    source[k]=v0;
    // Three non-commuting 4D rotations with fixed offsets, all whole turns per loop.
    var v=rot4(v0,0u,3u,a4);
    v=rot4(v,1u,3u,a4*2.0+params.tilt);
    v=rot4(v,2u,3u,-a4+0.4);
    v=rot4(v,0u,1u,a4);
    let k4=1.6/(cam-v.w);                        // 4D -> 3D perspective
    var q=vec4f(v.xyz*k4,0.0);
    q=rot4(q,1u,2u,0.5);
    q=rot4(q,0u,2u,a3);
    let k3=2.2/(3.4-q.z);                         // 3D -> 2D perspective
    screen[k]=vec3f(q.xy*k3*params.zoom,(v.w+1.0)*0.5);
  }

  var col=vec3f(0.0);
  let sharp=260.0*params.thickness;
  let soft=28.0*params.thickness;
  for(var i=0u;i<count;i++){
    for(var j=i+1u;j<count;j++){
      let d4=source[i]-source[j];
      if(abs(dot(d4,d4)-edge2)>1e-3){continue;}
      let ea=screen[i]; let eb=screen[j];
      let pa=p-ea.xy; let ba=eb.xy-ea.xy;
      let h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-6),0.0,1.0);
      let d=length(pa-ba*h);
      let dep=mix(ea.z,eb.z,h);                   // 0 = far in w, 1 = near
      let intensity=exp(-d*sharp)+params.halo*exp(-d*soft);
      col+=pal(dep*0.6+round(params.cycles)*t/TAU)*intensity*mix(1.0,0.35+0.65*dep,params.depth);
    }
  }
  return vec4f(1.0-exp(-col*1.6),1.0);
}
