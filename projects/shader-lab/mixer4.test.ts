import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createNode, frameInputs, portType, validatePatch, evaluateParameters, applyRack } from './core';
import { performanceBank } from './performance-bank';

it('keeps the legacy mixer intact and exposes four independently modulatable channels',()=>{
  expect(createNode('mixer').params).toEqual({mix:0.5});
  const node=createNode('mixer4');
  expect(frameInputs(node)).toEqual(['a','b','c','d']);
  expect(portType(node,'frame','out')).toBe('frame');
  expect(portType(node,'param:levelD','in')).toBe('scalar');
  for(const preset of performanceBank) expect(validatePatch(preset.patch)).toEqual([]);
  const patch=performanceBank[0]!.patch;
  const values=evaluateParameters(patch,2).mix!;
  expect(values.levelA!+values.levelB!).toBeCloseTo(1);
  expect(values.levelA).not.toBe(0.5);
  expect(()=>applyRack(patch,'Crushed Reverie')).toThrow();
});

describe.skipIf(process.env.DIVERGENT_GPU_TESTS!=='1')('four-channel mixer pixels',()=>{
  it('renders the five blends and makes zero-level channels neutral',async()=>{
    const api=await import('vgpu/node'); const gpu=await api.init({adapter:'hardware'});
    try {
      const red=api.target(gpu,{size:[2,2],format:'rgba8unorm'});
      const blue=api.target(gpu,{size:[2,2],format:'rgba8unorm'});
      const out=api.target(gpu,{size:[2,2],format:'rgba8unorm'});
      const fill=(r:number,b:number)=>api.effect(gpu,`@fragment fn fs_main()->@location(0) vec4f{return vec4f(${r}.0,0.0,${b}.0,1.0);}`);
      const r=fill(1,0),b=fill(0,1); await r.compile(red);await b.compile(blue);
      api.frame(gpu,f=>{f.pass(red,r);f.pass(blue,b);});
      const params={...createNode('mixer4').params,levelA:0.5,levelB:0.5,levelC:0,levelD:0};
      const fx=api.effect(gpu,readFileSync(new URL('./mixer4.wgsl',import.meta.url),'utf8'),{set:{a:red,b:blue,c:red,d:blue,samp:api.sampler(gpu),params}});
      await fx.compile(out);
      const expected=[[128,0,128],[128,0,128],[128,0,128],[128,0,128],[128,0,128]];
      // Multiply blends each channel toward white by its opacity: .5 red × .5 blue = (.5,.25,.5).
      expected[3]=[128,64,128];
      for(let blend=0;blend<5;blend++) {
        fx.set({params:{...params,blend}});api.frame(gpu,f=>f.pass(out,fx));
        const pixels=await out.read();
        expected[blend]!.forEach((value,i)=>expect(Math.abs(pixels[i]!-value)).toBeLessThanOrEqual(1));
      }
      fx.set({params:{...params,levelA:1,levelB:1,levelC:1,levelD:1,blend:1}});
      api.frame(gpu,f=>f.pass(out,fx));
      expect(Array.from((await out.read()).slice(0,3))).toEqual([255,0,255]);
      fx.set({params:{...params,levelA:1,levelB:1,levelC:1,levelD:1,blend:0}});
      api.frame(gpu,f=>f.pass(out,fx));
      const balanced=await out.read();
      for(const channel of [0,2]) expect(Math.abs(balanced[channel]!-128)).toBeLessThanOrEqual(1);
      fx.set({params:{...params,levelA:0,levelB:0,blend:3}});api.frame(gpu,f=>f.pass(out,fx));
      expect(Array.from((await out.read()).slice(0,3))).toEqual([0,0,0]);
    } finally {gpu.dispose();}
  },30000);
});
