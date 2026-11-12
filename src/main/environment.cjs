'use strict';
const LANGUAGES=['zh-CN','en-US','ja-JP','en-GB'];
// Electron 在默认 UA 中追加 Electron/<version>，网页检测站和部分站点会把它当作运行时标记。
// 只清理运行时标记，保留 Chromium/Chrome 版本及其余兼容字段；用户显式填写的 UA 不改写。
function sanitizeElectronUserAgent(value){return String(value||'').replace(/\s+Electron\/[^\s]+/ig,'').trim();}
function environment(value={}){let language='zh-CN';try{language=Intl.getCanonicalLocales(String(value.language||'zh-CN'))[0];}catch{}const timezone=String(value.timezone||'Asia/Tokyo');try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format();}catch{throw Error('无效时区');}const number=(key,min,max,def=0)=>{const v=value[key]===undefined||value[key]===''?def:Number(value[key]);if(!Number.isFinite(v)||(v!==0&&(v<min||v>max)))throw Error('环境参数超出范围：'+key);return v;};const width=number('width',640,3840),height=number('height',480,2160);if(!!width!==!!height||!Number.isInteger(width)||!Number.isInteger(height))throw Error('视口宽高需同时设置整数，或同时为0自适应');const cpu=number('cpu',1,64);if(!Number.isInteger(cpu))throw Error('CPU线程数需为整数');const userAgent=String(value.userAgent||'').trim();if(userAgent.length>512||/[\r\n\x00-\x1f\x7f]/.test(userAgent))throw Error('UA格式无效');const platform=String(value.platform||'');if(!['','Win32','MacIntel','Linux x86_64'].includes(platform))throw Error('不支持的平台标识');const colorScheme=value.colorScheme||'system',reducedMotion=value.reducedMotion||'system';if(!['system','light','dark'].includes(colorScheme)||!['system','reduce','no-preference'].includes(reducedMotion))throw Error('媒体偏好无效');const geoEnabled=value.geoEnabled===true;const latitude=Number(value.latitude??0),longitude=Number(value.longitude??0);if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)throw Error('经纬度无效');const fingerprint=require('./fingerprint.cjs').normalize(value.fingerprint);if(fingerprint.enabled&&fingerprint.hardware&&(width>fingerprint.screenWidth||height>fingerprint.screenHeight))throw Error('视口不能超过模拟屏幕');return {fingerprint,language,timezone,width,height,scale:number('scale',1,3),cpu,userAgent,platform,colorScheme,reducedMotion,geoEnabled,latitude,longitude};}
// 同一实例的弹出窗口与主页面共用渲染进程，时区/语言覆盖在进程内已生效（值相同），此时 Chromium 报 already in effect，可忽略。
async function shared(promise){try{return await promise;}catch(e){if(!/already in effect/i.test(String(e?.message)))throw e;}}
// 注入失败只降级、不阻塞实例：新建的弹出窗口在 target 尚未就绪时，Page 域可能不响应命令。
// 保持"enable → addScript"的顺序，整体给 1.5 秒上限，超时记一行日志就继续套用其余环境。
async function inject(wc,source){try{await Promise.race([(async()=>{await wc.debugger.sendCommand('Page.enable');await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source});})(),new Promise((_,rej)=>setTimeout(()=>rej(Error('页面域无响应')),1500))]);}catch(e){console.warn('[environment] 注入已跳过：'+e.message);}}
// window.chrome 必须在指纹脚本之前注册：两者的 Function.prototype.toString 覆盖是链式的，
// shim 先装、指纹后装，指纹的 Proxy 未命中时才落到 shim，shim 未命中再落到原生。

// 自定义 UA 也要给出完整的 UA-CH metadata：空 brands / fullVersionList 是硬标记。
function userAgentMetadataFromUA(userAgent, native) {
  const m = String(userAgent || '').match(/Chrome\/([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)/);
  if (!m) return native?.metadata || null;
  const major = m[1], fullVersion = m.slice(1).join('.');
  const brandVersion = String(Number(major) - 8);
  return {
    brands: [
      { brand: 'Chromium', version: major },
      { brand: 'Not_A Brand', version: brandVersion },
      { brand: 'Google Chrome', version: major },
    ],
    fullVersionList: [
      { brand: 'Chromium', version: fullVersion },
      { brand: 'Not_A Brand', version: brandVersion + '.0.0.0' },
      { brand: 'Google Chrome', version: fullVersion },
    ],
    platform: 'Windows', platformVersion: native?.metadata?.platformVersion || '19.0.0',
    architecture: native?.metadata?.architecture || 'x86',
    model: '', mobile: false,
  };
}
async function applyEnvironment(wc,env,native,bounds){await inject(wc,require('./chrome-shim.cjs').source());const source=require('./fingerprint.cjs').script(env);if(source)await inject(wc,source);const userAgent=env.userAgent||sanitizeElectronUserAgent(wc.getUserAgent());const metadata=require('./fingerprint.cjs').generatedMetadata(env,native)||userAgentMetadataFromUA(userAgent,native)||native.metadata;await wc.debugger.sendCommand('Emulation.setUserAgentOverride',{userAgent,acceptLanguage:env.language,platform:env.platform||native.platform,...(metadata?{userAgentMetadata:metadata}:{})});await shared(wc.debugger.sendCommand('Emulation.setTimezoneOverride',{timezoneId:env.timezone}));await shared(wc.debugger.sendCommand('Emulation.setLocaleOverride',{locale:env.language}));await require('./viewport.cjs').applyViewport(wc,env,bounds);if(env.cpu)await wc.debugger.sendCommand('Emulation.setHardwareConcurrencyOverride',{hardwareConcurrency:env.cpu});const features=[];if(env.colorScheme!=='system')features.push({name:'prefers-color-scheme',value:env.colorScheme});if(env.reducedMotion!=='system')features.push({name:'prefers-reduced-motion',value:env.reducedMotion});if(features.length)await wc.debugger.sendCommand('Emulation.setEmulatedMedia',{features});if(env.geoEnabled)await wc.debugger.sendCommand('Emulation.setGeolocationOverride',{latitude:env.latitude,longitude:env.longitude,accuracy:100});}
module.exports={LANGUAGES,environment,applyEnvironment,sanitizeElectronUserAgent};
