import { createNode, isEffect, type Patch, type NodeType } from './core';
import type { CatalogPreset } from './preset-catalog';

function recipe(name: string, devices: [string, NodeType, Record<string,number>?][], wires: [string,string,string,number?][]): Patch {
  return { version: 2, name, transport: { bpm: 120, loopSeconds: 16 }, events: [],
    nodes: devices.map(([id,type,params],i) => {
      const node=createNode(type,id); Object.assign(node.params,params);
      node.position={x:type==='lfo'?270:type==='mixer4'?540:isEffect(type)?810:type==='output'?1080:0,y:type==='lfo'?380:((type==='mixer4'||isEffect(type)||type==='output')?130:i*210)};
      return node;
    }),
    connections:wires.map(([from,to,port,depth],i)=>({id:`wire-${i}`,from:{node:from,port:depth===undefined?'frame':'value'},to:{node:to,port},...(depth===undefined?{}:{depth})})),
  };
}

// Editor audition recipes stay separate from the frozen 23-film release catalog.
export const performanceBank: CatalogPreset[] = [
  {
    id:'crosscurrent', bank:'Mixer & Memory', name:'Crosscurrent', duration:16, loopable:true,
    description:'An LFO trades two colored streams across opposing channel faders.',
    patch:recipe('Crosscurrent',[
      ['silk','silk',{palette:5,density:22,fold:0.42}],['lattice','lattice',{palette:7,density:12,fold:0.3}],
      ['breath','lfo',{beats:16}],['mix','mixer4',{levelA:0.5,levelB:0.5}],['output','output'],
    ],[['silk','mix','a'],['lattice','mix','b'],['breath','mix','param:levelA',0.48],['breath','mix','param:levelB',-0.48],['mix','output','in']]),
    controls:[{node:'mix',param:'levelA',label:'Silk level'},{node:'mix',param:'levelB',label:'Lattice level'},{node:'mix',param:'master',label:'Master'}],
  },
  {
    id:'memory-carousel', bank:'Mixer & Memory', name:'Memory Carousel', duration:16, loopable:false,
    description:'Three streams mix into a rotating feedback chamber; slow modulation steers the returning image.',
    patch:recipe('Memory Carousel',[
      ['orbit','orbit',{palette:6,density:7}],['cells','cells',{palette:7,sites:12,fill:0.35}],['lattice','lattice',{palette:8,density:9,fold:0.25}],
      ['drift','lfo',{beats:32}],['mix','mixer4',{levelA:0.65,levelB:0.3,levelC:0.3,blend:2}],
      ['memory','fx.feedback',{amount:0.85,decay:0.975,injection:0.18,zoom:1.005,rotate:0.007}],['output','output'],
    ],[['orbit','mix','a'],['cells','mix','b'],['lattice','mix','c'],['mix','memory','in'],['drift','memory','param:shiftX',0.004],['drift','mix','param:levelB',0.2],['memory','output','in']]),
    controls:[{node:'mix',param:'levelB',label:'Cells level'},{node:'memory',param:'injection',label:'Fresh image'},{node:'memory',param:'decay',label:'Memory'}],
  },
];

const operatorStudies: {id:string;name:string;description:string;params:Record<string,number>;drift:number}[] = [
  {id:'velvet-sidebands',name:'Velvet Sidebands',description:'Gentle sinusoidal phase folds with a slowly breathing modulation index.', params:{mode:0,frequency:6,ratio:0.5,depth:1.6,crossing:1.3,palette:6,smoothing:0.45},drift:0.6},
  {id:'chrome-teeth',name:'Chrome Teeth',description:'A saw modulator cuts metallic ridges across a sine carrier.', params:{mode:0,frequency:9,ratio:1.5,depth:5,modulator:2,crossing:0.7,palette:7,smoothing:0.28},drift:1.4},
  {id:'ring-orchard',name:'Ring Orchard',description:'Signed triangle and sine multiplication opens a moving lattice of cancellations.', params:{mode:1,carrier:1,frequency:7,ratio:0.75,depth:1.8,crossing:1.55,palette:3,smoothing:0.35,width:0.09},drift:0.5},
];
for (const study of operatorStudies) {
  performanceBank.push({id:study.id,name:study.name,bank:'Operator Studies',duration:16,loopable:true,description:study.description,
    patch:recipe(study.name,[['source','operator',study.params],['breath','lfo',{beats:32}],['glow','fx.glow',{amount:0.25}],['output','output']],
      [['source','glow','in'],['breath','source','param:depth',study.drift],['glow','output','in']]),
    controls:[{node:'source',param:'depth',label:'Modulation depth'},{node:'source',param:'ratio',label:'Frequency ratio'},{node:'source',param:'smoothing',label:'Harmonic smoothing'}],
  });
}

