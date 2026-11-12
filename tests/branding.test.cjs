'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
test('app is branded 千禧accounts with stable persisted data and session identifiers',()=>{const main=read('src/main/main.cjs'),html=read('src/renderer/index.html');
 assert.match(main,/app\.setName\('千禧accounts'\)/);assert.match(read('src/main/app-paths.cjs'),/path\.join\(base,'QianXiAccounts'\)/,'data must land in the product directory');assert.match(main,/persist:arena-core-controls/);assert.match(main,/icon:appIcon/);
 assert.match(html,/<title>千禧accounts<\/title>/);assert.match(html,/class="mark"><svg /);assert.doesNotMatch(html,/Arena Core|ARENA CORE/);
 const ico=fs.readFileSync(path.join(root,'resources/qianxi.ico'));assert.deepEqual([...ico.subarray(0,4)],[0,0,1,0]);assert(ico.readUInt16LE(4)>=5,'multi-size ico');
 const png=fs.readFileSync(path.join(root,'resources/qianxi.png'));assert.equal(png.subarray(1,4).toString(),'PNG');});
test('public product links, updater feed and package metadata use QianXi',()=>{
 const pkg=require('../package.json'),config=require('../electron-builder.config.cjs');
 assert.equal(pkg.name,'qianxi');assert.equal(pkg.homepage,'https://github.com/momoqiqi-qwq/QianXi-Accounts');
 assert.equal(config.publish[0].owner,'momoqiqi-qwq');assert.equal(config.publish[0].repo,'QianXi-Accounts');
 for(const file of ['README.md','src/renderer/app.js','src/main/ipc.cjs','scripts/publish-release.cjs'])assert(!read(file).includes('HEYD66/arena-core'),file);
 assert.match(read('src/main/preload.cjs'),/exposeInMainWorld\('qianxi'/);
 assert.match(read('src/renderer/app.js'),/window\.qianxi/);
});
test('no legacy brand token survives in shipped sources',()=>{
 // 旧品牌串按片段拼接，避免本测试自己把旧字样带回仓库。
 const legacy=new RegExp('(?<![A-Za-z])'+['fa','cet'].join(''),'i');
 // tmp/ holds scratch copies and local diagnostics (e.g. upstream reference checkouts); it is never shipped.
  // docs/ records upstream provenance by name and tmp/ holds scratch copies; neither is packaged
 // (electron-builder ships src/**, package.json, LICENSE, README.md), so neither is a shipped source.
 const skip=new Set(['node_modules','.git','release','dist','.dsh-vision-router','tmp','docs']);
 const walk=(dir,out=[])=>{
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   if(skip.has(entry.name))continue;
   const target=path.join(dir,entry.name);
   if(entry.isDirectory()){
    if(/^android\/(app\/)?build$/.test(path.relative(root,target).replace(/\\/g,'/')))continue;
    walk(target,out);continue;
   }
   if(/\.(cjs|js|json|md|html|css|nsh|ps1|yml|cmd|cs|java|xml|gradle)$/i.test(entry.name))out.push(target);
  }
  return out;
 };
 const hits=walk(root).filter(file=>legacy.test(fs.readFileSync(file,'utf8')));
 assert.deepEqual(hits.map(file=>path.relative(root,file)),[],'legacy brand token must be gone');
});
