'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('qianxiExit',Object.freeze({answer(response,checkboxChecked){if(response===0||response===1)ipcRenderer.send('qianxi:exit-answer',{response,checkboxChecked:checkboxChecked===true});}}));