// Geometry Oscillator ports (2026-09-22 genart session). Each study pairs a source with
// existing processors rather than adding source-specific effects.
function chain(patch: Patch): Patch {
  // Lay devices out left to right in declaration order; controls sit underneath.
  let row = 0, column = 1;
  for (const node of patch.nodes) {
    if (node.type === 'lfo') { node.position = { x: 270, y: 420 }; continue; }
    const source = !isEffect(node.type) && node.type !== 'output' && node.type !== 'mixer4';
    node.position = source ? { x: 0, y: row++ * 260 } : { x: 290 * column++, y: 130 };
  }
  return patch;
}
performanceBank.push(
  {id:'poincare-garden',name:'Poincaré Garden',bank:'Geometry Studies',duration:16,loopable:true,
    description:'A {7,3} hyperbolic tiling drifts through its disk while a slow LFO swells the Möbius translation.',
    patch:chain(recipe('Poincaré Garden',[['source','hyperbolic',{sides:7,meet:3,drift:0.45,palette:9,zoom:1.08}],['breath','lfo',{beats:32}],['glow','fx.glow',{amount:0.3}],['output','output']],
      [['source','glow','in'],['breath','source','param:drift',0.15],['glow','output','in']])),
    controls:[{node:'source',param:'drift',label:'Möbius drift'},{node:'source',param:'edge',label:'Edge width'},{node:'source',param:'spread',label:'Depth color spread'}]},
  {id:'crystal-mandala',name:'Crystal Mandala',bank:'Geometry Studies',duration:16,loopable:true,
    description:'Seven interfering waves fold into an eight-wedge kaleidoscope; the wave phase spread breathes.',
    patch:chain(recipe('Crystal Mandala',[['source','quasicrystal',{symmetry:7,scale:18,flow:2,palette:10,bands:12}],['breath','lfo',{beats:32}],['kaleido','fx.kaleido',{segments:8,amount:1}],['glow','fx.glow',{amount:0.2}],['output','output']],
      [['source','kaleido','in'],['kaleido','glow','in'],['breath','source','param:twist',0.3],['glow','output','in']])),
    controls:[{node:'source',param:'twist',label:'Wave phase spread'},{node:'source',param:'scale',label:'Wave frequency'},{node:'kaleido',param:'twist',label:'Spiral twist'}]},
  {id:'tesseract-afterimage',name:'Tesseract Afterimage',bank:'Geometry Studies',duration:16,loopable:false,
    description:'A tesseract turns through the fourth dimension; low injection lets the feedback chamber keep a long, contracting trail.',
    patch:chain(recipe('Tesseract Afterimage',[['source','polytope',{shape:1,turns:2,tumble:1,palette:9,zoom:1.7}],['breath','lfo',{beats:32}],['memory','fx.feedback',{amount:1,decay:0.996,injection:0.08,zoom:0.994,rotate:-0.004}],['glow','fx.glow',{amount:0.35}],['output','output']],
      [['source','memory','in'],['memory','glow','in'],['breath','source','param:tilt',0.8],['glow','output','in']])),
    controls:[{node:'source',param:'tilt',label:'4D tilt'},{node:'memory',param:'decay',label:'Memory'},{node:'source',param:'perspective',label:'4D camera distance'}]},
  {id:'tesseract-in-the-disk',name:'Tesseract in the Disk',bank:'Geometry Studies',duration:16,loopable:false,
    description:'A 24-cell cut through a hyperbolic tiling by difference blend, then a softened Crushed Reverie (crush 0.40).',
    patch:chain(recipe('Tesseract in the Disk',[['source','polytope',{shape:2,turns:1,palette:11,zoom:2,halo:0.35}],['disk','hyperbolic',{sides:5,meet:4,palette:2,drift:0.35}],['breath','lfo',{beats:64}],
      ['mix','mixer4',{levelA:1,levelB:0.8,master:0.6,blend:4}],['reverb-a','fx.reverb',{amount:1}],['crush','fx.crush',{amount:0.4}],['reverb-b','fx.reverb',{amount:1}],['output','output']],
      [['source','mix','a'],['disk','mix','b'],['breath','mix','param:levelB',0.3],['mix','reverb-a','in'],['reverb-a','crush','in'],['crush','reverb-b','in'],['reverb-b','output','in']])),
    controls:[{node:'mix',param:'levelB',label:'Tiling level'},{node:'source',param:'tilt',label:'4D tilt'},{node:'crush',param:'amount',label:'Color crush'}]},
  {id:'zellige-drift',name:'Zellige Drift',bank:'Geometry Studies',duration:16,loopable:true,
    description:'A fivefold zellige with strapwork; the phason orbit flips tiles while the view circles.',
    patch:chain(recipe('Zellige Drift',[['source','multigrid',{symmetry:5,lines:1,palette:9,size:11,flip:0.35,pan:2}],['breath','lfo',{beats:32}],['glow','fx.glow',{amount:0.15}],['output','output']],
      [['source','glow','in'],['breath','source','param:phasonX',0.25],['glow','output','in']])),
    controls:[{node:'source',param:'flip',label:'Phason orbit'},{node:'source',param:'size',label:'Tile size'},{node:'source',param:'grout',label:'Grout width'}]},
  {id:'delft-loom',name:'Delft Loom',bank:'Geometry Studies',duration:16,loopable:false,
    description:'Sevenfold Delft arcs flipping through a radial Chrono Loom, so the rim lags the centre.',
    patch:chain(recipe('Delft Loom',[['source','multigrid',{symmetry:7,lines:2,palette:10,size:16,flip:0.6,pan:0}],['loom','fx.chrono',{amount:0.9,seconds:1.6,mode:2,spread:0.2}],['output','output']],
      [['source','loom','in'],['loom','output','in']])),
    controls:[{node:'loom',param:'seconds',label:'Age span'},{node:'loom',param:'spread',label:'RGB age spread'},{node:'source',param:'flip',label:'Phason orbit'}]},
  {id:'zellige-in-the-disk',name:'Zellige in the Disk',bank:'Geometry Studies',duration:16,loopable:true,
    description:'Hyperbolic Map folds a panning zellige into an {8,3} Poincaré disk: two pantry ingredients composed. Phason flips stay off here: magnified, one discrete flip repaints the whole disk.',
    patch:chain(recipe('Zellige in the Disk',[['source','multigrid',{symmetry:5,lines:1,palette:9,size:22,flip:0,pan:3}],['disk','fx.hyperbolic',{sides:8,meet:3,scale:0.4,edge:0,drift:0.3}],['glow','fx.glow',{amount:0.2}],['output','output']],
      [['source','disk','in'],['disk','glow','in'],['glow','output','in']])),
    controls:[{node:'disk',param:'drift',label:'Möbius drift'},{node:'disk',param:'scale',label:'Input area per tile'},{node:'source',param:'size',label:'Tile size'}]},
  {id:'operator-cathedral',name:'Operator Cathedral',bank:'Geometry Studies',duration:16,loopable:true,
    description:'Operator Bloom phase-modulation folded into a {7,3} disk; an LFO breathes the modulation depth.',
    patch:chain(recipe('Operator Cathedral',[['source','operator',{frequency:6,ratio:0.5,depth:1.6,crossing:1.3,palette:6,smoothing:0.45}],['breath','lfo',{beats:32}],['disk','fx.hyperbolic',{sides:7,meet:3,scale:0.3,edge:0.5}],['glow','fx.glow',{amount:0.3}],['output','output']],
      [['source','disk','in'],['breath','source','param:depth',0.8],['disk','glow','in'],['glow','output','in']])),
    controls:[{node:'source',param:'depth',label:'Modulation depth'},{node:'disk',param:'sides',label:'Polygon sides'},{node:'disk',param:'edge',label:'Seam darkness'}]},
  {id:'plasma-polytope',name:'Plasma Polytope',bank:'Geometry Studies',duration:16,loopable:true,
    description:'A 24-cell dragged through Ink Marbling becomes crackling plasma; an LFO swells the drag.',
    patch:chain(recipe('Plasma Polytope',[['source','polytope',{shape:2,turns:1,palette:9,zoom:1.8,halo:0.35}],['breath','lfo',{beats:32}],['marble','fx.marble',{strength:0.14,warp:3.5,scale:2.4,flow:0.6,veins:0}],['glow','fx.glow',{amount:0.45}],['output','output']],
      [['source','marble','in'],['breath','marble','param:strength',0.08],['marble','glow','in'],['glow','output','in']])),
    controls:[{node:'marble',param:'strength',label:'Drag strength'},{node:'marble',param:'warp',label:'Noise bends noise'},{node:'source',param:'halo',label:'Halo'}]},
  {id:'acid-ebru',name:'Acid Ebru',bank:'Geometry Studies',duration:16,loopable:true,
    description:'A stained-glass quasicrystal combed into marbled paper, veins and all.',
    patch:chain(recipe('Acid Ebru',[['source','quasicrystal',{symmetry:7,scale:14,flow:1,palette:10,bands:8}],['marble','fx.marble',{strength:0.18,warp:4.5,veins:0.45,bands:6}],['output','output']],
      [['source','marble','in'],['marble','output','in']])),
    controls:[{node:'marble',param:'veins',label:'Ink veins'},{node:'marble',param:'strength',label:'Drag strength'},{node:'source',param:'symmetry',label:'Wave count'}]},
  {id:'hue-tunnel',name:'Hue Tunnel',bank:'Geometry Studies',duration:16,loopable:false,
    description:'The gallery feedback tunnel inside the synth: Orbital Bloom pulled inward, lighten composite, trails turning hue every tick.',
    patch:chain(recipe('Hue Tunnel',[['source','orbit',{density:5,glow:0.2,palette:6}],['breath','lfo',{beats:32}],['memory','fx.feedback',{amount:1,zoom:0.965,rotate:-0.03,decay:0.98,injection:0.1,hue:0.1,lighten:1}],['output','output']],
      [['source','memory','in'],['breath','memory','param:hue',0.03],['memory','output','in']])),
    controls:[{node:'memory',param:'hue',label:'Hue drift'},{node:'memory',param:'zoom',label:'Tunnel zoom'},{node:'memory',param:'rotate',label:'Twist'}]},
  {id:'cyanotype-veil',name:'Cyanotype Veil',bank:'Geometry Studies',duration:16,loopable:true,
    description:'A Clifford attractor printed as a cyanotype, its constants orbiting so the veil folds and refolds.',
    patch:chain(recipe('Cyanotype Veil',[['source','attractor',{kind:0,a:-1.4,b:1.6,c:1.0,d:0.7,orbit:0.08,print:0}],['output','output']],
      [['source','output','in']])),
    controls:[{node:'source',param:'orbit',label:'Constant orbit'},{node:'source',param:'exposure',label:'Exposure'},{node:'source',param:'a',label:'a'}]},
);

