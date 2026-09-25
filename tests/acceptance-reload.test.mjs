import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('extension/content.js','utf8');
const helpers=source.slice(source.indexOf('  function extensionUrl('),source.indexOf('  function requestPage('));
test('invalidated extension context disables HLS worker without throwing',()=>{
 const ctx=vm.createContext({chrome:{runtime:{getURL(){throw new Error('Extension context invalidated.');}}}});
 vm.runInContext(helpers,ctx);const options=ctx.hlsWorkerOptions();
 assert.equal(options.enableWorker,false);assert.equal(options.workerPath,undefined);
});
test('valid context retains locally bundled HLS worker',()=>{
 const ctx=vm.createContext({chrome:{runtime:{getURL:p=>'chrome-extension://test/'+p}}});vm.runInContext(helpers,ctx);
 assert.equal(ctx.hlsWorkerOptions().enableWorker,true);assert.ok(ctx.hlsWorkerOptions().workerPath.endsWith('vendor/hls/hls.worker.js'));
});
test('date metadata opts out of translation and retains machine-readable date',()=>{
 const ctx=vm.createContext({element:(tag,cls,text)=>({tag,cls,text,setAttribute(k,v){this[k]=v;}}),formatDate:()=> '9/21'});vm.runInContext(helpers,ctx);
 const label=ctx.dateLabel('2026-09-21T00:00:00Z',true);
 assert.equal(label.tag,'time');assert.equal(label.translate,'no');assert.ok(label.cls.includes('notranslate'));assert.equal(label.text,' · 9/21');assert.equal(label.dateTime,'2026-09-21T00:00:00.000Z');
});
test('render failure produces a visible refresh action instead of a blank reader',()=>{
 let notice,reloaded=false;
 const ctx=vm.createContext({ROOT_ID:'test',console:{error(){}},renderReaderContent(){throw new Error('video failure');},document:{getElementById:()=>({querySelector:()=>({replaceChildren:n=>notice=n})})},window:{location:{reload(){reloaded=true;}}},element:(tag,cls,text)=>({tag,cls,text,children:[],append(...n){this.children.push(...n);},addEventListener(k,fn){this[k]=fn;}})});
 vm.runInContext(source.slice(source.indexOf('  function renderReader()'),source.indexOf('  function renderReaderContent()')),ctx);ctx.renderReader();
 assert.equal(notice.children[0].text,'内容暂时无法显示');notice.children.find(n=>n.tag==='button').click();assert.equal(reloaded,true);
});
