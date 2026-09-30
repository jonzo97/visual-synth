// Looping phase is always an integer multiple of 2π over twelve seconds.
// 1: a sine wave; 2: interference; 3: domain warping + fine threads.
struct Params { phase: f32, aspect: f32, fold: f32, density: f32, palette: f32, layers: f32, offset: f32, ratio: f32, strength: f32, mode: f32, ax: f32, ay: f32, bx: f32, by: f32, crossing: f32, angle: f32, mixAmount: f32 }
@group(0) @binding(0) var<uniform> params: Params;

fn strand(f: f32, density: f32) -> f32 {
  let v = f*density;
  let d = abs(fract(v+0.5)-0.5);
  let aa = max(fwidth(v)*0.7,0.008);
  // Fade unresolved threads toward their coverage instead of flickering.
  return mix(1.0-smoothstep(0.045,0.045+aa,d),0.12,smoothstep(0.35,0.9,aa));
}

fn popColor(v: f32) -> vec3f {
  // Exact sRGB stops transcribed from the user's pop palette.
  let gold = vec3f(232,149,42) / 255.0;
  let maroon = vec3f(139,26,43) / 255.0;
  let emerald = vec3f(0,212,106) / 255.0;
  let teal = vec3f(0,139,150) / 255.0;
  let glow = vec3f(255,217,61) / 255.0;
  let lime = vec3f(127,255,0) / 255.0;
  let apricot = vec3f(255,179,71) / 255.0;
  var stops = array<vec3f,7>(maroon,gold,glow,lime,emerald,teal,apricot);
  if(params.palette > 3.5 && params.palette < 4.5){stops = array<vec3f,7>(teal,emerald,lime,glow,lime,emerald,teal);}
  if(params.palette > 4.5){stops = array<vec3f,7>(maroon,maroon,gold,apricot,glow,apricot,maroon);}
  let x = clamp(v,0.0,0.9999)*6.0;
  let i = u32(floor(x));
  return mix(stops[i],stops[i+1u],smoothstep(0.0,1.0,fract(x)));
}

