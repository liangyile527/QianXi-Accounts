'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('extensionBrowser',{request:(method,args)=>ipcRenderer.invoke('qianxi:extension-browser',method,args),onState:fn=>{ipcRenderer.on('qianxi:extension-browser-state',(_e,value)=>fn(value));}});
