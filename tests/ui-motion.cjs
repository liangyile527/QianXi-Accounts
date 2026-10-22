'use strict';
// 动画门禁：真实 Chromium + 真实 ui.css，检查「切换标签栏」的入场动画确实在跑、跑完不留残影、
// 被弹层挡住时先攒着等关掉再播、方向跟着前后顺序走、以及 prefers-reduced-motion 下彻底关掉但仍能切换。
// IPC 与运行时是模拟的（同 appearance-audit），不代表 Windows 端到端。
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {Store}=require('../src/main/store.cjs'),{Library}=require('../src/main/library.cjs'),{Workspace}=require('../src/main/workspace.cjs');
(async()=>{
const root=fs.mkdtempSync(path.join(os.tmpdir(),'arena-motion-')),store=new Store(root),library=new Library(root,store),workspace=new Workspace(root);
let browser,page;const results=[],errors=[];
const a=store.create('工作实例 A');
const snap=()=>({...workspace.snapshot(library),versions:{app:'test',electron:'simulated IPC'},coreInstalled:true,activeId:a.id,creationProgress:null,library:[],diagnostics:{job:null,lastJob:null,results:[]},instances:store.list().map(x=>({...x,status:'running',nodes:[],logs:[],assignment:{status:'未关联来源'},pageState:'已打开网页',error:'',currentURL:x.url}))});
const emit=()=>{if(page&&!page.isClosed())page.evaluate(s=>window.__listeners.onState?.(s),snap()).catch(()=>{});};
try{
browser=await chromium.launch({headless:true,args:['--no-sandbox']});
page=await browser.newPage({viewport:{width:1280,height:800}});
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});
await page.exposeFunction('__testRequest',async(action,m={})=>{try{let value;
 switch(action){
  case 'snapshot':return {ok:true,value:snap()};
  case 'layout':case 'activate':return {ok:true};
  case 'quick-bar-save':value=workspace.saveQuickBar(m.bar||{});break;
  case 'quick-bar-remove':workspace.removeQuickBar(m.barId);break;
  case 'quick-bar-activate':workspace.activateQuickBar(m.barId);break;
  case 'quick-bar-reorder':workspace.reorderQuickBars(m.barIds);break;
  case 'quick-link-reorder':value=workspace.reorderQuickLinks(m.ids);break;
  default:return {ok:true};
 }emit();return {ok:true,value};}catch(e){return {ok:false,error:e.message};}});
// 宽松桥：真实 preload 的方法远不止 request/onState，缺一个 initialize() 就静默停住。
await page.addInitScript(()=>{window.__listeners={};window.qianxi=new Proxy({},{get:(t,k)=>k==='request'?((x,p)=>window.__testRequest(x,p)):(typeof k==='string'&&k.startsWith('on')?((fn)=>{window.__listeners[k]=fn;return()=>{};}):(()=>Promise.resolve({ok:true})))});});
// 第一栏保留默认快捷网站再加两个，第二栏只有一个网站，切换后内容差异一眼可辨。
workspace.saveQuickLink({name:'甲站',url:'https://a.test/'});
workspace.saveQuickLink({name:'乙站',url:'https://b.test/'});
const secondId=workspace.saveQuickBar({name:'第二栏'});
workspace.saveQuickLink({name:'丙站',url:'https://c.test/',bar:secondId});
workspace.activateQuickBar('quick-bar-1');
await page.goto('file://'+path.resolve(__dirname,'../src/renderer/index.html'));
await page.waitForSelector('#quickSiteList');
const ok=name=>{results.push(name);console.log('PASS',name);};


await page.waitForFunction(()=>state.quickBars.length===2);
const barOneCount=await page.locator('#quickSiteList .quick-site').count();
assert(barOneCount>=2,'第一栏应有网站，实际 '+barOneCount);
const switchToSecond=()=>page.locator(`.quick-bar-row[data-bar-row="${secondId}"]`).click();
const switchToFirst=()=>page.locator('.quick-bar-row[data-bar-row="quick-bar-1"]').click();
const waitClass=sel=>page.waitForFunction(sel=>document.querySelector(sel)!==null,sel,{timeout:3000});
const anims=sel=>page.evaluate(sel=>{const el=document.querySelector(sel);if(!el)return null;const list=el.getAnimations();return {names:list.map(x=>x.animationName),children:[...el.querySelectorAll('.quick-site')].map(c=>({n:getComputedStyle(c).animationName,d:parseFloat(getComputedStyle(c).animationDelay)||0}))};},sel);

// 1) 弹层开着时切换：动画先攒着，不能在后背看不见的地方偷偷播完。
await page.locator('[data-quick-bar="tabs"]').click();
await page.waitForSelector('#quickTabsDialog[open]');
const dialogAnim=await page.evaluate(()=>getComputedStyle(document.getElementById('quickTabsDialog')).animationName);
assert.equal(dialogAnim,'qh-dialog-in','弹层要有入场动画');
const box=await page.locator('#quickTabsDialog').boundingBox();
assert(box.x>=0&&box.y>=0&&box.x+box.width<=1281&&box.y+box.height<=801,'入场动画期间弹层不能出屏 '+JSON.stringify(box));
await switchToSecond();
await page.waitForFunction(id=>state.quickBar===id,String(secondId));
await page.waitForTimeout(120);
assert.equal(await page.evaluate(()=>document.getElementById('quickSiteList').classList.contains('quick-swap-forward')),false,'弹层开着时不播，动画要攒到关掉之后');
ok('Switching a tab bar behind the open panel defers the strip animation instead of playing it unseen');

// 2) 关掉弹层：动画开始播，向后翻从右侧进入，子项逐次落位，跑完不留 transform。
await page.locator('[data-quick-bar="tabs-close"]').click();
await waitClass('#quickSiteList.quick-swap-forward');
const live=await anims('#quickSiteList');
assert(live.names.includes('qh-swap-in'),'列表要有 qh-swap-in：'+JSON.stringify(live));
assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('quickSiteList')).getPropertyValue('--swap-x').trim()),'10px','向后翻应从右侧 10px 进入');
assert(live.children.every(c=>c.n==='qh-item-in'),'子项要各自入场：'+JSON.stringify(live.children));

