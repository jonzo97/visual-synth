// De Bruijn multigrid tiling, rendered per pixel. For each pair of grid families (r,s)
// every line intersection is one rhomb; a pixel finds the rhomb whose corner vertex V
// satisfies x - V = u*e_r + v*e_s with u,v in [0,1]. Phason shifts flip tiles; every
// temporal input is periodic in phase (2pi per loop).
struct Params {
  phase:f32, aspect:f32, symmetry:f32, seed:f32, size:f32, phasonX:f32, phasonY:f32,
  flip:f32, pan:f32, color:f32, lines:f32, grout:f32, palette:f32, offset:f32
}
@group(0) @binding(0) var<uniform> params:Params;

const PI:f32 = 3.14159265359;
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

// Five tile glazes plus grout (index 5). 9-11 are the page's zellige, Delft and
// terracotta glazes; 0-8 derive five tones from the shared three-stop palettes.
fn glaze(i:u32)->vec3f {
  if(params.palette>10.5){
    var g=array<vec3f,6>(vec3f(154,74,44),vec3f(201,163,106),vec3f(75,90,58),vec3f(228,214,187),vec3f(46,38,34),vec3f(184,171,148));
    return g[i]/255.0;
  }
  if(params.palette>9.5){
    var g=array<vec3f,6>(vec3f(28,63,148),vec3f(61,103,184),vec3f(243,241,234),vec3f(143,176,217),vec3f(35,48,94),vec3f(233,230,222));
    return g[i]/255.0;
  }
  if(params.palette>8.5){
    var g=array<vec3f,6>(vec3f(31,62,140),vec3f(47,143,138),vec3f(200,149,46),vec3f(90,52,38),vec3f(236,229,211),vec3f(207,200,184));
    return g[i]/255.0;
  }
  var g=array<vec3f,6>(colors(0u),colors(1u),colors(2u),mix(colors(0u),colors(1u),0.5)*0.7,mix(colors(1u),colors(2u),0.5)*1.1,vec3f(0.035,0.035,0.05));
  return g[i];
}

fn hashu(x:u32)->u32 {
  var h=x*747796405u+2891336453u;
  h=((h>>((h>>28u)+4u))^h)*277803737u;
  return (h>>22u)^h;
}

fn segDist(p:vec2f,a:vec2f,b:vec2f)->f32 {
  let pa=p-a; let ba=b-a;
  return length(pa-ba*clamp(dot(pa,ba)/max(dot(ba,ba),1e-6),0.0,1.0));
}

