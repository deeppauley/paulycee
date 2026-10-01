import assert from 'node:assert/strict';
import {publishLibrary} from '../publish.js';
const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
const current=new Uint8Array([1,2,3]);
const version=Buffer.from(await crypto.subtle.digest('SHA-256',current)).toString('hex');
const requests=[],blobs=[];
globalThis.fetch=async(url,options)=>{const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):null;requests.push({path,body});
  assert.equal(options.headers.Authorization,'Bearer test-token');
  let data;
  if(path.endsWith('/git/ref/heads/main'))data={object:{sha:'parent'}};
  else if(path.endsWith('/git/commits/parent'))data={tree:{sha:'base-tree'}};
  else if(path.includes('/contents/'))data={content:Buffer.from(current).toString('base64')};
  else if(path.endsWith('/git/blobs')){blobs.push(Buffer.from(body.content,'base64'));data={sha:'blob'+blobs.length};}
  else if(path.endsWith('/git/trees')){assert.equal(body.base_tree,'base-tree');assert.ok(body.tree.every(t=>t.path.startsWith('practice/library/')));data={sha:'tree'};}
  else if(path.endsWith('/git/commits')){assert.deepEqual(body.parents,['parent']);data={sha:'new-commit'};}
  else if(path.endsWith('/git/refs/heads/main')){assert.equal(body.force,false);data={object:{sha:body.sha}};}
  else throw Error('Unexpected request');
  return {ok:true,json:async()=>data};
};
const args={token:'test-token',key,tracks:[{id:'0',file:'000.bin',name:'Existing'},{id:'local-1',name:'New track',filename:'private-original.wav',local:true}],name:'Test library',libraryVersion:version,readFile:async()=>new Blob(['private audio bytes']),status:()=>{}};
assert.equal(await publishLibrary(args),'new-commit');assert.equal(blobs.length,2);
async function open(b){return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:b.subarray(0,12)},key,b.subarray(12)));}
assert.equal(await open(blobs[0]),'private audio bytes');assert.equal(blobs[0].includes(Buffer.from('private audio bytes')),false);
const manifest=JSON.parse(await open(blobs[1]));assert.equal(manifest.tracks.length,2);assert.equal(manifest.tracks[1].local,undefined);assert.equal(manifest.tracks[1].filename,undefined);
const before=blobs.length;await assert.rejects(()=>publishLibrary({...args,libraryVersion:'stale'}),/changed since you unlocked/);assert.equal(blobs.length,before);
console.log('PASS: browser publishing encrypts audio and metadata, preserves existing files, rejects stale libraries, and never force-pushes. GitHub mocked; no live upload token used.');
