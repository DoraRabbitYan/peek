import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const bridge=readFileSync('extension/page-bridge.js','utf8'), content=readFileSync('extension/content.js','utf8');
function api(response) {
 const calls=[];
 const ctx=vm.createContext({Object,captured:{templates:new Map()},graphql:async(...args)=>{calls.push(args);if(response instanceof Error)throw response;return response;},deepFind(value,predicate){if(!value||typeof value!=='object')return null;if(predicate(value))return value;for(const v of Object.values(value)){const r=this.deepFind(v,predicate);if(r)return r;}return null;}});
 // Reuse the production traversal rather than a response-specific test parser.
 vm.runInContext(bridge.slice(bridge.indexOf('  function objectValue('),bridge.indexOf('  function normalizeHeaders('))+bridge.slice(bridge.indexOf('  function deepFind('),bridge.indexOf('  function findOperation('))+bridge.slice(bridge.indexOf('  async function readBookmarkFolders('),bridge.indexOf('  async function uploadMedia(')),ctx);
 return {ctx,calls};
}
test('reads native folders, preserving opaque string IDs and next cursor',async()=>{
 const h=api({data:{viewer:{bookmark_collections_slice:{items:[{id:'folder:123',name:'AI'},{id:123,name:'unsafe numeric id'}],slice_info:{next_cursor:'next'}}}}});
 const r=await h.ctx.readBookmarkFolders('');assert.equal(r.folders.length,1);assert.equal(r.folders[0].id,'folder:123');assert.equal(r.cursor,'next');assert.equal(h.calls[0][0],'BookmarkFoldersSlice');assert.equal(h.calls[0][2],'GET');
});
test('repeated cursor and empty pages terminate folder pagination',async()=>{
 for(const items of [[],[{id:'1',name:'Work'}]]){const h=api({data:{bookmark_collections_slice:{items,slice_info:{next_cursor:'same'}}}});assert.equal((await h.ctx.readBookmarkFolders('same')).cursor,null);}
});
test('missing folders and API errors do not masquerade as an empty successful list',async()=>{
 await assert.rejects(api({data:{}}).ctx.readBookmarkFolders(),/未返回收藏夹/);
 await assert.rejects(api(new Error('forbidden')).ctx.readBookmarkFolders(),/forbidden/);
});
test('folder write targets native mutation with exact string folder and tweet IDs',async()=>{
 const h=api({data:{bookmark_tweet_to_folder:'Done'}});assert.equal((await h.ctx.saveBookmarkToFolder('99','folder:123')).saved,true);
 assert.equal(h.calls[0][0],'bookmarkTweetToFolder');assert.equal(h.calls[0][1].tweet_id,'99');assert.equal(h.calls[0][1].bookmark_collection_id,'folder:123');
});
test('invalid folder ID and unconfirmed write response fail closed',async()=>{
 const h=api({});await assert.rejects(h.ctx.saveBookmarkToFolder('99',''),/ID/);assert.equal(h.calls.length,0);
 await assert.rejects(h.ctx.saveBookmarkToFolder('99','1'),/未确认/);
});
class Node {
 constructor(tag,cls='',text=''){Object.assign(this,{tag,cls,textContent:text,children:[],handlers:{},isConnected:true});}
 append(...n){this.children.push(...n);}
 setAttribute(k,v){this[k]=v;}
 addEventListener(k,fn){this.handlers[k]=fn;}
 focus(){}
 remove(){this.isConnected=false;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 querySelectorAll(selector){return this.children.flatMap(n=>[n,...n.querySelectorAll('*')]).filter(n=>selector==='*'||selector==='button'&&n.tag==='button'||selector.startsWith('.')&&n.cls.includes(selector.slice(1)));}
}
async function picker(response,bookmarked=false){
 const root=new Node('root'), state={busy:new Set()}, requests=[],actions=[];
 const model={id:'99',flags:{bookmarked},counts:{bookmarks:4}};
 const ctx=vm.createContext({state,ROOT_ID:'root',document:{getElementById:()=>root},element:(...a)=>new Node(...a),requestPage:async(type,payload)=>{requests.push({type,payload});if(typeof response === "function") return response(type,payload);if(type==='READ_BOOKMARK_FOLDERS') {if(response instanceof Error)throw response;return response;}return {saved:true};},findModel:()=>model,renderReader(){},notify(){},handleAction:(...args)=>actions.push(args)});
 vm.runInContext(content.slice(content.indexOf('  function openBookmarkPicker('),content.indexOf('  async function handleAction(')),ctx);ctx.openBookmarkPicker(model);await new Promise(r=>setImmediate(r));
 return {root,state,model,requests,actions};
}
test('opening picker never writes; selecting a native folder saves and updates bookmark once',async()=>{
 const h=await picker({folders:[{id:'f1',name:'分类 A'}],cursor:null});assert.equal(h.requests.length,1);assert.equal(h.model.flags.bookmarked,false);
 const button=h.root.querySelectorAll('button').find(n=>n.textContent==='分类 A');await button.handlers.click();
 assert.equal(h.requests[1].type,'SAVE_BOOKMARK_FOLDER');assert.equal(h.requests[1].payload.folderId,'f1');assert.equal(h.model.flags.bookmarked,true);assert.equal(h.model.counts.bookmarks,5);
});
test('already-bookmarked post can change folder without increasing count',async()=>{
 const h=await picker({folders:[{id:'f1',name:'分类 A'}],cursor:null},true);
 await h.root.querySelectorAll('button').find(n=>n.textContent==='分类 A').handlers.click();assert.equal(h.model.counts.bookmarks,4);
});
test('folder permission failure leaves ordinary bookmarking usable',async()=>{
 const h=await picker(new Error('forbidden'));
 await h.root.querySelectorAll('button').find(n=>n.textContent==='仅保存到所有书签').handlers.click();
 assert.equal(h.actions.length,1);assert.equal(h.actions[0][2],true);assert.equal(h.requests.length,1);
});

test('folder save failure preserves previous bookmark state',async()=>{
 const h=await picker(async(type)=>{if(type==='READ_BOOKMARK_FOLDERS')return {folders:[{id:'f1',name:'分类 A'}],cursor:null};throw new Error('save failed');});
 await h.root.querySelectorAll('button').find(n=>n.textContent==='分类 A').handlers.click();
 assert.equal(h.model.flags.bookmarked,false);assert.equal(h.model.counts.bookmarks,4);assert.equal(h.state.busy.size,0);
});
test('double-click during saving issues only one mutation',async()=>{
 let finish;
 const h=await picker(async(type)=>type==='READ_BOOKMARK_FOLDERS'?{folders:[{id:'f1',name:'分类 A'}],cursor:null}:new Promise(r=>{finish=r;}));
 const button=h.root.querySelectorAll('button').find(n=>n.textContent==='分类 A');const pending=button.handlers.click();await button.handlers.click();
 assert.equal(h.requests.filter(r=>r.type==='SAVE_BOOKMARK_FOLDER').length,1);finish({saved:true});await pending;
});
test('picker paginates folders and deduplicates repeated IDs',async()=>{
 const h=await picker(async(type,payload)=>payload.cursor?{folders:[{id:'f1',name:'A'},{id:'f2',name:'B'}],cursor:null}:{folders:[{id:'f1',name:'A'}],cursor:'next'});
 await h.root.querySelectorAll('button').find(n=>n.textContent==='加载更多收藏夹').handlers.click();
 assert.equal(h.root.querySelectorAll('button').filter(n=>n.textContent==='A').length,1);assert.ok(h.root.querySelectorAll('button').some(n=>n.textContent==='B'));
});

test('null folder mutation result cannot be reported as saved',async()=>{
 await assert.rejects(api({data:{bookmark_tweet_to_folder:null}}).ctx.saveBookmarkToFolder('99','f1'),/未确认/);
});