@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f {
  let t=params.phase+params.offset;
  let screen=vec2f((uv.x-0.5)*params.aspect,0.5-uv.y)*2.0;
  let x=screen*params.size*0.5+params.pan*vec2f(cos(t),sin(t));
  // Tile units per pixel, taken in uniform control flow.
  let px=max(fwidth(x.y),1e-5);

  let n=u32(clamp(round(params.symmetry),3.0,11.0));
  let nf=f32(n);
  let odd=(n%2u)==1u;
  // Odd N: directions 2pi j/N (Penrose-type); even N: pi j/N (N=4 is Ammann-Beenker).
  let step=select(PI/nf,TAU/nf,odd);
  let perp=select(3.0,2.0,odd);
  let ux=params.phasonX+params.flip*cos(t);
  let uy=params.phasonY+params.flip*sin(t);
  var e:array<vec2f,11>;
  var g:array<f32,11>;
  var mean=0.0;
  for(var j=0u;j<n;j++){
    let a=step*f32(j);
    e[j]=vec2f(cos(a),sin(a));
    g[j]=f32(hashu(u32(params.seed)*16u+j)&0xffffu)/65535.0-0.5;
    mean+=g[j];
  }
  mean/=nf;
  for(var j=0u;j<n;j++){
    let a=step*f32(j)*perp;
    // Sum-zero offsets give Penrose-type tilings; N=3 needs a non-integer sum so three
    // line families never meet at one point.
    g[j]=g[j]-mean+select(0.0,0.37/3.0,n==3u)+ux*cos(a)+uy*sin(a);
  }

  let y=x/(nf*0.5);
  var found=false;
  var fr=0u; var fs=0u; var fu=0.0; var fv=0.0; var hash=0u; var qp=vec2f(0.0);
  for(var r=0u;r<n-1u && !found;r++){
    for(var s=r+1u;s<n && !found;s++){
      let er=e[r]; let es=e[s];
      let det=er.x*es.y-er.y*es.x;
      if(abs(det)<1e-6){continue;}
      let cr=floor(dot(y,er)-g[r]);
      let cs=floor(dot(y,es)-g[s]);
      for(var i=-2;i<=2 && !found;i++){
        for(var k=-2;k<=2;k++){
          let kr=cr+f32(i); let ks=cs+f32(k);
          let a=kr+g[r]; let b=ks+g[s];
          let p=vec2f(a*es.y-b*er.y,b*er.x-a*es.x)/det;
          var v=vec2f(0.0);
          var q=vec2f(0.0);
          var h=r*131u+s*17u;
          for(var j=0u;j<n;j++){
            var K=ceil(dot(p,e[j])-g[j]);
            if(j==r){K=kr;} if(j==s){K=ks;}
            v+=K*e[j];
            let pa=step*f32(j)*perp;
            q+=K*vec2f(cos(pa),sin(pa));
            h=h*31u+u32(i32(K)+4096);
          }
          let d=x-v;
          let u=(d.x*es.y-d.y*es.x)/det;
          let w=(er.x*d.y-er.y*d.x)/det;
          if(u>=-1e-4 && u<=1.0001 && w>=-1e-4 && w<=1.0001){
            found=true; fr=r; fs=s; fu=u; fv=w; hash=h; qp=q;
            break;
          }
        }
      }
    }
  }
  if(!found){return vec4f(glaze(5u),1.0);}

  let er=e[fr]; let es=e[fs];
  let det=abs(er.x*es.y-er.y*es.x);
  let dd=fs-fr;
  let kind=min(dd,n-dd);
  var col:vec3f;
  if(params.color<0.5){
    var order=array<u32,5>(0u,2u,1u,3u,4u);
    col=glaze(order[(kind-1u)%5u]);
  } else if(params.color<1.5){
    col=glaze((fr+fs)%5u);
  } else {
    // Perpendicular-space position: the tiling's hidden structure.
    let pa=step*perp;
    let qq=qp+0.5*(vec2f(cos(pa*f32(fr)),sin(pa*f32(fr)))+vec2f(cos(pa*f32(fs)),sin(pa*f32(fs))));
    let ang=fract(atan2(qq.y,qq.x)/TAU+1.0)*4.0;
    let i=u32(ang)%4u;
    let f=fract(ang);
    col=mix(glaze(i),glaze((i+1u)%4u),f*f*(3.0-2.0*f));
    col=mix(glaze(4u),col,0.25+0.75*clamp(length(qq)/(0.35*nf),0.0,1.0));
  }
  col*=1.0+(f32(hashu(hash)%1000u)/1000.0*0.12-0.06);

  // Real-space position inside the rhomb (corner at origin).
  let local=fu*er+fv*es;
  let aa=px*1.2;
  if(params.lines>0.5){
    var band=1e3;
    if(params.lines<1.5){
      // Girih strapwork: edge midpoints joined; bands continue across neighbours.
      let m0=0.5*er; let m1=er+0.5*es; let m2=es+0.5*er; let m3=0.5*es;
      band=min(min(segDist(local,m0,m1),segDist(local,m1,m2)),min(segDist(local,m2,m3),segDist(local,m3,m0)));
    } else {
      // Arcs about two opposite corners through the midpoints of their edges.
      band=min(abs(length(local)-0.5),abs(length(local-er-es)-0.5));
    }
    col=mix(col,vec3f(0.08,0.07,0.11),1.0-smoothstep(0.085-aa,0.085+aa,band));
    col=mix(col,vec3f(0.97,0.95,0.9),1.0-smoothstep(0.045-aa,0.045+aa,band));
  }
  // Grout: distance to the rhomb's sides in tile units.
  let edge=min(min(fu,1.0-fu),min(fv,1.0-fv))*det;
  let gw=params.grout*0.5;
  col=mix(glaze(5u),col,smoothstep(gw-aa,gw+aa,edge));
  return vec4f(col,1.0);
}
