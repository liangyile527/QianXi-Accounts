'use strict';
/* 快捷网站栏的新能力：＋号添加、多列全部面板、分组颜色、左右拖动。
   只走生产 IPC（quick-link-save / quick-link-open），不直接改渲染层状态。 */
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'arena-quick-groups-'));app.setPath('userData',root);app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.commandLine.appendSwitch('disable-background-networking');if(process.platform==='linux')app.commandLine.appendSwitch('disable-gpu');
const {Controller}=require('../src/main/controller.cjs'),{installIPC}=require('../src/main/ipc.cjs'),{Workspace}=require('../src/main/workspace.cjs');
let win,c,server;const results=[],errors=[],hits=[];
const pause=(ms=140)=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(await fn())return;await new Promise(r=>setTimeout(r,40));}throw Error('Timeout '+label);};
const ok=name=>{results.push(name);console.log('PASS '+name);};
setTimeout(()=>app.exit(2),180000).unref();
app.whenReady().then(async()=>{try{
 server=http.createServer((req,res)=>{hits.push(req.url);res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Group fixture</title><h1>FIXTURE</h1>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 win=new BrowserWindow({width:1440,height:900,show:true,webPreferences:{preload:path.join(__dirname,'../src/main/preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
 c=new Controller(win,root,path.join(__dirname,'../resources/mihomo',process.platform==='win32'?'mihomo.exe':'mihomo'));installIPC(win,c);
 const a=c.store.list()[0];c.store.update(a.id,{url:base+'/home'});
 await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));
 const ui=code=>win.webContents.executeJavaScript(code);
 await wait(()=>ui('!!current()'),'initialize');
 await c.start(a.id);await ui(`route('browser',${JSON.stringify(a.id)})`);await pause();
 const r=c.runtimes.get(a.id);await wait(()=>r.view.webContents.getTitle()==='Group fixture','fixture page');
 const click=async selector=>{const point=await ui(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();if(e.disabled||r.width<1||!e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))throw Error('Not clickable '+${JSON.stringify(selector)});return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await pause();};

 // 1. 颜色分组：蓝蓝紫 无无 → 两个组 + 两个散标签，且散标签仍是列表的直接子元素
 const ids=c.workspace.data.quickLinks.map(x=>x.id);
 const tones=[[ids[0],'blue'],[ids[1],'blue'],[ids[2],'purple'],[ids[3],''],[ids[4],'']];
 await ui(`(async()=>{for(const pair of ${JSON.stringify(tones)}){const link=(await window.facet.request('snapshot')).value.quickLinks.find(x=>x.id===pair[0]);await window.facet.request('quick-link-save',{link:{id:link.id,name:link.name,url:link.url,color:pair[1]}});}state=(await window.facet.request('snapshot')).value;render();return 1})()`);
 await pause(160);
 const shape=await ui(`(()=>{const list=document.querySelector('#quickSiteList'),groups=[...list.querySelectorAll(':scope>.quick-group')];return {groups:groups.length,counts:groups.map(g=>g.querySelectorAll('.quick-site').length),tints:groups.map(g=>g.className.trim()),borders:groups.map(g=>getComputedStyle(g).borderTopWidth+' '+getComputedStyle(g).borderTopStyle),bg:groups.map(g=>getComputedStyle(g).backgroundColor),direct:list.querySelectorAll(':scope>.quick-site').length,directTint:[...list.querySelectorAll(':scope>.quick-site')].map(b=>b.className)}})()`);
 assert.equal(shape.groups,2,'two coloured groups');assert.deepEqual(shape.counts,[2,1]);assert.ok(shape.tints[0].includes('qc-blue')&&shape.tints[1].includes('qc-purple'),shape.tints.join('|'));
 assert.ok(shape.borders.every(b=>/^[\d.]+px solid$/.test(b)&&parseFloat(b)>=0.8),shape.borders.join('|'));assert.notEqual(shape.bg[0],shape.bg[1],'blue and purple groups differ');
 assert.equal(shape.direct,2,'uncoloured links stay direct children');assert.ok(shape.directTint.every(x=>!/qc-/.test(x)),shape.directTint.join('|'));
 assert.equal('color' in new Workspace(root).data.quickLinks[0],true);
 ok('Consecutive same-colour labels merge into one framed group; uncoloured labels stay flat');

 // 2. 清空颜色不写入空字段
 await ui(`(async()=>{const link=(await window.facet.request('snapshot')).value.quickLinks.find(x=>x.id===${JSON.stringify(ids[3])});await window.facet.request('quick-link-save',{link:{id:link.id,name:link.name,url:link.url,color:''}});state=(await window.facet.request('snapshot')).value;render();return 1})()`);
 await pause(140);assert.equal('color' in new Workspace(root).data.quickLinks.find(x=>x.id===ids[3]),false);
 ok('Clearing a colour drops the field instead of persisting an empty value');

 // 3. 管理窗口里的小色点可直接改色（每行 9 个：无 + 8 色）
 await click('[data-quick="manage"]');
 await wait(()=>ui('document.querySelector("#quickLinksDialog").open'),'manager open');
 assert.equal(await ui('document.querySelectorAll("#quickLinkRows .quick-manager-row:first-child .quick-color").length'),9,'nine swatches per row');
 await click('#quickLinkRows .quick-manager-row:first-child .quick-color.qc-red');
 await wait(()=>new Workspace(root).data.quickLinks[0].color==='red','swatch colour saved');
 assert.equal(await ui('document.querySelector("#quickSiteList .quick-site.qc-red")!==null'),true,'bar shows the new colour');
 await click('[data-quick="close"]');
 await wait(()=>ui('!document.querySelector("#quickLinksDialog").open'),'manager closed');
 await ui(`(async()=>{const link=(await window.facet.request('snapshot')).value.quickLinks.find(x=>x.id===${JSON.stringify(ids[0])});await window.facet.request('quick-link-save',{link:{id:link.id,name:link.name,url:link.url,color:'blue'}});state=(await window.facet.request('snapshot')).value;render();return 1})()`);
 await wait(()=>new Workspace(root).data.quickLinks[0].color==='blue','colour restored');
 ok('Manager swatches recolour a saved shortcut in one click');

 fs.writeFileSync(path.join(__dirname,`quick-links-groups-${process.platform}.png`),(await win.webContents.capturePage({x:240,y:96,width:win.getContentSize()[0]-240,height:110})).toPNG());

 // 3. ＋ 号添加任意网站（含颜色），并关闭原生页面遮挡
 await click('[data-quick="add"]');
 await wait(()=>ui('!!document.querySelector("#quickAddDialog")&&document.querySelector("#quickAddDialog").open'),'add dialog open');
 assert.equal(r.view.getVisible(),false);
 assert.equal(await ui('document.querySelector("#quickAddDialog").hasAttribute("data-browser-overlay")'),true);
 assert.equal(await ui('document.querySelectorAll("#quickAddColors .quick-color").length'),9,'nine swatches in the add form');
 fs.writeFileSync(path.join(__dirname,`quick-links-add-${process.platform}.png`),(await win.webContents.capturePage()).toPNG());
 await ui(`document.querySelector('#quickAddName').value='面板测试站';document.querySelector('#quickAddURL').value=${JSON.stringify(base+'/panel')}`);
 await click('#quickAddColors .quick-color.qc-green');
 await click('#quickAddDialog button[type="submit"]');
 await wait(()=>c.workspace.data.quickLinks.length===6,'plus add');
 const added=new Workspace(root).data.quickLinks.at(-1);
 assert.equal(added.name,'面板测试站');assert.equal(added.url,base+'/panel');assert.equal(added.color,'green');
 await wait(()=>ui('!document.querySelector("#quickAddDialog").open'),'add dialog closed');
 await wait(()=>r.view.getVisible(),'native restored after add');
 assert.equal(c.workspace.data.quickLinks[0].name,'Arena','default order intact');
 assert.equal(await ui(`[...document.querySelectorAll('#quickSiteList>.quick-group')].length`),3,'green group appended');
 ok('Plus button adds any HTTP site with a colour through production IPC');

 // 4. 全部面板：多列、按颜色区分、点击在当前实例打开
 await click('.quick-all');
 await wait(()=>ui('document.querySelector("#quickAllDialog").open'),'all panel open');
 assert.equal(r.view.getVisible(),false);
 const panel=await ui(`(()=>{const grid=document.querySelector('#quickAllGrid');return {items:grid.querySelectorAll('.quick-all-item').length,cols:getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,blue:grid.querySelectorAll('.quick-all-item.qc-blue').length,green:grid.querySelectorAll('.quick-all-item.qc-green').length,title:document.querySelector('#quickAllTitle').textContent}})()`);
 assert.equal(panel.items,6);assert.ok(panel.cols>=2,'multi-column grid got '+panel.cols);assert.equal(panel.blue,2,'the two blue defaults');assert.equal(panel.green,1);
 assert.ok(panel.title.includes('6'),panel.title);
 fs.writeFileSync(path.join(__dirname,`quick-links-all-${process.platform}.png`),(await win.webContents.capturePage()).toPNG());
 await click('#quickAllGrid .quick-all-item[data-quick-id="'+added.id+'"]');
 await wait(()=>r.view.webContents.getURL()===base+'/panel','panel navigation');
 await wait(()=>ui('!document.querySelector("#quickAllDialog").open'),'panel closed');
 await wait(()=>r.view.getVisible(),'native restored after panel');
 ok('All-sites panel lists every shortcut in several columns and opens it in the current instance');

 // 5. 左右拖动：真的滚动，且拖动不会误触导航；重渲染后位置保留
 win.setSize(960,760);await pause(200);
 while(!(await ui('(()=>{const l=document.querySelector("#quickSiteList");return l.scrollWidth>l.clientWidth+1})()'))){if(c.workspace.data.quickLinks.length>=21)break;c.workspace.saveQuickLink({name:'拖拽测试标签 '+c.workspace.data.quickLinks.length,url:base+'/drag'});c.emit();await pause(80);}
 await wait(()=>ui('(()=>{const l=document.querySelector("#quickSiteList");return l.scrollWidth>l.clientWidth+1})()'),'overflowing bar');
 await ui('document.querySelector("#quickSiteList").scrollLeft=0');await pause(80);
 const before=r.view.webContents.getURL();
 const from=await ui(`(()=>{const r=document.querySelector('#quickSiteList').getBoundingClientRect();return {x:Math.round(r.x+r.width-36),y:Math.round(r.y+r.height/2)}})()`);
 win.webContents.sendInputEvent({type:'mouseDown',x:from.x,y:from.y,button:'left',clickCount:1});
 for(let i=1;i<=10;i++){win.webContents.sendInputEvent({type:'mouseMove',x:from.x-i*20,y:from.y,button:'left',movementX:-20,movementY:0});await pause(16);}
 win.webContents.sendInputEvent({type:'mouseUp',x:from.x-200,y:from.y,button:'left',clickCount:1});
 await pause(90);
 const dragged=await ui('document.querySelector("#quickSiteList").scrollLeft');
 assert.ok(dragged>40,'drag scrolled to '+dragged);
 assert.equal(r.view.webContents.getURL(),before,'drag must not navigate');
 assert.equal(await ui('document.querySelector("#quickSiteList").classList.contains("dragging")'),false,'drag state cleared');
 const suppressed=await ui('Date.now()<quickSuppressUntil');
 if(suppressed){await click('#quickSiteList .quick-site');await pause(160);assert.equal(r.view.webContents.getURL(),before,'click right after drag is ignored');}
 await ui('render(true)');await pause(200);
 assert.ok(Math.abs((await ui('document.querySelector("#quickSiteList").scrollLeft'))-dragged)<=1,'scroll survives re-render');
 ok('Bar scrolls by dragging left and right, ignores the trailing click and keeps its offset across re-render');

}catch(e){errors.push(e.stack||String(e));console.error(e);}finally{try{await c?.closeAll();}catch(e){errors.push(e.message);}win?.destroy();server?.close();const report={platform:process.platform,electron:process.versions.electron,passed:results.length,results,errors};fs.writeFileSync(path.join(__dirname,`quick-links-groups-${process.platform}.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));app.exit(errors.length?1:0);}});
