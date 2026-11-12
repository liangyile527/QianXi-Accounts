// 主世界兼容层：Electron 的 window.chrome 是一个没有任何成员的空对象，
// 真实 Chrome 一定有 chrome.app / chrome.csi / chrome.loadTimes —— 指纹站点和反爬脚本
// 几乎都对这一项单独打分，缺失它比缺 UA 还显眼。
// 结构按 Chrome 157（Windows，真机实测）对齐：三者都可枚举、可写、可配置；
// chrome.runtime 在普通网页里不存在，所以这里也不定义。
(function () {
  'use strict';
  try {
    var appliedKey = Symbol.for('qianxi.chrome.shim');
    if (window[appliedKey]) return;
    Object.defineProperty(window, appliedKey, { value: true, configurable: true });

    var apply = Reflect.apply;
    var previous = Function.prototype.toString;
    var sources = new WeakMap();

    // name/length 按原生形状写死；toString 只对登记过的函数返回 [native code]，
    // 其余一律落到上一层（可能是指纹脚本装的 Proxy，再往下才是原生）。
    var fake = function (name, arity, impl) {
      if (typeof name === 'string' && name) Object.defineProperty(impl, 'name', { value: name, configurable: true });
      Object.defineProperty(impl, 'length', { value: arity, configurable: true });
      sources.set(impl, 'function ' + (name || '') + '() { [native code] }');
      return impl;
    };
    var toString = function () {
      if (sources.has(this)) return sources.get(this);
      return apply(previous, this, arguments);
    };
    Object.defineProperty(Function.prototype, 'toString', {
      ...Object.getOwnPropertyDescriptor(Function.prototype, 'toString'), value: toString,
    });

    var host = window.chrome;
    if (!host || typeof host !== 'object') {
      host = {};
      try { Object.defineProperty(window, 'chrome', { value: host, writable: true, enumerable: true, configurable: true }); }
      catch (e) { try { window.chrome = host; } catch (e2) {} }
    }
    var put = function (key, value) {
      try { Object.defineProperty(host, key, { value: value, writable: true, enumerable: true, configurable: true }); }
      catch (e) { try { host[key] = value; } catch (e2) {} }
    };

    var timeOrigin = function () {
      var t = Number(performance.timeOrigin);
      return Number.isFinite(t) ? t : Date.now() - performance.now();
    };
    // 真 Chrome 的顺序就是 requestTime … connectionInfo，键集合必须完整。
    put('loadTimes', fake('', 0, function () {
      var origin = timeOrigin(), start = origin / 1000, finish = start;
      try {
        var nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
        if (nav && nav.loadEventEnd) finish = (origin + nav.loadEventEnd) / 1000;
      } catch (e) {}
      return {
        requestTime: start, startLoadTime: start, commitLoadTime: 0,
        finishDocumentLoadTime: finish, finishLoadTime: finish,
        firstPaintTime: 0, firstPaintAfterLoadTime: 0, navigationType: 'Other',
        wasFetchedViaSpdy: false, wasNpnNegotiated: false,
        npnNegotiatedProtocol: '', wasAlternateProtocolAvailable: false, connectionInfo: 'unknown',
      };
    }));
    put('csi', fake('', 0, function () {
      var origin = timeOrigin();
      return { startE: Math.round(origin), onloadT: Math.round(origin + performance.now()), pageT: Math.round(performance.now() * 1000) / 1000, tran: 15 };
    }));

    var app = {};
    app.isInstalled = false;
    app.getDetails = fake('getDetails', 0, function () { return null; });
    app.getIsInstalled = fake('getIsInstalled', 0, function () { return false; });
    app.installState = fake('installState', 0, function () { return undefined; });
    app.runningState = fake('runningState', 0, function () { return 'cannot_run'; });
    app.InstallState = { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' };
    app.RunningState = { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' };
    put('app', app);
    // Electron 的 WebContentsView 没有浏览器外框：outerWidth === innerWidth、
    // outerHeight === innerHeight。真 Chrome 顶部有标签栏 + 地址栏（约 90px），
    // 侧边还可能留边框，这里按常见布局补齐差值。
    var outerWidthOffset = 0, outerHeightOffset = 90;
    var defineWindowProp = function (key, getter) {
      try {
        var desc = Object.getOwnPropertyDescriptor(window, key);
        if (desc && desc.configurable === false) return;
        Object.defineProperty(window, key, {
          get: getter, enumerable: true, configurable: true,
        });
        if (typeof sources !== 'undefined') sources.set(getter, 'function get ' + key + '() { [native code] }');
      } catch (e) {}
    };
    defineWindowProp('outerWidth', function () { return window.innerWidth + outerWidthOffset; });
    defineWindowProp('outerHeight', function () { return window.innerHeight + outerHeightOffset; });
  } catch (e) {}
})();