// Instruments: Doodle Lab pieces rebuilt as sources (generators/instruments.ts). Each ships two
// snapshots with three knobs, Morph and a touch/XY mapping for the Player.
performanceBank.push(
  {id:'acid-checker-garden',name:'Acid Checker Garden',bank:'Instruments',duration:16,loopable:true,
    description:'The conformal grid of a rational function: every little square stays square while three zeros and two poles circle.',
    patch:chain(recipe('Acid Checker Garden',[['source','complex',{arrangement:0,style:2,lines:12,spin:1,flow:2,drift:0.6,zoom:1.6}],['glow','fx.glow',{amount:0.25}],['output','output']],
      [['source','glow','in'],['glow','output','in']])),
    controls:[{node:'source',param:'spread',label:'Zero / pole spread'},{node:'source',param:'lines',label:'Contour density'},{node:'source',param:'hue',label:'Colour cycle'}],
    touch:{x:{node:'source',param:'drift'},y:{node:'source',param:'zoom'},hint:'Drag: left–right drifts the zeros and poles, up–down zooms.'}},
  {id:'neon-quartet',name:'Neon Quartet',bank:'Instruments',duration:16,loopable:true,
    description:'Four zeros and three poles warped threefold by z³: glowing modulus contours and phase rays spin out of every root.',
    patch:chain(recipe('Neon Quartet',[['source','complex',{arrangement:4,style:0,warp:3,lines:10,spin:-1,flow:1,drift:0.4,zoom:1.3,hue:0.55}],['glow','fx.glow',{amount:0.4}],['output','output']],
      [['source','glow','in'],['glow','output','in']])),
    controls:[{node:'source',param:'drift',label:'Handle drift'},{node:'source',param:'lines',label:'Phase rays'},{node:'glow',param:'amount',label:'Glow'}],
    touch:{x:{node:'source',param:'hue'},y:{node:'source',param:'spread'},hint:'Drag: left–right cycles colour, up–down spreads the roots.'}},
  {id:'escher-garden',name:'Escher Garden',bank:'Instruments',duration:16,loopable:true,
    description:'The acid checker garden fed through a Droste spiral: every ring holds the next copy, zooming in one ratio per loop.',
    patch:chain(recipe('Escher Garden',[['source','complex',{arrangement:0,style:2,lines:10,spin:1,flow:1,drift:0.5,zoom:1.4}],['droste','fx.droste',{ratio:3,arms:1,zoom:1,outer:0.46,soft:0.25}],['glow','fx.glow',{amount:0.2}],['output','output']],
      [['source','droste','in'],['droste','glow','in'],['glow','output','in']])),
    controls:[{node:'droste',param:'ratio',label:'Scale ratio'},{node:'droste',param:'arms',label:'Spiral arms'},{node:'droste',param:'outer',label:'Ring radius'}],
    touch:{x:{node:'source',param:'hue'},y:{node:'droste',param:'soft'},hint:'Drag: left–right cycles colour, up–down softens the seams.'}},
  {id:'zellige-vortex',name:'Zellige Vortex',bank:'Instruments',duration:16,loopable:true,
    description:'Strapwork zellige pulled into a two-armed Droste vortex that zooms and turns once per loop.',
    patch:chain(recipe('Zellige Vortex',[['source','multigrid',{symmetry:5,lines:1,palette:9,size:8,flip:0}],['droste','fx.droste',{ratio:2.5,arms:2,zoom:1,spin:0,outer:0.5,soft:0.2}],['output','output']],
      [['source','droste','in'],['droste','output','in']])),
    controls:[{node:'droste',param:'ratio',label:'Scale ratio'},{node:'droste',param:'soft',label:'Seam softness'},{node:'source',param:'size',label:'Tile size'}],
    touch:{x:{node:'droste',param:'ratio'},y:{node:'droste',param:'outer'},hint:'Drag: left–right sets the scale ratio, up–down the ring radius.'}},
  {id:'breathing-bulb',name:'Breathing Bulb',bank:'Instruments',duration:16,loopable:true,
    description:'A sphere-traced Mandelbulb whose power breathes while the camera circles it once per loop.',
    patch:chain(recipe('Breathing Bulb',[['source','julia',{shape:1,power:8,breathe:0.7,distance:2.5,tilt:0.3,hue:0.8,spread:1.2,glow:0.9}],['output','output']],
      [['source','output','in']])),
    controls:[{node:'source',param:'power',label:'Bulb power'},{node:'source',param:'breathe',label:'Breathing'},{node:'source',param:'spread',label:'Colour spread'}],
    touch:{x:{node:'source',param:'hue'},y:{node:'source',param:'tilt'},hint:'Drag: left–right cycles colour, up–down tilts the camera.'}},
  {id:'nautilus-julia',name:'Nautilus Julia',bank:'Instruments',duration:16,loopable:true,
    description:'A quaternion Julia set, a complex Julia set spun around the real axis, breathing as its constant orbits.',
    patch:chain(recipe('Nautilus Julia',[['source','julia',{cx:-0.2,cy:0.8,cz:0,breathe:0.5,distance:2.5,tilt:0.05,spread:0.5,hue:0.5,glow:1}],['output','output']],
      [['source','output','in']])),
    controls:[{node:'source',param:'slice',label:'4D slice'},{node:'source',param:'cz',label:'c j'},{node:'source',param:'glow',label:'Glow'}],
    touch:{x:{node:'source',param:'cx'},y:{node:'source',param:'cy'},hint:'Drag to steer the Julia constant c: every point is a different set.'}},
  {id:'slime-mold-wars',name:'Slime Mold Wars',bank:'Instruments',duration:20,loopable:false,
    description:'Three rival physarum colonies, a quarter-million agents, each following its own trail and fleeing the others. Drag to lay food.',
    patch:{...chain(recipe('Slime Mold Wars',[['source','slime',{species:3,palette:6,grid:512,agents:1,aggression:1.2,decay:0.9,diffuse:0.2,deposit:2,exposure:0.45,sensorAngle:0.6,turn:0.45,steps:2}],['glow','fx.glow',{amount:0.2}],['output','output']],
      [['source','glow','in'],['glow','output','in']])),simulation:{tickHz:60,warmupTicks:120,events:[]}},
    controls:[{node:'source',param:'aggression',label:'Rival repulsion'},{node:'source',param:'sensorAngle',label:'Sensor angle'},{node:'source',param:'decay',label:'Trail persistence'}],
    touch:{inject:'source',hint:'Drag to lay food: every colony races to it.'}},
  {id:'mycelium-truce',name:'Mycelium Truce',bank:'Instruments',duration:20,loopable:false,
    description:'Two colonies at truce: low rivalry lets gold and jade veins braid past each other into one shared network.',
    patch:{...chain(recipe('Mycelium Truce',[['source','slime',{species:2,palette:3,grid:512,agents:1,sensorDistance:7,sensorAngle:0.6,turn:0.5,decay:0.93,diffuse:0.15,deposit:1.5,aggression:0.3,exposure:0.6}],['output','output']],
      [['source','output','in']])),simulation:{tickHz:60,warmupTicks:240,events:[]}},
    controls:[{node:'source',param:'aggression',label:'Rivalry'},{node:'source',param:'sensorDistance',label:'Sensor reach'},{node:'source',param:'turn',label:'Turn speed'}],
    touch:{inject:'source',x:{node:'source',param:'exposure'},hint:'Drag to feed the network; left–right sets the glow.'}},
  {id:'ink-in-water',name:'Ink in Water',bank:'Instruments',duration:20,loopable:false,
    description:'Three stirrers trail luminous ink through a stable-fluids tank; vorticity keeps every eddy curling. Drag to swirl the water.',
    patch:{...chain(recipe('Ink in Water',[['source','ink',{grid:512,palette:6,emitters:3,curl:7,stir:1,swirl:0.8,fade:0.996,ink:0.55,exposure:0.6}],['glow','fx.glow',{amount:0.25}],['output','output']],
      [['source','glow','in'],['glow','output','in']])),simulation:{tickHz:60,warmupTicks:180,events:[]}},
    controls:[{node:'source',param:'curl',label:'Vorticity'},{node:'source',param:'fade',label:'Ink persistence'},{node:'source',param:'stir',label:'Stirrer strength'}],
    touch:{inject:'source',hint:'Drag to swirl the water and release ink.'}},
  {id:'marbled-tide',name:'Marbled Tide',bank:'Instruments',duration:20,loopable:false,
    description:'Slow stirrers and long-lived ink fold into marbled bands, then Ink Marbling combs the whole tank once more.',
    patch:{...chain(recipe('Marbled Tide',[['source','ink',{grid:512,palette:3,emitters:4,curl:5,stir:0.8,swirl:0.5,fade:0.997,ink:0.45,exposure:0.8}],['marble','fx.marble',{strength:0.05,warp:2.5,veins:0.3,bands:7}],['output','output']],
      [['source','marble','in'],['marble','output','in']])),simulation:{tickHz:60,warmupTicks:300,events:[]}},
    controls:[{node:'source',param:'swirl',label:'Stirrer speed'},{node:'marble',param:'veins',label:'Ink veins'},{node:'source',param:'curl',label:'Vorticity'}],
    touch:{inject:'source',x:{node:'marble',param:'strength'},hint:'Drag to swirl; left–right sets the marbling drag.'}},
  {id:'frost-fizz',name:'Frost Fizz',bank:'Instruments',duration:16,loopable:true,
    description:'A chilled white can up close: brushed aluminium, torn silver scratches, beads of condensation and carbonation streaming upward.',
    patch:chain(recipe('Frost Fizz',[['source','fizz',{palette:0,fizz:0.35,frost:0.4,claws:4,slant:0.2}],['output','output']],
      [['source','output','in']])),
    controls:[{node:'source',param:'fizz',label:'Carbonation'},{node:'source',param:'frost',label:'Condensation'},{node:'source',param:'clawDepth',label:'Scratch depth'}],
    touch:{x:{node:'source',param:'light'},y:{node:'source',param:'bubbleSize'},hint:'Drag: left–right moves the light, up–down sizes the bubbles.'}},
  {id:'fizz-vortex',name:'Fizz Vortex',bank:'Instruments',duration:16,loopable:true,
    description:'The chrome-night can pulled into a Droste spiral: scratches and bubbles recurse inward forever.',
    patch:chain(recipe('Fizz Vortex',[['source','fizz',{palette:2,fizz:0.5,frost:0.3,claws:4,slant:0.2,bubbleSize:1.2}],['droste','fx.droste',{ratio:3.2,arms:1,zoom:1,outer:0.5,soft:0.25}],['output','output']],
      [['source','droste','in'],['droste','output','in']])),
    controls:[{node:'source',param:'fizz',label:'Carbonation'},{node:'droste',param:'ratio',label:'Scale ratio'},{node:'droste',param:'arms',label:'Spiral arms'}],
    touch:{x:{node:'source',param:'light'},y:{node:'droste',param:'outer'},hint:'Drag: left–right moves the light, up–down the ring radius.'}},
);
