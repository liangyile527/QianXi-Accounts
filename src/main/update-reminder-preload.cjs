'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('qianxiUpdateReminder',Object.freeze({answer(response){if(response===0||response===1)ipcRenderer.send('qianxi:update-reminder-answer',{response});},openProject(){ipcRenderer.send('qianxi:update-reminder-project');}}));
