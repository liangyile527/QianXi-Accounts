'use strict';
// Build → install → launch in one step: close the running app (NSIS refuses to
// overwrite live instances), run the freshly built installer silently, then
// start the installed executable and verify it matches the build output.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawn,spawnSync,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),release=path.join(root,'release');
const APP_GUID='2541b14a-9d68-53e3-866a-2bb1b96bd5e6',EXECUTABLE='QianXiAccounts.exe',APP_NAME='千禧accounts';
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
// 桌面 / 开始菜单 / 任务栏固定，三处的 .lnk 必须指向当前安装目录里的 exe。
// 安装目录和 exe 名固定不变时它们本来就一直有效；这里额外兜住「曾经装到别的目录、
// 或者快捷方式是旧副本」的情况，安装完当场把目标改对，缺了就补一个。
function repairShortcuts(executable){
 // 路径用 base64 传给 PowerShell：绕开命令行里反斜杠/中文的转义问题，
 // 之前用 JSON.stringify 拼字符串会把 E:\a\b 变成 E:\\a\\b，比较永远不等，
 // 结果把已经正确的快捷方式又"改指"一遍。
 const exe64=Buffer.from(executable,'utf8').toString('base64');
 const ps=[
  "$ErrorActionPreference='Stop';",
  "$exe=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+exe64+"'));",
  "if(-not (Test-Path -LiteralPath $exe)){throw ('安装的可执行文件不存在：'+$exe)}",
  "$exeFull=[IO.Path]::GetFullPath($exe);",
  "$name='千禧accounts';",
  "$taskbar=Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar';",
  "$desktop=[Environment]::GetFolderPath('Desktop');",
  "$startMenu=Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs';",
  "$commonMenu=Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs';",
  "$commonDesktop=[Environment]::GetFolderPath('CommonDesktopDirectory');",
  "$dirs=@($desktop,$commonDesktop,$startMenu,$commonMenu,$taskbar);",
  "$shell=New-Object -ComObject WScript.Shell;",
  "$fixed=@();$created=@();$checked=0;$pinned=$null;",
  "foreach($dir in $dirs){",
  "  if(-not (Test-Path -LiteralPath $dir)){continue}",
  "  foreach($file in (Get-ChildItem -LiteralPath $dir -Filter *.lnk -Recurse -ErrorAction SilentlyContinue)){",
  "    $link=$shell.CreateShortcut($file.FullName);",
  "    $target=if($link.TargetPath){$link.TargetPath}else{''};",
  "    $isApp=($target -match 'QianXiAccounts\\.exe$') -or ($file.BaseName -like ($name+'*'));",
  "    if(-not $isApp){continue}",
  "    $checked++;",
  "    if($dir -eq $taskbar){$pinned=$file.FullName}",
  "    $same=$false;",
  "    if($target){try{$same=([IO.Path]::GetFullPath($target) -eq $exeFull)}catch{$same=$false}}",
  "    $icon=$exeFull+',0';",
  "    if(-not $same -or ($link.IconLocation -ne $icon)){",
  "      $link.TargetPath=$exeFull;$link.WorkingDirectory=(Split-Path -Parent $exeFull);$link.IconLocation=$icon;$link.Save();$fixed+=$file.FullName;",
  "    }",
  "  }",
  "}",
  "foreach($dir in @($desktop,$startMenu)){",
  "  $file=Join-Path $dir ($name+'.lnk');",
  "  if(Test-Path -LiteralPath $file){continue}",
  "  $link=$shell.CreateShortcut($file);$link.TargetPath=$exeFull;$link.WorkingDirectory=(Split-Path -Parent $exeFull);$link.IconLocation=$exeFull+',0';$link.Description=$name;$link.Save();$created+=$file;",
  "}",
  "[pscustomobject]@{checked=$checked;fixed=$fixed;created=$created;pinned=$pinned;target=$exeFull}|ConvertTo-Json -Depth 4 -Compress"
 ].join(' ');
 const out=execFileSync('powershell',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true});
 return JSON.parse(String(out||'{}').trim()||'{}');
}// Win11 没有可用的代码接口把应用固定到任务栏（放 .lnk 只是候选、写 Taskband BLOB 会打坏
// 已有固定项、Shell verb 已被移除）。tools/pin-taskbar.ps1 走键盘：Win+T 进任务栏 →
// UIA 找到按钮 → 应用菜单键 → 按 AutomationId 命中 TaskbarPin/Unpin。这里直接复用，
// 不做等价的自动点击。它需要交互式桌面，失败就如实报告，不假装成功。
function pinToTaskbar(executable){
 // Win11 没有代码接口能把应用固定到任务栏：放 .lnk 只是候选、写 Taskband BLOB 会打坏既有
 // 固定项、Shell verb 也已被移除。pin-taskbar.ps1 走键盘（Win+T → UIA 找按钮 → 应用菜单键
 // → 按 AutomationId 命中 TaskbarPin/Unpin）。这份实现搬自 U-Time 项目，已实测。
 const script=path.join(__dirname,'pin-taskbar.ps1');
 if(!fs.existsSync(script))return {ok:false,output:'缺少 scripts/pin-taskbar.ps1，未执行固定'};
 // 参数里的中文不能直接塞进 -Command（PS 5.1 按 GBK 解析命令行会乱码），写一个带 BOM 的
 // 临时脚本用 -File 跑；同时把控制台输出编码切成 UTF-8，node 才能正确读回中文。
 const temp=path.join(os.tmpdir(),'qianxi-pin-'+process.pid+'.ps1');
 const body=["$OutputEncoding=[Text.Encoding]::UTF8",
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
  "& '"+script+"' -AppName '"+APP_NAME+"' -AppPath '"+executable+"'",
  'exit $LASTEXITCODE'].join('\r\n');
 try{
  fs.writeFileSync(temp,'\uFEFF'+body+'\r\n',{encoding:'utf8'});
  const out=execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',temp],{encoding:'utf8',windowsHide:true});
  return {ok:true,output:String(out||'').trim()};
 }catch(error){
  const detail=String((error.stdout||'')+(error.stderr||'')||error.message||'').trim();
  return {ok:false,output:detail};
 }finally{
  try{fs.rmSync(temp,{force:true});}catch{/* 临时脚本删不掉不影响结论 */}
 }
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
 const shortcuts=repairShortcuts(executable);
 const fixedList=shortcuts.fixed||[],createdList=shortcuts.created||[];
 say('快捷方式：检查 '+Number(shortcuts.checked||0)+' 个，改指 '+fixedList.length+' 个'+(createdList.length?('，新建 '+createdList.length+' 个'):'')+' → '+executable);
 for(const item of fixedList)say('  改指：'+item);
 for(const item of createdList)say('  新建：'+item);
 if(shortcuts.pinned&&!fs.existsSync(shortcuts.pinned))throw Error('任务栏快捷方式目标丢失：'+shortcuts.pinned);
 if(!launch)return say('按要求未启动新版本');
 // 自动化外壳常把 ELECTRON_RUN_AS_NODE 带进子进程；带着它启动只会得到一个立刻退出的
 // Node 进程（还会把 --user-data-dir 之类当成 bad option），必须先清掉。
 const env={...process.env};
 delete env.ELECTRON_RUN_AS_NODE;
 delete env.ELECTRON_NO_ATTACH_CONSOLE;
 const child=spawn(executable,[],{detached:true,stdio:'ignore',windowsHide:false,env});
 child.unref();
 let started=false;
 for(let i=0;i<24;i++){if(runningAppProcesses().length){started=true;break}await sleep(250);}
 if(!started)throw Error('启动后没有检测到应用进程：'+executable);
 say('已启动新版本：'+executable);
 // 应用起来了才能固定（任务栏按钮来自运行中的窗口）。固定失败不改变「安装成功」的结论，
 // 但必须原样打印，不能吃掉。
 const pinned=pinToTaskbar(executable);
 for(const line of String(pinned.output||'').split(/\r?\n/).filter(Boolean))say('  '+line);
 const lastLine=(String(pinned.output||'').split(/\r?\n/).filter(Boolean).slice(-1)[0])||'无输出';
 say(pinned.ok?'任务栏固定：已确认（scripts/pin-taskbar.ps1）':'任务栏固定：未成功，需人工检查（'+lastLine+'）');
}
if(require.main===module)main().catch(error=>{console.error('安装失败：'+error.message);process.exitCode=1;});
module.exports={installerPath,installLocation,closeRunningApp,repairShortcuts,pinToTaskbar};
