'use strict';
const {safeURL}=require('./store.cjs');
const MAX_LINKS=21;
const MAX_BARS=12;
// 第一个标签栏固定用作「默认」：老数据里的快捷网站没有 bar 字段，全部归到它。
const DEFAULT_BAR='quick-bar-1';
const DEFAULT_BARS=[{id:DEFAULT_BAR,name:'标签栏 1'}];
// Group colours are display-only: an empty string means "no group".
const COLORS=['','blue','green','purple','teal','amber','red','pink','grey'];
const DEFAULT_LINKS=[['arena','Arena','https://arena.ai/agent'],['chatgpt','ChatGPT','https://chatgpt.com/'],['claude','Claude','https://claude.ai/new'],['gemini','Gemini','https://gemini.google.com/app'],['grok','Grok','https://grok.com/']];
function linkColor(value,fallback=''){const raw=value===undefined||value===null?fallback:value;if(typeof raw!=='string')throw Error('分组颜色无效');const color=raw.trim();if(color&&!COLORS.includes(color))throw Error('分组颜色无效');return color;}
function linkFields(value={},fallbackColor=''){const name=String(value.name??'').trim(),raw=String(value.url??'').trim();if(!name||name.length>24||/[\x00-\x1f\x7f]/.test(name))throw Error('名称需为1–24个字符，不能含控制字符');if(!raw||raw.length>2048||/[\x00-\x1f\x7f]/.test(raw))throw Error('请输入2048字符以内的有效网址');const url=safeURL(raw);if(url.length>2048)throw Error('网址过长');const fields={name,url},color=linkColor(value.color,fallbackColor);if(color)fields.color=color;return fields;}
function barName(value){const name=String(value??'').trim();if(!name||name.length>16||/[\x00-\x1f\x7f]/.test(name))throw Error('标签栏名称需为1–16个字符，不能含控制字符');return name;}
function initialBars(value){if(value===undefined)return DEFAULT_BARS.map(row=>({...row}));if(!Array.isArray(value)||!value.length||value.length>MAX_BARS)throw Error('标签栏数据格式无效');const ids=new Set();return value.map(row=>{if(!row||typeof row.id!=='string'||!/^[-\w]{1,80}$/.test(row.id)||ids.has(row.id))throw Error('标签栏标识无效或重复');ids.add(row.id);return {id:row.id,name:barName(row.name)};});}
function initialLinks(value){if(value===undefined)return DEFAULT_LINKS.map(([id,name,url])=>({id:'quick-'+id,name,url,bar:DEFAULT_BAR}));if(!Array.isArray(value)||value.length>MAX_LINKS*MAX_BARS)throw Error('快捷网站数据格式无效');const ids=new Set();return value.map(row=>{if(!row||typeof row.id!=='string'||!/^[-\w]{1,80}$/.test(row.id)||ids.has(row.id))throw Error('快捷网站标识无效或重复');ids.add(row.id);const link={id:row.id,...linkFields(row)};if(typeof row.bar==='string'&&/^[-\w]{1,80}$/.test(row.bar))link.bar=row.bar;return link;});}
// One-time upgrade: move legacy ipip.la shortcuts into the detection menu.
// Preserve renamed/custom links and the IDs and order of every other shortcut.
function withoutLegacyIPIP(links){return links.filter(x=>!(x.name.toLowerCase()==='ipip.la'&&['ipip.la','www.ipip.la'].includes(new URL(x.url).hostname)));}
module.exports={linkFields,linkColor,barName,initialLinks,initialBars,withoutLegacyIPIP,MAX_LINKS,MAX_BARS,COLORS,DEFAULT_BAR};
