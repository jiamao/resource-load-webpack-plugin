const webpack = require("webpack");

const { Template } = webpack;

const pluginName = 'JT_JsonpTemplatePlugin';
const loadResourceFun = `${pluginName}_LoadResource`;
const loadResourceCacheKey = `${pluginName}_LoadResourceCacheKey`;
const loadResourceCacheFun = `${pluginName}_LoadResource_cache`;
const loadResourceCompleteFun = `${pluginName}_LoadResource_complete`;
const inlineJavascriptFun = `${pluginName}_InlineScript`;
const getJavascriptTagFun = `${pluginName}_GetScriptTagByUrl`;
const oldCreateElementFun = `${pluginName}_CreateElement`;

const CSS_MODULE_TYPE = 'css/mini-extract';

class JTResourceLoad {
  constructor(option = {}) {
      // 加载前处理逻辑，可以针对加载url初始化
      option.loadBeforeTemplate = option.loadBeforeTemplate || `console.log(' start load:', url, retryTime)`;
      // 加载资源完成回调
      option.loadCompleteTemplate = option.loadCompleteTemplate || `console.log('load:', type, url, retryTime)`;
      // 失败重试次数
      if(typeof option.retryTime === 'undefined') option.retryTime = 2;
      option.retryTime = Math.min(option.retryTime, 5);
      // 缓存url的正则
      if(typeof option.localCacheRegs === 'undefined') option.localCacheRegs = [];
      this.option = option;
  }
  apply(compiler) {
        compiler.hooks.compilation.tap(pluginName, compilation => {
            const { mainTemplate } = compilation;

            const alterAssetTagGroups = compilation.hooks.htmlWebpackPluginAlterAssetTags;
            const crossOriginLoading =
                        mainTemplate.outputOptions.crossOriginLoading;
            const chunkLoadTimeout = mainTemplate.outputOptions.chunkLoadTimeout;
            const jsonpScriptType = mainTemplate.outputOptions.jsonpScriptType;
            // 是否需要缓存
            const isLocalCache = !!this.option.localCacheRegs;            

            const cacheRegRules = [
                `var isMatch = false; var cacheName='${loadResourceCacheKey}_' + url;`
            ];
            // 命中规则的才缓存
            if(isLocalCache) {
                for(const k in this.option.localCacheRegs) {
                    const r = this.option.localCacheRegs[k];
                    if(!r) continue;
                    cacheRegRules.push(`if(!isMatch && ${typeof r ==='string'?r:r.toString()}.test(url)) {isMatch = true; cacheName='${loadResourceCacheKey}_${k}';}`);
                }
            }

            const cacheFun = [
                `function ${loadResourceCacheFun}(url, data) {`,
                        Template.indent([
                            "try {",
                            ...cacheRegRules,
                            "if(!window.localStorage || !isMatch) return null;",
                            "if(typeof data === 'undefined') {",
                                "var text = window.localStorage.getItem(cacheName);",
                                // 当缓存中的url是当前url才表示命中，否则为不同版本，不能采用
                                "if(text && text.indexOf('//' + url) === 0) return text;",
                            "}",
                            "else window.localStorage.setItem(cacheName, '//' + url + '\\n' + data);",
                            "} catch(e) {console.error(e);",
                                "if(e.name === 'QuotaExceededError') {",
                                    "window.localStorage.clear && window.localStorage.clear();",
                                "}",
                            "}"
                        ]),
                    "}"
                ];
            // 加载JS逻辑
            const loadResourceScript = Template.asString([
                    this.option.globalScript?`try{ ${this.option.globalScript} }catch(e){console.error(e);}`:'',
                    `function ${loadResourceCompleteFun}(type, url, xhr, retryTime) {`,
                        Template.indent([
                            "try{",
                                Template.indent([this.option.loadCompleteTemplate]),
                            "}catch(e){console.error(e);}"
                        ]),
                    "}",
                    
                    ...(isLocalCache ? cacheFun: []),

                    `function ${loadResourceFun}(url, callback, retryTime, ltype, sourceType, nc) {`,
                        Template.indent([
                            "retryTime = typeof retryTime !== 'number'?0: retryTime;",
                            "sourceType=sourceType||'js';",
                            isLocalCache? `if(retryTime == 0) {var text = ${loadResourceCacheFun}(url); if(text) {callback && callback({ type: 'load', url: url, retryTime: retryTime, text: text }); return text;}}` : "",
                            "var loadType = ltype || 'ajax';// ajax || tag",
                            "try{",
                                Template.indent([
                                    this.option.loadBeforeTemplate
                                ]),
                            "}catch(e){console.error(e);}",
                            "if(ltype) loadType = ltype;",
                            "if(loadType == 'ajax') {",
                                Template.indent([
                                    "var xhr = new XMLHttpRequest();",
                                    "xhr.onreadystatechange = function() {",
                                        Template.indent([
                                            "if(xhr.readyState==4) {",
                                                Template.indent([
                                                    "clearTimeout(timeoutHandler);",
                                                    "if(xhr.status==200 && xhr.responseText) {",
                                                        Template.indent([
                                                            // 缓存
                                                            isLocalCache? `if(retryTime == 0) ${loadResourceCacheFun}(url, xhr.responseText);` : "",
                                                            "callback({ type: 'load', url: url, retryTime: retryTime, text: xhr.responseText });",
                                                            `${loadResourceCompleteFun}('success', url, xhr, retryTime);`
                                                        ]),
                                                    "}",
                                                    "else {",
                                                        `if(retryTime < ${this.option.retryTime}) { ${loadResourceFun}(url, callback, retryTime+1, ltype, sourceType, nc); return;}`,
                                                        "callback({ type: 'fail', url: url, retryTime: retryTime });",
                                                        `${loadResourceCompleteFun}('fail', url, xhr, retryTime);`,
                                                    "}"
                                                ]),
                                            "}",
                                        ]),
                                    "};",
                                    "xhr.open('GET', url, true);",
                                    "xhr.send(null);"
                                ]),
                            "}",
                            "else {",
                                Template.indent([
                                    "var el = document.createElement(sourceType==='css'?'link':'script');",
                                    jsonpScriptType
                                        ? `el.type = ${JSON.stringify(jsonpScriptType)};`
                                        : "",
                                    "if(sourceType === 'js') el.charset = 'utf-8';",
                                    "if(sourceType === 'css') el.rel = 'stylesheet';",
                                    "el.type = sourceType === 'css'?'text/css':'text/javascript';",
                                    `el.timeout = ${chunkLoadTimeout / 1000};`,
                                    `if (nc) {`,
                                    Template.indent(
                                        `el.setAttribute("nonce", nc);`
                                    ),
                                    "}",
                                    "el.src = el.href = url",
                                    crossOriginLoading
                                        ? Template.asString([
                                                "if (el.src.indexOf(window.location.origin + '/') !== 0) {",
                                                Template.indent(
                                                    `el.crossOrigin = ${JSON.stringify(crossOriginLoading)};`
                                                ),
                                                "}"
                                        ])
                                        : "",
                                    "el.onerror = function(e){",
                                        Template.indent([
                                            "clearTimeout(timeoutHandler);",
                                            `if(retryTime < ${this.option.retryTime}) { ${loadResourceFun}(url, callback, retryTime+1, ltype, sourceType, nc); e.stopPropagation && e.stopPropagation(); return;}`,
                                            "callback({ type: 'fail', url: url, retryTime: retryTime });",
                                            `${loadResourceCompleteFun}('fail', url, this, retryTime);`
                                        ]),
                                    "}",
                                    "el.onload = function(e){",
                                        Template.indent([
                                            "clearTimeout(timeoutHandler);",
                                            "callback({ type: 'load', url: url, retryTime: retryTime });",
                                            `${loadResourceCompleteFun}('success', url, this, retryTime);`
                                        ]),
                                    "}",
                                    "document.head.appendChild(el);"
                                ]),
                            "}",
                            "var timeoutHandler = setTimeout(function(){",
                                Template.indent([
                                    `if(retryTime < ${this.option.retryTime}) { ${loadResourceFun}(url, callback, retryTime+1, ltype, sourceType, nc); return;}`,
                                    "callback({ type: 'timeout', url: url, retryTime: retryTime });",
                                    `${loadResourceCompleteFun}('timeout', url, xhr||el, retryTime);`,
                                ]),
                            `}, ${chunkLoadTimeout});`
                        ]),
                    "}",
                    `function ${inlineJavascriptFun}(ct, url, tag){`, 
                        Template.indent([
                            "var script = document.createElement(tag==='css'?'style':'script');",
                            "script.innerHTML=ct;",
                            "script.type=tag==='css'?'text/css':'text/javascript';",
                            "url && script.setAttribute('data-src', url);",
                            "document.head.appendChild(script);"
                        ]),
                    "}",
                    `function ${getJavascriptTagFun}(url, tagName){`,
                        Template.indent([
                            "var tags = document.getElementsByTagName(tagName||'script');if(!tags) return null;",
                            "for(var i=0;i<tags.length;i++){",
                                Template.indent([
                                    "var tag=tags[i];",
                                    "if(tag && tag.attributes) {",
                                        Template.indent([
                                            "for(var j=0;j<tag.attributes.length;j++){",
                                                "var attr = tag.attributes[j];",
                                                "if((attr.name==='src'||attr.name==='data-src') && attr.value===url) return tag;",
                                            "}"
                                        ]),
                                    "}"
                                ]),
                            "}"
                        ]),
                    "}",
                ]);

            // 注入ajax函数，用于资源拉起
            mainTemplate.hooks.localVars.tap(
                pluginName,
                (source, chunk, hash) => {
                   return Template.asString([
                    source,
                    // 注入一段脚本，表示index.js加载完成
                    "if(typeof window !== 'undefined') window.webpackInstalledChunks = typeof installedChunks !== 'undefined'?installedChunks:{};",
                    alterAssetTagGroups?"":loadResourceScript
                   ]);
                }
            );
            // 覆盖加载核心逻辑
            if(mainTemplate.hooks.jsonpScript && mainTemplate.hooks.jsonpScript.taps) {
                for(const tap of mainTemplate.hooks.jsonpScript.taps) {
                    
                    if(tap.name === 'JsonpMainTemplatePlugin') {
                        //console.log('replace JsonpMainTemplatePlugin tap', tap);
                        tap.fn = (source, chunk, hash) => {
                            return Template.asString([                            
                                "var onScriptComplete;",
                                "// jt: create error before stack unwound to get useful stacktrace later",
                                "var error = new Error();",
                                "onScriptComplete = function (event) {",
                                Template.indent([
                                    "// avoid mem leaks in IE.",
                                    "var chunk = installedChunks[chunkId];",
                                    "if(chunk !== 0) {",
                                    Template.indent([
                                        "if(chunk) {",
                                        Template.indent([
                                            "var errorType = event && (event.type === 'load' ? 'missing' : event.type);",
                                            "var realSrc = event && event.url;",
                                            "error.message = 'Loading chunk ' + chunkId + ' failed.\\n(' + errorType + ': ' + realSrc + ')';",
                                            "error.name = 'ChunkLoadError1';",
                                            "error.type = errorType;",
                                            "error.request = realSrc;",
                                            "chunk[1](error);"
                                        ]),
                                        "}",
                                        "installedChunks[chunkId] = undefined;"
                                    ]),
                                    "}"
                                ]),
                                "};",
                                `${loadResourceFun}(jsonpScriptSrc(chunkId), function(data) {`,
                                    Template.indent([
                                        "if(data.type === 'load' && data.text) {",
                                            Template.indent([
                                                //`eval(data.text);`,
                                                `${this.option.syncRunType==='script' || this.option.syncRunType==='tag'?inlineJavascriptFun:'eval'}(data.text, data.url);`,
                                            ]),
                                        "}",
                                        "onScriptComplete(data);"
                                    ]),
                                `}, 0, '', 'js', ${mainTemplate.requireFn}.nc)`,                            
                            ]);
                        }
                    }
                }
            }
            // 覆盖掉加载入口
            if(mainTemplate.hooks.requireEnsure && mainTemplate.hooks.requireEnsure.taps) {
                
                for(const tap of mainTemplate.hooks.requireEnsure.taps) {
                    if(tap.name === 'JsonpMainTemplatePlugin load') {
                        tap.fn = (source, chunk, hash) => {
                            return Template.asString([
                                source,
                                "",
                                "// JSONP chunk loading for javascript",
                                "",
                                "var installedChunkData = installedChunks[chunkId];",
                                'if(installedChunkData !== 0) { // 0 means "already installed".',
                                Template.indent([
                                    "",
                                    '// a Promise means "currently loading".',
                                    "if(installedChunkData) {",
                                    Template.indent(["promises.push(installedChunkData[2]);"]),
                                    "} else {",
                                    Template.indent([
                                        "// setup Promise in chunk cache",
                                        "var promise = new Promise(function(resolve, reject) {",
                                        Template.indent([
                                            "installedChunkData = installedChunks[chunkId] = [resolve, reject];"
                                        ]),
                                        "});",
                                        "promises.push(installedChunkData[2] = promise);",
                                        "",
                                        "// start chunk loading",
                                        mainTemplate.hooks.jsonpScript.call("", chunk, hash),
                                        //"document.head.appendChild(script);"
                                    ]),
                                    "}"
                                ]),
                                "}"
                            ]);
                        }
                    }
                    // css加载函数
                    else if(tap.name === 'mini-css-extract-plugin' && this.option.cssLoad) {
                        tap.fn = (source, chunk, hash) => {
                            
                            //console.log('start mini css extract');

                            const chunkMap = this.getCssChunkObject(chunk);
                            
                            if (Object.keys(chunkMap).length > 0) {
                                const chunkMaps = chunk.getChunkMaps();
                                const linkHrefPath = mainTemplate.getAssetPath(JSON.stringify(`css/[name].[contenthash:8].css`), {
                                    hash: `" + ${mainTemplate.renderCurrentHashCode(hash)} + "`,
                                    hashWithLength: length => `" + ${mainTemplate.renderCurrentHashCode(hash, length)} + "`,
                                    chunk: {
                                    id: '" + chunkId + "',
                                    hash: `" + ${JSON.stringify(chunkMaps.hash)}[chunkId] + "`,

                                    hashWithLength(length) {
                                        const shortChunkHashMap = Object.create(null);

                                        for (const chunkId of Object.keys(chunkMaps.hash)) {
                                        if (typeof chunkMaps.hash[chunkId] === 'string') {
                                            shortChunkHashMap[chunkId] = chunkMaps.hash[chunkId].substring(0, length);
                                        }
                                        }

                                        return `" + ${JSON.stringify(shortChunkHashMap)}[chunkId] + "`;
                                    },

                                    contentHash: {
                                        [CSS_MODULE_TYPE]: `" + ${JSON.stringify(chunkMaps.contentHash[CSS_MODULE_TYPE])}[chunkId] + "`
                                    },
                                    contentHashWithLength: {
                                        [CSS_MODULE_TYPE]: length => {
                                        const shortContentHashMap = {};
                                        const contentHash = chunkMaps.contentHash[CSS_MODULE_TYPE];

                                        for (const chunkId of Object.keys(contentHash)) {
                                            if (typeof contentHash[chunkId] === 'string') {
                                            shortContentHashMap[chunkId] = contentHash[chunkId].substring(0, length);
                                            }
                                        }

                                        return `" + ${JSON.stringify(shortContentHashMap)}[chunkId] + "`;
                                        }
                                    },
                                    name: `" + (${JSON.stringify(chunkMaps.name)}[chunkId]||chunkId) + "`
                                    },
                                    contentHashType: CSS_MODULE_TYPE
                                });
                                return Template.asString([source, '', 
                                    `var cssChunks = ${JSON.stringify(chunkMap)};`, 
                                    'if(installedCssChunks[chunkId]) promises.push(installedCssChunks[chunkId]);', 
                                    'else if(installedCssChunks[chunkId] !== 0 && cssChunks[chunkId]) {', 
                                        Template.indent(['promises.push(installedCssChunks[chunkId] = new Promise(function(resolve, reject) {', 
                                            Template.indent([
                                                `var href = ${linkHrefPath};`, 
                                                `var fullhref = ${mainTemplate.requireFn}.p + href;`,                                                 
                                                `console.log('${pluginName} load ', fullhref);`, 
                                                'var existingLinkTags = document.getElementsByTagName("link");', 
                                                'for(var i = 0; i < existingLinkTags.length; i++) {', 
                                                    Template.indent([
                                                        'var tag = existingLinkTags[i];', 
                                                        'var dataHref = tag.getAttribute("data-src") || tag.getAttribute("data-href") || tag.getAttribute("href");', 
                                                        'if(tag.rel === "stylesheet" && (dataHref === href || dataHref === fullhref)) return resolve();'
                                                    ]), 
                                                '}', 
                                                'var existingStyleTags = document.getElementsByTagName("style");', 
                                                'for(var i = 0; i < existingStyleTags.length; i++) {', 
                                                    Template.indent([
                                                        'var tag = existingStyleTags[i];', 
                                                        'var dataHref = tag.getAttribute("data-src") || tag.getAttribute("data-href");', 
                                                        'if(dataHref === href || dataHref === fullhref) return resolve();'
                                                    ]), 
                                                '}', 
                                                `${loadResourceFun}(fullhref, function(data) {`,
                                                    Template.indent([
                                                        "if(data.type === 'load' && data.text) {",
                                                            Template.indent([
                                                                `${inlineJavascriptFun}(data.text, fullhref, 'css');`,
                                                            ]),
                                                        "}",
                                                        "if(data.type === 'load') resolve(data);",
                                                        "else {",
                                                            Template.indent([
                                                                'var err = new Error("Loading CSS chunk " + chunkId + " failed.\\n(" + data.url + ")");', 
                                                                'err.code = "CSS_CHUNK_LOAD_FAILED";', 
                                                                'err.request = data.url;', 
                                                                'delete installedCssChunks[chunkId]', 
                                                                'reject(err);'
                                                            ]), 
                                                        "}",
                                                    ]),
                                                `}, 0, 'tag', 'css');`,
                                            ]), 
                                            '}).then(function() {', 
                                                Template.indent(['installedCssChunks[chunkId] = 0;']), 
                                            '}));'
                                        ]), 
                                    '}'
                                ]);
                            }                

                            return source;
                        }
                    }
                }
            }

            // 处理同步JS
            if(alterAssetTagGroups) {
                alterAssetTagGroups.tap('JT_JsonpMainTemplatePlugin_scripts', (pluginArgs, callback) => {
                    const headTagName = Object.prototype.hasOwnProperty.call(pluginArgs, 'headTags') ? 'headTags' : 'head';
                    const bodyTagName = Object.prototype.hasOwnProperty.call(pluginArgs, 'bodyTags') ? 'bodyTags' : 'body';
                    const head = pluginArgs[headTagName] || (pluginArgs[headTagName]=[]);
                    const body = pluginArgs[bodyTagName] || (pluginArgs[bodyTagName]=[]);
                    // 注入一段加载脚本
                    head.unshift({
                        tagName: 'script',
                        type: 'text/javascript',
                        closeTag: true,
                        innerHTML: loadResourceScript
                    });

                    // 如果有外加script
                    if(this.option.addScript) {
                        let addCode = this.option.addScript || '';
                        if(typeof addCode === 'function') {
                            addCode = addCode({
                                loadResourceFun
                            }) || '';
                        }
                        if(addCode) {
                            head.push({
                                tagName: 'script',
                                type: 'text/javascript',
                                closeTag: true,
                                innerHTML: addCode
                            });
                        }
                    }
                    
                    const tags = [
                        ...head,
                        ...body
                    ];
                    
                    for(const tag of tags) {
                        if(!tag || !tag.attributes || (!tag.attributes.src && !tag.attributes.href)) continue;
                        const url = tag.attributes.src || tag.attributes.href;
                        // js加载
                        if(tag.tagName === 'script') {
                            // 同步加载的js加载方式
                            if(this.option.syncLoadType === 'ajax') {
                                tag.innerHTML = Template.asString([
                                    `${loadResourceFun}('${url}', function(data){`,
                                        Template.indent([
                                            "if(data.type === 'load' && data.text) {",
                                                    Template.indent([
                                                        `${this.option.syncRunType==='script'||this.option.syncRunType==='tag'?inlineJavascriptFun:'eval'}(data.text, '${url}');`
                                                    ]),
                                                "}",
                                            ]),
                                    "}, 0, '');"
                                ]);                            
                                tag.attributes['data-src'] = url;
                                delete tag.attributes.src;
                            }
                            else {
                                if(this.option.syncLoadAsync) tag.attributes['async'] = true; 
                                tag.attributes['onerror'] = `${loadResourceFun}(this.src, function(data){}, 1, 'tag')`;                            
                                tag.attributes['onload'] = `${loadResourceCompleteFun}('success', this.src, this, 0)`;
                            }
                        }
                        // 同步 css
                        else if(tag.tagName === 'link' && tag.attributes.rel === 'stylesheet') {
                            tag.attributes['onerror'] = `${loadResourceFun}(this.href, function(data){}, 1, 'tag', 'css')`;                            
                            tag.attributes['onload'] = `${loadResourceCompleteFun}('success', this.href, this, 0)`;
                        }
                    }
                    if(callback) {
                        callback(null, pluginArgs);
                    }
                });
            }
        });
  }

  getCssChunkObject(mainChunk) {
    const obj = {};
    const chunks = mainChunk.getAllAsyncChunks();
    for (const chunk of chunks) {
        
      for (const module of chunk.modulesIterable) {
        //console.log(chunk.id, module.type);
        if (module.type === CSS_MODULE_TYPE) {
            //console.log(chunk);
            obj[chunk.id] = 1;
            break;
        }
      }
    }
    return obj;
  }
}
module.exports = JTResourceLoad;