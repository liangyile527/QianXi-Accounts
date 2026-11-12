'use strict';
// 实例页内查找：真实 Electron 页面验证 Ctrl+F 拦截、查找栏渲染、计数回报、Enter 循环、
// Esc 关闭、IPC 通道、右键菜单模板，以及实例停止后的清理。
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'qianxi-page-find-test-'));app.setPath('userData',root);app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');if(process.platform==='linux')app.commandLine.appendSwitch('disable-gpu');
const {Controller}=require('../src/main/controller.cjs'),{installIPC}=require('../src/main/ipc.cjs'),pageTools=require('../src/main/page-tools.cjs');
let win,c,server;const results=[],errors=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));const wait=async(fn,label,n=300)=>{for(let i=0;i<n;i++){try{const value=await fn();if(value)return value;}catch{}await sleep(50);}throw Error('Timeout: '+label);};const ok=name=>{results.push(name);console.log('PASS '+name);};
setTimeout(()=>app.exit(2),90000).unref();
app.whenReady().then(async()=>{try{
 server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Find fixture</title><body><p>alpha one</p><p>alpha two</p><p>beta</p><input id="field" value="alpha"></body>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port+'/';
 win=new BrowserWindow({width:1400,height:900,show:true,webPreferences:{preload:path.join(__dirname,'../src/main/preload.cjs'),sandbox:true,contextIsolation:true}});
 c=new Controller(win,root,path.join(__dirname,'../resources/mihomo',process.platform==='win32'?'mihomo.exe':'mihomo'));installIPC(win,c);
 const a=c.store.list()[0]||c.store.create('页内查找实例');c.store.update(a.id,{name:'页内查找实例',url});
 await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));const ui=code=>win.webContents.executeJavaScript(code);await wait(()=>ui('typeof route==="function"&&!!current()'),'renderer');
 await c.start(a.id);const runtime=()=>c.runtimes.get(a.id),wc=()=>runtime().view.webContents;await wait(()=>wc().getURL()===url&&!wc().isLoading(),'instance loaded');
 await ui(`localOpen.add(${JSON.stringify(a.id)});route('browser',${JSON.stringify(a.id)})`);await wait(()=>ui('!!document.querySelector("#addressField")'),'address row');

 // Ctrl+F 走实例网页的 before-input-event，由主进程通知渲染层打开查找栏。
 wc().sendInputEvent({type:'keyDown',keyCode:'F',modifiers:['control']});wc().sendInputEvent({type:'keyUp',keyCode:'F',modifiers:['control']});
 await wait(()=>ui('!!document.querySelector("#pageFindInput")'),'find bar opens');ok('Ctrl+F 打开查找栏');

 await ui(`(()=>{const i=document.querySelector('#pageFindInput');i.value='alpha';i.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
 const count=await wait(()=>{const t=ui('document.querySelector("#pageFindCount").textContent');return t.then(x=>/^\d+\/\d+$/.test(x)?x:'');},'match count');
 assert.equal(count,'1/3');assert.equal(runtime().find.query,'alpha');ok('输入关键字得到 1/3 并回报到主进程');

 await ui(`document.querySelector('[data-page-find=next]').click()`);
 assert.equal(await wait(()=>{const t=ui('document.querySelector("#pageFindCount").textContent');return t.then(x=>x==='2/3'?x:'');},'next match'),'2/3');
 await ui(`document.querySelector('[data-page-find=prev]').click()`);
 assert.equal(await wait(()=>{const t=ui('document.querySelector("#pageFindCount").textContent');return t.then(x=>x==='1/3'?x:'');},'previous match'),'1/3');ok('下一个 / 上一个循环命中');

 await ui(`document.querySelector('[data-page-find=close]').click()`);
 await wait(()=>ui('!document.querySelector("#pageFindInput")'),'find bar closes');assert.equal(runtime().find,null);assert.equal(runtime().findLast,'alpha');ok('关闭查找栏并从实例状态移除查找会话');

 const opened=await c.externalRequest({action:'page-find-open',id:a.id});assert.equal(opened.ok,true);assert.equal(opened.value.query,'alpha');
 await wait(()=>ui('!!document.querySelector("#pageFindInput")'),'channel reopens find bar');ok('本地控制通道重开查找栏并回填上次关键字');
 await c.externalRequest({action:'page-find-close',id:a.id});await wait(()=>ui('!document.querySelector("#pageFindInput")'),'channel closes find bar');

 // 右键菜单模板：内置项在前，扩展项追加在后；宫格视图不提供查找。
 const items=pageTools.template(c,a.id,runtime(),wc(),{pageURL:url,frameURL:url,mediaType:'none',isEditable:false,selectionText:''});
 const labels=items.filter(x=>x.label).map(x=>x.label);
 for(const label of ['后退','前进','重新加载','在此页查找…','检查'])assert.ok(labels.includes(label),'missing menu item: '+label);
 const selected=pageTools.template(c,a.id,runtime(),wc(),{pageURL:url,mediaType:'none',isEditable:false,selectionText:'alpha two'});
 assert.deepEqual(selected.filter(x=>x.label).map(x=>x.label),['复制','用所选文字查找','检查']);ok('网页右键菜单包含导航、查找、检查与选中文字项');

 const saved=c.grid;c.grid={tiles:[]};
 assert.throws(()=>pageTools.open(c,a.id),/宫格/);c.grid=saved;ok('宫格视图拒绝打开查找');

 // 输入法：组合期间（拼音串）不发请求、不更新主进程查询；上屏后才按最终文本查找。
 await c.externalRequest({action:'page-find-open',id:a.id});
 await wait(()=>ui('!!document.querySelector("#pageFindInput")'),'find bar for ime');
 const beforeIme=runtime().find.query;
 await ui(`(async()=>{const i=document.querySelector('#pageFindInput');i.focus();
  for(const s of ['z','zh','zha','zhao']){i.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
   i.value=s;i.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));await new Promise(r=>setTimeout(r,60));}
  i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true}));
  return i.value;})()`);
 await sleep(320);
 assert.equal(runtime().find.query,beforeIme,'组合期间的拼音串不应成为查找词');
 assert.equal(await ui('document.querySelector("#pageFindCount").textContent'),'','组合期间不应出现「查找中…」或计数');
 await ui(`(()=>{const i=document.querySelector('#pageFindInput');i.value='beta';i.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));return true;})()`);
 await wait(()=>runtime().find.query==='beta','compositionend 后按最终文本查找');
 assert.equal(await wait(()=>{const t=ui('document.querySelector("#pageFindCount").textContent');return t.then(x=>/^\d+\/\d+$/.test(x)?x:'');},'count after ime'),'1/1');
 ok('输入法组合期间不发送查找，上屏后按最终文本查找');

 // 停止实例时视图被回收，查找栏必须由主进程主动清场，不能挂着上一个实例的关键字。
 await c.stop(a.id);
 await wait(()=>ui('!document.querySelector("#pageFind")'),'find bar cleared on stop');
 assert.equal(c.runtimes.get(a.id).find??null,null);assert.equal(c.runtimes.get(a.id).pageTools??null,null);ok('实例停止后解绑页内查找并清掉查找栏');
}catch(e){errors.push(e.stack||String(e));console.error(e);}finally{try{await c?.closeAll();}catch(e){errors.push(e.message);}win?.destroy();if(server){server.closeAllConnections();server.close();}const report={platform:process.platform,electron:process.versions.electron,passed:results.length,results,errors};fs.writeFileSync(path.join(root,'page-find-report.json'),JSON.stringify(report,null,1));console.log(JSON.stringify(report));app.exit(errors.length?1:0);}});
