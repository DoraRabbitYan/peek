import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync('extension/content.js','utf8');
const bridge = readFileSync('extension/page-bridge.js','utf8');
function setup() {
  const state = {composerMedia:[],replyText:'草稿'};
  const revoked=[], notices=[];
  const ctx=vm.createContext({state,URL:{createObjectURL:f=>'blob:'+f.name,revokeObjectURL:u=>revoked.push(u)},notify:(...x)=>notices.push(x),renderReader(){},window:{requestAnimationFrame(){}},document:{querySelector(){}},ROOT_ID:'test'});
  vm.runInContext(source.slice(source.indexOf('  function addMediaFiles('),source.indexOf('  function renderReplyTools(')),ctx);
  return {state,revoked,notices,ctx};
}
const file=(name,type='image/png',size=100)=>({name,type,size});
test('images are capped at four and removing one releases its preview',()=>{
 const h=setup();h.ctx.addMediaFiles([1,2,3,4,5].map(i=>file('image'+i)));
 assert.equal(h.state.composerMedia.length,4);assert.equal(h.notices.length,1);
 h.ctx.removeMediaItem(h.state.composerMedia[0].id);
 assert.equal(h.state.composerMedia.length,3);assert.equal(h.revoked[0],'blob:image1');assert.equal(h.state.replyText,'草稿');
});
test('mixed images/videos and multiple videos are rejected in either input order',()=>{
 for (const files of [[file('a'),file('b','video/mp4')],[file('b','video/mp4'),file('a')],[file('a','video/mp4'),file('b','video/mp4')]]) {
 const h=setup();h.ctx.addMediaFiles(files);assert.equal(h.state.composerMedia.length,1);assert.equal(h.notices.length,1);
 }
});
test('oversized images/videos and non-media files are not added',()=>{
 const h=setup();h.ctx.addMediaFiles([file('a','image/png',21*1024**2),file('b','video/mp4',513*1024**2),file('c','text/plain')]);
 assert.equal(h.state.composerMedia.length,0);
});
function uploader(responses) {
 const calls=[];
 const ctx=vm.createContext({Blob,FormData,requestHeaders:async()=>({}),setTimeout:fn=>fn(),fetch:async(url,opts)=>{calls.push({url,command:opts.body?.get('command')});const r=responses.shift();assert.ok(r,'unexpected request');return {ok:r.ok!==false,status:r.status||200,json:async()=>r.json};}});
 vm.runInContext(bridge.slice(bridge.indexOf('  async function uploadMedia('),bridge.indexOf('  async function createReply(')),ctx);
 return {ctx,calls};
}
const init={json:{media_id_string:'9007199254740993123'}}, append={json:{}};
test('successful chunked video upload polls until succeeded and preserves media ID',async()=>{
 const h=uploader([init,append,{json:{processing_info:{state:'pending'}}},{json:{processing_info:{state:'succeeded'}}}]);
 const id=await h.ctx.uploadMedia(new Blob(['data'],{type:'video/mp4'}),'test.mp4','video/mp4');
 assert.equal(id,'9007199254740993123');assert.equal(h.calls.length,4);
});
test('FINALIZE failed processing must reject instead of returning a publishable media ID',async()=>{
 const h=uploader([init,append,{json:{processing_info:{state:'failed',error:{message:'bad video'}}}}]);
 await assert.rejects(h.ctx.uploadMedia(new Blob(['data'],{type:'video/mp4'}),'test.mp4','video/mp4'));
});
test('STATUS HTTP failure must reject instead of treating missing processing state as success',async()=>{
 const h=uploader([init,append,{json:{processing_info:{state:'pending'}}},{ok:false,status:503,json:{errors:[{message:'unavailable'}]}}]);
 await assert.rejects(h.ctx.uploadMedia(new Blob(['data'],{type:'video/mp4'}),'test.mp4','video/mp4'));
});
function clipboardHarness(text='') {
 const h=setup(), handlers={};h.state.replyText=text;
 Object.assign(h.ctx,{composer:{addEventListener:(name,fn)=>handlers[name]=fn,classList:{add(){},remove(){}}},textarea:{value:text},window:{requestAnimationFrame(){}}});
 vm.runInContext(source.slice(source.indexOf('    composer.addEventListener("paste"'),source.indexOf('    composer.addEventListener("focusout"')),h.ctx);
 return {...h,handlers};
}
test('clipboard file items and file-list fallback both add images',()=>{
 for(const fallback of [false,true]) {
 const h=clipboardHarness();let prevented=false;
 h.handlers.paste({clipboardData:{items:fallback?[]:[{kind:'file',getAsFile:()=>file('paste')}],files:fallback?[file('paste')]:[],getData:()=>''},preventDefault(){prevented=true;}});
 assert.equal(h.state.composerMedia.length,1);assert.equal(prevented,true);
 }
});
test('drop accepts media files and ignores text files',()=>{
 const h=clipboardHarness();h.handlers.drop({preventDefault(){},dataTransfer:{files:[file('drop'),file('txt','text/plain')]}});
 assert.equal(h.state.composerMedia.length,1);
});
test('pasting combined image and text must not discard the text when a draft exists',()=>{
 const h=clipboardHarness('原草稿');
 h.handlers.paste({clipboardData:{items:[{kind:'file',getAsFile:()=>file('paste')}],getData:()=>'+新文字'},preventDefault(){}});
 assert.ok(h.state.replyText.includes('+新文字'),'pasted text was lost');
});


