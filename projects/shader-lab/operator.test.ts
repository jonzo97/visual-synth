import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createNode} from './core';
it.skipIf(process.env.DIVERGENT_GPU_TESTS!=='1')('Operator Bloom renders distinct PM/ring fields, animates and loops',async()=>{
 const api=await import('vgpu/node'); const gpu=await api.init({adapter:'hardware'});
 try {
  const out=api.target(gpu,{size:[192,108],format:'rgba8unorm'});
  const params={...createNode('operator').params,aspect:192/108,phase:0};
  const effect=api.effect(gpu,readFileSync(new URL('./generators/operator.wgsl',import.meta.url),'utf8'),{set:{params}});
  await effect.compile(out);
  const render=async(overrides:Record<string,number>)=>{effect.set({params:{...params,...overrides}});api.frame(gpu,f=>f.pass(out,effect));return new Uint8Array(await out.read());};
  const diff=(a:Uint8Array,b:Uint8Array)=>a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]!),0)/a.length;
  const base=await render({});
  expect(diff(base,await render({phase:1}))).toBeGreaterThan(3);
  expect(diff(base,await render({phase:2*Math.PI}))).toBeLessThan(0.1);
  expect(diff(base,await render({mode:1}))).toBeGreaterThan(3);
  expect(diff(await render({depth:0,mode:0}),await render({depth:0,mode:1}))).toBe(0); // both reduce to the same carrier
  for(let mode=0;mode<2;mode++) for(let carrier=0;carrier<4;carrier++) {
   const pixels=await render({mode,carrier,modulator:carrier});
   expect(Math.max(...pixels.filter((_,i)=>i%4!==3))).toBeGreaterThan(80);
  }
 } finally {gpu.dispose();}
},30000);