fn layerColor(layer:u32)->vec3f{
  var colors=array<vec3f,3>(vec3f(255,103,200),vec3f(149,132,255),vec3f(92,240,239));
  if(params.palette>6.5 && params.palette<7.5){colors=array<vec3f,3>(vec3f(255,109,53),vec3f(48,221,255),vec3f(232,247,126));}
  if(params.palette>7.5){colors=array<vec3f,3>(vec3f(255,204,69),vec3f(234,67,131),vec3f(120,243,161));}
  return colors[layer]/255.0;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  var p = vec2f((uv.x - 0.5) * params.aspect, uv.y - 0.5);
  if(params.mode > 0.5){
    let a = vec2f((params.ax-0.5)*params.aspect,params.ay-0.5);
    let b = vec2f((params.bx-0.5)*params.aspect,params.by-0.5);
    let da = p-a; let db = p-b;
    // Soft cores bound the field even when poles overlap.
    let fa = da/(dot(da,da)+0.045);
    let fb = db/(dot(db,db)+0.045);
    var force = fa+fb;
    if(params.mode > 1.5){force = fa-fb;}
    if(params.mode > 2.5){force = vec2f(-force.y,force.x);}
    p += force*params.strength*0.085;
  }
  let t = params.phase;
  let first = sin(p.x * 4.8 + t) * 0.13;
  let second = sin(p.x * (4.8*params.ratio) - t + p.y * 3.0 + params.offset) * 0.07;
  var field = p.y + first;
  if (params.layers > 1.5) { field += second; }
  if (params.layers > 2.5) {
    field += params.fold * (0.2 * sin(p.x * 3.2 + p.y * 5.5 + sin(t))
      + 0.13 * sin(p.y * 8.0 - p.x * 2.8 + cos(t)));
  }
  let envelope = exp(-field * field * 8.0);
  let freq = params.density * 6.2831853;
  let ridge = 0.5 + 0.5 * sin(field * freq);
  let threads = pow(ridge, 18.0);
  let broad = 0.5 + 0.5 * sin(field * 16.0 + p.x * 2.0);
  var deep = vec3f(0.025, 0.105, 0.12);
  var middle = vec3f(0.10, 0.46, 0.49);
  var light = vec3f(1.0, 0.58, 0.43);
  if (params.palette > 0.5 && params.palette < 1.5) {
    deep = vec3f(0.08, 0.023, 0.065); middle = vec3f(0.53, 0.12, 0.21); light = vec3f(1.0, 0.72, 0.36);
  }
  if (params.palette > 1.5 && params.palette < 2.5) {
    deep = vec3f(0.025, 0.06, 0.12); middle = vec3f(0.27, 0.33, 0.65); light = vec3f(0.61, 0.97, 0.78);
  }
  let sweep = 0.5 + 0.5 * sin(p.x * 1.9 + field * 7.0 + sin(t));
  var rgb = deep * 0.45 + envelope * (mix(middle, light, sweep) * (0.1 + threads * 0.75) + broad * middle * 0.3);
  rgb += pow(ridge, 60.0) * envelope * vec3f(0.8, 0.9, 0.83) * 0.3;
  if(params.palette > 2.5){
    let color = popColor(0.5+0.5*sin(field*9.0+p.x*1.8+sin(t)));
    deep = vec3f(0.055,0.013,0.033); light = color;
    rgb = deep + envelope*color*(0.13+0.87*threads);
  }
  if(params.palette>5.5){deep=vec3f(0.045,0.018,0.09);light=layerColor(0u);rgb=deep+envelope*light*(0.06+threads);}
  if(params.crossing > 0.5 && params.layers > 2.5){
    let q = vec2f(cos(params.angle)*p.x-sin(params.angle)*p.y,sin(params.angle)*p.x+cos(params.angle)*p.y);
    var other = q.y + 0.13*sin(q.x*4.8-t+params.offset)
      + params.fold*0.16*sin(q.x*4.0+q.y*3.0+cos(t));
    if(params.crossing > 2.5){other += 0.13*sin(q.x*11.0+q.y*8.0+sin(t));}
    let a = strand(field,params.density);
    let b = strand(other,params.density*0.83);
    let ea = exp(-field*field*6.0);
    let eb = exp(-other*other*6.0);
    var ca = mix(middle,light,sweep);
    var cb = mix(light,middle,0.5+0.5*sin(other*7.0-p.x*2.0));
    if(params.palette > 2.5){ca=popColor(0.5+0.5*sin(field*7.0+p.x));cb=popColor(0.5+0.5*cos(other*6.0-p.x+1.7));}
    if(params.palette>5.5){ca=layerColor(0u);cb=layerColor(1u);}
    var crossed = deep*0.4 + ca*a*ea + cb*b*eb;
    if(params.crossing < 1.5){
      let parity = fract((floor(field*params.density+0.5)+floor(other*params.density*0.83+0.5))*0.5)*2.0;
      crossed = deep*0.4 + ca*a*ea*(1.0-b*(1.0-parity)) + cb*b*eb*(1.0-a*parity);
    }else{
      crossed += a*b*ea*eb*vec3f(0.4,0.32,0.22);
    }
    if(params.crossing > 2.5){
      let third = p.x*0.7-p.y*0.6+0.19*sin(p.y*8.0+p.x*3.0-t)+0.1*cos(p.x*12.0+t+params.offset);
      let c = strand(third,params.density*0.61);
      var cc=mix(ca,cb,0.5);if(params.palette>5.5){cc=layerColor(2u);}
      crossed += cc*c*exp(-third*third*7.0)*0.8;
    }
    rgb = mix(rgb,crossed,params.mixAmount);
  }
  if (params.layers < 2.5) {
    let line = 1.0 - smoothstep(0.003, 0.008, abs(field));
    rgb = deep + line * light;
  }
  let vignette = 1.0 - 0.35 * smoothstep(0.25, 0.75, distance(uv, vec2f(0.5)));
  return vec4f(rgb * vignette, 1.0);
}