const frames=await page.evaluate(()=>new Promise(res=>{const el=document.querySelector('#quickSiteList .quick-site');const read=()=>getComputedStyle(el).transform;const t0=read();requestAnimationFrame(()=>requestAnimationFrame(()=>res({t0,t1:read()})));}));
assert.notEqual(frames.t0,frames.t1,'两帧之间画面必须真的在动：'+JSON.stringify(frames));
await page.waitForTimeout(700);
const settled=await page.evaluate(()=>{const one=el=>{const m=new DOMMatrixReadOnly(getComputedStyle(el).transform==='none'?'':getComputedStyle(el).transform);return {x:m.m41,y:m.m42,scale:m.a,opacity:getComputedStyle(el).opacity};};const card=document.querySelector('#quickSiteList .quick-site');return {list:one(document.getElementById('quickSiteList')),card:one(card)};});
for(const [name,box] of Object.entries(settled)){assert.equal(box.x,0,name+' 动画结束不能留横向残影：'+JSON.stringify(settled));assert.equal(box.y,0,name+' 动画结束不能留纵向残影');assert.equal(box.scale,1,name+' 动画结束缩放必须回到 1');assert.equal(box.opacity,'1',name+' 动画结束不透明度必须回到 1');}
assert.equal(await page.locator('#quickSiteList .quick-site').count(),1);
assert.equal((await page.locator('#quickSiteList .quick-site').first().textContent()).includes('丙站'),true);
ok('Closing the panel plays a forward strip animation with staggered items that settles without leftovers');

// 3) 反向切换：从后面的栏切回前面的栏，从左侧进入，内容回到第一栏。
await page.locator('[data-quick-bar="tabs"]').click();
await page.waitForSelector('#quickTabsDialog[open]');
await switchToFirst();
await page.waitForFunction(()=>state.quickBar==='quick-bar-1');
await page.locator('[data-quick-bar="tabs-close"]').click();
await waitClass('#quickSiteList.quick-swap-backward');
const backItems=(await anims('#quickSiteList')).children;
assert(backItems.length>1,'第一栏应该有多个子项，实际 '+backItems.length);
assert(backItems.every(c=>c.n==='qh-item-in'),'每个子项都要入场：'+JSON.stringify(backItems));
assert(backItems.slice(1).some(c=>c.d>0),'第二个之后的子项要有延迟，形成逐次落位：'+JSON.stringify(backItems));
assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('quickSiteList')).getPropertyValue('--swap-x').trim()),'-10px','向前翻应从左侧 -10px 进入');
await page.waitForTimeout(700);
assert.equal(await page.locator('#quickSiteList .quick-site').count(),barOneCount);
ok('Switching back animates from the opposite side and restores the previous tab bar');

// 3.5) 整行就是切换按钮、拖动可改顺序：拖第二行到第一行前面，顺序变了但当前栏不变。
await page.locator('[data-quick-bar="tabs"]').click();
await page.waitForSelector('#quickTabsDialog[open]');
const barRows=page.locator('#quickBarRows .quick-bar-row');
assert.equal(await barRows.count(),2,'应有两行标签栏');
assert.equal(await page.locator('#quickBarRows [data-quick-bar="use"]').count(),0,'切换按钮应已删除，整行可点');
const orderBefore=await page.evaluate(()=>state.quickBars.map(bar=>bar.id));
const rowTop=await barRows.nth(0).boundingBox(),rowBottom=await barRows.nth(1).boundingBox();
await page.mouse.move(rowBottom.x+rowBottom.width/2,rowBottom.y+rowBottom.height/2);
await page.mouse.down();
await page.mouse.move(rowBottom.x+rowBottom.width/2,rowTop.y+2,{steps:10});
assert.equal(await page.locator('#quickBarRows .quick-bar-row.dragging').count(),1,'拖动中应恰好有一行浮起');
await page.mouse.up();
await page.waitForFunction(ids=>state.quickBars.map(bar=>bar.id).join()!==ids,orderBefore.join());
const orderAfter=await page.evaluate(()=>state.quickBars.map(bar=>bar.id));
assert.deepEqual(orderAfter,[orderBefore[1],orderBefore[0]],'拖动应把第二行排到第一行前面：'+JSON.stringify({orderBefore,orderAfter}));
assert.equal(await page.evaluate(()=>state.quickBar),'quick-bar-1','拖动不应顺手切换标签栏');
await page.locator('#quickBarRows .quick-bar-row').nth(0).locator('[data-quick-bar="rename"]').click();
assert.equal(await page.evaluate(()=>state.quickBar),'quick-bar-1','点行内按钮不应算作点行');
await page.locator('[data-quick-bar="new"]').click();
await page.keyboard.press('Escape');
ok('A bar row is itself the switch target, drag reorders instead of switching, and row buttons never switch');

