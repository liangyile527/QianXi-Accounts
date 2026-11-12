'use strict';
// 实例网页的页内查找（Ctrl+F）与网页右键菜单。
// 每个实例只有一个网页视图，所以查找状态直接挂在实例运行时（r.find）上，不区分标签页；
// 宫格视图不提供查找和「检查」，避免对缩略图画布做无意义的页面操作。
//
// 注意：Electron 的 webContents 事件只派发给发起调用的那个包装对象，`view.webContents`
// 不能假设每次取到同一个引用。所以 attach 时把引用缓存在 r.pageWebContents 上，
// 查找、停止查找、菜单动作全部用这份引用 —— 否则会出现「findInPage 有返回值，
// 但 found-in-page 永不触发、界面永远停在『查找中…』」。
const {Menu,clipboard}=require('electron');
const MAX_QUERY=200;
function query(value){return typeof value==='string'?value.replace(/[\r\n]+/g,' ').slice(0,MAX_QUERY):'';}
function state(r){if(!r.find)r.find={query:'',matches:0,active:0,requestId:0,pending:false,searched:false};return r.find;}
// reason 让渲染层区分「自己请求的关闭」与「视图没了被动清场」：
// 前者可能是乱序到达的旧回报，后者必须无条件照做。
function emitFind(c,id,r,reason){
 if(c.window.isDestroyed()||c.window.webContents.isDestroyed())return;
 const f=r.find;
 c.window.webContents.send('core:page-find',f?{id,open:true,query:f.query,matches:f.matches,active:f.active,pending:f.pending,searched:f.searched}:{id,open:false,reason:reason||'state',at:Date.now()});
}
function active(c,id){
 const r=c.runtimes.get(id),wc=r?.pageWebContents;
 if(!r||r.status!=='running'||!wc||wc.isDestroyed())throw Error('请先启动实例');
 return {r,wc};
}
// 渲染层收到 core:page-find-open 后显示查找栏并把焦点交给输入框；打开时不执行任何脚本。
function open(c,id,{text}={}){
 const {r}=active(c,id);
 if(c.grid)throw Error('请先从宫格放大或切换到浏览页面再查找');
 const value=query(text??r.findLast??'');
 state(r).query=value;
 c.window.webContents.focus();
 c.window.webContents.send('core:page-find-open',{id,query:value});
 return {query:value};
}
function search(c,id,value,{forward=true,next=false}={}){
 const {r,wc}=active(c,id),f=state(r),text=query(value);
 f.query=text;
 if(!text){
  // 让 requestId 失效：清空输入后，上一轮 findInPage 的 found-in-page 仍会到达，
  // 只要 id 还对得上就会把 pending 设回 true，界面闪一下「查找中…」。
  f.requestId=-1;f.matches=0;f.active=0;f.pending=false;f.searched=false;
  try{wc.stopFindInPage('clearSelection');}catch{}
  emitFind(c,id,r);return {matches:0,active:0};
 }
 // 首次查找不传 findNext（显式传 false 在本机 Electron 里不会产生 found-in-page 事件）；
 // Enter / Shift+Enter 循环时传 findNext:true 继续同一会话。
 const options={forward:forward!==false};
 if(next)options.findNext=true;
 f.requestId=wc.findInPage(text,options);
 f.pending=true;
 emitFind(c,id,r);
 return {pending:true};
}
function close(c,id,{action='keepSelection',focusPage=true}={}){
 const r=c.runtimes.get(id);if(!r)return {closed:false};
 const wc=r.pageWebContents,f=r.find;
 if(f?.query)r.findLast=f.query;
 r.find=null;
 if(wc&&!wc.isDestroyed()){
  try{wc.stopFindInPage(action==='clearSelection'?'clearSelection':'keepSelection');}catch{}
  if(focusPage)try{wc.focus();}catch{}
 }
 emitFind(c,id,r,'request');
 return {closed:true};
}
function copy(value){if(!value)return;try{clipboard.writeText(String(value));}catch{}}
function trim(items){
 const out=[];
 for(const item of items){if(item.type==='separator'&&(!out.length||out[out.length-1].type==='separator'))continue;out.push(item);}
 while(out.length&&out[out.length-1].type==='separator')out.pop();
 return out;
}
function nav(wc,method){
 try{
  if(wc.navigationHistory&&typeof wc.navigationHistory[method]==='function')return Boolean(wc.navigationHistory[method]());
  return Boolean(wc[method]&&wc[method]());
 }catch{return false;}
}
function suggest(c,id,url){
 if(!url)return;
 setImmediate(()=>{Promise.resolve(c.navigate(id,url)).catch(error=>c.log(id,'打开链接失败：'+require('./workspace.cjs').redact(error.message),'WARN'));});
}
function inspect(c,id,wc,params){
 const x=Math.max(0,Math.round(Number(params?.x)||0)),y=Math.max(0,Math.round(Number(params?.y)||0)),r=c.runtimes?.get?.(id),already=Boolean(r?.devtoolsOpen)||wc.isDevToolsOpened?.()===true;
 Promise.resolve()
  .then(()=>already?null:c.toggleDevTools(id))
  .then(()=>{if(!wc.isDestroyed())wc.inspectElement(x,y);})
  .catch(error=>c.log(id,'打开开发者工具失败：'+require('./workspace.cjs').redact(error.message),'WARN'));
}
function openFind(c,id,r,text){
 try{open(c,id,{text});}catch(error){c.log(id,require('./workspace.cjs').redact(error.message),'WARN');}
}
function template(c,id,r,wc,params){
 const p=params||{},items=[];
 if(p.linkURL)items.push({label:'打开链接',click:()=>suggest(c,id,p.linkURL)},{label:'复制链接地址',click:()=>copy(p.linkURL)},{type:'separator'});
 else if(p.mediaType==='image'&&p.srcURL)items.push(
  {label:'打开图片',click:()=>suggest(c,id,p.srcURL)},
  {label:'复制图片',click:()=>{try{wc.copyImageAt(Math.max(0,Math.round(Number(p.x)||0)),Math.max(0,Math.round(Number(p.y)||0)));}catch{}}},
  {label:'复制图片地址',click:()=>copy(p.srcURL)},{type:'separator'});
 if(p.isEditable){
  const f=p.editFlags||{};
  items.push(
   {role:'undo',label:'撤销',enabled:f.canUndo!==false},
   {role:'redo',label:'重做',enabled:f.canRedo!==false},{type:'separator'},
   {role:'cut',label:'剪切',enabled:f.canCut!==false},
   {role:'copy',label:'复制',enabled:f.canCopy!==false},
   {role:'paste',label:'粘贴',enabled:f.canPaste!==false},
   {role:'selectAll',label:'全选',enabled:f.canSelectAll!==false},{type:'separator'});
 }
 const selected=(p.selectionText||'').trim();
 if(!p.isEditable){
  if(selected)items.push({label:'复制',click:()=>copy(p.selectionText)},{label:'用所选文字查找',click:()=>openFind(c,id,r,p.selectionText)});
  else items.push(
   {label:'后退',enabled:nav(wc,'canGoBack'),click:()=>nav(wc,'goBack')},
   {label:'前进',enabled:nav(wc,'canGoForward'),click:()=>nav(wc,'goForward')},
   {label:'重新加载',click:()=>{try{wc.reload();}catch{}}},
   {type:'separator'},
   {label:'在此页查找…',accelerator:'CmdOrCtrl+F',registerAccelerator:false,click:()=>openFind(c,id,r)});
 }
 if(!c.grid)items.push({type:'separator'},{label:'检查',click:()=>inspect(c,id,wc,p)});
 const extra=r.extensionHost?.menuItems?.(p,wc)||[];
 return trim(extra.length?[...items,{type:'separator'},...extra]:items);
}
function build(c,id,r,wc,params){
 const items=template(c,id,r,wc,params);
 return items.length?Menu.buildFromTemplate(items):null;
}
// 注册页面级监听，返回解绑函数；实例停止时由 controller 调用。
function attach(c,id,r,wc){
 r.pageWebContents=wc;
 const onFound=(_event,result)=>{
  const f=r.find;
  if(!f||f.requestId<0||result.requestId!==f.requestId)return;
  f.matches=result.matches||0;
  f.active=result.activeMatchOrdinal||0;
  if(result.finalUpdate){f.pending=false;f.searched=true;}
  emitFind(c,id,r);
 };
 const onNavigate=(_event,_url,isInPlace,isMainFrame)=>{
  if(!isMainFrame||isInPlace||!r.find)return;
  r.find.matches=0;r.find.active=0;r.find.pending=false;r.find.searched=false;
  emitFind(c,id,r);
 };
 const onContext=(_event,params)=>{
  const menu=build(c,id,r,wc,params);
  if(!menu)return;
  r.pageMenu=menu;
  menu.popup({window:c.window,callback:()=>{if(r.pageMenu===menu)r.pageMenu=null;}});
 };
 wc.on('found-in-page',onFound);
 wc.on('did-start-navigation',onNavigate);
 wc.on('context-menu',onContext);
 return ()=>{
  if(!wc.isDestroyed()){
   wc.removeListener('found-in-page',onFound);
   wc.removeListener('did-start-navigation',onNavigate);
   wc.removeListener('context-menu',onContext);
  }
  r.pageMenu?.closePopup?.();
  r.pageMenu=null;
  r.find=null;
  if(r.pageWebContents===wc)r.pageWebContents=null;
  // 实例停止/视图销毁时前端收不到 close 请求的回报，必须主动清场，
  // 否则查找栏会挂着上一个实例的关键字留在界面上。
  emitFind(c,id,r,'detach');
 };
}
module.exports={attach,open,search,close,template,build,MAX_QUERY};
