import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ImageCache } from './imageCache.ts';
import { cardFacePath, PRESENTATION_VERSION } from './presentation.ts';

const directory=new URL('../../public/cards/crayon-v1/',import.meta.url);
test('all 52 identities plus jokers and back have real correctly sized, audited PNGs',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',directory),'utf8'));
  assert.equal(manifest.version,'crayon-deck-v1');
  assert.equal(manifest.entries.length,55);
  assert.equal(new Set(manifest.entries.map(e=>e.file)).size,55);
  for(const suit of ['♦','♣','♥','♠'])for(const rank of ['A','2','3','4','5','6','7','8','9','10','J','Q','K']){
    const card=manifest.entries.find(e=>e.suit===suit&&e.rank===rank);assert.ok(card,rank+suit);
    assert.equal(cardFacePath(rank+suit,PRESENTATION_VERSION).split('/').at(-1),card.file);
    assert.equal(card.pipCount,['J','Q','K'].includes(rank)?null:rank==='A'?1:Number(rank));
  }
  for(const entry of manifest.entries){
    const png=fs.readFileSync(new URL(entry.file,directory));
    assert.equal(png.subarray(1,4).toString(),'PNG');
    assert.equal(png.readUInt32BE(16),1020);assert.equal(png.readUInt32BE(20),1425);
    assert.equal(crypto.createHash('sha256').update(png).digest('hex'),entry.sha256,entry.file);
  }
});
test('cache evicts least recently used unpinned assets within entry and byte budgets',()=>{
  const cache=new ImageCache(3,100);cache.retain(['current']);
  cache.set('current','shown',30);cache.set('old','old',30);cache.set('next','next',30);
  cache.get('old');cache.set('new','new',30);
  assert.equal(cache.get('next'),undefined);assert.equal(cache.get('current'),'shown');
  cache.cost('new',65);assert.equal(cache.get('old'),undefined);
  assert.ok(cache.snapshot().bytes<=100);assert.ok(cache.snapshot().entries<=3);
  cache.retain(['new']);cache.set('future','future',25);
  assert.equal(cache.get('current'),undefined);assert.equal(cache.get('new'),'new');
});
test('six targets, reference and deck fit the production 64 MiB cache budget',()=>{
  const bytes=1020*1425*4,cache=new ImageCache();
  const current=Array.from({length:8},(_,i)=>'shown-'+i);cache.retain(current);
  current.forEach(key=>cache.set(key,key,bytes));
  for(let i=0;i<30;i++)cache.set('past-'+i,i,bytes);
  assert.ok(cache.snapshot().bytes<=64*1024*1024);assert.ok(cache.snapshot().entries<=12);
  current.forEach(key=>assert.equal(cache.get(key),key));
});
test('all forty sample pip cards are fixed-size static PNGs from the archived HTML',()=>{
  const directory=new URL('../../public/cards/web-pips-v2/',import.meta.url);
  const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',directory),'utf8'));
  assert.equal(manifest.version,'crayon-deck-v2');assert.equal(manifest.baseVersion,'crayon-deck-v1');
  assert.deepEqual(manifest.settings,{rough:3,mis:2,gap:.3,lw:1.5,draft:true,boil:false});
  assert.equal(manifest.entries.length,40);assert.equal(new Set(manifest.entries.map(e=>e.file)).size,40);
  for(const suit of ['♦','♣','♥','♠'])for(const rank of ['A','2','3','4','5','6','7','8','9','10']){
    const entry=manifest.entries.find(e=>e.rank===rank&&e.suit===suit);assert.ok(entry,rank+suit);
    assert.equal(cardFacePath(rank+suit,PRESENTATION_VERSION,'crayon-deck-v2'),'cards/web-pips-v2/'+entry.file);
    assert.equal(entry.pipCount,rank==='A'?1:Number(rank));
    const png=fs.readFileSync(new URL(entry.file,directory));
    assert.equal(png.readUInt32BE(16),1020);assert.equal(png.readUInt32BE(20),1425);
    assert.equal(crypto.createHash('sha256').update(png).digest('hex'),entry.sha256);
  }
  for(const [file,expected]of [['source.html',manifest.sourceSha256],['MaShanZheng-Regular.ttf',manifest.fontSha256]]){
    const source=fs.readFileSync(new URL('../../../artwork/web-pips-v2/'+file,import.meta.url));
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'),expected);
  }
});

test('borderless revision preserves all identities, dimensions and source provenance',()=>{
  const dir=new URL('../../public/cards/borderless-v3/',import.meta.url);
  const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',dir),'utf8'));
  assert.equal(manifest.version,'crayon-deck-v3');assert.equal(manifest.innerFrame,false);
  assert.equal(manifest.entries.length,55);assert.equal(new Set(manifest.entries.map(e=>e.file)).size,55);
  for(const entry of manifest.entries){
    const png=fs.readFileSync(new URL(entry.file,dir));
    assert.equal(png.readUInt32BE(16),1020);assert.equal(png.readUInt32BE(20),1425);
    assert.equal(crypto.createHash('sha256').update(png).digest('hex'),entry.sha256);
    if(!['back','Joker'].includes(entry.rank))assert.equal(cardFacePath(entry.rank+entry.suit,PRESENTATION_VERSION,'crayon-deck-v3'),'cards/borderless-v3/'+entry.file);
    if(!['back','Joker','J','Q','K'].includes(entry.rank))assert.equal(entry.pipCount,entry.rank==='A'?1:Number(entry.rank));
  }
  const oldPips=JSON.parse(fs.readFileSync(new URL('../../public/cards/web-pips-v2/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.sources[0].sourceSha256,oldPips.sourceSha256);
  assert.equal(manifest.sources[0].fontSha256,oldPips.fontSha256);
  assert.deepEqual(manifest.sources[0].settings,oldPips.settings);
  const oldCourt=JSON.parse(fs.readFileSync(new URL('manifest.json',directory),'utf8'));
  assert.deepEqual(manifest.sources[1].sourceHashes,oldCourt.sourceHashes);
  assert.equal(manifest.entries.find(e=>e.rank==='back').sha256,oldCourt.entries.find(e=>e.rank==='back').sha256);
});

test('uniform paper revision has all 54 faces and preserves original court and back pixels',()=>{
 const dir=new URL('../../public/cards/uniform-v4/',import.meta.url);
 const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',dir),'utf8'));
 const previous=JSON.parse(fs.readFileSync(new URL('../../public/cards/borderless-v3/manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.version,'crayon-deck-v4');assert.equal(manifest.paperColor,'#FFFEFC');assert.equal(manifest.fixationShape,'cross');
 assert.equal(manifest.entries.length,55);assert.equal(new Set(manifest.entries.map(e=>e.file)).size,55);
 for(const e of manifest.entries){
  const png=fs.readFileSync(new URL(e.file,dir));
  assert.equal(png.readUInt32BE(16),1020);assert.equal(png.readUInt32BE(20),1425);
  assert.equal(crypto.createHash('sha256').update(png).digest('hex'),e.sha256);
  if(!['back','Joker'].includes(e.rank))assert.equal(cardFacePath(e.rank+e.suit,PRESENTATION_VERSION),'cards/uniform-v4/'+e.file);
  if(['back','Joker','J','Q','K'].includes(e.rank))assert.equal(e.sha256,previous.entries.find(p=>p.file===e.file).sha256);
  else {assert.equal(e.pipCount,e.rank==='A'?1:Number(e.rank));assert.notEqual(e.sha256,previous.entries.find(p=>p.file===e.file).sha256);}
 }
});
