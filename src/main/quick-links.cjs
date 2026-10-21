'use strict';
const {safeURL}=require('./store.cjs');
const MAX_LINKS=21;
// Group colours are display-only: an empty string means "no group".
const COLORS=['','blue','green','purple','teal','amber','red','pink','grey'];
const DEFAULT_LINKS=[['arena','Arena','https://arena.ai/agent'],['chatgpt','ChatGPT','https://chatgpt.com/'],['claude','Claude','https://claude.ai/new'],['gemini','Gemini','https://gemini.google.com/app'],['grok','Grok','https://grok.com/']];
function linkColor(value,fallback=''){const raw=value===undefined||value===null?fallback:value;if(typeof raw!=='string')throw Error('分组颜色无效');const color=raw.trim();if(color&&!COLORS.includes(color))throw Error('分组颜色无效');return color;}
function linkFields(value={},fallbackColor=''){const name=String(value.name??'').trim(),raw=String(value.url??'').trim();if(!name||name.length>24||/[\x00-\x1f\x7f]/.test(name))throw Error('名称需为1–24个字符，不能含控制字符');if(!raw||raw.length>2048||/[\x00-\x1f\x7f]/.test(raw))throw Error('请输入2048字符以内的有效网址');const url=safeURL(raw);if(url.length>2048)throw Error('网址过长');const fields={name,url},color=linkColor(value.color,fallbackColor);if(color)fields.color=color;return fields;}
function initialLinks(value){if(value===undefined)return DEFAULT_LINKS.map(([id,name,url])=>({id:'quick-'+id,name,url}));if(!Array.isArray(value)||value.length>MAX_LINKS)throw Error('快捷网站数据格式无效');const ids=new Set();return value.map(row=>{if(!row||typeof row.id!=='string'||!/^[-\w]{1,80}$/.test(row.id)||ids.has(row.id))throw Error('快捷网站标识无效或重复');ids.add(row.id);return {id:row.id,...linkFields(row)};});}
// One-time upgrade: move legacy ipip.la shortcuts into the detection menu.
// Preserve renamed/custom links and the IDs and order of every other shortcut.
function withoutLegacyIPIP(links){return links.filter(x=>!(x.name.toLowerCase()==='ipip.la'&&['ipip.la','www.ipip.la'].includes(new URL(x.url).hostname)));}
module.exports={linkFields,linkColor,initialLinks,withoutLegacyIPIP,MAX_LINKS,COLORS};