test('paste replaces selected text while retaining surrounding draft',()=>{
 const h=clipboardHarness('before OLD after');h.ctx.textarea.selectionStart=7;h.ctx.textarea.selectionEnd=10;
 h.handlers.paste({clipboardData:{items:[{kind:'file',getAsFile:()=>file('paste')}],getData:()=>'NEW'},preventDefault(){}});
 assert.equal(h.state.replyText,'before NEW after');
});
test('STATUS missing processing information is not treated as success',async()=>{
 const h=uploader([init,append,{json:{processing_info:{state:'pending'}}},{json:{}}]);
 await assert.rejects(h.ctx.uploadMedia(new Blob(['data']), 'test.mp4','video/mp4'),/未返回处理结果/);
});
test('an aborted upload does not even initialize media',async()=>{
 const h=uploader([]), controller=new AbortController();controller.abort();
 await assert.rejects(h.ctx.uploadMedia(new Blob(['data']),'test.mp4','video/mp4',controller.signal));
 assert.equal(h.calls.length,0);
});
function replyHarness(upload,send) {
 const calls=[];
 const ctx=vm.createContext({Blob,AbortSignal,uploadMedia:upload,graphql:async(...args)=>{calls.push(args);return send(...args);}});
 vm.runInContext(bridge.slice(bridge.indexOf('  async function createReply('),bridge.indexOf('  function followStateFromUser(')),ctx);
 return {ctx,calls};
}
test('expired request cannot publish even if delivered late',async()=>{
 const h=replyHarness(async()=> '123',async()=>({}));
 await assert.rejects(h.ctx.createReply('1','text',[],Date.now()-1),/未发送回复/);
 assert.equal(h.calls.length,0);
});
test('failed upload never calls CreateTweet',async()=>{
 const h=replyHarness(async()=>{throw new Error('upload failed');},async()=>({}));
 await assert.rejects(h.ctx.createReply('1','text',[{buffer:new ArrayBuffer(2),type:'video/mp4'}]),/upload failed/);
 assert.equal(h.calls.length,0);
});
test('successful reply passes its deadline signal to publishing',async()=>{
 const h=replyHarness(async()=> '123',async()=>({ok:true}));
 await h.ctx.createReply('1','text',[]);
 assert.equal(h.calls[0][0],'CreateTweet');assert.equal(h.calls[0][3].aborted,false);
});
test('lost publish response reports unknown state and does not retry',async()=>{
 const h=replyHarness(async()=> '123',async()=>{throw new Error('connection lost');});
 await assert.rejects(h.ctx.createReply('1','text'),/发布状态未确认/);
 assert.equal(h.calls.length,1);
});
test('explicit server rejection retains useful failure text',async()=>{
 const h=replyHarness(async()=> '123',async()=>{const e=new Error('not allowed');e.replyRejected=true;throw e;});
 await assert.rejects(h.ctx.createReply('1','text'),/not allowed/);
});
test('unknown publishing state preserves the draft and blocks a second submission',async()=>{
 const state={replyText:'keep draft',composerMedia:[],focal:{id:'1',counts:{replies:0}},busy:new Set()};let requests=0;
 const ctx=vm.createContext({state,renderReader(){},notify(){},requestPage:async()=>{requests++;throw new Error('发布状态未确认，请先核对');}});
 vm.runInContext(source.slice(source.indexOf('  async function publishReply('),source.indexOf('  function createIconButton(')),ctx);
 await ctx.publishReply();await ctx.publishReply();
 assert.equal(state.replyText,'keep draft');assert.equal(state.replyUnconfirmed,true);assert.equal(requests,1);assert.equal(state.busy.has('reply'),false);
});
test('upload timeout cannot advance to CreateTweet',async()=>{
 const controller=new AbortController();let writes=0;
 const ctx=vm.createContext({Blob,AbortSignal:{timeout:()=>controller.signal},uploadMedia:async()=>{controller.abort();return '123';},graphql:async()=>{writes++;}});
 vm.runInContext(bridge.slice(bridge.indexOf('  async function createReply('),bridge.indexOf('  function followStateFromUser(')),ctx);
 await assert.rejects(ctx.createReply('1','text',[{buffer:new ArrayBuffer(1),type:'video/mp4'}]));
 assert.equal(writes,0);
});