// 4) 关闭是同步的：点一下立刻收起、Escape 也立刻收起，动画不拖住交互。
await page.locator('[data-quick-bar="tabs"]').click();
await page.waitForSelector('#quickTabsDialog[open]');
await page.locator('[data-quick-bar="tabs-close"]').click();
assert.equal(await page.locator('#quickTabsDialog').evaluate(e=>e.open),false,'关闭弹层不能被动画拖成异步');
await page.locator('[data-quick-bar="tabs"]').click();
await page.waitForSelector('#quickTabsDialog[open]');
await page.keyboard.press('Escape');
assert.equal(await page.locator('#quickTabsDialog').evaluate(e=>e.open),false);
ok('The panel still closes synchronously, including by Escape, so animation never blocks input');

// 4.5) 快捷网站卡片：直接拖=平移（不排序），按住 260ms 再拖=排序（浮起幽灵跟着指针）。
const stripOrder=()=>page.evaluate(()=>[...document.querySelectorAll('#quickSiteList .quick-site')].map(node=>node.dataset.quickId));
const orderPre=await stripOrder();
assert(orderPre.length>1,'第一栏至少要有两个网站，实际 '+orderPre.length);
const target=await page.locator('#quickSiteList .quick-site').nth(1).boundingBox();
await page.mouse.move(target.x+target.width/2,target.y+target.height/2);
await page.mouse.down();
await page.waitForTimeout(320);
await page.mouse.move(target.x+target.width/2+8,target.y+target.height/2,{steps:2});
await page.mouse.move(target.x+target.width/2+180,target.y+target.height/2,{steps:14});
assert.equal(await page.locator('.quick-site-ghost').count(),1,'按住后再拖应该浮起一张跟着指针的幽灵');
await page.mouse.up();
await page.waitForTimeout(420);
const orderPost=await stripOrder();
assert.notDeepEqual(orderPost,orderPre,'按住后再拖应改变顺序：'+JSON.stringify({orderPre,orderPost}));
ok('Dragging a shortcut pans the strip, while holding it first lifts a ghost and reorders');

// 5) 降级：prefers-reduced-motion 下动画彻底关掉，但切换依旧生效。
await page.emulateMedia({reducedMotion:'reduce'});
await page.reload();
await page.waitForSelector('#quickSiteList');
await page.waitForFunction(()=>state.quickBars.length===2);
await page.locator('[data-quick-bar="tabs"]').click();
await page.waitForSelector('#quickTabsDialog[open]');
assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('quickTabsDialog')).animationName),'none','降级模式弹层不应有入场动画');
await switchToSecond();
await page.waitForFunction(id=>state.quickBar===id,String(secondId));
await page.locator('[data-quick-bar="tabs-close"]').click();
await page.waitForTimeout(80);
const reduced=await page.evaluate(()=>({name:getComputedStyle(document.getElementById('quickSiteList')).animationName,card:getComputedStyle(document.querySelector('#quickSiteList .quick-site')).animationName,transform:getComputedStyle(document.querySelector('#quickSiteList .quick-site')).transform,count:document.querySelectorAll('#quickSiteList .quick-site').length}));
assert.equal(reduced.name,'none','降级模式列表不应有动画：'+JSON.stringify(reduced));
assert.equal(reduced.card,'none');
assert.equal(reduced.transform,'none');
assert.equal(reduced.count,1,'降级模式下切换必须照常生效');
ok('Reduced motion disables every strip and dialog animation while switching still works');

assert.deepEqual(errors,[]);
fs.writeFileSync(path.join(__dirname,'ui-motion-results.json'),JSON.stringify({platform:process.platform,backend:'actual Chromium + real ui.css; simulated IPC and runtime',passed:results.length,results,errors},null,2)+'\n');
console.log('All motion checks passed:',results.length);
}catch(e){console.error('Motion errors',errors);if(page)await page.screenshot({path:path.join(__dirname,'ui-motion-failure.png')}).catch(()=>{});throw e;}
finally{await browser?.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});



