'use strict';
// Build → install → launch in one step: close the running app (NSIS refuses to
// overwrite live instances), run the freshly built installer silently, then
// start the installed executable and verify it matches the build output.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn,spawnSync,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),release=path.join(root,'release');
const APP_GUID='2541b14a-9d68-53e3-866a-2bb1b96bd5e6',EXECUTABLE='QianXiAccounts.exe';
const dry=process.argv.includes('--dry-run'),launch=!process.argv.includes('--no-launch');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const say=message=>console.log((dry?'[dry-run] ':'')+message);

function manifest(){const file=path.join(release,'build-manifest.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;}
function installerPath(){
 const built=manifest();
 if(built?.installer&&fs.existsSync(built.installer))return built.installer;
 const candidates=fs.existsSync(release)?fs.readdirSync(release).filter(name=>/^QianXi-Accounts-Setup-.+\.exe$/i.test(name)):[];
 if(!candidates.length)throw Error('release/ 下没有安装包，请先运行 npm.cmd run build:installer');
 candidates.sort((a,b)=>fs.statSync(path.join(release,b)).mtimeMs-fs.statSync(path.join(release,a)).mtimeMs);
 return path.join(release,candidates[0]);
}
function verifyInstaller(file){
 const sha=file+'.sha256';
 if(!fs.existsSync(sha))return null;
 const expected=fs.readFileSync(sha,'utf8').split(/\s+/)[0].trim().toLowerCase();
 const actual=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 if(expected&&expected!==actual)throw Error('安装包 SHA256 与 .sha256 记录不一致：'+file);
 return actual;
}
function tasklistNames(){
 const out=spawnSync('tasklist',['/FO','CSV','/NH'],{encoding:'utf8',windowsHide:true});
 if(out.status!==0)return [];
 return out.stdout.split(/\r?\n/).map(line=>line.split('","')[0].replace(/^"/,'')).filter(Boolean);
}
function runningAppProcesses(){
 const names=new Set(tasklistNames().filter(name=>/QianXiAccounts|千禧accounts/i.test(name)));
 const rows=[];
 for(const name of names){
  const out=spawnSync('tasklist',['/FI','IMAGENAME eq '+name,'/FO','CSV','/NH'],{encoding:'utf8',windowsHide:true});
  for(const line of String(out.stdout||'').split(/\r?\n/)){
   const match=line.match(/^"([^"]+)","(\d+)"/);
   if(match)rows.push({name:match[1],pid:Number(match[2])});
  }
 }
 return rows;
}
async function closeRunningApp(){
 let rows=runningAppProcesses();
 if(!rows.length){say('没有正在运行的应用进程，跳过关闭');return;}
 say('关闭正在运行的应用进程：'+rows.map(row=>row.name+'#'+row.pid).join(', '));
 if(dry)return;
 for(const row of rows){try{execFileSync('taskkill',['/F','/PID',String(row.pid)],{stdio:'ignore',windowsHide:true});}catch{}}
 for(let i=0;i<60;i++){if(!runningAppProcesses().length)return;await sleep(250);}
 throw Error('应用进程仍在运行，无法安装新版本：'+runningAppProcesses().map(row=>row.name+'#'+row.pid).join(', '));
}
function regQuery(key,value){
 try{const out=execFileSync('reg',['query',key,'/v',value],{encoding:'utf8',windowsHide:true});
  const match=out.match(new RegExp(value+'\\s+REG_[A-Z_]+\\s+(.+)'));
  return match?match[1].trim():'';
 }catch{return '';}
}
function installLocation(){
 const fromGuid=regQuery('HKCU\\Software\\'+APP_GUID,'InstallLocation');
 if(fromGuid&&fs.existsSync(path.join(fromGuid,EXECUTABLE)))return fromGuid;
 const uninstall=regQuery('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+APP_GUID,'UninstallString').replace(/^"|"$/g,'');
 if(uninstall){const dir=path.dirname(uninstall);if(fs.existsSync(path.join(dir,EXECUTABLE)))return dir;}
 for(const candidate of ['D:\\QianXiAccounts','C:\\QianXiAccounts']){if(fs.existsSync(path.join(candidate,EXECUTABLE)))return candidate;}
 return '';
}
function runInstaller(file){
 return new Promise((resolve,reject)=>{
  say('静默安装：'+file);
  if(dry)return resolve(0);
  const child=spawn(file,['/S'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.on('data',data=>{output=(output+data).slice(-4000);});
  child.stderr.on('data',data=>{output=(output+data).slice(-4000);});
  child.on('error',reject);
  child.on('exit',code=>{
   if(code===0)return resolve(0);
   const hint=code===2?'（安装器拒绝了安装：旧进程未退出或需要正常退出）':'';
   reject(Error('安装器退出码 '+code+hint+(output?'\n'+output:'')));
  });
 });
}
async function main(){
 const installer=installerPath();
 const sha=verifyInstaller(installer);
 say('安装包：'+installer);
 if(sha)say('SHA256 校验通过：'+sha);
 const before=installLocation();
 say('当前安装目录：'+(before||'（未检测到，将使用安装器默认目录）'));
 await closeRunningApp();
 await runInstaller(installer);
 if(dry)return say('dry-run 结束，未安装也未启动');
 const installed=installLocation();
 if(!installed)throw Error('安装后未找到已安装的 '+EXECUTABLE);
 const executable=path.join(installed,EXECUTABLE);
 const built=manifest()?.unpackedExecutable;
 const size=fs.statSync(executable).size;
 if(built&&fs.existsSync(built)&&fs.statSync(built).size!==size)throw Error('已安装可执行文件大小与构建产物不一致：'+executable);
 say('已安装：'+executable+'（'+size+' 字节，'+fs.statSync(executable).mtime.toLocaleString()+'）');
 if(!launch)return say('按要求未启动新版本');
 const child=spawn(executable,[],{detached:true,stdio:'ignore',windowsHide:false});
 child.unref();
 await sleep(1500);
 const alive=runningAppProcesses().length>0;
 say((alive?'已启动新版本：':'已请求启动新版本（进程尚未出现）：')+executable);
 if(!alive)process.exitCode=1;
}
if(require.main===module)main().catch(error=>{console.error('安装失败：'+error.message);process.exitCode=1;});
module.exports={installerPath,installLocation,closeRunningApp};
