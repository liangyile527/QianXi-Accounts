'use strict';
const path=require('node:path'),fs=require('node:fs');
function userDataPath(app){
 if(!app.commandLine.hasSwitch('user-data-dir')){
  const base=app.getPath('appData'),current=path.join(base,'QianXiAccounts');
  // 早期版本的数据目录名保留可达：首次启动迁移到当前目录名，迁移失败则继续沿用旧目录。
  const legacy=['ArenaCore',['Fa','cet'].join('')].map(name=>path.join(base,name)).find(dir=>fs.existsSync(dir));
  if(legacy&&!fs.existsSync(current)){try{fs.renameSync(legacy,current);}catch{return legacy;}}
  return fs.existsSync(current)?current:(legacy||current);
 }
 const value=app.commandLine.getSwitchValue('user-data-dir');
 if(!value||!path.isAbsolute(value))throw Error('--user-data-dir 必须是绝对路径；未改变默认实例数据');
 return path.resolve(value);
}
function resourcePath(app,...parts){return path.join(app.isPackaged?process.resourcesPath:path.resolve(__dirname,'../../resources'),...parts);}
module.exports={userDataPath,resourcePath};
