
/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.1.10 Copyright (c) 2010-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/requirejs for details
 */
//Not using strict: uneven strict support in browsers, #392, and causes
//problems with requirejs.exec()/transpiler plugins that may not be strict.
/*jslint regexp: true, nomen: true, sloppy: true */
/*global window, navigator, document, importScripts, setTimeout, opera */

var requirejs, require, define;
(function (global) {
    var req, s, head, baseElement, dataMain, src,
        interactiveScript, currentlyAddingScript, mainScript, subPath,
        version = '2.1.10',
        commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
        cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        op = Object.prototype,
        ostring = op.toString,
        hasOwn = op.hasOwnProperty,
        ap = Array.prototype,
        apsp = ap.splice,
        isBrowser = !!(typeof window !== 'undefined' && typeof navigator !== 'undefined' && window.document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
                      /^complete$/ : /^(complete|loaded)$/,
        defContextName = '_',
        //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
        isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
        contexts = {},
        cfg = {},
        globalDefQueue = [],
        useInteractive = false;

    function isFunction(it) {
        return ostring.call(it) === '[object Function]';
    }

    function isArray(it) {
        return ostring.call(it) === '[object Array]';
    }

    /**
     * Helper function for iterating over an array. If the func returns
     * a true value, it will break out of the loop.
     */
    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    /**
     * Helper function for iterating over an array backwards. If the func
     * returns a true value, it will break out of the loop.
     */
    function eachReverse(ary, func) {
        if (ary) {
            var i;
            for (i = ary.length - 1; i > -1; i -= 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    function getOwn(obj, prop) {
        return hasProp(obj, prop) && obj[prop];
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (hasProp(obj, prop)) {
                if (func(obj[prop], prop)) {
                    break;
                }
            }
        }
    }

    /**
     * Simple function to mix in properties from source into target,
     * but only if target does not already have a property of the same name.
     */
    function mixin(target, source, force, deepStringMixin) {
        if (source) {
            eachProp(source, function (value, prop) {
                if (force || !hasProp(target, prop)) {
                    if (deepStringMixin && typeof value === 'object' && value &&
                        !isArray(value) && !isFunction(value) &&
                        !(value instanceof RegExp)) {

                        if (!target[prop]) {
                            target[prop] = {};
                        }
                        mixin(target[prop], value, force, deepStringMixin);
                    } else {
                        target[prop] = value;
                    }
                }
            });
        }
        return target;
    }

    //Similar to Function.prototype.bind, but the 'this' object is specified
    //first, since it is easier to read/figure out what 'this' will be.
    function bind(obj, fn) {
        return function () {
            return fn.apply(obj, arguments);
        };
    }

    function scripts() {
        return document.getElementsByTagName('script');
    }

    function defaultOnError(err) {
        throw err;
    }

    //Allow getting a global that expressed in
    //dot notation, like 'a.b.c'.
    function getGlobal(value) {
        if (!value) {
            return value;
        }
        var g = global;
        each(value.split('.'), function (part) {
            g = g[part];
        });
        return g;
    }

    /**
     * Constructs an error with a pointer to an URL with more information.
     * @param {String} id the error ID that maps to an ID on a web page.
     * @param {String} message human readable error.
     * @param {Error} [err] the original error, if there is one.
     *
     * @returns {Error}
     */
    function makeError(id, msg, err, requireModules) {
        var e = new Error(msg + '\nhttp://requirejs.org/docs/errors.html#' + id);
        e.requireType = id;
        e.requireModules = requireModules;
        if (err) {
            e.originalError = err;
        }
        return e;
    }

    if (typeof define !== 'undefined') {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //Do not overwrite and existing requirejs instance.
            return;
        }
        cfg = requirejs;
        requirejs = undefined;
    }

    //Allow for a require config object
    if (typeof require !== 'undefined' && !isFunction(require)) {
        //assume it is a config object.
        cfg = require;
        require = undefined;
    }

    function newContext(contextName) {
        var inCheckLoaded, Module, context, handlers,
            checkLoadedTimeoutId,
            config = {
                //Defaults. Do not set a default for map
                //config to speed up normalize(), which
                //will run faster if there is no default.
                waitSeconds: 7,
                baseUrl: './',
                paths: {},
                bundles: {},
                pkgs: {},
                shim: {},
                config: {}
            },
            registry = {},
            //registry of just enabled modules, to speed
            //cycle breaking code when lots of modules
            //are registered, but not activated.
            enabledRegistry = {},
            undefEvents = {},
            defQueue = [],
            defined = {},
            urlFetched = {},
            bundlesMap = {},
            requireCounter = 1,
            unnormalizedCounter = 1;

        /**
         * Trims the . and .. from an array of path segments.
         * It will keep a leading path segment if a .. will become
         * the first path segment, to help with module name lookups,
         * which act like paths, but can be remapped. But the end result,
         * all paths that use this function should look normalized.
         * NOTE: this method MODIFIES the input array.
         * @param {Array} ary the array of path segments.
         */
        function trimDots(ary) {
            var i, part, length = ary.length;
            for (i = 0; i < length; i++) {
                part = ary[i];
                if (part === '.') {
                    ary.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                        //End of the line. Keep at least one non-dot
                        //path segment at the front so it can be mapped
                        //correctly to disk. Otherwise, there is likely
                        //no path mapping for a path starting with '..'.
                        //This can still fail, but catches the most reasonable
                        //uses of ..
                        break;
                    } else if (i > 0) {
                        ary.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
        }

        /**
         * Given a relative module name, like ./something, normalize it to
         * a real name that can be mapped to a path.
         * @param {String} name the relative name
         * @param {String} baseName a real name that the name arg is relative
         * to.
         * @param {Boolean} applyMap apply the map config to the value. Should
         * only be done if this normalization is for a dependency ID.
         * @returns {String} normalized name
         */
        function normalize(name, baseName, applyMap) {
            var pkgMain, mapValue, nameParts, i, j, nameSegment, lastIndex,
                foundMap, foundI, foundStarMap, starI,
                baseParts = baseName && baseName.split('/'),
                normalizedBaseParts = baseParts,
                map = config.map,
                starMap = map && map['*'];

            //Adjust any relative paths.
            if (name && name.charAt(0) === '.') {
                //If have a base name, try to normalize against it,
                //otherwise, assume it is a top-level require that will
                //be relative to baseUrl in the end.
                if (baseName) {
                    //Convert baseName to array, and lop off the last part,
                    //so that . matches that 'directory' and not name of the baseName's
                    //module. For instance, baseName of 'one/two/three', maps to
                    //'one/two/three.js', but we want the directory, 'one/two' for
                    //this normalization.
                    normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                    name = name.split('/');
                    lastIndex = name.length - 1;

                    // If wanting node ID compatibility, strip .js from end
                    // of IDs. Have to do this here, and not in nameToUrl
                    // because node allows either .js or non .js to map
                    // to same file.
                    if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                        name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                    }

                    name = normalizedBaseParts.concat(name);
                    trimDots(name);
                    name = name.join('/');
                } else if (name.indexOf('./') === 0) {
                    // No baseName, so this is ID is resolved relative
                    // to baseUrl, pull off the leading dot.
                    name = name.substring(2);
                }
            }

            //Apply map config if available.
            if (applyMap && map && (baseParts || starMap)) {
                nameParts = name.split('/');

                outerLoop: for (i = nameParts.length; i > 0; i -= 1) {
                    nameSegment = nameParts.slice(0, i).join('/');

                    if (baseParts) {
                        //Find the longest baseName segment match in the config.
                        //So, do joins on the biggest to smallest lengths of baseParts.
                        for (j = baseParts.length; j > 0; j -= 1) {
                            mapValue = getOwn(map, baseParts.slice(0, j).join('/'));

                            //baseName segment has config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = getOwn(mapValue, nameSegment);
                                if (mapValue) {
                                    //Match, update name to the new value.
                                    foundMap = mapValue;
                                    foundI = i;
                                    break outerLoop;
                                }
                            }
                        }
                    }

                    //Check for a star map match, but just hold on to it,
                    //if there is a shorter segment match later in a matching
                    //config, then favor over this star map.
                    if (!foundStarMap && starMap && getOwn(starMap, nameSegment)) {
                        foundStarMap = getOwn(starMap, nameSegment);
                        starI = i;
                    }
                }

                if (!foundMap && foundStarMap) {
                    foundMap = foundStarMap;
                    foundI = starI;
                }

                if (foundMap) {
                    nameParts.splice(0, foundI, foundMap);
                    name = nameParts.join('/');
                }
            }

            // If the name points to a package's name, use
            // the package main instead.
            pkgMain = getOwn(config.pkgs, name);

            return pkgMain ? pkgMain : name;
        }

        function removeScript(name) {
            if (isBrowser) {
                each(scripts(), function (scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name &&
                            scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = getOwn(config.paths, id);
            if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
                //Pop off the first array value, since it failed, and
                //retry
                pathConfig.shift();
                context.require.undef(id);
                context.require([id]);
                return true;
            }
        }

        //Turns a plugin!resource to [plugin, resource]
        //with the plugin being undefined if the name
        //did not have a plugin prefix.
        function splitPrefix(name) {
            var prefix,
                index = name ? name.indexOf('!') : -1;
            if (index > -1) {
                prefix = name.substring(0, index);
                name = name.substring(index + 1, name.length);
            }
            return [prefix, name];
        }

        /**
         * Creates a module mapping that includes plugin prefix, module
         * name, and path. If parentModuleMap is provided it will
         * also normalize the name via require.normalize()
         *
         * @param {String} name the module name
         * @param {String} [parentModuleMap] parent module map
         * for the module name, used to resolve relative names.
         * @param {Boolean} isNormalized: is the ID already normalized.
         * This is true if this call is done for a define() module ID.
         * @param {Boolean} applyMap: apply the map config to the ID.
         * Should only be true if this map is for a dependency.
         *
         * @returns {Object}
         */
        function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
            var url, pluginModule, suffix, nameParts,
                prefix = null,
                parentName = parentModuleMap ? parentModuleMap.name : null,
                originalName = name,
                isDefine = true,
                normalizedName = '';

            //If no name, then it means it is a require call, generate an
            //internal name.
            if (!name) {
                isDefine = false;
                name = '_@r' + (requireCounter += 1);
            }

            nameParts = splitPrefix(name);
            prefix = nameParts[0];
            name = nameParts[1];

            if (prefix) {
                prefix = normalize(prefix, parentName, applyMap);
                pluginModule = getOwn(defined, prefix);
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function (name) {
                            return normalize(name, parentName, applyMap);
                        });
                    } else {
                        normalizedName = normalize(name, parentName, applyMap);
                    }
                } else {
                    //A regular module.
                    normalizedName = normalize(name, parentName, applyMap);

                    //Normalized name may be a plugin ID due to map config
                    //application in normalize. The map config values must
                    //already be normalized, so do not need to redo that part.
                    nameParts = splitPrefix(normalizedName);
                    prefix = nameParts[0];
                    normalizedName = nameParts[1];
                    isNormalized = true;

                    url = context.nameToUrl(normalizedName);
                }
            }

            //If the id is a plugin id that cannot be determined if it needs
            //normalization, stamp it with a unique ID so two matching relative
            //ids that may conflict can be separate.
            suffix = prefix && !pluginModule && !isNormalized ?
                     '_unnormalized' + (unnormalizedCounter += 1) :
                     '';

            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !!suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ?
                        prefix + '!' + normalizedName :
                        normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            }

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (hasProp(defined, id) &&
                    (!mod || mod.defineEmitComplete)) {
                if (name === 'defined') {
                    fn(defined[id]);
                }
            } else {
                mod = getModule(depMap);
                if (mod.error && name === 'error') {
                    fn(mod.error);
                } else {
                    mod.on(name, fn);
                }
            }
        }

        function onError(err, errback) {
            var ids = err.requireModules,
                notified = false;

            if (errback) {
                errback(err);
            } else {
                each(ids, function (id) {
                    var mod = getOwn(registry, id);
                    if (mod) {
                        //Set error on module, so it skips timeout checks.
                        mod.error = err;
                        if (mod.events.error) {
                            notified = true;
                            mod.emit('error', err);
                        }
                    }
                });

                if (!notified) {
                    req.onError(err);
                }
            }
        }

        /**
         * Internal method to transfer globalQueue items to this context's
         * defQueue.
         */
        function takeGlobalQueue() {
            //Push all the globalDefQueue items into the context's defQueue
            if (globalDefQueue.length) {
                //Array splice in the values since the context code has a
                //local var ref to defQueue, so cannot just reassign the one
                //on context.
                apsp.apply(defQueue,
                           [defQueue.length, 0].concat(globalDefQueue));
                globalDefQueue = [];
            }
        }

        handlers = {
            'require': function (mod) {
                if (mod.require) {
                    return mod.require;
                } else {
                    return (mod.require = context.makeRequire(mod.map));
                }
            },
            'exports': function (mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    if (mod.exports) {
                        return mod.exports;
                    } else {
                        return (mod.exports = defined[mod.map.id] = {});
                    }
                }
            },
            'module': function (mod) {
                if (mod.module) {
                    return mod.module;
                } else {
                    return (mod.module = {
                        id: mod.map.id,
                        uri: mod.map.url,
                        config: function () {
                            return  getOwn(config.config, mod.map.id) || {};
                        },
                        exports: handlers.exports(mod)
                    });
                }
            }
        };

        function cleanRegistry(id) {
            //Clean up machinery used for waiting modules.
            delete registry[id];
            delete enabledRegistry[id];
        }

        function breakCycle(mod, traced, processed) {
            var id = mod.map.id;

            if (mod.error) {
                mod.emit('error', mod.error);
            } else {
                traced[id] = true;
                each(mod.depMaps, function (depMap, i) {
                    var depId = depMap.id,
                        dep = getOwn(registry, depId);

                    //Only force things that have not completed
                    //being defined, so still in the registry,
                    //and only if it has not been matched up
                    //in the module already.
                    if (dep && !mod.depMatched[i] && !processed[depId]) {
                        if (getOwn(traced, depId)) {
                            mod.defineDep(i, defined[depId]);
                            mod.check(); //pass false?
                        } else {
                            breakCycle(dep, traced, processed);
                        }
                    }
                });
                processed[id] = true;
            }
        }

        function checkLoaded() {
            var err, usingPathFallback,
                waitInterval = config.waitSeconds * 1000,
                //It is possible to disable the wait interval by using waitSeconds of 0.
                expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),
                noLoads = [],
                reqCalls = [],
                stillLoading = false,
                needCycleCheck = true;

            //Do not bother if this call was a result of a cycle break.
            if (inCheckLoaded) {
                return;
            }

            inCheckLoaded = true;

            //Figure out the state of all the modules.
            eachProp(enabledRegistry, function (mod) {
                var map = mod.map,
                    modId = map.id;

                //Skip things that are not enabled or in error state.
                if (!mod.enabled) {
                    return;
                }

                if (!map.isDefine) {
                    reqCalls.push(mod);
                }

                if (!mod.error) {
                    //If the module should be executed, and it has not
                    //been inited and time is up, remember it.
                    if (!mod.inited && expired) {
                        if (hasPathFallback(modId)) {
                            usingPathFallback = true;
                            stillLoading = true;
                        } else {
                            noLoads.push(modId);
                            removeScript(modId);
                        }
                    } else if (!mod.inited && mod.fetched && map.isDefine) {
                        stillLoading = true;
                        if (!map.prefix) {
                            //No reason to keep looking for unfinished
                            //loading. If the only stillLoading is a
                            //plugin resource though, keep going,
                            //because it may be that a plugin resource
                            //is waiting on a non-plugin cycle.
                            return (needCycleCheck = false);
                        }
                    }
                }
            });

            if (expired && noLoads.length) {
                //If wait time expired, throw error of unloaded modules.
                err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
                err.contextName = context.contextName;
                return onError(err);
            }

            //Not expired, check for a cycle.
            if (needCycleCheck) {
                each(reqCalls, function (mod) {
                    breakCycle(mod, {}, {});
                });
            }

            //If still waiting on loads, and the waiting load is something
            //other than a plugin resource, or there are still outstanding
            //scripts, then just try back later.
            if ((!expired || usingPathFallback) && stillLoading) {
                //Something is still waiting to load. Wait for it, but only
                //if a timeout is not already in effect.
                if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {
                    checkLoadedTimeoutId = setTimeout(function () {
                        checkLoadedTimeoutId = 0;
                        checkLoaded();
                    }, 50);
                }
            }

            inCheckLoaded = false;
        }

        Module = function (map) {
            this.events = getOwn(undefEvents, map.id) || {};
            this.map = map;
            this.shim = getOwn(config.shim, map.id);
            this.depExports = [];
            this.depMaps = [];
            this.depMatched = [];
            this.pluginMaps = {};
            this.depCount = 0;

            /* this.exports this.factory
               this.depMaps = [],
               this.enabled, this.fetched
            */
        };

        Module.prototype = {
            init: function (depMaps, factory, errback, options) {
                options = options || {};

                //Do not do more inits if already done. Can happen if there
                //are multiple define calls for the same module. That is not
                //a normal, common case, but it is also not unexpected.
                if (this.inited) {
                    return;
                }

                this.factory = factory;

                if (errback) {
                    //Register for errors on this module.
                    this.on('error', errback);
                } else if (this.events.error) {
                    //If no errback already, but there are error listeners
                    //on this module, set up an errback to pass to the deps.
                    errback = bind(this, function (err) {
                        this.emit('error', err);
                    });
                }

                //Do a copy of the dependency array, so that
                //source inputs are not modified. For example
                //"shim" deps are passed in here directly, and
                //doing a direct modification of the depMaps array
                //would affect that config.
                this.depMaps = depMaps && depMaps.slice(0);

                this.errback = errback;

                //Indicate this module has be initialized
                this.inited = true;

                this.ignore = options.ignore;

                //Could have option to init this module in enabled mode,
                //or could have been previously marked as enabled. However,
                //the dependencies are not known until init is called. So
                //if enabled previously, now trigger dependencies as enabled.
                if (options.enabled || this.enabled) {
                    //Enable this module and dependencies.
                    //Will call this.check()
                    this.enable();
                } else {
                    this.check();
                }
            },

            defineDep: function (i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;
                }
            },

            fetch: function () {
                if (this.fetched) {
                    return;
                }
                this.fetched = true;

                context.startTime = (new Date()).getTime();

                var map = this.map;

                //If the manager is for a plugin managed resource,
                //ask the plugin to load it now.
                if (this.shim) {
                    context.makeRequire(this.map, {
                        enableBuildCallback: true
                    })(this.shim.deps || [], bind(this, function () {
                        return map.prefix ? this.callPlugin() : this.load();
                    }));
                } else {
                    //Regular dependency.
                    return map.prefix ? this.callPlugin() : this.load();
                }
            },

            load: function () {
                var url = this.map.url;

                //Regular dependency.
                if (!urlFetched[url]) {
                    urlFetched[url] = true;
                    context.load(this.map.id, url);
                }
            },

            /**
             * Checks if the module is ready to define itself, and if so,
             * define it.
             */
            check: function () {
                if (!this.enabled || this.enabling) {
                    return;
                }

                var err, cjsModule,
                    id = this.map.id,
                    depExports = this.depExports,
                    exports = this.exports,
                    factory = this.factory;

                if (!this.inited) {
                    this.fetch();
                } else if (this.error) {
                    this.emit('error', this.error);
                } else if (!this.defining) {
                    //The factory could trigger another require call
                    //that would result in checking this module to
                    //define itself again. If already in the process
                    //of doing that, skip this work.
                    this.defining = true;

                    if (this.depCount < 1 && !this.defined) {
                        if (isFunction(factory)) {
                            //If there is an error listener, favor passing
                            //to that instead of throwing an error. However,
                            //only do it for define()'d  modules. require
                            //errbacks should not be called for failures in
                            //their callbacks (#699). However if a global
                            //onError is set, use that.
                            if ((this.events.error && this.map.isDefine) ||
                                req.onError !== defaultOnError) {
                                try {
                                    exports = context.execCb(id, factory, depExports, exports);
                                } catch (e) {
                                    err = e;
                                }
                            } else {
                                exports = context.execCb(id, factory, depExports, exports);
                            }

                            // Favor return value over exports. If node/cjs in play,
                            // then will not have a return value anyway. Favor
                            // module.exports assignment over exports object.
                            if (this.map.isDefine && exports === undefined) {
                                cjsModule = this.module;
                                if (cjsModule) {
                                    exports = cjsModule.exports;
                                } else if (this.usingExports) {
                                    //exports already set the defined value.
                                    exports = this.exports;
                                }
                            }

                            if (err) {
                                err.requireMap = this.map;
                                err.requireModules = this.map.isDefine ? [this.map.id] : null;
                                err.requireType = this.map.isDefine ? 'define' : 'require';
                                return onError((this.error = err));
                            }

                        } else {
                            //Just a literal value
                            exports = factory;
                        }

                        this.exports = exports;

                        if (this.map.isDefine && !this.ignore) {
                            defined[id] = exports;

                            if (req.onResourceLoad) {
                                req.onResourceLoad(context, this.map, this.depMaps);
                            }
                        }

                        //Clean up
                        cleanRegistry(id);

                        this.defined = true;
                    }

                    //Finished the define stage. Allow calling check again
                    //to allow define notifications below in the case of a
                    //cycle.
                    this.defining = false;

                    if (this.defined && !this.defineEmitted) {
                        this.defineEmitted = true;
                        this.emit('defined', this.exports);
                        this.defineEmitComplete = true;
                    }

                }
            },

            callPlugin: function () {
                var map = this.map,
                    id = map.id,
                    //Map already normalized the prefix.
                    pluginMap = makeModuleMap(map.prefix);

                //Mark this as a dependency for this plugin, so it
                //can be traced for cycles.
                this.depMaps.push(pluginMap);

                on(pluginMap, 'defined', bind(this, function (plugin) {
                    var load, normalizedMap, normalizedMod,
                        bundleId = getOwn(bundlesMap, this.map.id),
                        name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        localRequire = context.makeRequire(map.parentMap, {
                            enableBuildCallback: true
                        });

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function (name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        //prefix and name should already be normalized, no need
                        //for applying map config again either.
                        normalizedMap = makeModuleMap(map.prefix + '!' + name,
                                                      this.map.parentMap);
                        on(normalizedMap,
                            'defined', bind(this, function (value) {
                                this.init([], function () { return value; }, null, {
                                    enabled: true,
                                    ignore: true
                                });
                            }));

                        normalizedMod = getOwn(registry, normalizedMap.id);
                        if (normalizedMod) {
                            //Mark this as a dependency for this plugin, so it
                            //can be traced for cycles.
                            this.depMaps.push(normalizedMap);

                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function (err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    //If a paths config, then just load that file instead to
                    //resolve the plugin, as it is built into that paths layer.
                    if (bundleId) {
                        this.map.url = context.nameToUrl(bundleId);
                        this.load();
                        return;
                    }

                    load = bind(this, function (value) {
                        this.init([], function () { return value; }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function (err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function (mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                cleanRegistry(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = bind(this, function (text, textAlt) {
                        /*jslint evil: true */
                        var moduleName = map.name,
                            moduleMap = makeModuleMap(moduleName),
                            hasInteractive = useInteractive;

                        //As of 2.1.0, support just passing the text, to reinforce
                        //fromText only being called once per resource. Still
                        //support old style of passing moduleName but discard
                        //that moduleName in favor of the internal ref.
                        if (textAlt) {
                            text = textAlt;
                        }

                        //Turn off interactive script matching for IE for any define
                        //calls in the text, then turn it back on at the end.
                        if (hasInteractive) {
                            useInteractive = false;
                        }

                        //Prime the system by creating a module instance for
                        //it.
                        getModule(moduleMap);

                        //Transfer any config to this other module.
                        if (hasProp(config.config, id)) {
                            config.config[moduleName] = config.config[id];
                        }

                        try {
                            req.exec(text);
                        } catch (e) {
                            return onError(makeError('fromtexteval',
                                             'fromText eval for ' + id +
                                            ' failed: ' + e,
                                             e,
                                             [id]));
                        }

                        if (hasInteractive) {
                            useInteractive = true;
                        }

                        //Mark this as a dependency for the plugin
                        //resource
                        this.depMaps.push(moduleMap);

                        //Support anonymous modules.
                        context.completeLoad(moduleName);

                        //Bind the value of that module to the value for this
                        //resource ID.
                        localRequire([moduleName], load);
                    });

                    //Use parentName here since the plugin's name is not reliable,
                    //could be some weird string with no path that actually wants to
                    //reference the parentName's path.
                    plugin.load(map.name, localRequire, load, config);
                }));

                context.enable(pluginMap, this);
                this.pluginMaps[pluginMap.id] = pluginMap;
            },

            enable: function () {
                enabledRegistry[this.map.id] = this;
                this.enabled = true;

                //Set flag mentioning that the module is enabling,
                //so that immediate calls to the defined callbacks
                //for dependencies do not trigger inadvertent load
                //with the depCount still being zero.
                this.enabling = true;

                //Enable each dependency
                each(this.depMaps, bind(this, function (depMap, i) {
                    var id, mod, handler;

                    if (typeof depMap === 'string') {
                        //Dependency needs to be converted to a depMap
                        //and wired up to this module.
                        depMap = makeModuleMap(depMap,
                                               (this.map.isDefine ? this.map : this.map.parentMap),
                                               false,
                                               !this.skipMap);
                        this.depMaps[i] = depMap;

                        handler = getOwn(handlers, depMap.id);

                        if (handler) {
                            this.depExports[i] = handler(this);
                            return;
                        }

                        this.depCount += 1;

                        on(depMap, 'defined', bind(this, function (depExports) {
                            this.defineDep(i, depExports);
                            this.check();
                        }));

                        if (this.errback) {
                            on(depMap, 'error', bind(this, this.errback));
                        }
                    }

                    id = depMap.id;
                    mod = registry[id];

                    //Skip special modules like 'require', 'exports', 'module'
                    //Also, don't call enable if it is already enabled,
                    //important in circular dependency cases.
                    if (!hasProp(handlers, id) && mod && !mod.enabled) {
                        context.enable(depMap, this);
                    }
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function (pluginMap) {
                    var mod = getOwn(registry, pluginMap.id);
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.enabling = false;

                this.check();
            },

            on: function (name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function (name, evt) {
                each(this.events[name], function (cb) {
                    cb(evt);
                });
                if (name === 'error') {
                    //Now that the error handler was triggered, remove
                    //the listeners, since this broken Module instance
                    //can stay around for a while in the registry.
                    delete this.events[name];
                }
            }
        };

        function callGetModule(args) {
            //Skip modules already defined.
            if (!hasProp(defined, args[0])) {
                getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
            }
        }

        function removeListener(node, func, name, ieName) {
            //Favor detachEvent because of IE9
            //issue, see attachEvent/addEventListener comment elsewhere
            //in this file.
            if (node.detachEvent && !isOpera) {
                //Probably IE. If not it will throw an error, which will be
                //useful to know.
                if (ieName) {
                    node.detachEvent(ieName, func);
                }
            } else {
                node.removeEventListener(name, func, false);
            }
        }

        /**
         * Given an event from a script node, get the requirejs info from it,
         * and then removes the event listeners on the node.
         * @param {Event} evt
         * @returns {Object}
         */
        function getScriptData(evt) {
            //Using currentTarget instead of target for Firefox 2.0's sake. Not
            //all old browsers will be supported, but this one was easy enough
            //to support and still makes sense.
            var node = evt.currentTarget || evt.srcElement;

            //Remove the listeners once here.
            removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
            removeListener(node, context.onScriptError, 'error');

            return {
                node: node,
                id: node && node.getAttribute('data-requiremodule')
            };
        }

        function intakeDefines() {
            var args;

            //Any defined modules in the global queue, intake them now.
            takeGlobalQueue();

            //Make sure any remaining defQueue items get properly processed.
            while (defQueue.length) {
                args = defQueue.shift();
                if (args[0] === null) {
                    return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' + args[args.length - 1]));
                } else {
                    //args are id, deps, factory. Should be normalized by the
                    //define() function.
                    callGetModule(args);
                }
            }
        }

        context = {
            config: config,
            contextName: contextName,
            registry: registry,
            defined: defined,
            urlFetched: urlFetched,
            defQueue: defQueue,
            Module: Module,
            makeModuleMap: makeModuleMap,
            nextTick: req.nextTick,
            onError: onError,

            /**
             * Set a configuration for the context.
             * @param {Object} cfg config object to integrate.
             */
            configure: function (cfg) {
                //Make sure the baseUrl ends in a slash.
                if (cfg.baseUrl) {
                    if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
                        cfg.baseUrl += '/';
                    }
                }

                //Save off the paths since they require special processing,
                //they are additive.
                var shim = config.shim,
                    objs = {
                        paths: true,
                        bundles: true,
                        config: true,
                        map: true
                    };

                eachProp(cfg, function (value, prop) {
                    if (objs[prop]) {
                        if (!config[prop]) {
                            config[prop] = {};
                        }
                        mixin(config[prop], value, true, true);
                    } else {
                        config[prop] = value;
                    }
                });

                //Reverse map the bundles
                if (cfg.bundles) {
                    eachProp(cfg.bundles, function (value, prop) {
                        each(value, function (v) {
                            if (v !== prop) {
                                bundlesMap[v] = prop;
                            }
                        });
                    });
                }

                //Merge shim
                if (cfg.shim) {
                    eachProp(cfg.shim, function (value, id) {
                        //Normalize the structure
                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if ((value.exports || value.init) && !value.exportsFn) {
                            value.exportsFn = context.makeShimExports(value);
                        }
                        shim[id] = value;
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {
                    each(cfg.packages, function (pkgObj) {
                        var location, name;

                        pkgObj = typeof pkgObj === 'string' ? { name: pkgObj } : pkgObj;

                        name = pkgObj.name;
                        location = pkgObj.location;
                        if (location) {
                            config.paths[name] = pkgObj.location;
                        }

                        //Save pointer to main module ID for pkg name.
                        //Remove leading dot in main, so main paths are normalized,
                        //and remove any trailing .js, since different package
                        //envs have different conventions: some use a module name,
                        //some use a file name.
                        config.pkgs[name] = pkgObj.name + '/' + (pkgObj.main || 'main')
                                     .replace(currDirRegExp, '')
                                     .replace(jsSuffixRegExp, '');
                    });
                }

                //If there are any "waiting to execute" modules in the registry,
                //update the maps for them, since their info, like URLs to load,
                //may have changed.
                eachProp(registry, function (mod, id) {
                    //If module already has init called, since it is too
                    //late to modify them, and ignore unnormalized ones
                    //since they are transient.
                    if (!mod.inited && !mod.map.unnormalized) {
                        mod.map = makeModuleMap(id);
                    }
                });

                //If a deps array or a config callback is specified, then call
                //require with those args. This is useful when require is defined as a
                //config object before require.js is loaded.
                if (cfg.deps || cfg.callback) {
                    context.require(cfg.deps || [], cfg.callback);
                }
            },

            makeShimExports: function (value) {
                function fn() {
                    var ret;
                    if (value.init) {
                        ret = value.init.apply(global, arguments);
                    }
                    return ret || (value.exports && getGlobal(value.exports));
                }
                return fn;
            },

            makeRequire: function (relMap, options) {
                options = options || {};

                function localRequire(deps, callback, errback) {
                    var id, map, requireMod;

                    if (options.enableBuildCallback && callback && isFunction(callback)) {
                        callback.__requireJsBuild = true;
                    }

                    if (typeof deps === 'string') {
                        if (isFunction(callback)) {
                            //Invalid call
                            return onError(makeError('requireargs', 'Invalid require call'), errback);
                        }

                        //If require|exports|module are requested, get the
                        //value for them from the special handlers. Caveat:
                        //this only works while module is being defined.
                        if (relMap && hasProp(handlers, deps)) {
                            return handlers[deps](registry[relMap.id]);
                        }

                        //Synchronous access to one module. If require.get is
                        //available (as in the Node adapter), prefer that.
                        if (req.get) {
                            return req.get(context, deps, relMap, localRequire);
                        }

                        //Normalize module name, if it contains . or ..
                        map = makeModuleMap(deps, relMap, false, true);
                        id = map.id;

                        if (!hasProp(defined, id)) {
                            return onError(makeError('notloaded', 'Module name "' +
                                        id +
                                        '" has not been loaded yet for context: ' +
                                        contextName +
                                        (relMap ? '' : '. Use require([])')));
                        }
                        return defined[id];
                    }

                    //Grab defines waiting in the global queue.
                    intakeDefines();

                    //Mark all the dependencies as needing to be loaded.
                    context.nextTick(function () {
                        //Some defines could have been added since the
                        //require call, collect them.
                        intakeDefines();

                        requireMod = getModule(makeModuleMap(null, relMap));

                        //Store if map config should be applied to this require
                        //call for dependencies.
                        requireMod.skipMap = options.skipMap;

                        requireMod.init(deps, callback, errback, {
                            enabled: true
                        });

                        checkLoaded();
                    });

                    return localRequire;
                }

                mixin(localRequire, {
                    isBrowser: isBrowser,

                    /**
                     * Converts a module name + .extension into an URL path.
                     * *Requires* the use of a module name. It does not support using
                     * plain URLs like nameToUrl.
                     */
                    toUrl: function (moduleNamePlusExt) {
                        var ext,
                            index = moduleNamePlusExt.lastIndexOf('.'),
                            segment = moduleNamePlusExt.split('/')[0],
                            isRelative = segment === '.' || segment === '..';

                        //Have a file extension alias, and it is not the
                        //dots from a relative path.
                        if (index !== -1 && (!isRelative || index > 1)) {
                            ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                            moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                        }

                        return context.nameToUrl(normalize(moduleNamePlusExt,
                                                relMap && relMap.id, true), ext,  true);
                    },

                    defined: function (id) {
                        return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
                    },

                    specified: function (id) {
                        id = makeModuleMap(id, relMap, false, true).id;
                        return hasProp(defined, id) || hasProp(registry, id);
                    }
                });

                //Only allow undef on top level require calls
                if (!relMap) {
                    localRequire.undef = function (id) {
                        //Bind any waiting define() calls to this context,
                        //fix for #408
                        takeGlobalQueue();

                        var map = makeModuleMap(id, relMap, true),
                            mod = getOwn(registry, id);

                        removeScript(id);

                        delete defined[id];
                        delete urlFetched[map.url];
                        delete undefEvents[id];

                        //Clean queued defines too. Go backwards
                        //in array so that the splices do not
                        //mess up the iteration.
                        eachReverse(defQueue, function(args, i) {
                            if(args[0] === id) {
                                defQueue.splice(i, 1);
                            }
                        });

                        if (mod) {
                            //Hold on to listeners in case the
                            //module will be attempted to be reloaded
                            //using a different config.
                            if (mod.events.defined) {
                                undefEvents[id] = mod.events;
                            }

                            cleanRegistry(id);
                        }
                    };
                }

                return localRequire;
            },

            /**
             * Called to enable a module if it is still in the registry
             * awaiting enablement. A second arg, parent, the parent module,
             * is passed in for context, when this method is overriden by
             * the optimizer. Not shown here to keep code compact.
             */
            enable: function (depMap) {
                var mod = getOwn(registry, depMap.id);
                if (mod) {
                    getModule(depMap).enable();
                }
            },

            /**
             * Internal method used by environment adapters to complete a load event.
             * A load event could be a script load or just a load pass from a synchronous
             * load call.
             * @param {String} moduleName the name of the module to potentially complete.
             */
            completeLoad: function (moduleName) {
                var found, args, mod,
                    shim = getOwn(config.shim, moduleName) || {},
                    shExports = shim.exports;

                takeGlobalQueue();

                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        args[0] = moduleName;
                        //If already found an anonymous module and bound it
                        //to this name, then this is some other anon module
                        //waiting for its completeLoad to fire.
                        if (found) {
                            break;
                        }
                        found = true;
                    } else if (args[0] === moduleName) {
                        //Found matching define call for this script!
                        found = true;
                    }

                    callGetModule(args);
                }

                //Do this after the cycle of callGetModule in case the result
                //of those calls/init calls changes the registry.
                mod = getOwn(registry, moduleName);

                if (!found && !hasProp(defined, moduleName) && mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine',
                                             'No define call for ' + moduleName,
                                             null,
                                             [moduleName]));
                        }
                    } else {
                        //A script that does not call define(), so just simulate
                        //the call for it.
                        callGetModule([moduleName, (shim.deps || []), shim.exportsFn]);
                    }
                }

                checkLoaded();
            },

            /**
             * Converts a module name to a file path. Supports cases where
             * moduleName may actually be just an URL.
             * Note that it **does not** call normalize on the moduleName,
             * it is assumed to have already been normalized. This is an
             * internal API, not a public one. Use toUrl for the public API.
             */
            nameToUrl: function (moduleName, ext, skipExt) {
                var paths, syms, i, parentModule, url,
                    parentPath, bundleId,
                    pkgMain = getOwn(config.pkgs, moduleName);

                if (pkgMain) {
                    moduleName = pkgMain;
                }

                bundleId = getOwn(bundlesMap, moduleName);

                if (bundleId) {
                    return context.nameToUrl(bundleId, ext, skipExt);
                }

                //If a colon is in the URL, it indicates a protocol is used and it is just
                //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
                //or ends with .js, then assume the user meant to use an url and not a module id.
                //The slash is important for protocol-less URLs as well as full paths.
                if (req.jsExtRegExp.test(moduleName)) {
                    //Just a plain path, not module name lookup, so just return it.
                    //Add extension if it is included. This is a bit wonky, only non-.js things pass
                    //an extension, this method probably needs to be reworked.
                    url = moduleName + (ext || '');
                } else {
                    //A module that needs to be converted to a path.
                    paths = config.paths;

                    syms = moduleName.split('/');
                    //For each module name segment, see if there is a path
                    //registered for it. Start with most specific name
                    //and work up from it.
                    for (i = syms.length; i > 0; i -= 1) {
                        parentModule = syms.slice(0, i).join('/');

                        parentPath = getOwn(paths, parentModule);
                        if (parentPath) {
                            //If an array, it means there are a few choices,
                            //Choose the one that is desired
                            if (isArray(parentPath)) {
                                parentPath = parentPath[0];
                            }
                            syms.splice(0, i, parentPath);
                            break;
                        }
                    }

                    //Join the path parts together, then figure out if baseUrl is needed.
                    url = syms.join('/');
                    url += (ext || (/^data\:|\?/.test(url) || skipExt ? '' : '.js'));
                    url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
                }

                return config.urlArgs ? url +
                                        ((url.indexOf('?') === -1 ? '?' : '&') +
                                         config.urlArgs) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function (id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callback function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function (name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function (evt) {
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                if (evt.type === 'load' ||
                        (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
                    //Reset interactive script so a script node is not held onto for
                    //to long.
                    interactiveScript = null;

                    //Pull out the name of the module and the context.
                    var data = getScriptData(evt);
                    context.completeLoad(data.id);
                }
            },

            /**
             * Callback for script errors.
             */
            onScriptError: function (evt) {
                var data = getScriptData(evt);
                if (!hasPathFallback(data.id)) {
                    return onError(makeError('scripterror', 'Script error for: ' + data.id, evt, [data.id]));
                }
            }
        };

        context.require = context.makeRequire();
        return context;
    }

    /**
     * Main entry point.
     *
     * If the only argument to require is a string, then the module that
     * is represented by that string is fetched for the appropriate context.
     *
     * If the first argument is an array, then it will be treated as an array
     * of dependency string names to fetch. An optional function callback can
     * be specified to execute when all of those dependencies are available.
     *
     * Make a local req variable to help Caja compliance (it assumes things
     * on a require that are not standardized), and to give a short
     * name for minification/local scope use.
     */
    req = requirejs = function (deps, callback, errback, optional) {

        //Find the right context, use default
        var context, config,
            contextName = defContextName;

        // Determine if have config object in the call.
        if (!isArray(deps) && typeof deps !== 'string') {
            // deps is a config object
            config = deps;
            if (isArray(callback)) {
                // Adjust args if there are dependencies
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = getOwn(contexts, contextName);
        if (!context) {
            context = contexts[contextName] = req.s.newContext(contextName);
        }

        if (config) {
            context.configure(config);
        }

        return context.require(deps, callback, errback);
    };

    /**
     * Support require.config() to make it easier to cooperate with other
     * AMD loaders on globally agreed names.
     */
    req.config = function (config) {
        return req(config);
    };

    /**
     * Execute something after the current tick
     * of the event loop. Override for other envs
     * that have a better solution than setTimeout.
     * @param  {Function} fn function to execute later.
     */
    req.nextTick = typeof setTimeout !== 'undefined' ? function (fn) {
        setTimeout(fn, 4);
    } : function (fn) { fn(); };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    req.version = version;

    //Used to filter out dependencies that are already paths.
    req.jsExtRegExp = /^\/|:|\?|\.js$/;
    req.isBrowser = isBrowser;
    s = req.s = {
        contexts: contexts,
        newContext: newContext
    };

    //Create default context.
    req({});

    //Exports some context-sensitive methods on global require.
    each([
        'toUrl',
        'undef',
        'defined',
        'specified'
    ], function (prop) {
        //Reference from contexts instead of early binding to default context,
        //so that during builds, the latest instance of the default context
        //with its config gets used.
        req[prop] = function () {
            var ctx = contexts[defContextName];
            return ctx.require[prop].apply(ctx, arguments);
        };
    });

    if (isBrowser) {
        head = s.head = document.getElementsByTagName('head')[0];
        //If BASE tag is in play, using appendChild is a problem for IE6.
        //When that browser dies, this can be removed. Details in this jQuery bug:
        //http://dev.jquery.com/ticket/2709
        baseElement = document.getElementsByTagName('base')[0];
        if (baseElement) {
            head = s.head = baseElement.parentNode;
        }
    }

    /**
     * Any errors that require explicitly generates will be passed to this
     * function. Intercept/override it if you want custom error handling.
     * @param {Error} err the error object.
     */
    req.onError = defaultOnError;

    /**
     * Creates the node for the load command. Only used in browser envs.
     */
    req.createNode = function (config, moduleName, url) {
        var node = config.xhtml ?
                document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
                document.createElement('script');
        node.type = config.scriptType || 'text/javascript';
        node.charset = 'utf-8';
        node.async = true;
        return node;
    };

    /**
     * Does the request to load a module for the browser case.
     * Make this a separate function to allow other environments
     * to override it.
     *
     * @param {Object} context the require context to find state.
     * @param {String} moduleName the name of the module.
     * @param {Object} url the URL to the module.
     */
    req.load = function (context, moduleName, url) {
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = req.createNode(config, moduleName, url);

            node.setAttribute('data-requirecontext', context.contextName);
            node.setAttribute('data-requiremodule', moduleName);

            //Set up load listener. Test attachEvent first because IE9 has
            //a subtle issue in its addEventListener and script onload firings
            //that do not match the behavior of all other browsers with
            //addEventListener support, which fire the onload event for a
            //script right after the script execution. See:
            //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
            //UNFORTUNATELY Opera implements attachEvent but does not follow the script
            //script execution mode.
            if (node.attachEvent &&
                    //Check if node.attachEvent is artificially added by custom script or
                    //natively supported by browser
                    //read https://github.com/jrburke/requirejs/issues/187
                    //if we can NOT find [native code] then it must NOT natively supported.
                    //in IE8, node.attachEvent does not have toString()
                    //Note the test for "[native code" with no closing brace, see:
                    //https://github.com/jrburke/requirejs/issues/273
                    !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
                    !isOpera) {
                //Probably IE. IE (at least 6-8) do not fire
                //script onload right after executing the script, so
                //we cannot tie the anonymous define call to a name.
                //However, IE reports the script as being in 'interactive'
                //readyState at the time of the define call.
                useInteractive = true;

                node.attachEvent('onreadystatechange', context.onScriptLoad);
                //It would be great to add an error handler here to catch
                //404s in IE9+. However, onreadystatechange will fire before
                //the error handler, so that does not help. If addEventListener
                //is used, then IE will fire error before load, but we cannot
                //use that pathway given the connect.microsoft.com issue
                //mentioned above about not doing the 'script execute,
                //then fire the script load event listener before execute
                //next script' that other browsers do.
                //Best hope: IE10 fixes the issues,
                //and then destroys all installs of IE 6-9.
                //node.attachEvent('onerror', context.onScriptError);
            } else {
                node.addEventListener('load', context.onScriptLoad, false);
                node.addEventListener('error', context.onScriptError, false);
            }
            node.src = url;

            //For some cache cases in IE 6-8, the script executes before the end
            //of the appendChild execution, so to tie an anonymous define
            //call to the module name (which is stored on the node), hold on
            //to a reference to this node, but clear after the DOM insertion.
            currentlyAddingScript = node;
            if (baseElement) {
                head.insertBefore(node, baseElement);
            } else {
                head.appendChild(node);
            }
            currentlyAddingScript = null;

            return node;
        } else if (isWebWorker) {
            try {
                //In a web worker, use importScripts. This is not a very
                //efficient use of importScripts, importScripts will block until
                //its script is downloaded and evaluated. However, if web workers
                //are in play, the expectation that a build has been done so that
                //only one script needs to be loaded anyway. This may need to be
                //reevaluated if other use cases become common.
                importScripts(url);

                //Account for anonymous modules
                context.completeLoad(moduleName);
            } catch (e) {
                context.onError(makeError('importscripts',
                                'importScripts failed for ' +
                                    moduleName + ' at ' + url,
                                e,
                                [moduleName]));
            }
        }
    };

    function getInteractiveScript() {
        if (interactiveScript && interactiveScript.readyState === 'interactive') {
            return interactiveScript;
        }

        eachReverse(scripts(), function (script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser && !cfg.skipDataMain) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function (script) {
            //Set the 'head' where we can append children by
            //using the script's parent.
            if (!head) {
                head = script.parentNode;
            }

            //Look for a data-main attribute to set main script for the page
            //to load. If it is there, the path to data main becomes the
            //baseUrl, if it is not already set.
            dataMain = script.getAttribute('data-main');
            if (dataMain) {
                //Preserve dataMain in case it is a path (i.e. contains '?')
                mainScript = dataMain;

                //Set final baseUrl if there is not already an explicit one.
                if (!cfg.baseUrl) {
                    //Pull off the directory of data-main for use as the
                    //baseUrl.
                    src = mainScript.split('/');
                    mainScript = src.pop();
                    subPath = src.length ? src.join('/')  + '/' : './';

                    cfg.baseUrl = subPath;
                }

                //Strip off any trailing .js since mainScript is now
                //like a module name.
                mainScript = mainScript.replace(jsSuffixRegExp, '');

                 //If mainScript is still a path, fall back to dataMain
                if (req.jsExtRegExp.test(mainScript)) {
                    mainScript = dataMain;
                }

                //Put the data-main script in the files to load.
                cfg.deps = cfg.deps ? cfg.deps.concat(mainScript) : [mainScript];

                return true;
            }
        });
    }

    /**
     * The function that handles definitions of modules. Differs from
     * require() in that a string for the module should be the first argument,
     * and the function to execute after dependencies are loaded should
     * return a value to define the module corresponding to the first argument's
     * name.
     */
    define = function (name, deps, callback) {
        var node, context;

        //Allow for anonymous modules
        if (typeof name !== 'string') {
            //Adjust args appropriately
            callback = deps;
            deps = name;
            name = null;
        }

        //This module may not have dependencies
        if (!isArray(deps)) {
            callback = deps;
            deps = null;
        }

        //If no name, and callback is a function, then figure out if it a
        //CommonJS thing with dependencies.
        if (!deps && isFunction(callback)) {
            deps = [];
            //Remove comments from the callback string,
            //look for require calls, and pull them into the dependencies,
            //but only if there are function args.
            if (callback.length) {
                callback
                    .toString()
                    .replace(commentRegExp, '')
                    .replace(cjsRequireRegExp, function (match, dep) {
                        deps.push(dep);
                    });

                //May be a CommonJS thing even without require calls, but still
                //could use exports, and module. Avoid doing exports and module
                //work though if it just needs require.
                //REQUIRES the function to expect the CommonJS variables in the
                //order listed below.
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);
            }
        }

        //If in IE 6-8 and hit an anonymous define() call, do the interactive
        //work.
        if (useInteractive) {
            node = currentlyAddingScript || getInteractiveScript();
            if (node) {
                if (!name) {
                    name = node.getAttribute('data-requiremodule');
                }
                context = contexts[node.getAttribute('data-requirecontext')];
            }
        }

        //Always save off evaluating the def call until the script onload handler.
        //This allows multiple modules to be in a file without prematurely
        //tracing dependencies, and allows for anonymous module support,
        //where the module name is not known until the script onload event
        //occurs. If no context, use the global queue, and get it processed
        //in the onscript load callback.
        (context ? context.defQueue : globalDefQueue).push([name, deps, callback]);
    };

    define.amd = {
        jQuery: true
    };


    /**
     * Executes the text. Normally just uses eval, but can be modified
     * to use a better, environment-specific call. Only used for transpiling
     * loader plugins, not for plain JS modules.
     * @param {String} text the text to execute/evaluate.
     */
    req.exec = function (text) {
        /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    req(cfg);
}(this));

define("requireLib", function(){});

/*!
 * jQuery JavaScript Library v2.1.0
 * http://jquery.com/
 *
 * Includes Sizzle.js
 * http://sizzlejs.com/
 *
 * Copyright 2005, 2014 jQuery Foundation, Inc. and other contributors
 * Released under the MIT license
 * http://jquery.org/license
 *
 * Date: 2014-01-23T21:10Z
 */

(function( global, factory ) {

	if ( typeof module === "object" && typeof module.exports === "object" ) {
		// For CommonJS and CommonJS-like environments where a proper window is present,
		// execute the factory and get jQuery
		// For environments that do not inherently posses a window with a document
		// (such as Node.js), expose a jQuery-making factory as module.exports
		// This accentuates the need for the creation of a real window
		// e.g. var jQuery = require("jquery")(window);
		// See ticket #14549 for more info
		module.exports = global.document ?
			factory( global, true ) :
			function( w ) {
				if ( !w.document ) {
					throw new Error( "jQuery requires a window with a document" );
				}
				return factory( w );
			};
	} else {
		factory( global );
	}

// Pass this if window is not defined yet
}(typeof window !== "undefined" ? window : this, function( window, noGlobal ) {

// Can't do this because several apps including ASP.NET trace
// the stack via arguments.caller.callee and Firefox dies if
// you try to trace through "use strict" call chains. (#13335)
// Support: Firefox 18+
//

var arr = [];

var slice = arr.slice;

var concat = arr.concat;

var push = arr.push;

var indexOf = arr.indexOf;

var class2type = {};

var toString = class2type.toString;

var hasOwn = class2type.hasOwnProperty;

var trim = "".trim;

var support = {};



var
	// Use the correct document accordingly with window argument (sandbox)
	document = window.document,

	version = "2.1.0",

	// Define a local copy of jQuery
	jQuery = function( selector, context ) {
		// The jQuery object is actually just the init constructor 'enhanced'
		// Need init if jQuery is called (just allow error to be thrown if not included)
		return new jQuery.fn.init( selector, context );
	},

	// Matches dashed string for camelizing
	rmsPrefix = /^-ms-/,
	rdashAlpha = /-([\da-z])/gi,

	// Used by jQuery.camelCase as callback to replace()
	fcamelCase = function( all, letter ) {
		return letter.toUpperCase();
	};

jQuery.fn = jQuery.prototype = {
	// The current version of jQuery being used
	jquery: version,

	constructor: jQuery,

	// Start with an empty selector
	selector: "",

	// The default length of a jQuery object is 0
	length: 0,

	toArray: function() {
		return slice.call( this );
	},

	// Get the Nth element in the matched element set OR
	// Get the whole matched element set as a clean array
	get: function( num ) {
		return num != null ?

			// Return a 'clean' array
			( num < 0 ? this[ num + this.length ] : this[ num ] ) :

			// Return just the object
			slice.call( this );
	},

	// Take an array of elements and push it onto the stack
	// (returning the new matched element set)
	pushStack: function( elems ) {

		// Build a new jQuery matched element set
		var ret = jQuery.merge( this.constructor(), elems );

		// Add the old object onto the stack (as a reference)
		ret.prevObject = this;
		ret.context = this.context;

		// Return the newly-formed element set
		return ret;
	},

	// Execute a callback for every element in the matched set.
	// (You can seed the arguments with an array of args, but this is
	// only used internally.)
	each: function( callback, args ) {
		return jQuery.each( this, callback, args );
	},

	map: function( callback ) {
		return this.pushStack( jQuery.map(this, function( elem, i ) {
			return callback.call( elem, i, elem );
		}));
	},

	slice: function() {
		return this.pushStack( slice.apply( this, arguments ) );
	},

	first: function() {
		return this.eq( 0 );
	},

	last: function() {
		return this.eq( -1 );
	},

	eq: function( i ) {
		var len = this.length,
			j = +i + ( i < 0 ? len : 0 );
		return this.pushStack( j >= 0 && j < len ? [ this[j] ] : [] );
	},

	end: function() {
		return this.prevObject || this.constructor(null);
	},

	// For internal use only.
	// Behaves like an Array's method, not like a jQuery method.
	push: push,
	sort: arr.sort,
	splice: arr.splice
};

jQuery.extend = jQuery.fn.extend = function() {
	var options, name, src, copy, copyIsArray, clone,
		target = arguments[0] || {},
		i = 1,
		length = arguments.length,
		deep = false;

	// Handle a deep copy situation
	if ( typeof target === "boolean" ) {
		deep = target;

		// skip the boolean and the target
		target = arguments[ i ] || {};
		i++;
	}

	// Handle case when target is a string or something (possible in deep copy)
	if ( typeof target !== "object" && !jQuery.isFunction(target) ) {
		target = {};
	}

	// extend jQuery itself if only one argument is passed
	if ( i === length ) {
		target = this;
		i--;
	}

	for ( ; i < length; i++ ) {
		// Only deal with non-null/undefined values
		if ( (options = arguments[ i ]) != null ) {
			// Extend the base object
			for ( name in options ) {
				src = target[ name ];
				copy = options[ name ];

				// Prevent never-ending loop
				if ( target === copy ) {
					continue;
				}

				// Recurse if we're merging plain objects or arrays
				if ( deep && copy && ( jQuery.isPlainObject(copy) || (copyIsArray = jQuery.isArray(copy)) ) ) {
					if ( copyIsArray ) {
						copyIsArray = false;
						clone = src && jQuery.isArray(src) ? src : [];

					} else {
						clone = src && jQuery.isPlainObject(src) ? src : {};
					}

					// Never move original objects, clone them
					target[ name ] = jQuery.extend( deep, clone, copy );

				// Don't bring in undefined values
				} else if ( copy !== undefined ) {
					target[ name ] = copy;
				}
			}
		}
	}

	// Return the modified object
	return target;
};

jQuery.extend({
	// Unique for each copy of jQuery on the page
	expando: "jQuery" + ( version + Math.random() ).replace( /\D/g, "" ),

	// Assume jQuery is ready without the ready module
	isReady: true,

	error: function( msg ) {
		throw new Error( msg );
	},

	noop: function() {},

	// See test/unit/core.js for details concerning isFunction.
	// Since version 1.3, DOM methods and functions like alert
	// aren't supported. They return false on IE (#2968).
	isFunction: function( obj ) {
		return jQuery.type(obj) === "function";
	},

	isArray: Array.isArray,

	isWindow: function( obj ) {
		return obj != null && obj === obj.window;
	},

	isNumeric: function( obj ) {
		// parseFloat NaNs numeric-cast false positives (null|true|false|"")
		// ...but misinterprets leading-number strings, particularly hex literals ("0x...")
		// subtraction forces infinities to NaN
		return obj - parseFloat( obj ) >= 0;
	},

	isPlainObject: function( obj ) {
		// Not plain objects:
		// - Any object or value whose internal [[Class]] property is not "[object Object]"
		// - DOM nodes
		// - window
		if ( jQuery.type( obj ) !== "object" || obj.nodeType || jQuery.isWindow( obj ) ) {
			return false;
		}

		// Support: Firefox <20
		// The try/catch suppresses exceptions thrown when attempting to access
		// the "constructor" property of certain host objects, ie. |window.location|
		// https://bugzilla.mozilla.org/show_bug.cgi?id=814622
		try {
			if ( obj.constructor &&
					!hasOwn.call( obj.constructor.prototype, "isPrototypeOf" ) ) {
				return false;
			}
		} catch ( e ) {
			return false;
		}

		// If the function hasn't returned already, we're confident that
		// |obj| is a plain object, created by {} or constructed with new Object
		return true;
	},

	isEmptyObject: function( obj ) {
		var name;
		for ( name in obj ) {
			return false;
		}
		return true;
	},

	type: function( obj ) {
		if ( obj == null ) {
			return obj + "";
		}
		// Support: Android < 4.0, iOS < 6 (functionish RegExp)
		return typeof obj === "object" || typeof obj === "function" ?
			class2type[ toString.call(obj) ] || "object" :
			typeof obj;
	},

	// Evaluates a script in a global context
	globalEval: function( code ) {
		var script,
			indirect = eval;

		code = jQuery.trim( code );

		if ( code ) {
			// If the code includes a valid, prologue position
			// strict mode pragma, execute code by injecting a
			// script tag into the document.
			if ( code.indexOf("use strict") === 1 ) {
				script = document.createElement("script");
				script.text = code;
				document.head.appendChild( script ).parentNode.removeChild( script );
			} else {
			// Otherwise, avoid the DOM node creation, insertion
			// and removal by using an indirect global eval
				indirect( code );
			}
		}
	},

	// Convert dashed to camelCase; used by the css and data modules
	// Microsoft forgot to hump their vendor prefix (#9572)
	camelCase: function( string ) {
		return string.replace( rmsPrefix, "ms-" ).replace( rdashAlpha, fcamelCase );
	},

	nodeName: function( elem, name ) {
		return elem.nodeName && elem.nodeName.toLowerCase() === name.toLowerCase();
	},

	// args is for internal usage only
	each: function( obj, callback, args ) {
		var value,
			i = 0,
			length = obj.length,
			isArray = isArraylike( obj );

		if ( args ) {
			if ( isArray ) {
				for ( ; i < length; i++ ) {
					value = callback.apply( obj[ i ], args );

					if ( value === false ) {
						break;
					}
				}
			} else {
				for ( i in obj ) {
					value = callback.apply( obj[ i ], args );

					if ( value === false ) {
						break;
					}
				}
			}

		// A special, fast, case for the most common use of each
		} else {
			if ( isArray ) {
				for ( ; i < length; i++ ) {
					value = callback.call( obj[ i ], i, obj[ i ] );

					if ( value === false ) {
						break;
					}
				}
			} else {
				for ( i in obj ) {
					value = callback.call( obj[ i ], i, obj[ i ] );

					if ( value === false ) {
						break;
					}
				}
			}
		}

		return obj;
	},

	trim: function( text ) {
		return text == null ? "" : trim.call( text );
	},

	// results is for internal usage only
	makeArray: function( arr, results ) {
		var ret = results || [];

		if ( arr != null ) {
			if ( isArraylike( Object(arr) ) ) {
				jQuery.merge( ret,
					typeof arr === "string" ?
					[ arr ] : arr
				);
			} else {
				push.call( ret, arr );
			}
		}

		return ret;
	},

	inArray: function( elem, arr, i ) {
		return arr == null ? -1 : indexOf.call( arr, elem, i );
	},

	merge: function( first, second ) {
		var len = +second.length,
			j = 0,
			i = first.length;

		for ( ; j < len; j++ ) {
			first[ i++ ] = second[ j ];
		}

		first.length = i;

		return first;
	},

	grep: function( elems, callback, invert ) {
		var callbackInverse,
			matches = [],
			i = 0,
			length = elems.length,
			callbackExpect = !invert;

		// Go through the array, only saving the items
		// that pass the validator function
		for ( ; i < length; i++ ) {
			callbackInverse = !callback( elems[ i ], i );
			if ( callbackInverse !== callbackExpect ) {
				matches.push( elems[ i ] );
			}
		}

		return matches;
	},

	// arg is for internal usage only
	map: function( elems, callback, arg ) {
		var value,
			i = 0,
			length = elems.length,
			isArray = isArraylike( elems ),
			ret = [];

		// Go through the array, translating each of the items to their new values
		if ( isArray ) {
			for ( ; i < length; i++ ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret.push( value );
				}
			}

		// Go through every key on the object,
		} else {
			for ( i in elems ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret.push( value );
				}
			}
		}

		// Flatten any nested arrays
		return concat.apply( [], ret );
	},

	// A global GUID counter for objects
	guid: 1,

	// Bind a function to a context, optionally partially applying any
	// arguments.
	proxy: function( fn, context ) {
		var tmp, args, proxy;

		if ( typeof context === "string" ) {
			tmp = fn[ context ];
			context = fn;
			fn = tmp;
		}

		// Quick check to determine if target is callable, in the spec
		// this throws a TypeError, but we will just return undefined.
		if ( !jQuery.isFunction( fn ) ) {
			return undefined;
		}

		// Simulated bind
		args = slice.call( arguments, 2 );
		proxy = function() {
			return fn.apply( context || this, args.concat( slice.call( arguments ) ) );
		};

		// Set the guid of unique handler to the same of original handler, so it can be removed
		proxy.guid = fn.guid = fn.guid || jQuery.guid++;

		return proxy;
	},

	now: Date.now,

	// jQuery.support is not used in Core but other projects attach their
	// properties to it so it needs to exist.
	support: support
});

// Populate the class2type map
jQuery.each("Boolean Number String Function Array Date RegExp Object Error".split(" "), function(i, name) {
	class2type[ "[object " + name + "]" ] = name.toLowerCase();
});

function isArraylike( obj ) {
	var length = obj.length,
		type = jQuery.type( obj );

	if ( type === "function" || jQuery.isWindow( obj ) ) {
		return false;
	}

	if ( obj.nodeType === 1 && length ) {
		return true;
	}

	return type === "array" || length === 0 ||
		typeof length === "number" && length > 0 && ( length - 1 ) in obj;
}
var Sizzle =
/*!
 * Sizzle CSS Selector Engine v1.10.16
 * http://sizzlejs.com/
 *
 * Copyright 2013 jQuery Foundation, Inc. and other contributors
 * Released under the MIT license
 * http://jquery.org/license
 *
 * Date: 2014-01-13
 */
(function( window ) {

var i,
	support,
	Expr,
	getText,
	isXML,
	compile,
	outermostContext,
	sortInput,
	hasDuplicate,

	// Local document vars
	setDocument,
	document,
	docElem,
	documentIsHTML,
	rbuggyQSA,
	rbuggyMatches,
	matches,
	contains,

	// Instance-specific data
	expando = "sizzle" + -(new Date()),
	preferredDoc = window.document,
	dirruns = 0,
	done = 0,
	classCache = createCache(),
	tokenCache = createCache(),
	compilerCache = createCache(),
	sortOrder = function( a, b ) {
		if ( a === b ) {
			hasDuplicate = true;
		}
		return 0;
	},

	// General-purpose constants
	strundefined = typeof undefined,
	MAX_NEGATIVE = 1 << 31,

	// Instance methods
	hasOwn = ({}).hasOwnProperty,
	arr = [],
	pop = arr.pop,
	push_native = arr.push,
	push = arr.push,
	slice = arr.slice,
	// Use a stripped-down indexOf if we can't use a native one
	indexOf = arr.indexOf || function( elem ) {
		var i = 0,
			len = this.length;
		for ( ; i < len; i++ ) {
			if ( this[i] === elem ) {
				return i;
			}
		}
		return -1;
	},

	booleans = "checked|selected|async|autofocus|autoplay|controls|defer|disabled|hidden|ismap|loop|multiple|open|readonly|required|scoped",

	// Regular expressions

	// Whitespace characters http://www.w3.org/TR/css3-selectors/#whitespace
	whitespace = "[\\x20\\t\\r\\n\\f]",
	// http://www.w3.org/TR/css3-syntax/#characters
	characterEncoding = "(?:\\\\.|[\\w-]|[^\\x00-\\xa0])+",

	// Loosely modeled on CSS identifier characters
	// An unquoted value should be a CSS identifier http://www.w3.org/TR/css3-selectors/#attribute-selectors
	// Proper syntax: http://www.w3.org/TR/CSS21/syndata.html#value-def-identifier
	identifier = characterEncoding.replace( "w", "w#" ),

	// Acceptable operators http://www.w3.org/TR/selectors/#attribute-selectors
	attributes = "\\[" + whitespace + "*(" + characterEncoding + ")" + whitespace +
		"*(?:([*^$|!~]?=)" + whitespace + "*(?:(['\"])((?:\\\\.|[^\\\\])*?)\\3|(" + identifier + ")|)|)" + whitespace + "*\\]",

	// Prefer arguments quoted,
	//   then not containing pseudos/brackets,
	//   then attribute selectors/non-parenthetical expressions,
	//   then anything else
	// These preferences are here to reduce the number of selectors
	//   needing tokenize in the PSEUDO preFilter
	pseudos = ":(" + characterEncoding + ")(?:\\(((['\"])((?:\\\\.|[^\\\\])*?)\\3|((?:\\\\.|[^\\\\()[\\]]|" + attributes.replace( 3, 8 ) + ")*)|.*)\\)|)",

	// Leading and non-escaped trailing whitespace, capturing some non-whitespace characters preceding the latter
	rtrim = new RegExp( "^" + whitespace + "+|((?:^|[^\\\\])(?:\\\\.)*)" + whitespace + "+$", "g" ),

	rcomma = new RegExp( "^" + whitespace + "*," + whitespace + "*" ),
	rcombinators = new RegExp( "^" + whitespace + "*([>+~]|" + whitespace + ")" + whitespace + "*" ),

	rattributeQuotes = new RegExp( "=" + whitespace + "*([^\\]'\"]*?)" + whitespace + "*\\]", "g" ),

	rpseudo = new RegExp( pseudos ),
	ridentifier = new RegExp( "^" + identifier + "$" ),

	matchExpr = {
		"ID": new RegExp( "^#(" + characterEncoding + ")" ),
		"CLASS": new RegExp( "^\\.(" + characterEncoding + ")" ),
		"TAG": new RegExp( "^(" + characterEncoding.replace( "w", "w*" ) + ")" ),
		"ATTR": new RegExp( "^" + attributes ),
		"PSEUDO": new RegExp( "^" + pseudos ),
		"CHILD": new RegExp( "^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\(" + whitespace +
			"*(even|odd|(([+-]|)(\\d*)n|)" + whitespace + "*(?:([+-]|)" + whitespace +
			"*(\\d+)|))" + whitespace + "*\\)|)", "i" ),
		"bool": new RegExp( "^(?:" + booleans + ")$", "i" ),
		// For use in libraries implementing .is()
		// We use this for POS matching in `select`
		"needsContext": new RegExp( "^" + whitespace + "*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\(" +
			whitespace + "*((?:-\\d)?\\d*)" + whitespace + "*\\)|)(?=[^-]|$)", "i" )
	},

	rinputs = /^(?:input|select|textarea|button)$/i,
	rheader = /^h\d$/i,

	rnative = /^[^{]+\{\s*\[native \w/,

	// Easily-parseable/retrievable ID or TAG or CLASS selectors
	rquickExpr = /^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,

	rsibling = /[+~]/,
	rescape = /'|\\/g,

	// CSS escapes http://www.w3.org/TR/CSS21/syndata.html#escaped-characters
	runescape = new RegExp( "\\\\([\\da-f]{1,6}" + whitespace + "?|(" + whitespace + ")|.)", "ig" ),
	funescape = function( _, escaped, escapedWhitespace ) {
		var high = "0x" + escaped - 0x10000;
		// NaN means non-codepoint
		// Support: Firefox
		// Workaround erroneous numeric interpretation of +"0x"
		return high !== high || escapedWhitespace ?
			escaped :
			high < 0 ?
				// BMP codepoint
				String.fromCharCode( high + 0x10000 ) :
				// Supplemental Plane codepoint (surrogate pair)
				String.fromCharCode( high >> 10 | 0xD800, high & 0x3FF | 0xDC00 );
	};

// Optimize for push.apply( _, NodeList )
try {
	push.apply(
		(arr = slice.call( preferredDoc.childNodes )),
		preferredDoc.childNodes
	);
	// Support: Android<4.0
	// Detect silently failing push.apply
	arr[ preferredDoc.childNodes.length ].nodeType;
} catch ( e ) {
	push = { apply: arr.length ?

		// Leverage slice if possible
		function( target, els ) {
			push_native.apply( target, slice.call(els) );
		} :

		// Support: IE<9
		// Otherwise append directly
		function( target, els ) {
			var j = target.length,
				i = 0;
			// Can't trust NodeList.length
			while ( (target[j++] = els[i++]) ) {}
			target.length = j - 1;
		}
	};
}

function Sizzle( selector, context, results, seed ) {
	var match, elem, m, nodeType,
		// QSA vars
		i, groups, old, nid, newContext, newSelector;

	if ( ( context ? context.ownerDocument || context : preferredDoc ) !== document ) {
		setDocument( context );
	}

	context = context || document;
	results = results || [];

	if ( !selector || typeof selector !== "string" ) {
		return results;
	}

	if ( (nodeType = context.nodeType) !== 1 && nodeType !== 9 ) {
		return [];
	}

	if ( documentIsHTML && !seed ) {

		// Shortcuts
		if ( (match = rquickExpr.exec( selector )) ) {
			// Speed-up: Sizzle("#ID")
			if ( (m = match[1]) ) {
				if ( nodeType === 9 ) {
					elem = context.getElementById( m );
					// Check parentNode to catch when Blackberry 4.6 returns
					// nodes that are no longer in the document (jQuery #6963)
					if ( elem && elem.parentNode ) {
						// Handle the case where IE, Opera, and Webkit return items
						// by name instead of ID
						if ( elem.id === m ) {
							results.push( elem );
							return results;
						}
					} else {
						return results;
					}
				} else {
					// Context is not a document
					if ( context.ownerDocument && (elem = context.ownerDocument.getElementById( m )) &&
						contains( context, elem ) && elem.id === m ) {
						results.push( elem );
						return results;
					}
				}

			// Speed-up: Sizzle("TAG")
			} else if ( match[2] ) {
				push.apply( results, context.getElementsByTagName( selector ) );
				return results;

			// Speed-up: Sizzle(".CLASS")
			} else if ( (m = match[3]) && support.getElementsByClassName && context.getElementsByClassName ) {
				push.apply( results, context.getElementsByClassName( m ) );
				return results;
			}
		}

		// QSA path
		if ( support.qsa && (!rbuggyQSA || !rbuggyQSA.test( selector )) ) {
			nid = old = expando;
			newContext = context;
			newSelector = nodeType === 9 && selector;

			// qSA works strangely on Element-rooted queries
			// We can work around this by specifying an extra ID on the root
			// and working up from there (Thanks to Andrew Dupont for the technique)
			// IE 8 doesn't work on object elements
			if ( nodeType === 1 && context.nodeName.toLowerCase() !== "object" ) {
				groups = tokenize( selector );

				if ( (old = context.getAttribute("id")) ) {
					nid = old.replace( rescape, "\\$&" );
				} else {
					context.setAttribute( "id", nid );
				}
				nid = "[id='" + nid + "'] ";

				i = groups.length;
				while ( i-- ) {
					groups[i] = nid + toSelector( groups[i] );
				}
				newContext = rsibling.test( selector ) && testContext( context.parentNode ) || context;
				newSelector = groups.join(",");
			}

			if ( newSelector ) {
				try {
					push.apply( results,
						newContext.querySelectorAll( newSelector )
					);
					return results;
				} catch(qsaError) {
				} finally {
					if ( !old ) {
						context.removeAttribute("id");
					}
				}
			}
		}
	}

	// All others
	return select( selector.replace( rtrim, "$1" ), context, results, seed );
}

/**
 * Create key-value caches of limited size
 * @returns {Function(string, Object)} Returns the Object data after storing it on itself with
 *	property name the (space-suffixed) string and (if the cache is larger than Expr.cacheLength)
 *	deleting the oldest entry
 */
function createCache() {
	var keys = [];

	function cache( key, value ) {
		// Use (key + " ") to avoid collision with native prototype properties (see Issue #157)
		if ( keys.push( key + " " ) > Expr.cacheLength ) {
			// Only keep the most recent entries
			delete cache[ keys.shift() ];
		}
		return (cache[ key + " " ] = value);
	}
	return cache;
}

/**
 * Mark a function for special use by Sizzle
 * @param {Function} fn The function to mark
 */
function markFunction( fn ) {
	fn[ expando ] = true;
	return fn;
}

/**
 * Support testing using an element
 * @param {Function} fn Passed the created div and expects a boolean result
 */
function assert( fn ) {
	var div = document.createElement("div");

	try {
		return !!fn( div );
	} catch (e) {
		return false;
	} finally {
		// Remove from its parent by default
		if ( div.parentNode ) {
			div.parentNode.removeChild( div );
		}
		// release memory in IE
		div = null;
	}
}

/**
 * Adds the same handler for all of the specified attrs
 * @param {String} attrs Pipe-separated list of attributes
 * @param {Function} handler The method that will be applied
 */
function addHandle( attrs, handler ) {
	var arr = attrs.split("|"),
		i = attrs.length;

	while ( i-- ) {
		Expr.attrHandle[ arr[i] ] = handler;
	}
}

/**
 * Checks document order of two siblings
 * @param {Element} a
 * @param {Element} b
 * @returns {Number} Returns less than 0 if a precedes b, greater than 0 if a follows b
 */
function siblingCheck( a, b ) {
	var cur = b && a,
		diff = cur && a.nodeType === 1 && b.nodeType === 1 &&
			( ~b.sourceIndex || MAX_NEGATIVE ) -
			( ~a.sourceIndex || MAX_NEGATIVE );

	// Use IE sourceIndex if available on both nodes
	if ( diff ) {
		return diff;
	}

	// Check if b follows a
	if ( cur ) {
		while ( (cur = cur.nextSibling) ) {
			if ( cur === b ) {
				return -1;
			}
		}
	}

	return a ? 1 : -1;
}

/**
 * Returns a function to use in pseudos for input types
 * @param {String} type
 */
function createInputPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return name === "input" && elem.type === type;
	};
}

/**
 * Returns a function to use in pseudos for buttons
 * @param {String} type
 */
function createButtonPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return (name === "input" || name === "button") && elem.type === type;
	};
}

/**
 * Returns a function to use in pseudos for positionals
 * @param {Function} fn
 */
function createPositionalPseudo( fn ) {
	return markFunction(function( argument ) {
		argument = +argument;
		return markFunction(function( seed, matches ) {
			var j,
				matchIndexes = fn( [], seed.length, argument ),
				i = matchIndexes.length;

			// Match elements found at the specified indexes
			while ( i-- ) {
				if ( seed[ (j = matchIndexes[i]) ] ) {
					seed[j] = !(matches[j] = seed[j]);
				}
			}
		});
	});
}

/**
 * Checks a node for validity as a Sizzle context
 * @param {Element|Object=} context
 * @returns {Element|Object|Boolean} The input node if acceptable, otherwise a falsy value
 */
function testContext( context ) {
	return context && typeof context.getElementsByTagName !== strundefined && context;
}

// Expose support vars for convenience
support = Sizzle.support = {};

/**
 * Detects XML nodes
 * @param {Element|Object} elem An element or a document
 * @returns {Boolean} True iff elem is a non-HTML XML node
 */
isXML = Sizzle.isXML = function( elem ) {
	// documentElement is verified for cases where it doesn't yet exist
	// (such as loading iframes in IE - #4833)
	var documentElement = elem && (elem.ownerDocument || elem).documentElement;
	return documentElement ? documentElement.nodeName !== "HTML" : false;
};

/**
 * Sets document-related variables once based on the current document
 * @param {Element|Object} [doc] An element or document object to use to set the document
 * @returns {Object} Returns the current document
 */
setDocument = Sizzle.setDocument = function( node ) {
	var hasCompare,
		doc = node ? node.ownerDocument || node : preferredDoc,
		parent = doc.defaultView;

	// If no document and documentElement is available, return
	if ( doc === document || doc.nodeType !== 9 || !doc.documentElement ) {
		return document;
	}

	// Set our document
	document = doc;
	docElem = doc.documentElement;

	// Support tests
	documentIsHTML = !isXML( doc );

	// Support: IE>8
	// If iframe document is assigned to "document" variable and if iframe has been reloaded,
	// IE will throw "permission denied" error when accessing "document" variable, see jQuery #13936
	// IE6-8 do not support the defaultView property so parent will be undefined
	if ( parent && parent !== parent.top ) {
		// IE11 does not have attachEvent, so all must suffer
		if ( parent.addEventListener ) {
			parent.addEventListener( "unload", function() {
				setDocument();
			}, false );
		} else if ( parent.attachEvent ) {
			parent.attachEvent( "onunload", function() {
				setDocument();
			});
		}
	}

	/* Attributes
	---------------------------------------------------------------------- */

	// Support: IE<8
	// Verify that getAttribute really returns attributes and not properties (excepting IE8 booleans)
	support.attributes = assert(function( div ) {
		div.className = "i";
		return !div.getAttribute("className");
	});

	/* getElement(s)By*
	---------------------------------------------------------------------- */

	// Check if getElementsByTagName("*") returns only elements
	support.getElementsByTagName = assert(function( div ) {
		div.appendChild( doc.createComment("") );
		return !div.getElementsByTagName("*").length;
	});

	// Check if getElementsByClassName can be trusted
	support.getElementsByClassName = rnative.test( doc.getElementsByClassName ) && assert(function( div ) {
		div.innerHTML = "<div class='a'></div><div class='a i'></div>";

		// Support: Safari<4
		// Catch class over-caching
		div.firstChild.className = "i";
		// Support: Opera<10
		// Catch gEBCN failure to find non-leading classes
		return div.getElementsByClassName("i").length === 2;
	});

	// Support: IE<10
	// Check if getElementById returns elements by name
	// The broken getElementById methods don't pick up programatically-set names,
	// so use a roundabout getElementsByName test
	support.getById = assert(function( div ) {
		docElem.appendChild( div ).id = expando;
		return !doc.getElementsByName || !doc.getElementsByName( expando ).length;
	});

	// ID find and filter
	if ( support.getById ) {
		Expr.find["ID"] = function( id, context ) {
			if ( typeof context.getElementById !== strundefined && documentIsHTML ) {
				var m = context.getElementById( id );
				// Check parentNode to catch when Blackberry 4.6 returns
				// nodes that are no longer in the document #6963
				return m && m.parentNode ? [m] : [];
			}
		};
		Expr.filter["ID"] = function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				return elem.getAttribute("id") === attrId;
			};
		};
	} else {
		// Support: IE6/7
		// getElementById is not reliable as a find shortcut
		delete Expr.find["ID"];

		Expr.filter["ID"] =  function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				var node = typeof elem.getAttributeNode !== strundefined && elem.getAttributeNode("id");
				return node && node.value === attrId;
			};
		};
	}

	// Tag
	Expr.find["TAG"] = support.getElementsByTagName ?
		function( tag, context ) {
			if ( typeof context.getElementsByTagName !== strundefined ) {
				return context.getElementsByTagName( tag );
			}
		} :
		function( tag, context ) {
			var elem,
				tmp = [],
				i = 0,
				results = context.getElementsByTagName( tag );

			// Filter out possible comments
			if ( tag === "*" ) {
				while ( (elem = results[i++]) ) {
					if ( elem.nodeType === 1 ) {
						tmp.push( elem );
					}
				}

				return tmp;
			}
			return results;
		};

	// Class
	Expr.find["CLASS"] = support.getElementsByClassName && function( className, context ) {
		if ( typeof context.getElementsByClassName !== strundefined && documentIsHTML ) {
			return context.getElementsByClassName( className );
		}
	};

	/* QSA/matchesSelector
	---------------------------------------------------------------------- */

	// QSA and matchesSelector support

	// matchesSelector(:active) reports false when true (IE9/Opera 11.5)
	rbuggyMatches = [];

	// qSa(:focus) reports false when true (Chrome 21)
	// We allow this because of a bug in IE8/9 that throws an error
	// whenever `document.activeElement` is accessed on an iframe
	// So, we allow :focus to pass through QSA all the time to avoid the IE error
	// See http://bugs.jquery.com/ticket/13378
	rbuggyQSA = [];

	if ( (support.qsa = rnative.test( doc.querySelectorAll )) ) {
		// Build QSA regex
		// Regex strategy adopted from Diego Perini
		assert(function( div ) {
			// Select is set to empty string on purpose
			// This is to test IE's treatment of not explicitly
			// setting a boolean content attribute,
			// since its presence should be enough
			// http://bugs.jquery.com/ticket/12359
			div.innerHTML = "<select t=''><option selected=''></option></select>";

			// Support: IE8, Opera 10-12
			// Nothing should be selected when empty strings follow ^= or $= or *=
			if ( div.querySelectorAll("[t^='']").length ) {
				rbuggyQSA.push( "[*^$]=" + whitespace + "*(?:''|\"\")" );
			}

			// Support: IE8
			// Boolean attributes and "value" are not treated correctly
			if ( !div.querySelectorAll("[selected]").length ) {
				rbuggyQSA.push( "\\[" + whitespace + "*(?:value|" + booleans + ")" );
			}

			// Webkit/Opera - :checked should return selected option elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			// IE8 throws error here and will not see later tests
			if ( !div.querySelectorAll(":checked").length ) {
				rbuggyQSA.push(":checked");
			}
		});

		assert(function( div ) {
			// Support: Windows 8 Native Apps
			// The type and name attributes are restricted during .innerHTML assignment
			var input = doc.createElement("input");
			input.setAttribute( "type", "hidden" );
			div.appendChild( input ).setAttribute( "name", "D" );

			// Support: IE8
			// Enforce case-sensitivity of name attribute
			if ( div.querySelectorAll("[name=d]").length ) {
				rbuggyQSA.push( "name" + whitespace + "*[*^$|!~]?=" );
			}

			// FF 3.5 - :enabled/:disabled and hidden elements (hidden elements are still enabled)
			// IE8 throws error here and will not see later tests
			if ( !div.querySelectorAll(":enabled").length ) {
				rbuggyQSA.push( ":enabled", ":disabled" );
			}

			// Opera 10-11 does not throw on post-comma invalid pseudos
			div.querySelectorAll("*,:x");
			rbuggyQSA.push(",.*:");
		});
	}

	if ( (support.matchesSelector = rnative.test( (matches = docElem.webkitMatchesSelector ||
		docElem.mozMatchesSelector ||
		docElem.oMatchesSelector ||
		docElem.msMatchesSelector) )) ) {

		assert(function( div ) {
			// Check to see if it's possible to do matchesSelector
			// on a disconnected node (IE 9)
			support.disconnectedMatch = matches.call( div, "div" );

			// This should fail with an exception
			// Gecko does not error, returns false instead
			matches.call( div, "[s!='']:x" );
			rbuggyMatches.push( "!=", pseudos );
		});
	}

	rbuggyQSA = rbuggyQSA.length && new RegExp( rbuggyQSA.join("|") );
	rbuggyMatches = rbuggyMatches.length && new RegExp( rbuggyMatches.join("|") );

	/* Contains
	---------------------------------------------------------------------- */
	hasCompare = rnative.test( docElem.compareDocumentPosition );

	// Element contains another
	// Purposefully does not implement inclusive descendent
	// As in, an element does not contain itself
	contains = hasCompare || rnative.test( docElem.contains ) ?
		function( a, b ) {
			var adown = a.nodeType === 9 ? a.documentElement : a,
				bup = b && b.parentNode;
			return a === bup || !!( bup && bup.nodeType === 1 && (
				adown.contains ?
					adown.contains( bup ) :
					a.compareDocumentPosition && a.compareDocumentPosition( bup ) & 16
			));
		} :
		function( a, b ) {
			if ( b ) {
				while ( (b = b.parentNode) ) {
					if ( b === a ) {
						return true;
					}
				}
			}
			return false;
		};

	/* Sorting
	---------------------------------------------------------------------- */

	// Document order sorting
	sortOrder = hasCompare ?
	function( a, b ) {

		// Flag for duplicate removal
		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}

		// Sort on method existence if only one input has compareDocumentPosition
		var compare = !a.compareDocumentPosition - !b.compareDocumentPosition;
		if ( compare ) {
			return compare;
		}

		// Calculate position if both inputs belong to the same document
		compare = ( a.ownerDocument || a ) === ( b.ownerDocument || b ) ?
			a.compareDocumentPosition( b ) :

			// Otherwise we know they are disconnected
			1;

		// Disconnected nodes
		if ( compare & 1 ||
			(!support.sortDetached && b.compareDocumentPosition( a ) === compare) ) {

			// Choose the first element that is related to our preferred document
			if ( a === doc || a.ownerDocument === preferredDoc && contains(preferredDoc, a) ) {
				return -1;
			}
			if ( b === doc || b.ownerDocument === preferredDoc && contains(preferredDoc, b) ) {
				return 1;
			}

			// Maintain original order
			return sortInput ?
				( indexOf.call( sortInput, a ) - indexOf.call( sortInput, b ) ) :
				0;
		}

		return compare & 4 ? -1 : 1;
	} :
	function( a, b ) {
		// Exit early if the nodes are identical
		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}

		var cur,
			i = 0,
			aup = a.parentNode,
			bup = b.parentNode,
			ap = [ a ],
			bp = [ b ];

		// Parentless nodes are either documents or disconnected
		if ( !aup || !bup ) {
			return a === doc ? -1 :
				b === doc ? 1 :
				aup ? -1 :
				bup ? 1 :
				sortInput ?
				( indexOf.call( sortInput, a ) - indexOf.call( sortInput, b ) ) :
				0;

		// If the nodes are siblings, we can do a quick check
		} else if ( aup === bup ) {
			return siblingCheck( a, b );
		}

		// Otherwise we need full lists of their ancestors for comparison
		cur = a;
		while ( (cur = cur.parentNode) ) {
			ap.unshift( cur );
		}
		cur = b;
		while ( (cur = cur.parentNode) ) {
			bp.unshift( cur );
		}

		// Walk down the tree looking for a discrepancy
		while ( ap[i] === bp[i] ) {
			i++;
		}

		return i ?
			// Do a sibling check if the nodes have a common ancestor
			siblingCheck( ap[i], bp[i] ) :

			// Otherwise nodes in our document sort first
			ap[i] === preferredDoc ? -1 :
			bp[i] === preferredDoc ? 1 :
			0;
	};

	return doc;
};

Sizzle.matches = function( expr, elements ) {
	return Sizzle( expr, null, null, elements );
};

Sizzle.matchesSelector = function( elem, expr ) {
	// Set document vars if needed
	if ( ( elem.ownerDocument || elem ) !== document ) {
		setDocument( elem );
	}

	// Make sure that attribute selectors are quoted
	expr = expr.replace( rattributeQuotes, "='$1']" );

	if ( support.matchesSelector && documentIsHTML &&
		( !rbuggyMatches || !rbuggyMatches.test( expr ) ) &&
		( !rbuggyQSA     || !rbuggyQSA.test( expr ) ) ) {

		try {
			var ret = matches.call( elem, expr );

			// IE 9's matchesSelector returns false on disconnected nodes
			if ( ret || support.disconnectedMatch ||
					// As well, disconnected nodes are said to be in a document
					// fragment in IE 9
					elem.document && elem.document.nodeType !== 11 ) {
				return ret;
			}
		} catch(e) {}
	}

	return Sizzle( expr, document, null, [elem] ).length > 0;
};

Sizzle.contains = function( context, elem ) {
	// Set document vars if needed
	if ( ( context.ownerDocument || context ) !== document ) {
		setDocument( context );
	}
	return contains( context, elem );
};

Sizzle.attr = function( elem, name ) {
	// Set document vars if needed
	if ( ( elem.ownerDocument || elem ) !== document ) {
		setDocument( elem );
	}

	var fn = Expr.attrHandle[ name.toLowerCase() ],
		// Don't get fooled by Object.prototype properties (jQuery #13807)
		val = fn && hasOwn.call( Expr.attrHandle, name.toLowerCase() ) ?
			fn( elem, name, !documentIsHTML ) :
			undefined;

	return val !== undefined ?
		val :
		support.attributes || !documentIsHTML ?
			elem.getAttribute( name ) :
			(val = elem.getAttributeNode(name)) && val.specified ?
				val.value :
				null;
};

Sizzle.error = function( msg ) {
	throw new Error( "Syntax error, unrecognized expression: " + msg );
};

/**
 * Document sorting and removing duplicates
 * @param {ArrayLike} results
 */
Sizzle.uniqueSort = function( results ) {
	var elem,
		duplicates = [],
		j = 0,
		i = 0;

	// Unless we *know* we can detect duplicates, assume their presence
	hasDuplicate = !support.detectDuplicates;
	sortInput = !support.sortStable && results.slice( 0 );
	results.sort( sortOrder );

	if ( hasDuplicate ) {
		while ( (elem = results[i++]) ) {
			if ( elem === results[ i ] ) {
				j = duplicates.push( i );
			}
		}
		while ( j-- ) {
			results.splice( duplicates[ j ], 1 );
		}
	}

	// Clear input after sorting to release objects
	// See https://github.com/jquery/sizzle/pull/225
	sortInput = null;

	return results;
};

/**
 * Utility function for retrieving the text value of an array of DOM nodes
 * @param {Array|Element} elem
 */
getText = Sizzle.getText = function( elem ) {
	var node,
		ret = "",
		i = 0,
		nodeType = elem.nodeType;

	if ( !nodeType ) {
		// If no nodeType, this is expected to be an array
		while ( (node = elem[i++]) ) {
			// Do not traverse comment nodes
			ret += getText( node );
		}
	} else if ( nodeType === 1 || nodeType === 9 || nodeType === 11 ) {
		// Use textContent for elements
		// innerText usage removed for consistency of new lines (jQuery #11153)
		if ( typeof elem.textContent === "string" ) {
			return elem.textContent;
		} else {
			// Traverse its children
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				ret += getText( elem );
			}
		}
	} else if ( nodeType === 3 || nodeType === 4 ) {
		return elem.nodeValue;
	}
	// Do not include comment or processing instruction nodes

	return ret;
};

Expr = Sizzle.selectors = {

	// Can be adjusted by the user
	cacheLength: 50,

	createPseudo: markFunction,

	match: matchExpr,

	attrHandle: {},

	find: {},

	relative: {
		">": { dir: "parentNode", first: true },
		" ": { dir: "parentNode" },
		"+": { dir: "previousSibling", first: true },
		"~": { dir: "previousSibling" }
	},

	preFilter: {
		"ATTR": function( match ) {
			match[1] = match[1].replace( runescape, funescape );

			// Move the given value to match[3] whether quoted or unquoted
			match[3] = ( match[4] || match[5] || "" ).replace( runescape, funescape );

			if ( match[2] === "~=" ) {
				match[3] = " " + match[3] + " ";
			}

			return match.slice( 0, 4 );
		},

		"CHILD": function( match ) {
			/* matches from matchExpr["CHILD"]
				1 type (only|nth|...)
				2 what (child|of-type)
				3 argument (even|odd|\d*|\d*n([+-]\d+)?|...)
				4 xn-component of xn+y argument ([+-]?\d*n|)
				5 sign of xn-component
				6 x of xn-component
				7 sign of y-component
				8 y of y-component
			*/
			match[1] = match[1].toLowerCase();

			if ( match[1].slice( 0, 3 ) === "nth" ) {
				// nth-* requires argument
				if ( !match[3] ) {
					Sizzle.error( match[0] );
				}

				// numeric x and y parameters for Expr.filter.CHILD
				// remember that false/true cast respectively to 0/1
				match[4] = +( match[4] ? match[5] + (match[6] || 1) : 2 * ( match[3] === "even" || match[3] === "odd" ) );
				match[5] = +( ( match[7] + match[8] ) || match[3] === "odd" );

			// other types prohibit arguments
			} else if ( match[3] ) {
				Sizzle.error( match[0] );
			}

			return match;
		},

		"PSEUDO": function( match ) {
			var excess,
				unquoted = !match[5] && match[2];

			if ( matchExpr["CHILD"].test( match[0] ) ) {
				return null;
			}

			// Accept quoted arguments as-is
			if ( match[3] && match[4] !== undefined ) {
				match[2] = match[4];

			// Strip excess characters from unquoted arguments
			} else if ( unquoted && rpseudo.test( unquoted ) &&
				// Get excess from tokenize (recursively)
				(excess = tokenize( unquoted, true )) &&
				// advance to the next closing parenthesis
				(excess = unquoted.indexOf( ")", unquoted.length - excess ) - unquoted.length) ) {

				// excess is a negative index
				match[0] = match[0].slice( 0, excess );
				match[2] = unquoted.slice( 0, excess );
			}

			// Return only captures needed by the pseudo filter method (type and argument)
			return match.slice( 0, 3 );
		}
	},

	filter: {

		"TAG": function( nodeNameSelector ) {
			var nodeName = nodeNameSelector.replace( runescape, funescape ).toLowerCase();
			return nodeNameSelector === "*" ?
				function() { return true; } :
				function( elem ) {
					return elem.nodeName && elem.nodeName.toLowerCase() === nodeName;
				};
		},

		"CLASS": function( className ) {
			var pattern = classCache[ className + " " ];

			return pattern ||
				(pattern = new RegExp( "(^|" + whitespace + ")" + className + "(" + whitespace + "|$)" )) &&
				classCache( className, function( elem ) {
					return pattern.test( typeof elem.className === "string" && elem.className || typeof elem.getAttribute !== strundefined && elem.getAttribute("class") || "" );
				});
		},

		"ATTR": function( name, operator, check ) {
			return function( elem ) {
				var result = Sizzle.attr( elem, name );

				if ( result == null ) {
					return operator === "!=";
				}
				if ( !operator ) {
					return true;
				}

				result += "";

				return operator === "=" ? result === check :
					operator === "!=" ? result !== check :
					operator === "^=" ? check && result.indexOf( check ) === 0 :
					operator === "*=" ? check && result.indexOf( check ) > -1 :
					operator === "$=" ? check && result.slice( -check.length ) === check :
					operator === "~=" ? ( " " + result + " " ).indexOf( check ) > -1 :
					operator === "|=" ? result === check || result.slice( 0, check.length + 1 ) === check + "-" :
					false;
			};
		},

		"CHILD": function( type, what, argument, first, last ) {
			var simple = type.slice( 0, 3 ) !== "nth",
				forward = type.slice( -4 ) !== "last",
				ofType = what === "of-type";

			return first === 1 && last === 0 ?

				// Shortcut for :nth-*(n)
				function( elem ) {
					return !!elem.parentNode;
				} :

				function( elem, context, xml ) {
					var cache, outerCache, node, diff, nodeIndex, start,
						dir = simple !== forward ? "nextSibling" : "previousSibling",
						parent = elem.parentNode,
						name = ofType && elem.nodeName.toLowerCase(),
						useCache = !xml && !ofType;

					if ( parent ) {

						// :(first|last|only)-(child|of-type)
						if ( simple ) {
							while ( dir ) {
								node = elem;
								while ( (node = node[ dir ]) ) {
									if ( ofType ? node.nodeName.toLowerCase() === name : node.nodeType === 1 ) {
										return false;
									}
								}
								// Reverse direction for :only-* (if we haven't yet done so)
								start = dir = type === "only" && !start && "nextSibling";
							}
							return true;
						}

						start = [ forward ? parent.firstChild : parent.lastChild ];

						// non-xml :nth-child(...) stores cache data on `parent`
						if ( forward && useCache ) {
							// Seek `elem` from a previously-cached index
							outerCache = parent[ expando ] || (parent[ expando ] = {});
							cache = outerCache[ type ] || [];
							nodeIndex = cache[0] === dirruns && cache[1];
							diff = cache[0] === dirruns && cache[2];
							node = nodeIndex && parent.childNodes[ nodeIndex ];

							while ( (node = ++nodeIndex && node && node[ dir ] ||

								// Fallback to seeking `elem` from the start
								(diff = nodeIndex = 0) || start.pop()) ) {

								// When found, cache indexes on `parent` and break
								if ( node.nodeType === 1 && ++diff && node === elem ) {
									outerCache[ type ] = [ dirruns, nodeIndex, diff ];
									break;
								}
							}

						// Use previously-cached element index if available
						} else if ( useCache && (cache = (elem[ expando ] || (elem[ expando ] = {}))[ type ]) && cache[0] === dirruns ) {
							diff = cache[1];

						// xml :nth-child(...) or :nth-last-child(...) or :nth(-last)?-of-type(...)
						} else {
							// Use the same loop as above to seek `elem` from the start
							while ( (node = ++nodeIndex && node && node[ dir ] ||
								(diff = nodeIndex = 0) || start.pop()) ) {

								if ( ( ofType ? node.nodeName.toLowerCase() === name : node.nodeType === 1 ) && ++diff ) {
									// Cache the index of each encountered element
									if ( useCache ) {
										(node[ expando ] || (node[ expando ] = {}))[ type ] = [ dirruns, diff ];
									}

									if ( node === elem ) {
										break;
									}
								}
							}
						}

						// Incorporate the offset, then check against cycle size
						diff -= last;
						return diff === first || ( diff % first === 0 && diff / first >= 0 );
					}
				};
		},

		"PSEUDO": function( pseudo, argument ) {
			// pseudo-class names are case-insensitive
			// http://www.w3.org/TR/selectors/#pseudo-classes
			// Prioritize by case sensitivity in case custom pseudos are added with uppercase letters
			// Remember that setFilters inherits from pseudos
			var args,
				fn = Expr.pseudos[ pseudo ] || Expr.setFilters[ pseudo.toLowerCase() ] ||
					Sizzle.error( "unsupported pseudo: " + pseudo );

			// The user may use createPseudo to indicate that
			// arguments are needed to create the filter function
			// just as Sizzle does
			if ( fn[ expando ] ) {
				return fn( argument );
			}

			// But maintain support for old signatures
			if ( fn.length > 1 ) {
				args = [ pseudo, pseudo, "", argument ];
				return Expr.setFilters.hasOwnProperty( pseudo.toLowerCase() ) ?
					markFunction(function( seed, matches ) {
						var idx,
							matched = fn( seed, argument ),
							i = matched.length;
						while ( i-- ) {
							idx = indexOf.call( seed, matched[i] );
							seed[ idx ] = !( matches[ idx ] = matched[i] );
						}
					}) :
					function( elem ) {
						return fn( elem, 0, args );
					};
			}

			return fn;
		}
	},

	pseudos: {
		// Potentially complex pseudos
		"not": markFunction(function( selector ) {
			// Trim the selector passed to compile
			// to avoid treating leading and trailing
			// spaces as combinators
			var input = [],
				results = [],
				matcher = compile( selector.replace( rtrim, "$1" ) );

			return matcher[ expando ] ?
				markFunction(function( seed, matches, context, xml ) {
					var elem,
						unmatched = matcher( seed, null, xml, [] ),
						i = seed.length;

					// Match elements unmatched by `matcher`
					while ( i-- ) {
						if ( (elem = unmatched[i]) ) {
							seed[i] = !(matches[i] = elem);
						}
					}
				}) :
				function( elem, context, xml ) {
					input[0] = elem;
					matcher( input, null, xml, results );
					return !results.pop();
				};
		}),

		"has": markFunction(function( selector ) {
			return function( elem ) {
				return Sizzle( selector, elem ).length > 0;
			};
		}),

		"contains": markFunction(function( text ) {
			return function( elem ) {
				return ( elem.textContent || elem.innerText || getText( elem ) ).indexOf( text ) > -1;
			};
		}),

		// "Whether an element is represented by a :lang() selector
		// is based solely on the element's language value
		// being equal to the identifier C,
		// or beginning with the identifier C immediately followed by "-".
		// The matching of C against the element's language value is performed case-insensitively.
		// The identifier C does not have to be a valid language name."
		// http://www.w3.org/TR/selectors/#lang-pseudo
		"lang": markFunction( function( lang ) {
			// lang value must be a valid identifier
			if ( !ridentifier.test(lang || "") ) {
				Sizzle.error( "unsupported lang: " + lang );
			}
			lang = lang.replace( runescape, funescape ).toLowerCase();
			return function( elem ) {
				var elemLang;
				do {
					if ( (elemLang = documentIsHTML ?
						elem.lang :
						elem.getAttribute("xml:lang") || elem.getAttribute("lang")) ) {

						elemLang = elemLang.toLowerCase();
						return elemLang === lang || elemLang.indexOf( lang + "-" ) === 0;
					}
				} while ( (elem = elem.parentNode) && elem.nodeType === 1 );
				return false;
			};
		}),

		// Miscellaneous
		"target": function( elem ) {
			var hash = window.location && window.location.hash;
			return hash && hash.slice( 1 ) === elem.id;
		},

		"root": function( elem ) {
			return elem === docElem;
		},

		"focus": function( elem ) {
			return elem === document.activeElement && (!document.hasFocus || document.hasFocus()) && !!(elem.type || elem.href || ~elem.tabIndex);
		},

		// Boolean properties
		"enabled": function( elem ) {
			return elem.disabled === false;
		},

		"disabled": function( elem ) {
			return elem.disabled === true;
		},

		"checked": function( elem ) {
			// In CSS3, :checked should return both checked and selected elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			var nodeName = elem.nodeName.toLowerCase();
			return (nodeName === "input" && !!elem.checked) || (nodeName === "option" && !!elem.selected);
		},

		"selected": function( elem ) {
			// Accessing this property makes selected-by-default
			// options in Safari work properly
			if ( elem.parentNode ) {
				elem.parentNode.selectedIndex;
			}

			return elem.selected === true;
		},

		// Contents
		"empty": function( elem ) {
			// http://www.w3.org/TR/selectors/#empty-pseudo
			// :empty is negated by element (1) or content nodes (text: 3; cdata: 4; entity ref: 5),
			//   but not by others (comment: 8; processing instruction: 7; etc.)
			// nodeType < 6 works because attributes (2) do not appear as children
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				if ( elem.nodeType < 6 ) {
					return false;
				}
			}
			return true;
		},

		"parent": function( elem ) {
			return !Expr.pseudos["empty"]( elem );
		},

		// Element/input types
		"header": function( elem ) {
			return rheader.test( elem.nodeName );
		},

		"input": function( elem ) {
			return rinputs.test( elem.nodeName );
		},

		"button": function( elem ) {
			var name = elem.nodeName.toLowerCase();
			return name === "input" && elem.type === "button" || name === "button";
		},

		"text": function( elem ) {
			var attr;
			return elem.nodeName.toLowerCase() === "input" &&
				elem.type === "text" &&

				// Support: IE<8
				// New HTML5 attribute values (e.g., "search") appear with elem.type === "text"
				( (attr = elem.getAttribute("type")) == null || attr.toLowerCase() === "text" );
		},

		// Position-in-collection
		"first": createPositionalPseudo(function() {
			return [ 0 ];
		}),

		"last": createPositionalPseudo(function( matchIndexes, length ) {
			return [ length - 1 ];
		}),

		"eq": createPositionalPseudo(function( matchIndexes, length, argument ) {
			return [ argument < 0 ? argument + length : argument ];
		}),

		"even": createPositionalPseudo(function( matchIndexes, length ) {
			var i = 0;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"odd": createPositionalPseudo(function( matchIndexes, length ) {
			var i = 1;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"lt": createPositionalPseudo(function( matchIndexes, length, argument ) {
			var i = argument < 0 ? argument + length : argument;
			for ( ; --i >= 0; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"gt": createPositionalPseudo(function( matchIndexes, length, argument ) {
			var i = argument < 0 ? argument + length : argument;
			for ( ; ++i < length; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		})
	}
};

Expr.pseudos["nth"] = Expr.pseudos["eq"];

// Add button/input type pseudos
for ( i in { radio: true, checkbox: true, file: true, password: true, image: true } ) {
	Expr.pseudos[ i ] = createInputPseudo( i );
}
for ( i in { submit: true, reset: true } ) {
	Expr.pseudos[ i ] = createButtonPseudo( i );
}

// Easy API for creating new setFilters
function setFilters() {}
setFilters.prototype = Expr.filters = Expr.pseudos;
Expr.setFilters = new setFilters();

function tokenize( selector, parseOnly ) {
	var matched, match, tokens, type,
		soFar, groups, preFilters,
		cached = tokenCache[ selector + " " ];

	if ( cached ) {
		return parseOnly ? 0 : cached.slice( 0 );
	}

	soFar = selector;
	groups = [];
	preFilters = Expr.preFilter;

	while ( soFar ) {

		// Comma and first run
		if ( !matched || (match = rcomma.exec( soFar )) ) {
			if ( match ) {
				// Don't consume trailing commas as valid
				soFar = soFar.slice( match[0].length ) || soFar;
			}
			groups.push( (tokens = []) );
		}

		matched = false;

		// Combinators
		if ( (match = rcombinators.exec( soFar )) ) {
			matched = match.shift();
			tokens.push({
				value: matched,
				// Cast descendant combinators to space
				type: match[0].replace( rtrim, " " )
			});
			soFar = soFar.slice( matched.length );
		}

		// Filters
		for ( type in Expr.filter ) {
			if ( (match = matchExpr[ type ].exec( soFar )) && (!preFilters[ type ] ||
				(match = preFilters[ type ]( match ))) ) {
				matched = match.shift();
				tokens.push({
					value: matched,
					type: type,
					matches: match
				});
				soFar = soFar.slice( matched.length );
			}
		}

		if ( !matched ) {
			break;
		}
	}

	// Return the length of the invalid excess
	// if we're just parsing
	// Otherwise, throw an error or return tokens
	return parseOnly ?
		soFar.length :
		soFar ?
			Sizzle.error( selector ) :
			// Cache the tokens
			tokenCache( selector, groups ).slice( 0 );
}

function toSelector( tokens ) {
	var i = 0,
		len = tokens.length,
		selector = "";
	for ( ; i < len; i++ ) {
		selector += tokens[i].value;
	}
	return selector;
}

function addCombinator( matcher, combinator, base ) {
	var dir = combinator.dir,
		checkNonElements = base && dir === "parentNode",
		doneName = done++;

	return combinator.first ?
		// Check against closest ancestor/preceding element
		function( elem, context, xml ) {
			while ( (elem = elem[ dir ]) ) {
				if ( elem.nodeType === 1 || checkNonElements ) {
					return matcher( elem, context, xml );
				}
			}
		} :

		// Check against all ancestor/preceding elements
		function( elem, context, xml ) {
			var oldCache, outerCache,
				newCache = [ dirruns, doneName ];

			// We can't set arbitrary data on XML nodes, so they don't benefit from dir caching
			if ( xml ) {
				while ( (elem = elem[ dir ]) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						if ( matcher( elem, context, xml ) ) {
							return true;
						}
					}
				}
			} else {
				while ( (elem = elem[ dir ]) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						outerCache = elem[ expando ] || (elem[ expando ] = {});
						if ( (oldCache = outerCache[ dir ]) &&
							oldCache[ 0 ] === dirruns && oldCache[ 1 ] === doneName ) {

							// Assign to newCache so results back-propagate to previous elements
							return (newCache[ 2 ] = oldCache[ 2 ]);
						} else {
							// Reuse newcache so results back-propagate to previous elements
							outerCache[ dir ] = newCache;

							// A match means we're done; a fail means we have to keep checking
							if ( (newCache[ 2 ] = matcher( elem, context, xml )) ) {
								return true;
							}
						}
					}
				}
			}
		};
}

function elementMatcher( matchers ) {
	return matchers.length > 1 ?
		function( elem, context, xml ) {
			var i = matchers.length;
			while ( i-- ) {
				if ( !matchers[i]( elem, context, xml ) ) {
					return false;
				}
			}
			return true;
		} :
		matchers[0];
}

function condense( unmatched, map, filter, context, xml ) {
	var elem,
		newUnmatched = [],
		i = 0,
		len = unmatched.length,
		mapped = map != null;

	for ( ; i < len; i++ ) {
		if ( (elem = unmatched[i]) ) {
			if ( !filter || filter( elem, context, xml ) ) {
				newUnmatched.push( elem );
				if ( mapped ) {
					map.push( i );
				}
			}
		}
	}

	return newUnmatched;
}

function setMatcher( preFilter, selector, matcher, postFilter, postFinder, postSelector ) {
	if ( postFilter && !postFilter[ expando ] ) {
		postFilter = setMatcher( postFilter );
	}
	if ( postFinder && !postFinder[ expando ] ) {
		postFinder = setMatcher( postFinder, postSelector );
	}
	return markFunction(function( seed, results, context, xml ) {
		var temp, i, elem,
			preMap = [],
			postMap = [],
			preexisting = results.length,

			// Get initial elements from seed or context
			elems = seed || multipleContexts( selector || "*", context.nodeType ? [ context ] : context, [] ),

			// Prefilter to get matcher input, preserving a map for seed-results synchronization
			matcherIn = preFilter && ( seed || !selector ) ?
				condense( elems, preMap, preFilter, context, xml ) :
				elems,

			matcherOut = matcher ?
				// If we have a postFinder, or filtered seed, or non-seed postFilter or preexisting results,
				postFinder || ( seed ? preFilter : preexisting || postFilter ) ?

					// ...intermediate processing is necessary
					[] :

					// ...otherwise use results directly
					results :
				matcherIn;

		// Find primary matches
		if ( matcher ) {
			matcher( matcherIn, matcherOut, context, xml );
		}

		// Apply postFilter
		if ( postFilter ) {
			temp = condense( matcherOut, postMap );
			postFilter( temp, [], context, xml );

			// Un-match failing elements by moving them back to matcherIn
			i = temp.length;
			while ( i-- ) {
				if ( (elem = temp[i]) ) {
					matcherOut[ postMap[i] ] = !(matcherIn[ postMap[i] ] = elem);
				}
			}
		}

		if ( seed ) {
			if ( postFinder || preFilter ) {
				if ( postFinder ) {
					// Get the final matcherOut by condensing this intermediate into postFinder contexts
					temp = [];
					i = matcherOut.length;
					while ( i-- ) {
						if ( (elem = matcherOut[i]) ) {
							// Restore matcherIn since elem is not yet a final match
							temp.push( (matcherIn[i] = elem) );
						}
					}
					postFinder( null, (matcherOut = []), temp, xml );
				}

				// Move matched elements from seed to results to keep them synchronized
				i = matcherOut.length;
				while ( i-- ) {
					if ( (elem = matcherOut[i]) &&
						(temp = postFinder ? indexOf.call( seed, elem ) : preMap[i]) > -1 ) {

						seed[temp] = !(results[temp] = elem);
					}
				}
			}

		// Add elements to results, through postFinder if defined
		} else {
			matcherOut = condense(
				matcherOut === results ?
					matcherOut.splice( preexisting, matcherOut.length ) :
					matcherOut
			);
			if ( postFinder ) {
				postFinder( null, results, matcherOut, xml );
			} else {
				push.apply( results, matcherOut );
			}
		}
	});
}

function matcherFromTokens( tokens ) {
	var checkContext, matcher, j,
		len = tokens.length,
		leadingRelative = Expr.relative[ tokens[0].type ],
		implicitRelative = leadingRelative || Expr.relative[" "],
		i = leadingRelative ? 1 : 0,

		// The foundational matcher ensures that elements are reachable from top-level context(s)
		matchContext = addCombinator( function( elem ) {
			return elem === checkContext;
		}, implicitRelative, true ),
		matchAnyContext = addCombinator( function( elem ) {
			return indexOf.call( checkContext, elem ) > -1;
		}, implicitRelative, true ),
		matchers = [ function( elem, context, xml ) {
			return ( !leadingRelative && ( xml || context !== outermostContext ) ) || (
				(checkContext = context).nodeType ?
					matchContext( elem, context, xml ) :
					matchAnyContext( elem, context, xml ) );
		} ];

	for ( ; i < len; i++ ) {
		if ( (matcher = Expr.relative[ tokens[i].type ]) ) {
			matchers = [ addCombinator(elementMatcher( matchers ), matcher) ];
		} else {
			matcher = Expr.filter[ tokens[i].type ].apply( null, tokens[i].matches );

			// Return special upon seeing a positional matcher
			if ( matcher[ expando ] ) {
				// Find the next relative operator (if any) for proper handling
				j = ++i;
				for ( ; j < len; j++ ) {
					if ( Expr.relative[ tokens[j].type ] ) {
						break;
					}
				}
				return setMatcher(
					i > 1 && elementMatcher( matchers ),
					i > 1 && toSelector(
						// If the preceding token was a descendant combinator, insert an implicit any-element `*`
						tokens.slice( 0, i - 1 ).concat({ value: tokens[ i - 2 ].type === " " ? "*" : "" })
					).replace( rtrim, "$1" ),
					matcher,
					i < j && matcherFromTokens( tokens.slice( i, j ) ),
					j < len && matcherFromTokens( (tokens = tokens.slice( j )) ),
					j < len && toSelector( tokens )
				);
			}
			matchers.push( matcher );
		}
	}

	return elementMatcher( matchers );
}

function matcherFromGroupMatchers( elementMatchers, setMatchers ) {
	var bySet = setMatchers.length > 0,
		byElement = elementMatchers.length > 0,
		superMatcher = function( seed, context, xml, results, outermost ) {
			var elem, j, matcher,
				matchedCount = 0,
				i = "0",
				unmatched = seed && [],
				setMatched = [],
				contextBackup = outermostContext,
				// We must always have either seed elements or outermost context
				elems = seed || byElement && Expr.find["TAG"]( "*", outermost ),
				// Use integer dirruns iff this is the outermost matcher
				dirrunsUnique = (dirruns += contextBackup == null ? 1 : Math.random() || 0.1),
				len = elems.length;

			if ( outermost ) {
				outermostContext = context !== document && context;
			}

			// Add elements passing elementMatchers directly to results
			// Keep `i` a string if there are no elements so `matchedCount` will be "00" below
			// Support: IE<9, Safari
			// Tolerate NodeList properties (IE: "length"; Safari: <number>) matching elements by id
			for ( ; i !== len && (elem = elems[i]) != null; i++ ) {
				if ( byElement && elem ) {
					j = 0;
					while ( (matcher = elementMatchers[j++]) ) {
						if ( matcher( elem, context, xml ) ) {
							results.push( elem );
							break;
						}
					}
					if ( outermost ) {
						dirruns = dirrunsUnique;
					}
				}

				// Track unmatched elements for set filters
				if ( bySet ) {
					// They will have gone through all possible matchers
					if ( (elem = !matcher && elem) ) {
						matchedCount--;
					}

					// Lengthen the array for every element, matched or not
					if ( seed ) {
						unmatched.push( elem );
					}
				}
			}

			// Apply set filters to unmatched elements
			matchedCount += i;
			if ( bySet && i !== matchedCount ) {
				j = 0;
				while ( (matcher = setMatchers[j++]) ) {
					matcher( unmatched, setMatched, context, xml );
				}

				if ( seed ) {
					// Reintegrate element matches to eliminate the need for sorting
					if ( matchedCount > 0 ) {
						while ( i-- ) {
							if ( !(unmatched[i] || setMatched[i]) ) {
								setMatched[i] = pop.call( results );
							}
						}
					}

					// Discard index placeholder values to get only actual matches
					setMatched = condense( setMatched );
				}

				// Add matches to results
				push.apply( results, setMatched );

				// Seedless set matches succeeding multiple successful matchers stipulate sorting
				if ( outermost && !seed && setMatched.length > 0 &&
					( matchedCount + setMatchers.length ) > 1 ) {

					Sizzle.uniqueSort( results );
				}
			}

			// Override manipulation of globals by nested matchers
			if ( outermost ) {
				dirruns = dirrunsUnique;
				outermostContext = contextBackup;
			}

			return unmatched;
		};

	return bySet ?
		markFunction( superMatcher ) :
		superMatcher;
}

compile = Sizzle.compile = function( selector, group /* Internal Use Only */ ) {
	var i,
		setMatchers = [],
		elementMatchers = [],
		cached = compilerCache[ selector + " " ];

	if ( !cached ) {
		// Generate a function of recursive functions that can be used to check each element
		if ( !group ) {
			group = tokenize( selector );
		}
		i = group.length;
		while ( i-- ) {
			cached = matcherFromTokens( group[i] );
			if ( cached[ expando ] ) {
				setMatchers.push( cached );
			} else {
				elementMatchers.push( cached );
			}
		}

		// Cache the compiled function
		cached = compilerCache( selector, matcherFromGroupMatchers( elementMatchers, setMatchers ) );
	}
	return cached;
};

function multipleContexts( selector, contexts, results ) {
	var i = 0,
		len = contexts.length;
	for ( ; i < len; i++ ) {
		Sizzle( selector, contexts[i], results );
	}
	return results;
}

function select( selector, context, results, seed ) {
	var i, tokens, token, type, find,
		match = tokenize( selector );

	if ( !seed ) {
		// Try to minimize operations if there is only one group
		if ( match.length === 1 ) {

			// Take a shortcut and set the context if the root selector is an ID
			tokens = match[0] = match[0].slice( 0 );
			if ( tokens.length > 2 && (token = tokens[0]).type === "ID" &&
					support.getById && context.nodeType === 9 && documentIsHTML &&
					Expr.relative[ tokens[1].type ] ) {

				context = ( Expr.find["ID"]( token.matches[0].replace(runescape, funescape), context ) || [] )[0];
				if ( !context ) {
					return results;
				}
				selector = selector.slice( tokens.shift().value.length );
			}

			// Fetch a seed set for right-to-left matching
			i = matchExpr["needsContext"].test( selector ) ? 0 : tokens.length;
			while ( i-- ) {
				token = tokens[i];

				// Abort if we hit a combinator
				if ( Expr.relative[ (type = token.type) ] ) {
					break;
				}
				if ( (find = Expr.find[ type ]) ) {
					// Search, expanding context for leading sibling combinators
					if ( (seed = find(
						token.matches[0].replace( runescape, funescape ),
						rsibling.test( tokens[0].type ) && testContext( context.parentNode ) || context
					)) ) {

						// If seed is empty or no tokens remain, we can return early
						tokens.splice( i, 1 );
						selector = seed.length && toSelector( tokens );
						if ( !selector ) {
							push.apply( results, seed );
							return results;
						}

						break;
					}
				}
			}
		}
	}

	// Compile and execute a filtering function
	// Provide `match` to avoid retokenization if we modified the selector above
	compile( selector, match )(
		seed,
		context,
		!documentIsHTML,
		results,
		rsibling.test( selector ) && testContext( context.parentNode ) || context
	);
	return results;
}

// One-time assignments

// Sort stability
support.sortStable = expando.split("").sort( sortOrder ).join("") === expando;

// Support: Chrome<14
// Always assume duplicates if they aren't passed to the comparison function
support.detectDuplicates = !!hasDuplicate;

// Initialize against the default document
setDocument();

// Support: Webkit<537.32 - Safari 6.0.3/Chrome 25 (fixed in Chrome 27)
// Detached nodes confoundingly follow *each other*
support.sortDetached = assert(function( div1 ) {
	// Should return 1, but returns 4 (following)
	return div1.compareDocumentPosition( document.createElement("div") ) & 1;
});

// Support: IE<8
// Prevent attribute/property "interpolation"
// http://msdn.microsoft.com/en-us/library/ms536429%28VS.85%29.aspx
if ( !assert(function( div ) {
	div.innerHTML = "<a href='#'></a>";
	return div.firstChild.getAttribute("href") === "#" ;
}) ) {
	addHandle( "type|href|height|width", function( elem, name, isXML ) {
		if ( !isXML ) {
			return elem.getAttribute( name, name.toLowerCase() === "type" ? 1 : 2 );
		}
	});
}

// Support: IE<9
// Use defaultValue in place of getAttribute("value")
if ( !support.attributes || !assert(function( div ) {
	div.innerHTML = "<input/>";
	div.firstChild.setAttribute( "value", "" );
	return div.firstChild.getAttribute( "value" ) === "";
}) ) {
	addHandle( "value", function( elem, name, isXML ) {
		if ( !isXML && elem.nodeName.toLowerCase() === "input" ) {
			return elem.defaultValue;
		}
	});
}

// Support: IE<9
// Use getAttributeNode to fetch booleans when getAttribute lies
if ( !assert(function( div ) {
	return div.getAttribute("disabled") == null;
}) ) {
	addHandle( booleans, function( elem, name, isXML ) {
		var val;
		if ( !isXML ) {
			return elem[ name ] === true ? name.toLowerCase() :
					(val = elem.getAttributeNode( name )) && val.specified ?
					val.value :
				null;
		}
	});
}

return Sizzle;

})( window );



jQuery.find = Sizzle;
jQuery.expr = Sizzle.selectors;
jQuery.expr[":"] = jQuery.expr.pseudos;
jQuery.unique = Sizzle.uniqueSort;
jQuery.text = Sizzle.getText;
jQuery.isXMLDoc = Sizzle.isXML;
jQuery.contains = Sizzle.contains;



var rneedsContext = jQuery.expr.match.needsContext;

var rsingleTag = (/^<(\w+)\s*\/?>(?:<\/\1>|)$/);



var risSimple = /^.[^:#\[\.,]*$/;

// Implement the identical functionality for filter and not
function winnow( elements, qualifier, not ) {
	if ( jQuery.isFunction( qualifier ) ) {
		return jQuery.grep( elements, function( elem, i ) {
			/* jshint -W018 */
			return !!qualifier.call( elem, i, elem ) !== not;
		});

	}

	if ( qualifier.nodeType ) {
		return jQuery.grep( elements, function( elem ) {
			return ( elem === qualifier ) !== not;
		});

	}

	if ( typeof qualifier === "string" ) {
		if ( risSimple.test( qualifier ) ) {
			return jQuery.filter( qualifier, elements, not );
		}

		qualifier = jQuery.filter( qualifier, elements );
	}

	return jQuery.grep( elements, function( elem ) {
		return ( indexOf.call( qualifier, elem ) >= 0 ) !== not;
	});
}

jQuery.filter = function( expr, elems, not ) {
	var elem = elems[ 0 ];

	if ( not ) {
		expr = ":not(" + expr + ")";
	}

	return elems.length === 1 && elem.nodeType === 1 ?
		jQuery.find.matchesSelector( elem, expr ) ? [ elem ] : [] :
		jQuery.find.matches( expr, jQuery.grep( elems, function( elem ) {
			return elem.nodeType === 1;
		}));
};

jQuery.fn.extend({
	find: function( selector ) {
		var i,
			len = this.length,
			ret = [],
			self = this;

		if ( typeof selector !== "string" ) {
			return this.pushStack( jQuery( selector ).filter(function() {
				for ( i = 0; i < len; i++ ) {
					if ( jQuery.contains( self[ i ], this ) ) {
						return true;
					}
				}
			}) );
		}

		for ( i = 0; i < len; i++ ) {
			jQuery.find( selector, self[ i ], ret );
		}

		// Needed because $( selector, context ) becomes $( context ).find( selector )
		ret = this.pushStack( len > 1 ? jQuery.unique( ret ) : ret );
		ret.selector = this.selector ? this.selector + " " + selector : selector;
		return ret;
	},
	filter: function( selector ) {
		return this.pushStack( winnow(this, selector || [], false) );
	},
	not: function( selector ) {
		return this.pushStack( winnow(this, selector || [], true) );
	},
	is: function( selector ) {
		return !!winnow(
			this,

			// If this is a positional/relative selector, check membership in the returned set
			// so $("p:first").is("p:last") won't return true for a doc with two "p".
			typeof selector === "string" && rneedsContext.test( selector ) ?
				jQuery( selector ) :
				selector || [],
			false
		).length;
	}
});


// Initialize a jQuery object


// A central reference to the root jQuery(document)
var rootjQuery,

	// A simple way to check for HTML strings
	// Prioritize #id over <tag> to avoid XSS via location.hash (#9521)
	// Strict HTML recognition (#11290: must start with <)
	rquickExpr = /^(?:\s*(<[\w\W]+>)[^>]*|#([\w-]*))$/,

	init = jQuery.fn.init = function( selector, context ) {
		var match, elem;

		// HANDLE: $(""), $(null), $(undefined), $(false)
		if ( !selector ) {
			return this;
		}

		// Handle HTML strings
		if ( typeof selector === "string" ) {
			if ( selector[0] === "<" && selector[ selector.length - 1 ] === ">" && selector.length >= 3 ) {
				// Assume that strings that start and end with <> are HTML and skip the regex check
				match = [ null, selector, null ];

			} else {
				match = rquickExpr.exec( selector );
			}

			// Match html or make sure no context is specified for #id
			if ( match && (match[1] || !context) ) {

				// HANDLE: $(html) -> $(array)
				if ( match[1] ) {
					context = context instanceof jQuery ? context[0] : context;

					// scripts is true for back-compat
					// Intentionally let the error be thrown if parseHTML is not present
					jQuery.merge( this, jQuery.parseHTML(
						match[1],
						context && context.nodeType ? context.ownerDocument || context : document,
						true
					) );

					// HANDLE: $(html, props)
					if ( rsingleTag.test( match[1] ) && jQuery.isPlainObject( context ) ) {
						for ( match in context ) {
							// Properties of context are called as methods if possible
							if ( jQuery.isFunction( this[ match ] ) ) {
								this[ match ]( context[ match ] );

							// ...and otherwise set as attributes
							} else {
								this.attr( match, context[ match ] );
							}
						}
					}

					return this;

				// HANDLE: $(#id)
				} else {
					elem = document.getElementById( match[2] );

					// Check parentNode to catch when Blackberry 4.6 returns
					// nodes that are no longer in the document #6963
					if ( elem && elem.parentNode ) {
						// Inject the element directly into the jQuery object
						this.length = 1;
						this[0] = elem;
					}

					this.context = document;
					this.selector = selector;
					return this;
				}

			// HANDLE: $(expr, $(...))
			} else if ( !context || context.jquery ) {
				return ( context || rootjQuery ).find( selector );

			// HANDLE: $(expr, context)
			// (which is just equivalent to: $(context).find(expr)
			} else {
				return this.constructor( context ).find( selector );
			}

		// HANDLE: $(DOMElement)
		} else if ( selector.nodeType ) {
			this.context = this[0] = selector;
			this.length = 1;
			return this;

		// HANDLE: $(function)
		// Shortcut for document ready
		} else if ( jQuery.isFunction( selector ) ) {
			return typeof rootjQuery.ready !== "undefined" ?
				rootjQuery.ready( selector ) :
				// Execute immediately if ready is not present
				selector( jQuery );
		}

		if ( selector.selector !== undefined ) {
			this.selector = selector.selector;
			this.context = selector.context;
		}

		return jQuery.makeArray( selector, this );
	};

// Give the init function the jQuery prototype for later instantiation
init.prototype = jQuery.fn;

// Initialize central reference
rootjQuery = jQuery( document );


var rparentsprev = /^(?:parents|prev(?:Until|All))/,
	// methods guaranteed to produce a unique set when starting from a unique set
	guaranteedUnique = {
		children: true,
		contents: true,
		next: true,
		prev: true
	};

jQuery.extend({
	dir: function( elem, dir, until ) {
		var matched = [],
			truncate = until !== undefined;

		while ( (elem = elem[ dir ]) && elem.nodeType !== 9 ) {
			if ( elem.nodeType === 1 ) {
				if ( truncate && jQuery( elem ).is( until ) ) {
					break;
				}
				matched.push( elem );
			}
		}
		return matched;
	},

	sibling: function( n, elem ) {
		var matched = [];

		for ( ; n; n = n.nextSibling ) {
			if ( n.nodeType === 1 && n !== elem ) {
				matched.push( n );
			}
		}

		return matched;
	}
});

jQuery.fn.extend({
	has: function( target ) {
		var targets = jQuery( target, this ),
			l = targets.length;

		return this.filter(function() {
			var i = 0;
			for ( ; i < l; i++ ) {
				if ( jQuery.contains( this, targets[i] ) ) {
					return true;
				}
			}
		});
	},

	closest: function( selectors, context ) {
		var cur,
			i = 0,
			l = this.length,
			matched = [],
			pos = rneedsContext.test( selectors ) || typeof selectors !== "string" ?
				jQuery( selectors, context || this.context ) :
				0;

		for ( ; i < l; i++ ) {
			for ( cur = this[i]; cur && cur !== context; cur = cur.parentNode ) {
				// Always skip document fragments
				if ( cur.nodeType < 11 && (pos ?
					pos.index(cur) > -1 :

					// Don't pass non-elements to Sizzle
					cur.nodeType === 1 &&
						jQuery.find.matchesSelector(cur, selectors)) ) {

					matched.push( cur );
					break;
				}
			}
		}

		return this.pushStack( matched.length > 1 ? jQuery.unique( matched ) : matched );
	},

	// Determine the position of an element within
	// the matched set of elements
	index: function( elem ) {

		// No argument, return index in parent
		if ( !elem ) {
			return ( this[ 0 ] && this[ 0 ].parentNode ) ? this.first().prevAll().length : -1;
		}

		// index in selector
		if ( typeof elem === "string" ) {
			return indexOf.call( jQuery( elem ), this[ 0 ] );
		}

		// Locate the position of the desired element
		return indexOf.call( this,

			// If it receives a jQuery object, the first element is used
			elem.jquery ? elem[ 0 ] : elem
		);
	},

	add: function( selector, context ) {
		return this.pushStack(
			jQuery.unique(
				jQuery.merge( this.get(), jQuery( selector, context ) )
			)
		);
	},

	addBack: function( selector ) {
		return this.add( selector == null ?
			this.prevObject : this.prevObject.filter(selector)
		);
	}
});

function sibling( cur, dir ) {
	while ( (cur = cur[dir]) && cur.nodeType !== 1 ) {}
	return cur;
}

jQuery.each({
	parent: function( elem ) {
		var parent = elem.parentNode;
		return parent && parent.nodeType !== 11 ? parent : null;
	},
	parents: function( elem ) {
		return jQuery.dir( elem, "parentNode" );
	},
	parentsUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "parentNode", until );
	},
	next: function( elem ) {
		return sibling( elem, "nextSibling" );
	},
	prev: function( elem ) {
		return sibling( elem, "previousSibling" );
	},
	nextAll: function( elem ) {
		return jQuery.dir( elem, "nextSibling" );
	},
	prevAll: function( elem ) {
		return jQuery.dir( elem, "previousSibling" );
	},
	nextUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "nextSibling", until );
	},
	prevUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "previousSibling", until );
	},
	siblings: function( elem ) {
		return jQuery.sibling( ( elem.parentNode || {} ).firstChild, elem );
	},
	children: function( elem ) {
		return jQuery.sibling( elem.firstChild );
	},
	contents: function( elem ) {
		return elem.contentDocument || jQuery.merge( [], elem.childNodes );
	}
}, function( name, fn ) {
	jQuery.fn[ name ] = function( until, selector ) {
		var matched = jQuery.map( this, fn, until );

		if ( name.slice( -5 ) !== "Until" ) {
			selector = until;
		}

		if ( selector && typeof selector === "string" ) {
			matched = jQuery.filter( selector, matched );
		}

		if ( this.length > 1 ) {
			// Remove duplicates
			if ( !guaranteedUnique[ name ] ) {
				jQuery.unique( matched );
			}

			// Reverse order for parents* and prev-derivatives
			if ( rparentsprev.test( name ) ) {
				matched.reverse();
			}
		}

		return this.pushStack( matched );
	};
});
var rnotwhite = (/\S+/g);



// String to Object options format cache
var optionsCache = {};

// Convert String-formatted options into Object-formatted ones and store in cache
function createOptions( options ) {
	var object = optionsCache[ options ] = {};
	jQuery.each( options.match( rnotwhite ) || [], function( _, flag ) {
		object[ flag ] = true;
	});
	return object;
}

/*
 * Create a callback list using the following parameters:
 *
 *	options: an optional list of space-separated options that will change how
 *			the callback list behaves or a more traditional option object
 *
 * By default a callback list will act like an event callback list and can be
 * "fired" multiple times.
 *
 * Possible options:
 *
 *	once:			will ensure the callback list can only be fired once (like a Deferred)
 *
 *	memory:			will keep track of previous values and will call any callback added
 *					after the list has been fired right away with the latest "memorized"
 *					values (like a Deferred)
 *
 *	unique:			will ensure a callback can only be added once (no duplicate in the list)
 *
 *	stopOnFalse:	interrupt callings when a callback returns false
 *
 */
jQuery.Callbacks = function( options ) {

	// Convert options from String-formatted to Object-formatted if needed
	// (we check in cache first)
	options = typeof options === "string" ?
		( optionsCache[ options ] || createOptions( options ) ) :
		jQuery.extend( {}, options );

	var // Last fire value (for non-forgettable lists)
		memory,
		// Flag to know if list was already fired
		fired,
		// Flag to know if list is currently firing
		firing,
		// First callback to fire (used internally by add and fireWith)
		firingStart,
		// End of the loop when firing
		firingLength,
		// Index of currently firing callback (modified by remove if needed)
		firingIndex,
		// Actual callback list
		list = [],
		// Stack of fire calls for repeatable lists
		stack = !options.once && [],
		// Fire callbacks
		fire = function( data ) {
			memory = options.memory && data;
			fired = true;
			firingIndex = firingStart || 0;
			firingStart = 0;
			firingLength = list.length;
			firing = true;
			for ( ; list && firingIndex < firingLength; firingIndex++ ) {
				if ( list[ firingIndex ].apply( data[ 0 ], data[ 1 ] ) === false && options.stopOnFalse ) {
					memory = false; // To prevent further calls using add
					break;
				}
			}
			firing = false;
			if ( list ) {
				if ( stack ) {
					if ( stack.length ) {
						fire( stack.shift() );
					}
				} else if ( memory ) {
					list = [];
				} else {
					self.disable();
				}
			}
		},
		// Actual Callbacks object
		self = {
			// Add a callback or a collection of callbacks to the list
			add: function() {
				if ( list ) {
					// First, we save the current length
					var start = list.length;
					(function add( args ) {
						jQuery.each( args, function( _, arg ) {
							var type = jQuery.type( arg );
							if ( type === "function" ) {
								if ( !options.unique || !self.has( arg ) ) {
									list.push( arg );
								}
							} else if ( arg && arg.length && type !== "string" ) {
								// Inspect recursively
								add( arg );
							}
						});
					})( arguments );
					// Do we need to add the callbacks to the
					// current firing batch?
					if ( firing ) {
						firingLength = list.length;
					// With memory, if we're not firing then
					// we should call right away
					} else if ( memory ) {
						firingStart = start;
						fire( memory );
					}
				}
				return this;
			},
			// Remove a callback from the list
			remove: function() {
				if ( list ) {
					jQuery.each( arguments, function( _, arg ) {
						var index;
						while ( ( index = jQuery.inArray( arg, list, index ) ) > -1 ) {
							list.splice( index, 1 );
							// Handle firing indexes
							if ( firing ) {
								if ( index <= firingLength ) {
									firingLength--;
								}
								if ( index <= firingIndex ) {
									firingIndex--;
								}
							}
						}
					});
				}
				return this;
			},
			// Check if a given callback is in the list.
			// If no argument is given, return whether or not list has callbacks attached.
			has: function( fn ) {
				return fn ? jQuery.inArray( fn, list ) > -1 : !!( list && list.length );
			},
			// Remove all callbacks from the list
			empty: function() {
				list = [];
				firingLength = 0;
				return this;
			},
			// Have the list do nothing anymore
			disable: function() {
				list = stack = memory = undefined;
				return this;
			},
			// Is it disabled?
			disabled: function() {
				return !list;
			},
			// Lock the list in its current state
			lock: function() {
				stack = undefined;
				if ( !memory ) {
					self.disable();
				}
				return this;
			},
			// Is it locked?
			locked: function() {
				return !stack;
			},
			// Call all callbacks with the given context and arguments
			fireWith: function( context, args ) {
				if ( list && ( !fired || stack ) ) {
					args = args || [];
					args = [ context, args.slice ? args.slice() : args ];
					if ( firing ) {
						stack.push( args );
					} else {
						fire( args );
					}
				}
				return this;
			},
			// Call all the callbacks with the given arguments
			fire: function() {
				self.fireWith( this, arguments );
				return this;
			},
			// To know if the callbacks have already been called at least once
			fired: function() {
				return !!fired;
			}
		};

	return self;
};


jQuery.extend({

	Deferred: function( func ) {
		var tuples = [
				// action, add listener, listener list, final state
				[ "resolve", "done", jQuery.Callbacks("once memory"), "resolved" ],
				[ "reject", "fail", jQuery.Callbacks("once memory"), "rejected" ],
				[ "notify", "progress", jQuery.Callbacks("memory") ]
			],
			state = "pending",
			promise = {
				state: function() {
					return state;
				},
				always: function() {
					deferred.done( arguments ).fail( arguments );
					return this;
				},
				then: function( /* fnDone, fnFail, fnProgress */ ) {
					var fns = arguments;
					return jQuery.Deferred(function( newDefer ) {
						jQuery.each( tuples, function( i, tuple ) {
							var fn = jQuery.isFunction( fns[ i ] ) && fns[ i ];
							// deferred[ done | fail | progress ] for forwarding actions to newDefer
							deferred[ tuple[1] ](function() {
								var returned = fn && fn.apply( this, arguments );
								if ( returned && jQuery.isFunction( returned.promise ) ) {
									returned.promise()
										.done( newDefer.resolve )
										.fail( newDefer.reject )
										.progress( newDefer.notify );
								} else {
									newDefer[ tuple[ 0 ] + "With" ]( this === promise ? newDefer.promise() : this, fn ? [ returned ] : arguments );
								}
							});
						});
						fns = null;
					}).promise();
				},
				// Get a promise for this deferred
				// If obj is provided, the promise aspect is added to the object
				promise: function( obj ) {
					return obj != null ? jQuery.extend( obj, promise ) : promise;
				}
			},
			deferred = {};

		// Keep pipe for back-compat
		promise.pipe = promise.then;

		// Add list-specific methods
		jQuery.each( tuples, function( i, tuple ) {
			var list = tuple[ 2 ],
				stateString = tuple[ 3 ];

			// promise[ done | fail | progress ] = list.add
			promise[ tuple[1] ] = list.add;

			// Handle state
			if ( stateString ) {
				list.add(function() {
					// state = [ resolved | rejected ]
					state = stateString;

				// [ reject_list | resolve_list ].disable; progress_list.lock
				}, tuples[ i ^ 1 ][ 2 ].disable, tuples[ 2 ][ 2 ].lock );
			}

			// deferred[ resolve | reject | notify ]
			deferred[ tuple[0] ] = function() {
				deferred[ tuple[0] + "With" ]( this === deferred ? promise : this, arguments );
				return this;
			};
			deferred[ tuple[0] + "With" ] = list.fireWith;
		});

		// Make the deferred a promise
		promise.promise( deferred );

		// Call given func if any
		if ( func ) {
			func.call( deferred, deferred );
		}

		// All done!
		return deferred;
	},

	// Deferred helper
	when: function( subordinate /* , ..., subordinateN */ ) {
		var i = 0,
			resolveValues = slice.call( arguments ),
			length = resolveValues.length,

			// the count of uncompleted subordinates
			remaining = length !== 1 || ( subordinate && jQuery.isFunction( subordinate.promise ) ) ? length : 0,

			// the master Deferred. If resolveValues consist of only a single Deferred, just use that.
			deferred = remaining === 1 ? subordinate : jQuery.Deferred(),

			// Update function for both resolve and progress values
			updateFunc = function( i, contexts, values ) {
				return function( value ) {
					contexts[ i ] = this;
					values[ i ] = arguments.length > 1 ? slice.call( arguments ) : value;
					if ( values === progressValues ) {
						deferred.notifyWith( contexts, values );
					} else if ( !( --remaining ) ) {
						deferred.resolveWith( contexts, values );
					}
				};
			},

			progressValues, progressContexts, resolveContexts;

		// add listeners to Deferred subordinates; treat others as resolved
		if ( length > 1 ) {
			progressValues = new Array( length );
			progressContexts = new Array( length );
			resolveContexts = new Array( length );
			for ( ; i < length; i++ ) {
				if ( resolveValues[ i ] && jQuery.isFunction( resolveValues[ i ].promise ) ) {
					resolveValues[ i ].promise()
						.done( updateFunc( i, resolveContexts, resolveValues ) )
						.fail( deferred.reject )
						.progress( updateFunc( i, progressContexts, progressValues ) );
				} else {
					--remaining;
				}
			}
		}

		// if we're not waiting on anything, resolve the master
		if ( !remaining ) {
			deferred.resolveWith( resolveContexts, resolveValues );
		}

		return deferred.promise();
	}
});


// The deferred used on DOM ready
var readyList;

jQuery.fn.ready = function( fn ) {
	// Add the callback
	jQuery.ready.promise().done( fn );

	return this;
};

jQuery.extend({
	// Is the DOM ready to be used? Set to true once it occurs.
	isReady: false,

	// A counter to track how many items to wait for before
	// the ready event fires. See #6781
	readyWait: 1,

	// Hold (or release) the ready event
	holdReady: function( hold ) {
		if ( hold ) {
			jQuery.readyWait++;
		} else {
			jQuery.ready( true );
		}
	},

	// Handle when the DOM is ready
	ready: function( wait ) {

		// Abort if there are pending holds or we're already ready
		if ( wait === true ? --jQuery.readyWait : jQuery.isReady ) {
			return;
		}

		// Remember that the DOM is ready
		jQuery.isReady = true;

		// If a normal DOM Ready event fired, decrement, and wait if need be
		if ( wait !== true && --jQuery.readyWait > 0 ) {
			return;
		}

		// If there are functions bound, to execute
		readyList.resolveWith( document, [ jQuery ] );

		// Trigger any bound ready events
		if ( jQuery.fn.trigger ) {
			jQuery( document ).trigger("ready").off("ready");
		}
	}
});

/**
 * The ready event handler and self cleanup method
 */
function completed() {
	document.removeEventListener( "DOMContentLoaded", completed, false );
	window.removeEventListener( "load", completed, false );
	jQuery.ready();
}

jQuery.ready.promise = function( obj ) {
	if ( !readyList ) {

		readyList = jQuery.Deferred();

		// Catch cases where $(document).ready() is called after the browser event has already occurred.
		// we once tried to use readyState "interactive" here, but it caused issues like the one
		// discovered by ChrisS here: http://bugs.jquery.com/ticket/12282#comment:15
		if ( document.readyState === "complete" ) {
			// Handle it asynchronously to allow scripts the opportunity to delay ready
			setTimeout( jQuery.ready );

		} else {

			// Use the handy event callback
			document.addEventListener( "DOMContentLoaded", completed, false );

			// A fallback to window.onload, that will always work
			window.addEventListener( "load", completed, false );
		}
	}
	return readyList.promise( obj );
};

// Kick off the DOM ready check even if the user does not
jQuery.ready.promise();




// Multifunctional method to get and set values of a collection
// The value/s can optionally be executed if it's a function
var access = jQuery.access = function( elems, fn, key, value, chainable, emptyGet, raw ) {
	var i = 0,
		len = elems.length,
		bulk = key == null;

	// Sets many values
	if ( jQuery.type( key ) === "object" ) {
		chainable = true;
		for ( i in key ) {
			jQuery.access( elems, fn, i, key[i], true, emptyGet, raw );
		}

	// Sets one value
	} else if ( value !== undefined ) {
		chainable = true;

		if ( !jQuery.isFunction( value ) ) {
			raw = true;
		}

		if ( bulk ) {
			// Bulk operations run against the entire set
			if ( raw ) {
				fn.call( elems, value );
				fn = null;

			// ...except when executing function values
			} else {
				bulk = fn;
				fn = function( elem, key, value ) {
					return bulk.call( jQuery( elem ), value );
				};
			}
		}

		if ( fn ) {
			for ( ; i < len; i++ ) {
				fn( elems[i], key, raw ? value : value.call( elems[i], i, fn( elems[i], key ) ) );
			}
		}
	}

	return chainable ?
		elems :

		// Gets
		bulk ?
			fn.call( elems ) :
			len ? fn( elems[0], key ) : emptyGet;
};


/**
 * Determines whether an object can have data
 */
jQuery.acceptData = function( owner ) {
	// Accepts only:
	//  - Node
	//    - Node.ELEMENT_NODE
	//    - Node.DOCUMENT_NODE
	//  - Object
	//    - Any
	/* jshint -W018 */
	return owner.nodeType === 1 || owner.nodeType === 9 || !( +owner.nodeType );
};


function Data() {
	// Support: Android < 4,
	// Old WebKit does not have Object.preventExtensions/freeze method,
	// return new empty object instead with no [[set]] accessor
	Object.defineProperty( this.cache = {}, 0, {
		get: function() {
			return {};
		}
	});

	this.expando = jQuery.expando + Math.random();
}

Data.uid = 1;
Data.accepts = jQuery.acceptData;

Data.prototype = {
	key: function( owner ) {
		// We can accept data for non-element nodes in modern browsers,
		// but we should not, see #8335.
		// Always return the key for a frozen object.
		if ( !Data.accepts( owner ) ) {
			return 0;
		}

		var descriptor = {},
			// Check if the owner object already has a cache key
			unlock = owner[ this.expando ];

		// If not, create one
		if ( !unlock ) {
			unlock = Data.uid++;

			// Secure it in a non-enumerable, non-writable property
			try {
				descriptor[ this.expando ] = { value: unlock };
				Object.defineProperties( owner, descriptor );

			// Support: Android < 4
			// Fallback to a less secure definition
			} catch ( e ) {
				descriptor[ this.expando ] = unlock;
				jQuery.extend( owner, descriptor );
			}
		}

		// Ensure the cache object
		if ( !this.cache[ unlock ] ) {
			this.cache[ unlock ] = {};
		}

		return unlock;
	},
	set: function( owner, data, value ) {
		var prop,
			// There may be an unlock assigned to this node,
			// if there is no entry for this "owner", create one inline
			// and set the unlock as though an owner entry had always existed
			unlock = this.key( owner ),
			cache = this.cache[ unlock ];

		// Handle: [ owner, key, value ] args
		if ( typeof data === "string" ) {
			cache[ data ] = value;

		// Handle: [ owner, { properties } ] args
		} else {
			// Fresh assignments by object are shallow copied
			if ( jQuery.isEmptyObject( cache ) ) {
				jQuery.extend( this.cache[ unlock ], data );
			// Otherwise, copy the properties one-by-one to the cache object
			} else {
				for ( prop in data ) {
					cache[ prop ] = data[ prop ];
				}
			}
		}
		return cache;
	},
	get: function( owner, key ) {
		// Either a valid cache is found, or will be created.
		// New caches will be created and the unlock returned,
		// allowing direct access to the newly created
		// empty data object. A valid owner object must be provided.
		var cache = this.cache[ this.key( owner ) ];

		return key === undefined ?
			cache : cache[ key ];
	},
	access: function( owner, key, value ) {
		var stored;
		// In cases where either:
		//
		//   1. No key was specified
		//   2. A string key was specified, but no value provided
		//
		// Take the "read" path and allow the get method to determine
		// which value to return, respectively either:
		//
		//   1. The entire cache object
		//   2. The data stored at the key
		//
		if ( key === undefined ||
				((key && typeof key === "string") && value === undefined) ) {

			stored = this.get( owner, key );

			return stored !== undefined ?
				stored : this.get( owner, jQuery.camelCase(key) );
		}

		// [*]When the key is not a string, or both a key and value
		// are specified, set or extend (existing objects) with either:
		//
		//   1. An object of properties
		//   2. A key and value
		//
		this.set( owner, key, value );

		// Since the "set" path can have two possible entry points
		// return the expected data based on which path was taken[*]
		return value !== undefined ? value : key;
	},
	remove: function( owner, key ) {
		var i, name, camel,
			unlock = this.key( owner ),
			cache = this.cache[ unlock ];

		if ( key === undefined ) {
			this.cache[ unlock ] = {};

		} else {
			// Support array or space separated string of keys
			if ( jQuery.isArray( key ) ) {
				// If "name" is an array of keys...
				// When data is initially created, via ("key", "val") signature,
				// keys will be converted to camelCase.
				// Since there is no way to tell _how_ a key was added, remove
				// both plain key and camelCase key. #12786
				// This will only penalize the array argument path.
				name = key.concat( key.map( jQuery.camelCase ) );
			} else {
				camel = jQuery.camelCase( key );
				// Try the string as a key before any manipulation
				if ( key in cache ) {
					name = [ key, camel ];
				} else {
					// If a key with the spaces exists, use it.
					// Otherwise, create an array by matching non-whitespace
					name = camel;
					name = name in cache ?
						[ name ] : ( name.match( rnotwhite ) || [] );
				}
			}

			i = name.length;
			while ( i-- ) {
				delete cache[ name[ i ] ];
			}
		}
	},
	hasData: function( owner ) {
		return !jQuery.isEmptyObject(
			this.cache[ owner[ this.expando ] ] || {}
		);
	},
	discard: function( owner ) {
		if ( owner[ this.expando ] ) {
			delete this.cache[ owner[ this.expando ] ];
		}
	}
};
var data_priv = new Data();

var data_user = new Data();



/*
	Implementation Summary

	1. Enforce API surface and semantic compatibility with 1.9.x branch
	2. Improve the module's maintainability by reducing the storage
		paths to a single mechanism.
	3. Use the same single mechanism to support "private" and "user" data.
	4. _Never_ expose "private" data to user code (TODO: Drop _data, _removeData)
	5. Avoid exposing implementation details on user objects (eg. expando properties)
	6. Provide a clear path for implementation upgrade to WeakMap in 2014
*/
var rbrace = /^(?:\{[\w\W]*\}|\[[\w\W]*\])$/,
	rmultiDash = /([A-Z])/g;

function dataAttr( elem, key, data ) {
	var name;

	// If nothing was found internally, try to fetch any
	// data from the HTML5 data-* attribute
	if ( data === undefined && elem.nodeType === 1 ) {
		name = "data-" + key.replace( rmultiDash, "-$1" ).toLowerCase();
		data = elem.getAttribute( name );

		if ( typeof data === "string" ) {
			try {
				data = data === "true" ? true :
					data === "false" ? false :
					data === "null" ? null :
					// Only convert to a number if it doesn't change the string
					+data + "" === data ? +data :
					rbrace.test( data ) ? jQuery.parseJSON( data ) :
					data;
			} catch( e ) {}

			// Make sure we set the data so it isn't changed later
			data_user.set( elem, key, data );
		} else {
			data = undefined;
		}
	}
	return data;
}

jQuery.extend({
	hasData: function( elem ) {
		return data_user.hasData( elem ) || data_priv.hasData( elem );
	},

	data: function( elem, name, data ) {
		return data_user.access( elem, name, data );
	},

	removeData: function( elem, name ) {
		data_user.remove( elem, name );
	},

	// TODO: Now that all calls to _data and _removeData have been replaced
	// with direct calls to data_priv methods, these can be deprecated.
	_data: function( elem, name, data ) {
		return data_priv.access( elem, name, data );
	},

	_removeData: function( elem, name ) {
		data_priv.remove( elem, name );
	}
});

jQuery.fn.extend({
	data: function( key, value ) {
		var i, name, data,
			elem = this[ 0 ],
			attrs = elem && elem.attributes;

		// Gets all values
		if ( key === undefined ) {
			if ( this.length ) {
				data = data_user.get( elem );

				if ( elem.nodeType === 1 && !data_priv.get( elem, "hasDataAttrs" ) ) {
					i = attrs.length;
					while ( i-- ) {
						name = attrs[ i ].name;

						if ( name.indexOf( "data-" ) === 0 ) {
							name = jQuery.camelCase( name.slice(5) );
							dataAttr( elem, name, data[ name ] );
						}
					}
					data_priv.set( elem, "hasDataAttrs", true );
				}
			}

			return data;
		}

		// Sets multiple values
		if ( typeof key === "object" ) {
			return this.each(function() {
				data_user.set( this, key );
			});
		}

		return access( this, function( value ) {
			var data,
				camelKey = jQuery.camelCase( key );

			// The calling jQuery object (element matches) is not empty
			// (and therefore has an element appears at this[ 0 ]) and the
			// `value` parameter was not undefined. An empty jQuery object
			// will result in `undefined` for elem = this[ 0 ] which will
			// throw an exception if an attempt to read a data cache is made.
			if ( elem && value === undefined ) {
				// Attempt to get data from the cache
				// with the key as-is
				data = data_user.get( elem, key );
				if ( data !== undefined ) {
					return data;
				}

				// Attempt to get data from the cache
				// with the key camelized
				data = data_user.get( elem, camelKey );
				if ( data !== undefined ) {
					return data;
				}

				// Attempt to "discover" the data in
				// HTML5 custom data-* attrs
				data = dataAttr( elem, camelKey, undefined );
				if ( data !== undefined ) {
					return data;
				}

				// We tried really hard, but the data doesn't exist.
				return;
			}

			// Set the data...
			this.each(function() {
				// First, attempt to store a copy or reference of any
				// data that might've been store with a camelCased key.
				var data = data_user.get( this, camelKey );

				// For HTML5 data-* attribute interop, we have to
				// store property names with dashes in a camelCase form.
				// This might not apply to all properties...*
				data_user.set( this, camelKey, value );

				// *... In the case of properties that might _actually_
				// have dashes, we need to also store a copy of that
				// unchanged property.
				if ( key.indexOf("-") !== -1 && data !== undefined ) {
					data_user.set( this, key, value );
				}
			});
		}, null, value, arguments.length > 1, null, true );
	},

	removeData: function( key ) {
		return this.each(function() {
			data_user.remove( this, key );
		});
	}
});


jQuery.extend({
	queue: function( elem, type, data ) {
		var queue;

		if ( elem ) {
			type = ( type || "fx" ) + "queue";
			queue = data_priv.get( elem, type );

			// Speed up dequeue by getting out quickly if this is just a lookup
			if ( data ) {
				if ( !queue || jQuery.isArray( data ) ) {
					queue = data_priv.access( elem, type, jQuery.makeArray(data) );
				} else {
					queue.push( data );
				}
			}
			return queue || [];
		}
	},

	dequeue: function( elem, type ) {
		type = type || "fx";

		var queue = jQuery.queue( elem, type ),
			startLength = queue.length,
			fn = queue.shift(),
			hooks = jQuery._queueHooks( elem, type ),
			next = function() {
				jQuery.dequeue( elem, type );
			};

		// If the fx queue is dequeued, always remove the progress sentinel
		if ( fn === "inprogress" ) {
			fn = queue.shift();
			startLength--;
		}

		if ( fn ) {

			// Add a progress sentinel to prevent the fx queue from being
			// automatically dequeued
			if ( type === "fx" ) {
				queue.unshift( "inprogress" );
			}

			// clear up the last queue stop function
			delete hooks.stop;
			fn.call( elem, next, hooks );
		}

		if ( !startLength && hooks ) {
			hooks.empty.fire();
		}
	},

	// not intended for public consumption - generates a queueHooks object, or returns the current one
	_queueHooks: function( elem, type ) {
		var key = type + "queueHooks";
		return data_priv.get( elem, key ) || data_priv.access( elem, key, {
			empty: jQuery.Callbacks("once memory").add(function() {
				data_priv.remove( elem, [ type + "queue", key ] );
			})
		});
	}
});

jQuery.fn.extend({
	queue: function( type, data ) {
		var setter = 2;

		if ( typeof type !== "string" ) {
			data = type;
			type = "fx";
			setter--;
		}

		if ( arguments.length < setter ) {
			return jQuery.queue( this[0], type );
		}

		return data === undefined ?
			this :
			this.each(function() {
				var queue = jQuery.queue( this, type, data );

				// ensure a hooks for this queue
				jQuery._queueHooks( this, type );

				if ( type === "fx" && queue[0] !== "inprogress" ) {
					jQuery.dequeue( this, type );
				}
			});
	},
	dequeue: function( type ) {
		return this.each(function() {
			jQuery.dequeue( this, type );
		});
	},
	clearQueue: function( type ) {
		return this.queue( type || "fx", [] );
	},
	// Get a promise resolved when queues of a certain type
	// are emptied (fx is the type by default)
	promise: function( type, obj ) {
		var tmp,
			count = 1,
			defer = jQuery.Deferred(),
			elements = this,
			i = this.length,
			resolve = function() {
				if ( !( --count ) ) {
					defer.resolveWith( elements, [ elements ] );
				}
			};

		if ( typeof type !== "string" ) {
			obj = type;
			type = undefined;
		}
		type = type || "fx";

		while ( i-- ) {
			tmp = data_priv.get( elements[ i ], type + "queueHooks" );
			if ( tmp && tmp.empty ) {
				count++;
				tmp.empty.add( resolve );
			}
		}
		resolve();
		return defer.promise( obj );
	}
});
var pnum = (/[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/).source;

var cssExpand = [ "Top", "Right", "Bottom", "Left" ];

var isHidden = function( elem, el ) {
		// isHidden might be called from jQuery#filter function;
		// in that case, element will be second argument
		elem = el || elem;
		return jQuery.css( elem, "display" ) === "none" || !jQuery.contains( elem.ownerDocument, elem );
	};

var rcheckableType = (/^(?:checkbox|radio)$/i);



(function() {
	var fragment = document.createDocumentFragment(),
		div = fragment.appendChild( document.createElement( "div" ) );

	// #11217 - WebKit loses check when the name is after the checked attribute
	div.innerHTML = "<input type='radio' checked='checked' name='t'/>";

	// Support: Safari 5.1, iOS 5.1, Android 4.x, Android 2.3
	// old WebKit doesn't clone checked state correctly in fragments
	support.checkClone = div.cloneNode( true ).cloneNode( true ).lastChild.checked;

	// Make sure textarea (and checkbox) defaultValue is properly cloned
	// Support: IE9-IE11+
	div.innerHTML = "<textarea>x</textarea>";
	support.noCloneChecked = !!div.cloneNode( true ).lastChild.defaultValue;
})();
var strundefined = typeof undefined;



support.focusinBubbles = "onfocusin" in window;


var
	rkeyEvent = /^key/,
	rmouseEvent = /^(?:mouse|contextmenu)|click/,
	rfocusMorph = /^(?:focusinfocus|focusoutblur)$/,
	rtypenamespace = /^([^.]*)(?:\.(.+)|)$/;

function returnTrue() {
	return true;
}

function returnFalse() {
	return false;
}

function safeActiveElement() {
	try {
		return document.activeElement;
	} catch ( err ) { }
}

/*
 * Helper functions for managing events -- not part of the public interface.
 * Props to Dean Edwards' addEvent library for many of the ideas.
 */
jQuery.event = {

	global: {},

	add: function( elem, types, handler, data, selector ) {

		var handleObjIn, eventHandle, tmp,
			events, t, handleObj,
			special, handlers, type, namespaces, origType,
			elemData = data_priv.get( elem );

		// Don't attach events to noData or text/comment nodes (but allow plain objects)
		if ( !elemData ) {
			return;
		}

		// Caller can pass in an object of custom data in lieu of the handler
		if ( handler.handler ) {
			handleObjIn = handler;
			handler = handleObjIn.handler;
			selector = handleObjIn.selector;
		}

		// Make sure that the handler has a unique ID, used to find/remove it later
		if ( !handler.guid ) {
			handler.guid = jQuery.guid++;
		}

		// Init the element's event structure and main handler, if this is the first
		if ( !(events = elemData.events) ) {
			events = elemData.events = {};
		}
		if ( !(eventHandle = elemData.handle) ) {
			eventHandle = elemData.handle = function( e ) {
				// Discard the second event of a jQuery.event.trigger() and
				// when an event is called after a page has unloaded
				return typeof jQuery !== strundefined && jQuery.event.triggered !== e.type ?
					jQuery.event.dispatch.apply( elem, arguments ) : undefined;
			};
		}

		// Handle multiple events separated by a space
		types = ( types || "" ).match( rnotwhite ) || [ "" ];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[t] ) || [];
			type = origType = tmp[1];
			namespaces = ( tmp[2] || "" ).split( "." ).sort();

			// There *must* be a type, no attaching namespace-only handlers
			if ( !type ) {
				continue;
			}

			// If event changes its type, use the special event handlers for the changed type
			special = jQuery.event.special[ type ] || {};

			// If selector defined, determine special event api type, otherwise given type
			type = ( selector ? special.delegateType : special.bindType ) || type;

			// Update special based on newly reset type
			special = jQuery.event.special[ type ] || {};

			// handleObj is passed to all event handlers
			handleObj = jQuery.extend({
				type: type,
				origType: origType,
				data: data,
				handler: handler,
				guid: handler.guid,
				selector: selector,
				needsContext: selector && jQuery.expr.match.needsContext.test( selector ),
				namespace: namespaces.join(".")
			}, handleObjIn );

			// Init the event handler queue if we're the first
			if ( !(handlers = events[ type ]) ) {
				handlers = events[ type ] = [];
				handlers.delegateCount = 0;

				// Only use addEventListener if the special events handler returns false
				if ( !special.setup || special.setup.call( elem, data, namespaces, eventHandle ) === false ) {
					if ( elem.addEventListener ) {
						elem.addEventListener( type, eventHandle, false );
					}
				}
			}

			if ( special.add ) {
				special.add.call( elem, handleObj );

				if ( !handleObj.handler.guid ) {
					handleObj.handler.guid = handler.guid;
				}
			}

			// Add to the element's handler list, delegates in front
			if ( selector ) {
				handlers.splice( handlers.delegateCount++, 0, handleObj );
			} else {
				handlers.push( handleObj );
			}

			// Keep track of which events have ever been used, for event optimization
			jQuery.event.global[ type ] = true;
		}

	},

	// Detach an event or set of events from an element
	remove: function( elem, types, handler, selector, mappedTypes ) {

		var j, origCount, tmp,
			events, t, handleObj,
			special, handlers, type, namespaces, origType,
			elemData = data_priv.hasData( elem ) && data_priv.get( elem );

		if ( !elemData || !(events = elemData.events) ) {
			return;
		}

		// Once for each type.namespace in types; type may be omitted
		types = ( types || "" ).match( rnotwhite ) || [ "" ];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[t] ) || [];
			type = origType = tmp[1];
			namespaces = ( tmp[2] || "" ).split( "." ).sort();

			// Unbind all events (on this namespace, if provided) for the element
			if ( !type ) {
				for ( type in events ) {
					jQuery.event.remove( elem, type + types[ t ], handler, selector, true );
				}
				continue;
			}

			special = jQuery.event.special[ type ] || {};
			type = ( selector ? special.delegateType : special.bindType ) || type;
			handlers = events[ type ] || [];
			tmp = tmp[2] && new RegExp( "(^|\\.)" + namespaces.join("\\.(?:.*\\.|)") + "(\\.|$)" );

			// Remove matching events
			origCount = j = handlers.length;
			while ( j-- ) {
				handleObj = handlers[ j ];

				if ( ( mappedTypes || origType === handleObj.origType ) &&
					( !handler || handler.guid === handleObj.guid ) &&
					( !tmp || tmp.test( handleObj.namespace ) ) &&
					( !selector || selector === handleObj.selector || selector === "**" && handleObj.selector ) ) {
					handlers.splice( j, 1 );

					if ( handleObj.selector ) {
						handlers.delegateCount--;
					}
					if ( special.remove ) {
						special.remove.call( elem, handleObj );
					}
				}
			}

			// Remove generic event handler if we removed something and no more handlers exist
			// (avoids potential for endless recursion during removal of special event handlers)
			if ( origCount && !handlers.length ) {
				if ( !special.teardown || special.teardown.call( elem, namespaces, elemData.handle ) === false ) {
					jQuery.removeEvent( elem, type, elemData.handle );
				}

				delete events[ type ];
			}
		}

		// Remove the expando if it's no longer used
		if ( jQuery.isEmptyObject( events ) ) {
			delete elemData.handle;
			data_priv.remove( elem, "events" );
		}
	},

	trigger: function( event, data, elem, onlyHandlers ) {

		var i, cur, tmp, bubbleType, ontype, handle, special,
			eventPath = [ elem || document ],
			type = hasOwn.call( event, "type" ) ? event.type : event,
			namespaces = hasOwn.call( event, "namespace" ) ? event.namespace.split(".") : [];

		cur = tmp = elem = elem || document;

		// Don't do events on text and comment nodes
		if ( elem.nodeType === 3 || elem.nodeType === 8 ) {
			return;
		}

		// focus/blur morphs to focusin/out; ensure we're not firing them right now
		if ( rfocusMorph.test( type + jQuery.event.triggered ) ) {
			return;
		}

		if ( type.indexOf(".") >= 0 ) {
			// Namespaced trigger; create a regexp to match event type in handle()
			namespaces = type.split(".");
			type = namespaces.shift();
			namespaces.sort();
		}
		ontype = type.indexOf(":") < 0 && "on" + type;

		// Caller can pass in a jQuery.Event object, Object, or just an event type string
		event = event[ jQuery.expando ] ?
			event :
			new jQuery.Event( type, typeof event === "object" && event );

		// Trigger bitmask: & 1 for native handlers; & 2 for jQuery (always true)
		event.isTrigger = onlyHandlers ? 2 : 3;
		event.namespace = namespaces.join(".");
		event.namespace_re = event.namespace ?
			new RegExp( "(^|\\.)" + namespaces.join("\\.(?:.*\\.|)") + "(\\.|$)" ) :
			null;

		// Clean up the event in case it is being reused
		event.result = undefined;
		if ( !event.target ) {
			event.target = elem;
		}

		// Clone any incoming data and prepend the event, creating the handler arg list
		data = data == null ?
			[ event ] :
			jQuery.makeArray( data, [ event ] );

		// Allow special events to draw outside the lines
		special = jQuery.event.special[ type ] || {};
		if ( !onlyHandlers && special.trigger && special.trigger.apply( elem, data ) === false ) {
			return;
		}

		// Determine event propagation path in advance, per W3C events spec (#9951)
		// Bubble up to document, then to window; watch for a global ownerDocument var (#9724)
		if ( !onlyHandlers && !special.noBubble && !jQuery.isWindow( elem ) ) {

			bubbleType = special.delegateType || type;
			if ( !rfocusMorph.test( bubbleType + type ) ) {
				cur = cur.parentNode;
			}
			for ( ; cur; cur = cur.parentNode ) {
				eventPath.push( cur );
				tmp = cur;
			}

			// Only add window if we got to document (e.g., not plain obj or detached DOM)
			if ( tmp === (elem.ownerDocument || document) ) {
				eventPath.push( tmp.defaultView || tmp.parentWindow || window );
			}
		}

		// Fire handlers on the event path
		i = 0;
		while ( (cur = eventPath[i++]) && !event.isPropagationStopped() ) {

			event.type = i > 1 ?
				bubbleType :
				special.bindType || type;

			// jQuery handler
			handle = ( data_priv.get( cur, "events" ) || {} )[ event.type ] && data_priv.get( cur, "handle" );
			if ( handle ) {
				handle.apply( cur, data );
			}

			// Native handler
			handle = ontype && cur[ ontype ];
			if ( handle && handle.apply && jQuery.acceptData( cur ) ) {
				event.result = handle.apply( cur, data );
				if ( event.result === false ) {
					event.preventDefault();
				}
			}
		}
		event.type = type;

		// If nobody prevented the default action, do it now
		if ( !onlyHandlers && !event.isDefaultPrevented() ) {

			if ( (!special._default || special._default.apply( eventPath.pop(), data ) === false) &&
				jQuery.acceptData( elem ) ) {

				// Call a native DOM method on the target with the same name name as the event.
				// Don't do default actions on window, that's where global variables be (#6170)
				if ( ontype && jQuery.isFunction( elem[ type ] ) && !jQuery.isWindow( elem ) ) {

					// Don't re-trigger an onFOO event when we call its FOO() method
					tmp = elem[ ontype ];

					if ( tmp ) {
						elem[ ontype ] = null;
					}

					// Prevent re-triggering of the same event, since we already bubbled it above
					jQuery.event.triggered = type;
					elem[ type ]();
					jQuery.event.triggered = undefined;

					if ( tmp ) {
						elem[ ontype ] = tmp;
					}
				}
			}
		}

		return event.result;
	},

	dispatch: function( event ) {

		// Make a writable jQuery.Event from the native event object
		event = jQuery.event.fix( event );

		var i, j, ret, matched, handleObj,
			handlerQueue = [],
			args = slice.call( arguments ),
			handlers = ( data_priv.get( this, "events" ) || {} )[ event.type ] || [],
			special = jQuery.event.special[ event.type ] || {};

		// Use the fix-ed jQuery.Event rather than the (read-only) native event
		args[0] = event;
		event.delegateTarget = this;

		// Call the preDispatch hook for the mapped type, and let it bail if desired
		if ( special.preDispatch && special.preDispatch.call( this, event ) === false ) {
			return;
		}

		// Determine handlers
		handlerQueue = jQuery.event.handlers.call( this, event, handlers );

		// Run delegates first; they may want to stop propagation beneath us
		i = 0;
		while ( (matched = handlerQueue[ i++ ]) && !event.isPropagationStopped() ) {
			event.currentTarget = matched.elem;

			j = 0;
			while ( (handleObj = matched.handlers[ j++ ]) && !event.isImmediatePropagationStopped() ) {

				// Triggered event must either 1) have no namespace, or
				// 2) have namespace(s) a subset or equal to those in the bound event (both can have no namespace).
				if ( !event.namespace_re || event.namespace_re.test( handleObj.namespace ) ) {

					event.handleObj = handleObj;
					event.data = handleObj.data;

					ret = ( (jQuery.event.special[ handleObj.origType ] || {}).handle || handleObj.handler )
							.apply( matched.elem, args );

					if ( ret !== undefined ) {
						if ( (event.result = ret) === false ) {
							event.preventDefault();
							event.stopPropagation();
						}
					}
				}
			}
		}

		// Call the postDispatch hook for the mapped type
		if ( special.postDispatch ) {
			special.postDispatch.call( this, event );
		}

		return event.result;
	},

	handlers: function( event, handlers ) {
		var i, matches, sel, handleObj,
			handlerQueue = [],
			delegateCount = handlers.delegateCount,
			cur = event.target;

		// Find delegate handlers
		// Black-hole SVG <use> instance trees (#13180)
		// Avoid non-left-click bubbling in Firefox (#3861)
		if ( delegateCount && cur.nodeType && (!event.button || event.type !== "click") ) {

			for ( ; cur !== this; cur = cur.parentNode || this ) {

				// Don't process clicks on disabled elements (#6911, #8165, #11382, #11764)
				if ( cur.disabled !== true || event.type !== "click" ) {
					matches = [];
					for ( i = 0; i < delegateCount; i++ ) {
						handleObj = handlers[ i ];

						// Don't conflict with Object.prototype properties (#13203)
						sel = handleObj.selector + " ";

						if ( matches[ sel ] === undefined ) {
							matches[ sel ] = handleObj.needsContext ?
								jQuery( sel, this ).index( cur ) >= 0 :
								jQuery.find( sel, this, null, [ cur ] ).length;
						}
						if ( matches[ sel ] ) {
							matches.push( handleObj );
						}
					}
					if ( matches.length ) {
						handlerQueue.push({ elem: cur, handlers: matches });
					}
				}
			}
		}

		// Add the remaining (directly-bound) handlers
		if ( delegateCount < handlers.length ) {
			handlerQueue.push({ elem: this, handlers: handlers.slice( delegateCount ) });
		}

		return handlerQueue;
	},

	// Includes some event props shared by KeyEvent and MouseEvent
	props: "altKey bubbles cancelable ctrlKey currentTarget eventPhase metaKey relatedTarget shiftKey target timeStamp view which".split(" "),

	fixHooks: {},

	keyHooks: {
		props: "char charCode key keyCode".split(" "),
		filter: function( event, original ) {

			// Add which for key events
			if ( event.which == null ) {
				event.which = original.charCode != null ? original.charCode : original.keyCode;
			}

			return event;
		}
	},

	mouseHooks: {
		props: "button buttons clientX clientY offsetX offsetY pageX pageY screenX screenY toElement".split(" "),
		filter: function( event, original ) {
			var eventDoc, doc, body,
				button = original.button;

			// Calculate pageX/Y if missing and clientX/Y available
			if ( event.pageX == null && original.clientX != null ) {
				eventDoc = event.target.ownerDocument || document;
				doc = eventDoc.documentElement;
				body = eventDoc.body;

				event.pageX = original.clientX + ( doc && doc.scrollLeft || body && body.scrollLeft || 0 ) - ( doc && doc.clientLeft || body && body.clientLeft || 0 );
				event.pageY = original.clientY + ( doc && doc.scrollTop  || body && body.scrollTop  || 0 ) - ( doc && doc.clientTop  || body && body.clientTop  || 0 );
			}

			// Add which for click: 1 === left; 2 === middle; 3 === right
			// Note: button is not normalized, so don't use it
			if ( !event.which && button !== undefined ) {
				event.which = ( button & 1 ? 1 : ( button & 2 ? 3 : ( button & 4 ? 2 : 0 ) ) );
			}

			return event;
		}
	},

	fix: function( event ) {
		if ( event[ jQuery.expando ] ) {
			return event;
		}

		// Create a writable copy of the event object and normalize some properties
		var i, prop, copy,
			type = event.type,
			originalEvent = event,
			fixHook = this.fixHooks[ type ];

		if ( !fixHook ) {
			this.fixHooks[ type ] = fixHook =
				rmouseEvent.test( type ) ? this.mouseHooks :
				rkeyEvent.test( type ) ? this.keyHooks :
				{};
		}
		copy = fixHook.props ? this.props.concat( fixHook.props ) : this.props;

		event = new jQuery.Event( originalEvent );

		i = copy.length;
		while ( i-- ) {
			prop = copy[ i ];
			event[ prop ] = originalEvent[ prop ];
		}

		// Support: Cordova 2.5 (WebKit) (#13255)
		// All events should have a target; Cordova deviceready doesn't
		if ( !event.target ) {
			event.target = document;
		}

		// Support: Safari 6.0+, Chrome < 28
		// Target should not be a text node (#504, #13143)
		if ( event.target.nodeType === 3 ) {
			event.target = event.target.parentNode;
		}

		return fixHook.filter ? fixHook.filter( event, originalEvent ) : event;
	},

	special: {
		load: {
			// Prevent triggered image.load events from bubbling to window.load
			noBubble: true
		},
		focus: {
			// Fire native event if possible so blur/focus sequence is correct
			trigger: function() {
				if ( this !== safeActiveElement() && this.focus ) {
					this.focus();
					return false;
				}
			},
			delegateType: "focusin"
		},
		blur: {
			trigger: function() {
				if ( this === safeActiveElement() && this.blur ) {
					this.blur();
					return false;
				}
			},
			delegateType: "focusout"
		},
		click: {
			// For checkbox, fire native event so checked state will be right
			trigger: function() {
				if ( this.type === "checkbox" && this.click && jQuery.nodeName( this, "input" ) ) {
					this.click();
					return false;
				}
			},

			// For cross-browser consistency, don't fire native .click() on links
			_default: function( event ) {
				return jQuery.nodeName( event.target, "a" );
			}
		},

		beforeunload: {
			postDispatch: function( event ) {

				// Support: Firefox 20+
				// Firefox doesn't alert if the returnValue field is not set.
				if ( event.result !== undefined ) {
					event.originalEvent.returnValue = event.result;
				}
			}
		}
	},

	simulate: function( type, elem, event, bubble ) {
		// Piggyback on a donor event to simulate a different one.
		// Fake originalEvent to avoid donor's stopPropagation, but if the
		// simulated event prevents default then we do the same on the donor.
		var e = jQuery.extend(
			new jQuery.Event(),
			event,
			{
				type: type,
				isSimulated: true,
				originalEvent: {}
			}
		);
		if ( bubble ) {
			jQuery.event.trigger( e, null, elem );
		} else {
			jQuery.event.dispatch.call( elem, e );
		}
		if ( e.isDefaultPrevented() ) {
			event.preventDefault();
		}
	}
};

jQuery.removeEvent = function( elem, type, handle ) {
	if ( elem.removeEventListener ) {
		elem.removeEventListener( type, handle, false );
	}
};

jQuery.Event = function( src, props ) {
	// Allow instantiation without the 'new' keyword
	if ( !(this instanceof jQuery.Event) ) {
		return new jQuery.Event( src, props );
	}

	// Event object
	if ( src && src.type ) {
		this.originalEvent = src;
		this.type = src.type;

		// Events bubbling up the document may have been marked as prevented
		// by a handler lower down the tree; reflect the correct value.
		this.isDefaultPrevented = src.defaultPrevented ||
				// Support: Android < 4.0
				src.defaultPrevented === undefined &&
				src.getPreventDefault && src.getPreventDefault() ?
			returnTrue :
			returnFalse;

	// Event type
	} else {
		this.type = src;
	}

	// Put explicitly provided properties onto the event object
	if ( props ) {
		jQuery.extend( this, props );
	}

	// Create a timestamp if incoming event doesn't have one
	this.timeStamp = src && src.timeStamp || jQuery.now();

	// Mark it as fixed
	this[ jQuery.expando ] = true;
};

// jQuery.Event is based on DOM3 Events as specified by the ECMAScript Language Binding
// http://www.w3.org/TR/2003/WD-DOM-Level-3-Events-20030331/ecma-script-binding.html
jQuery.Event.prototype = {
	isDefaultPrevented: returnFalse,
	isPropagationStopped: returnFalse,
	isImmediatePropagationStopped: returnFalse,

	preventDefault: function() {
		var e = this.originalEvent;

		this.isDefaultPrevented = returnTrue;

		if ( e && e.preventDefault ) {
			e.preventDefault();
		}
	},
	stopPropagation: function() {
		var e = this.originalEvent;

		this.isPropagationStopped = returnTrue;

		if ( e && e.stopPropagation ) {
			e.stopPropagation();
		}
	},
	stopImmediatePropagation: function() {
		this.isImmediatePropagationStopped = returnTrue;
		this.stopPropagation();
	}
};

// Create mouseenter/leave events using mouseover/out and event-time checks
// Support: Chrome 15+
jQuery.each({
	mouseenter: "mouseover",
	mouseleave: "mouseout"
}, function( orig, fix ) {
	jQuery.event.special[ orig ] = {
		delegateType: fix,
		bindType: fix,

		handle: function( event ) {
			var ret,
				target = this,
				related = event.relatedTarget,
				handleObj = event.handleObj;

			// For mousenter/leave call the handler if related is outside the target.
			// NB: No relatedTarget if the mouse left/entered the browser window
			if ( !related || (related !== target && !jQuery.contains( target, related )) ) {
				event.type = handleObj.origType;
				ret = handleObj.handler.apply( this, arguments );
				event.type = fix;
			}
			return ret;
		}
	};
});

// Create "bubbling" focus and blur events
// Support: Firefox, Chrome, Safari
if ( !support.focusinBubbles ) {
	jQuery.each({ focus: "focusin", blur: "focusout" }, function( orig, fix ) {

		// Attach a single capturing handler on the document while someone wants focusin/focusout
		var handler = function( event ) {
				jQuery.event.simulate( fix, event.target, jQuery.event.fix( event ), true );
			};

		jQuery.event.special[ fix ] = {
			setup: function() {
				var doc = this.ownerDocument || this,
					attaches = data_priv.access( doc, fix );

				if ( !attaches ) {
					doc.addEventListener( orig, handler, true );
				}
				data_priv.access( doc, fix, ( attaches || 0 ) + 1 );
			},
			teardown: function() {
				var doc = this.ownerDocument || this,
					attaches = data_priv.access( doc, fix ) - 1;

				if ( !attaches ) {
					doc.removeEventListener( orig, handler, true );
					data_priv.remove( doc, fix );

				} else {
					data_priv.access( doc, fix, attaches );
				}
			}
		};
	});
}

jQuery.fn.extend({

	on: function( types, selector, data, fn, /*INTERNAL*/ one ) {
		var origFn, type;

		// Types can be a map of types/handlers
		if ( typeof types === "object" ) {
			// ( types-Object, selector, data )
			if ( typeof selector !== "string" ) {
				// ( types-Object, data )
				data = data || selector;
				selector = undefined;
			}
			for ( type in types ) {
				this.on( type, selector, data, types[ type ], one );
			}
			return this;
		}

		if ( data == null && fn == null ) {
			// ( types, fn )
			fn = selector;
			data = selector = undefined;
		} else if ( fn == null ) {
			if ( typeof selector === "string" ) {
				// ( types, selector, fn )
				fn = data;
				data = undefined;
			} else {
				// ( types, data, fn )
				fn = data;
				data = selector;
				selector = undefined;
			}
		}
		if ( fn === false ) {
			fn = returnFalse;
		} else if ( !fn ) {
			return this;
		}

		if ( one === 1 ) {
			origFn = fn;
			fn = function( event ) {
				// Can use an empty set, since event contains the info
				jQuery().off( event );
				return origFn.apply( this, arguments );
			};
			// Use same guid so caller can remove using origFn
			fn.guid = origFn.guid || ( origFn.guid = jQuery.guid++ );
		}
		return this.each( function() {
			jQuery.event.add( this, types, fn, data, selector );
		});
	},
	one: function( types, selector, data, fn ) {
		return this.on( types, selector, data, fn, 1 );
	},
	off: function( types, selector, fn ) {
		var handleObj, type;
		if ( types && types.preventDefault && types.handleObj ) {
			// ( event )  dispatched jQuery.Event
			handleObj = types.handleObj;
			jQuery( types.delegateTarget ).off(
				handleObj.namespace ? handleObj.origType + "." + handleObj.namespace : handleObj.origType,
				handleObj.selector,
				handleObj.handler
			);
			return this;
		}
		if ( typeof types === "object" ) {
			// ( types-object [, selector] )
			for ( type in types ) {
				this.off( type, selector, types[ type ] );
			}
			return this;
		}
		if ( selector === false || typeof selector === "function" ) {
			// ( types [, fn] )
			fn = selector;
			selector = undefined;
		}
		if ( fn === false ) {
			fn = returnFalse;
		}
		return this.each(function() {
			jQuery.event.remove( this, types, fn, selector );
		});
	},

	trigger: function( type, data ) {
		return this.each(function() {
			jQuery.event.trigger( type, data, this );
		});
	},
	triggerHandler: function( type, data ) {
		var elem = this[0];
		if ( elem ) {
			return jQuery.event.trigger( type, data, elem, true );
		}
	}
});


var
	rxhtmlTag = /<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi,
	rtagName = /<([\w:]+)/,
	rhtml = /<|&#?\w+;/,
	rnoInnerhtml = /<(?:script|style|link)/i,
	// checked="checked" or checked
	rchecked = /checked\s*(?:[^=]|=\s*.checked.)/i,
	rscriptType = /^$|\/(?:java|ecma)script/i,
	rscriptTypeMasked = /^true\/(.*)/,
	rcleanScript = /^\s*<!(?:\[CDATA\[|--)|(?:\]\]|--)>\s*$/g,

	// We have to close these tags to support XHTML (#13200)
	wrapMap = {

		// Support: IE 9
		option: [ 1, "<select multiple='multiple'>", "</select>" ],

		thead: [ 1, "<table>", "</table>" ],
		col: [ 2, "<table><colgroup>", "</colgroup></table>" ],
		tr: [ 2, "<table><tbody>", "</tbody></table>" ],
		td: [ 3, "<table><tbody><tr>", "</tr></tbody></table>" ],

		_default: [ 0, "", "" ]
	};

// Support: IE 9
wrapMap.optgroup = wrapMap.option;

wrapMap.tbody = wrapMap.tfoot = wrapMap.colgroup = wrapMap.caption = wrapMap.thead;
wrapMap.th = wrapMap.td;

// Support: 1.x compatibility
// Manipulating tables requires a tbody
function manipulationTarget( elem, content ) {
	return jQuery.nodeName( elem, "table" ) &&
		jQuery.nodeName( content.nodeType !== 11 ? content : content.firstChild, "tr" ) ?

		elem.getElementsByTagName("tbody")[0] ||
			elem.appendChild( elem.ownerDocument.createElement("tbody") ) :
		elem;
}

// Replace/restore the type attribute of script elements for safe DOM manipulation
function disableScript( elem ) {
	elem.type = (elem.getAttribute("type") !== null) + "/" + elem.type;
	return elem;
}
function restoreScript( elem ) {
	var match = rscriptTypeMasked.exec( elem.type );

	if ( match ) {
		elem.type = match[ 1 ];
	} else {
		elem.removeAttribute("type");
	}

	return elem;
}

// Mark scripts as having already been evaluated
function setGlobalEval( elems, refElements ) {
	var i = 0,
		l = elems.length;

	for ( ; i < l; i++ ) {
		data_priv.set(
			elems[ i ], "globalEval", !refElements || data_priv.get( refElements[ i ], "globalEval" )
		);
	}
}

function cloneCopyEvent( src, dest ) {
	var i, l, type, pdataOld, pdataCur, udataOld, udataCur, events;

	if ( dest.nodeType !== 1 ) {
		return;
	}

	// 1. Copy private data: events, handlers, etc.
	if ( data_priv.hasData( src ) ) {
		pdataOld = data_priv.access( src );
		pdataCur = data_priv.set( dest, pdataOld );
		events = pdataOld.events;

		if ( events ) {
			delete pdataCur.handle;
			pdataCur.events = {};

			for ( type in events ) {
				for ( i = 0, l = events[ type ].length; i < l; i++ ) {
					jQuery.event.add( dest, type, events[ type ][ i ] );
				}
			}
		}
	}

	// 2. Copy user data
	if ( data_user.hasData( src ) ) {
		udataOld = data_user.access( src );
		udataCur = jQuery.extend( {}, udataOld );

		data_user.set( dest, udataCur );
	}
}

function getAll( context, tag ) {
	var ret = context.getElementsByTagName ? context.getElementsByTagName( tag || "*" ) :
			context.querySelectorAll ? context.querySelectorAll( tag || "*" ) :
			[];

	return tag === undefined || tag && jQuery.nodeName( context, tag ) ?
		jQuery.merge( [ context ], ret ) :
		ret;
}

// Support: IE >= 9
function fixInput( src, dest ) {
	var nodeName = dest.nodeName.toLowerCase();

	// Fails to persist the checked state of a cloned checkbox or radio button.
	if ( nodeName === "input" && rcheckableType.test( src.type ) ) {
		dest.checked = src.checked;

	// Fails to return the selected option to the default selected state when cloning options
	} else if ( nodeName === "input" || nodeName === "textarea" ) {
		dest.defaultValue = src.defaultValue;
	}
}

jQuery.extend({
	clone: function( elem, dataAndEvents, deepDataAndEvents ) {
		var i, l, srcElements, destElements,
			clone = elem.cloneNode( true ),
			inPage = jQuery.contains( elem.ownerDocument, elem );

		// Support: IE >= 9
		// Fix Cloning issues
		if ( !support.noCloneChecked && ( elem.nodeType === 1 || elem.nodeType === 11 ) &&
				!jQuery.isXMLDoc( elem ) ) {

			// We eschew Sizzle here for performance reasons: http://jsperf.com/getall-vs-sizzle/2
			destElements = getAll( clone );
			srcElements = getAll( elem );

			for ( i = 0, l = srcElements.length; i < l; i++ ) {
				fixInput( srcElements[ i ], destElements[ i ] );
			}
		}

		// Copy the events from the original to the clone
		if ( dataAndEvents ) {
			if ( deepDataAndEvents ) {
				srcElements = srcElements || getAll( elem );
				destElements = destElements || getAll( clone );

				for ( i = 0, l = srcElements.length; i < l; i++ ) {
					cloneCopyEvent( srcElements[ i ], destElements[ i ] );
				}
			} else {
				cloneCopyEvent( elem, clone );
			}
		}

		// Preserve script evaluation history
		destElements = getAll( clone, "script" );
		if ( destElements.length > 0 ) {
			setGlobalEval( destElements, !inPage && getAll( elem, "script" ) );
		}

		// Return the cloned set
		return clone;
	},

	buildFragment: function( elems, context, scripts, selection ) {
		var elem, tmp, tag, wrap, contains, j,
			fragment = context.createDocumentFragment(),
			nodes = [],
			i = 0,
			l = elems.length;

		for ( ; i < l; i++ ) {
			elem = elems[ i ];

			if ( elem || elem === 0 ) {

				// Add nodes directly
				if ( jQuery.type( elem ) === "object" ) {
					// Support: QtWebKit
					// jQuery.merge because push.apply(_, arraylike) throws
					jQuery.merge( nodes, elem.nodeType ? [ elem ] : elem );

				// Convert non-html into a text node
				} else if ( !rhtml.test( elem ) ) {
					nodes.push( context.createTextNode( elem ) );

				// Convert html into DOM nodes
				} else {
					tmp = tmp || fragment.appendChild( context.createElement("div") );

					// Deserialize a standard representation
					tag = ( rtagName.exec( elem ) || [ "", "" ] )[ 1 ].toLowerCase();
					wrap = wrapMap[ tag ] || wrapMap._default;
					tmp.innerHTML = wrap[ 1 ] + elem.replace( rxhtmlTag, "<$1></$2>" ) + wrap[ 2 ];

					// Descend through wrappers to the right content
					j = wrap[ 0 ];
					while ( j-- ) {
						tmp = tmp.lastChild;
					}

					// Support: QtWebKit
					// jQuery.merge because push.apply(_, arraylike) throws
					jQuery.merge( nodes, tmp.childNodes );

					// Remember the top-level container
					tmp = fragment.firstChild;

					// Fixes #12346
					// Support: Webkit, IE
					tmp.textContent = "";
				}
			}
		}

		// Remove wrapper from fragment
		fragment.textContent = "";

		i = 0;
		while ( (elem = nodes[ i++ ]) ) {

			// #4087 - If origin and destination elements are the same, and this is
			// that element, do not do anything
			if ( selection && jQuery.inArray( elem, selection ) !== -1 ) {
				continue;
			}

			contains = jQuery.contains( elem.ownerDocument, elem );

			// Append to fragment
			tmp = getAll( fragment.appendChild( elem ), "script" );

			// Preserve script evaluation history
			if ( contains ) {
				setGlobalEval( tmp );
			}

			// Capture executables
			if ( scripts ) {
				j = 0;
				while ( (elem = tmp[ j++ ]) ) {
					if ( rscriptType.test( elem.type || "" ) ) {
						scripts.push( elem );
					}
				}
			}
		}

		return fragment;
	},

	cleanData: function( elems ) {
		var data, elem, events, type, key, j,
			special = jQuery.event.special,
			i = 0;

		for ( ; (elem = elems[ i ]) !== undefined; i++ ) {
			if ( jQuery.acceptData( elem ) ) {
				key = elem[ data_priv.expando ];

				if ( key && (data = data_priv.cache[ key ]) ) {
					events = Object.keys( data.events || {} );
					if ( events.length ) {
						for ( j = 0; (type = events[j]) !== undefined; j++ ) {
							if ( special[ type ] ) {
								jQuery.event.remove( elem, type );

							// This is a shortcut to avoid jQuery.event.remove's overhead
							} else {
								jQuery.removeEvent( elem, type, data.handle );
							}
						}
					}
					if ( data_priv.cache[ key ] ) {
						// Discard any remaining `private` data
						delete data_priv.cache[ key ];
					}
				}
			}
			// Discard any remaining `user` data
			delete data_user.cache[ elem[ data_user.expando ] ];
		}
	}
});

jQuery.fn.extend({
	text: function( value ) {
		return access( this, function( value ) {
			return value === undefined ?
				jQuery.text( this ) :
				this.empty().each(function() {
					if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
						this.textContent = value;
					}
				});
		}, null, value, arguments.length );
	},

	append: function() {
		return this.domManip( arguments, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				var target = manipulationTarget( this, elem );
				target.appendChild( elem );
			}
		});
	},

	prepend: function() {
		return this.domManip( arguments, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				var target = manipulationTarget( this, elem );
				target.insertBefore( elem, target.firstChild );
			}
		});
	},

	before: function() {
		return this.domManip( arguments, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this );
			}
		});
	},

	after: function() {
		return this.domManip( arguments, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this.nextSibling );
			}
		});
	},

	remove: function( selector, keepData /* Internal Use Only */ ) {
		var elem,
			elems = selector ? jQuery.filter( selector, this ) : this,
			i = 0;

		for ( ; (elem = elems[i]) != null; i++ ) {
			if ( !keepData && elem.nodeType === 1 ) {
				jQuery.cleanData( getAll( elem ) );
			}

			if ( elem.parentNode ) {
				if ( keepData && jQuery.contains( elem.ownerDocument, elem ) ) {
					setGlobalEval( getAll( elem, "script" ) );
				}
				elem.parentNode.removeChild( elem );
			}
		}

		return this;
	},

	empty: function() {
		var elem,
			i = 0;

		for ( ; (elem = this[i]) != null; i++ ) {
			if ( elem.nodeType === 1 ) {

				// Prevent memory leaks
				jQuery.cleanData( getAll( elem, false ) );

				// Remove any remaining nodes
				elem.textContent = "";
			}
		}

		return this;
	},

	clone: function( dataAndEvents, deepDataAndEvents ) {
		dataAndEvents = dataAndEvents == null ? false : dataAndEvents;
		deepDataAndEvents = deepDataAndEvents == null ? dataAndEvents : deepDataAndEvents;

		return this.map(function() {
			return jQuery.clone( this, dataAndEvents, deepDataAndEvents );
		});
	},

	html: function( value ) {
		return access( this, function( value ) {
			var elem = this[ 0 ] || {},
				i = 0,
				l = this.length;

			if ( value === undefined && elem.nodeType === 1 ) {
				return elem.innerHTML;
			}

			// See if we can take a shortcut and just use innerHTML
			if ( typeof value === "string" && !rnoInnerhtml.test( value ) &&
				!wrapMap[ ( rtagName.exec( value ) || [ "", "" ] )[ 1 ].toLowerCase() ] ) {

				value = value.replace( rxhtmlTag, "<$1></$2>" );

				try {
					for ( ; i < l; i++ ) {
						elem = this[ i ] || {};

						// Remove element nodes and prevent memory leaks
						if ( elem.nodeType === 1 ) {
							jQuery.cleanData( getAll( elem, false ) );
							elem.innerHTML = value;
						}
					}

					elem = 0;

				// If using innerHTML throws an exception, use the fallback method
				} catch( e ) {}
			}

			if ( elem ) {
				this.empty().append( value );
			}
		}, null, value, arguments.length );
	},

	replaceWith: function() {
		var arg = arguments[ 0 ];

		// Make the changes, replacing each context element with the new content
		this.domManip( arguments, function( elem ) {
			arg = this.parentNode;

			jQuery.cleanData( getAll( this ) );

			if ( arg ) {
				arg.replaceChild( elem, this );
			}
		});

		// Force removal if there was no new content (e.g., from empty arguments)
		return arg && (arg.length || arg.nodeType) ? this : this.remove();
	},

	detach: function( selector ) {
		return this.remove( selector, true );
	},

	domManip: function( args, callback ) {

		// Flatten any nested arrays
		args = concat.apply( [], args );

		var fragment, first, scripts, hasScripts, node, doc,
			i = 0,
			l = this.length,
			set = this,
			iNoClone = l - 1,
			value = args[ 0 ],
			isFunction = jQuery.isFunction( value );

		// We can't cloneNode fragments that contain checked, in WebKit
		if ( isFunction ||
				( l > 1 && typeof value === "string" &&
					!support.checkClone && rchecked.test( value ) ) ) {
			return this.each(function( index ) {
				var self = set.eq( index );
				if ( isFunction ) {
					args[ 0 ] = value.call( this, index, self.html() );
				}
				self.domManip( args, callback );
			});
		}

		if ( l ) {
			fragment = jQuery.buildFragment( args, this[ 0 ].ownerDocument, false, this );
			first = fragment.firstChild;

			if ( fragment.childNodes.length === 1 ) {
				fragment = first;
			}

			if ( first ) {
				scripts = jQuery.map( getAll( fragment, "script" ), disableScript );
				hasScripts = scripts.length;

				// Use the original fragment for the last item instead of the first because it can end up
				// being emptied incorrectly in certain situations (#8070).
				for ( ; i < l; i++ ) {
					node = fragment;

					if ( i !== iNoClone ) {
						node = jQuery.clone( node, true, true );

						// Keep references to cloned scripts for later restoration
						if ( hasScripts ) {
							// Support: QtWebKit
							// jQuery.merge because push.apply(_, arraylike) throws
							jQuery.merge( scripts, getAll( node, "script" ) );
						}
					}

					callback.call( this[ i ], node, i );
				}

				if ( hasScripts ) {
					doc = scripts[ scripts.length - 1 ].ownerDocument;

					// Reenable scripts
					jQuery.map( scripts, restoreScript );

					// Evaluate executable scripts on first document insertion
					for ( i = 0; i < hasScripts; i++ ) {
						node = scripts[ i ];
						if ( rscriptType.test( node.type || "" ) &&
							!data_priv.access( node, "globalEval" ) && jQuery.contains( doc, node ) ) {

							if ( node.src ) {
								// Optional AJAX dependency, but won't run scripts if not present
								if ( jQuery._evalUrl ) {
									jQuery._evalUrl( node.src );
								}
							} else {
								jQuery.globalEval( node.textContent.replace( rcleanScript, "" ) );
							}
						}
					}
				}
			}
		}

		return this;
	}
});

jQuery.each({
	appendTo: "append",
	prependTo: "prepend",
	insertBefore: "before",
	insertAfter: "after",
	replaceAll: "replaceWith"
}, function( name, original ) {
	jQuery.fn[ name ] = function( selector ) {
		var elems,
			ret = [],
			insert = jQuery( selector ),
			last = insert.length - 1,
			i = 0;

		for ( ; i <= last; i++ ) {
			elems = i === last ? this : this.clone( true );
			jQuery( insert[ i ] )[ original ]( elems );

			// Support: QtWebKit
			// .get() because push.apply(_, arraylike) throws
			push.apply( ret, elems.get() );
		}

		return this.pushStack( ret );
	};
});


var iframe,
	elemdisplay = {};

/**
 * Retrieve the actual display of a element
 * @param {String} name nodeName of the element
 * @param {Object} doc Document object
 */
// Called only from within defaultDisplay
function actualDisplay( name, doc ) {
	var elem = jQuery( doc.createElement( name ) ).appendTo( doc.body ),

		// getDefaultComputedStyle might be reliably used only on attached element
		display = window.getDefaultComputedStyle ?

			// Use of this method is a temporary fix (more like optmization) until something better comes along,
			// since it was removed from specification and supported only in FF
			window.getDefaultComputedStyle( elem[ 0 ] ).display : jQuery.css( elem[ 0 ], "display" );

	// We don't have any data stored on the element,
	// so use "detach" method as fast way to get rid of the element
	elem.detach();

	return display;
}

/**
 * Try to determine the default display value of an element
 * @param {String} nodeName
 */
function defaultDisplay( nodeName ) {
	var doc = document,
		display = elemdisplay[ nodeName ];

	if ( !display ) {
		display = actualDisplay( nodeName, doc );

		// If the simple way fails, read from inside an iframe
		if ( display === "none" || !display ) {

			// Use the already-created iframe if possible
			iframe = (iframe || jQuery( "<iframe frameborder='0' width='0' height='0'/>" )).appendTo( doc.documentElement );

			// Always write a new HTML skeleton so Webkit and Firefox don't choke on reuse
			doc = iframe[ 0 ].contentDocument;

			// Support: IE
			doc.write();
			doc.close();

			display = actualDisplay( nodeName, doc );
			iframe.detach();
		}

		// Store the correct default display
		elemdisplay[ nodeName ] = display;
	}

	return display;
}
var rmargin = (/^margin/);

var rnumnonpx = new RegExp( "^(" + pnum + ")(?!px)[a-z%]+$", "i" );

var getStyles = function( elem ) {
		return elem.ownerDocument.defaultView.getComputedStyle( elem, null );
	};



function curCSS( elem, name, computed ) {
	var width, minWidth, maxWidth, ret,
		style = elem.style;

	computed = computed || getStyles( elem );

	// Support: IE9
	// getPropertyValue is only needed for .css('filter') in IE9, see #12537
	if ( computed ) {
		ret = computed.getPropertyValue( name ) || computed[ name ];
	}

	if ( computed ) {

		if ( ret === "" && !jQuery.contains( elem.ownerDocument, elem ) ) {
			ret = jQuery.style( elem, name );
		}

		// Support: iOS < 6
		// A tribute to the "awesome hack by Dean Edwards"
		// iOS < 6 (at least) returns percentage for a larger set of values, but width seems to be reliably pixels
		// this is against the CSSOM draft spec: http://dev.w3.org/csswg/cssom/#resolved-values
		if ( rnumnonpx.test( ret ) && rmargin.test( name ) ) {

			// Remember the original values
			width = style.width;
			minWidth = style.minWidth;
			maxWidth = style.maxWidth;

			// Put in the new values to get a computed value out
			style.minWidth = style.maxWidth = style.width = ret;
			ret = computed.width;

			// Revert the changed values
			style.width = width;
			style.minWidth = minWidth;
			style.maxWidth = maxWidth;
		}
	}

	return ret !== undefined ?
		// Support: IE
		// IE returns zIndex value as an integer.
		ret + "" :
		ret;
}


function addGetHookIf( conditionFn, hookFn ) {
	// Define the hook, we'll check on the first run if it's really needed.
	return {
		get: function() {
			if ( conditionFn() ) {
				// Hook not needed (or it's not possible to use it due to missing dependency),
				// remove it.
				// Since there are no other hooks for marginRight, remove the whole object.
				delete this.get;
				return;
			}

			// Hook needed; redefine it so that the support test is not executed again.

			return (this.get = hookFn).apply( this, arguments );
		}
	};
}


(function() {
	var pixelPositionVal, boxSizingReliableVal,
		// Support: Firefox, Android 2.3 (Prefixed box-sizing versions).
		divReset = "padding:0;margin:0;border:0;display:block;-webkit-box-sizing:content-box;" +
			"-moz-box-sizing:content-box;box-sizing:content-box",
		docElem = document.documentElement,
		container = document.createElement( "div" ),
		div = document.createElement( "div" );

	div.style.backgroundClip = "content-box";
	div.cloneNode( true ).style.backgroundClip = "";
	support.clearCloneStyle = div.style.backgroundClip === "content-box";

	container.style.cssText = "border:0;width:0;height:0;position:absolute;top:0;left:-9999px;" +
		"margin-top:1px";
	container.appendChild( div );

	// Executing both pixelPosition & boxSizingReliable tests require only one layout
	// so they're executed at the same time to save the second computation.
	function computePixelPositionAndBoxSizingReliable() {
		// Support: Firefox, Android 2.3 (Prefixed box-sizing versions).
		div.style.cssText = "-webkit-box-sizing:border-box;-moz-box-sizing:border-box;" +
			"box-sizing:border-box;padding:1px;border:1px;display:block;width:4px;margin-top:1%;" +
			"position:absolute;top:1%";
		docElem.appendChild( container );

		var divStyle = window.getComputedStyle( div, null );
		pixelPositionVal = divStyle.top !== "1%";
		boxSizingReliableVal = divStyle.width === "4px";

		docElem.removeChild( container );
	}

	// Use window.getComputedStyle because jsdom on node.js will break without it.
	if ( window.getComputedStyle ) {
		jQuery.extend(support, {
			pixelPosition: function() {
				// This test is executed only once but we still do memoizing
				// since we can use the boxSizingReliable pre-computing.
				// No need to check if the test was already performed, though.
				computePixelPositionAndBoxSizingReliable();
				return pixelPositionVal;
			},
			boxSizingReliable: function() {
				if ( boxSizingReliableVal == null ) {
					computePixelPositionAndBoxSizingReliable();
				}
				return boxSizingReliableVal;
			},
			reliableMarginRight: function() {
				// Support: Android 2.3
				// Check if div with explicit width and no margin-right incorrectly
				// gets computed margin-right based on width of container. (#3333)
				// WebKit Bug 13343 - getComputedStyle returns wrong value for margin-right
				// This support function is only executed once so no memoizing is needed.
				var ret,
					marginDiv = div.appendChild( document.createElement( "div" ) );
				marginDiv.style.cssText = div.style.cssText = divReset;
				marginDiv.style.marginRight = marginDiv.style.width = "0";
				div.style.width = "1px";
				docElem.appendChild( container );

				ret = !parseFloat( window.getComputedStyle( marginDiv, null ).marginRight );

				docElem.removeChild( container );

				// Clean up the div for other support tests.
				div.innerHTML = "";

				return ret;
			}
		});
	}
})();


// A method for quickly swapping in/out CSS properties to get correct calculations.
jQuery.swap = function( elem, options, callback, args ) {
	var ret, name,
		old = {};

	// Remember the old values, and insert the new ones
	for ( name in options ) {
		old[ name ] = elem.style[ name ];
		elem.style[ name ] = options[ name ];
	}

	ret = callback.apply( elem, args || [] );

	// Revert the old values
	for ( name in options ) {
		elem.style[ name ] = old[ name ];
	}

	return ret;
};


var
	// swappable if display is none or starts with table except "table", "table-cell", or "table-caption"
	// see here for display values: https://developer.mozilla.org/en-US/docs/CSS/display
	rdisplayswap = /^(none|table(?!-c[ea]).+)/,
	rnumsplit = new RegExp( "^(" + pnum + ")(.*)$", "i" ),
	rrelNum = new RegExp( "^([+-])=(" + pnum + ")", "i" ),

	cssShow = { position: "absolute", visibility: "hidden", display: "block" },
	cssNormalTransform = {
		letterSpacing: 0,
		fontWeight: 400
	},

	cssPrefixes = [ "Webkit", "O", "Moz", "ms" ];

// return a css property mapped to a potentially vendor prefixed property
function vendorPropName( style, name ) {

	// shortcut for names that are not vendor prefixed
	if ( name in style ) {
		return name;
	}

	// check for vendor prefixed names
	var capName = name[0].toUpperCase() + name.slice(1),
		origName = name,
		i = cssPrefixes.length;

	while ( i-- ) {
		name = cssPrefixes[ i ] + capName;
		if ( name in style ) {
			return name;
		}
	}

	return origName;
}

function setPositiveNumber( elem, value, subtract ) {
	var matches = rnumsplit.exec( value );
	return matches ?
		// Guard against undefined "subtract", e.g., when used as in cssHooks
		Math.max( 0, matches[ 1 ] - ( subtract || 0 ) ) + ( matches[ 2 ] || "px" ) :
		value;
}

function augmentWidthOrHeight( elem, name, extra, isBorderBox, styles ) {
	var i = extra === ( isBorderBox ? "border" : "content" ) ?
		// If we already have the right measurement, avoid augmentation
		4 :
		// Otherwise initialize for horizontal or vertical properties
		name === "width" ? 1 : 0,

		val = 0;

	for ( ; i < 4; i += 2 ) {
		// both box models exclude margin, so add it if we want it
		if ( extra === "margin" ) {
			val += jQuery.css( elem, extra + cssExpand[ i ], true, styles );
		}

		if ( isBorderBox ) {
			// border-box includes padding, so remove it if we want content
			if ( extra === "content" ) {
				val -= jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );
			}

			// at this point, extra isn't border nor margin, so remove border
			if ( extra !== "margin" ) {
				val -= jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}
		} else {
			// at this point, extra isn't content, so add padding
			val += jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );

			// at this point, extra isn't content nor padding, so add border
			if ( extra !== "padding" ) {
				val += jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}
		}
	}

	return val;
}

function getWidthOrHeight( elem, name, extra ) {

	// Start with offset property, which is equivalent to the border-box value
	var valueIsBorderBox = true,
		val = name === "width" ? elem.offsetWidth : elem.offsetHeight,
		styles = getStyles( elem ),
		isBorderBox = jQuery.css( elem, "boxSizing", false, styles ) === "border-box";

	// some non-html elements return undefined for offsetWidth, so check for null/undefined
	// svg - https://bugzilla.mozilla.org/show_bug.cgi?id=649285
	// MathML - https://bugzilla.mozilla.org/show_bug.cgi?id=491668
	if ( val <= 0 || val == null ) {
		// Fall back to computed then uncomputed css if necessary
		val = curCSS( elem, name, styles );
		if ( val < 0 || val == null ) {
			val = elem.style[ name ];
		}

		// Computed unit is not pixels. Stop here and return.
		if ( rnumnonpx.test(val) ) {
			return val;
		}

		// we need the check for style in case a browser which returns unreliable values
		// for getComputedStyle silently falls back to the reliable elem.style
		valueIsBorderBox = isBorderBox &&
			( support.boxSizingReliable() || val === elem.style[ name ] );

		// Normalize "", auto, and prepare for extra
		val = parseFloat( val ) || 0;
	}

	// use the active box-sizing model to add/subtract irrelevant styles
	return ( val +
		augmentWidthOrHeight(
			elem,
			name,
			extra || ( isBorderBox ? "border" : "content" ),
			valueIsBorderBox,
			styles
		)
	) + "px";
}

function showHide( elements, show ) {
	var display, elem, hidden,
		values = [],
		index = 0,
		length = elements.length;

	for ( ; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}

		values[ index ] = data_priv.get( elem, "olddisplay" );
		display = elem.style.display;
		if ( show ) {
			// Reset the inline display of this element to learn if it is
			// being hidden by cascaded rules or not
			if ( !values[ index ] && display === "none" ) {
				elem.style.display = "";
			}

			// Set elements which have been overridden with display: none
			// in a stylesheet to whatever the default browser style is
			// for such an element
			if ( elem.style.display === "" && isHidden( elem ) ) {
				values[ index ] = data_priv.access( elem, "olddisplay", defaultDisplay(elem.nodeName) );
			}
		} else {

			if ( !values[ index ] ) {
				hidden = isHidden( elem );

				if ( display && display !== "none" || !hidden ) {
					data_priv.set( elem, "olddisplay", hidden ? display : jQuery.css(elem, "display") );
				}
			}
		}
	}

	// Set the display of most of the elements in a second loop
	// to avoid the constant reflow
	for ( index = 0; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}
		if ( !show || elem.style.display === "none" || elem.style.display === "" ) {
			elem.style.display = show ? values[ index ] || "" : "none";
		}
	}

	return elements;
}

jQuery.extend({
	// Add in style property hooks for overriding the default
	// behavior of getting and setting a style property
	cssHooks: {
		opacity: {
			get: function( elem, computed ) {
				if ( computed ) {
					// We should always get a number back from opacity
					var ret = curCSS( elem, "opacity" );
					return ret === "" ? "1" : ret;
				}
			}
		}
	},

	// Don't automatically add "px" to these possibly-unitless properties
	cssNumber: {
		"columnCount": true,
		"fillOpacity": true,
		"fontWeight": true,
		"lineHeight": true,
		"opacity": true,
		"order": true,
		"orphans": true,
		"widows": true,
		"zIndex": true,
		"zoom": true
	},

	// Add in properties whose names you wish to fix before
	// setting or getting the value
	cssProps: {
		// normalize float css property
		"float": "cssFloat"
	},

	// Get and set the style property on a DOM Node
	style: function( elem, name, value, extra ) {
		// Don't set styles on text and comment nodes
		if ( !elem || elem.nodeType === 3 || elem.nodeType === 8 || !elem.style ) {
			return;
		}

		// Make sure that we're working with the right name
		var ret, type, hooks,
			origName = jQuery.camelCase( name ),
			style = elem.style;

		name = jQuery.cssProps[ origName ] || ( jQuery.cssProps[ origName ] = vendorPropName( style, origName ) );

		// gets hook for the prefixed version
		// followed by the unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// Check if we're setting a value
		if ( value !== undefined ) {
			type = typeof value;

			// convert relative number strings (+= or -=) to relative numbers. #7345
			if ( type === "string" && (ret = rrelNum.exec( value )) ) {
				value = ( ret[1] + 1 ) * ret[2] + parseFloat( jQuery.css( elem, name ) );
				// Fixes bug #9237
				type = "number";
			}

			// Make sure that null and NaN values aren't set. See: #7116
			if ( value == null || value !== value ) {
				return;
			}

			// If a number was passed in, add 'px' to the (except for certain CSS properties)
			if ( type === "number" && !jQuery.cssNumber[ origName ] ) {
				value += "px";
			}

			// Fixes #8908, it can be done more correctly by specifying setters in cssHooks,
			// but it would mean to define eight (for every problematic property) identical functions
			if ( !support.clearCloneStyle && value === "" && name.indexOf( "background" ) === 0 ) {
				style[ name ] = "inherit";
			}

			// If a hook was provided, use that value, otherwise just set the specified value
			if ( !hooks || !("set" in hooks) || (value = hooks.set( elem, value, extra )) !== undefined ) {
				// Support: Chrome, Safari
				// Setting style to blank string required to delete "style: x !important;"
				style[ name ] = "";
				style[ name ] = value;
			}

		} else {
			// If a hook was provided get the non-computed value from there
			if ( hooks && "get" in hooks && (ret = hooks.get( elem, false, extra )) !== undefined ) {
				return ret;
			}

			// Otherwise just get the value from the style object
			return style[ name ];
		}
	},

	css: function( elem, name, extra, styles ) {
		var val, num, hooks,
			origName = jQuery.camelCase( name );

		// Make sure that we're working with the right name
		name = jQuery.cssProps[ origName ] || ( jQuery.cssProps[ origName ] = vendorPropName( elem.style, origName ) );

		// gets hook for the prefixed version
		// followed by the unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// If a hook was provided get the computed value from there
		if ( hooks && "get" in hooks ) {
			val = hooks.get( elem, true, extra );
		}

		// Otherwise, if a way to get the computed value exists, use that
		if ( val === undefined ) {
			val = curCSS( elem, name, styles );
		}

		//convert "normal" to computed value
		if ( val === "normal" && name in cssNormalTransform ) {
			val = cssNormalTransform[ name ];
		}

		// Return, converting to number if forced or a qualifier was provided and val looks numeric
		if ( extra === "" || extra ) {
			num = parseFloat( val );
			return extra === true || jQuery.isNumeric( num ) ? num || 0 : val;
		}
		return val;
	}
});

jQuery.each([ "height", "width" ], function( i, name ) {
	jQuery.cssHooks[ name ] = {
		get: function( elem, computed, extra ) {
			if ( computed ) {
				// certain elements can have dimension info if we invisibly show them
				// however, it must have a current display style that would benefit from this
				return elem.offsetWidth === 0 && rdisplayswap.test( jQuery.css( elem, "display" ) ) ?
					jQuery.swap( elem, cssShow, function() {
						return getWidthOrHeight( elem, name, extra );
					}) :
					getWidthOrHeight( elem, name, extra );
			}
		},

		set: function( elem, value, extra ) {
			var styles = extra && getStyles( elem );
			return setPositiveNumber( elem, value, extra ?
				augmentWidthOrHeight(
					elem,
					name,
					extra,
					jQuery.css( elem, "boxSizing", false, styles ) === "border-box",
					styles
				) : 0
			);
		}
	};
});

// Support: Android 2.3
jQuery.cssHooks.marginRight = addGetHookIf( support.reliableMarginRight,
	function( elem, computed ) {
		if ( computed ) {
			// WebKit Bug 13343 - getComputedStyle returns wrong value for margin-right
			// Work around by temporarily setting element display to inline-block
			return jQuery.swap( elem, { "display": "inline-block" },
				curCSS, [ elem, "marginRight" ] );
		}
	}
);

// These hooks are used by animate to expand properties
jQuery.each({
	margin: "",
	padding: "",
	border: "Width"
}, function( prefix, suffix ) {
	jQuery.cssHooks[ prefix + suffix ] = {
		expand: function( value ) {
			var i = 0,
				expanded = {},

				// assumes a single number if not a string
				parts = typeof value === "string" ? value.split(" ") : [ value ];

			for ( ; i < 4; i++ ) {
				expanded[ prefix + cssExpand[ i ] + suffix ] =
					parts[ i ] || parts[ i - 2 ] || parts[ 0 ];
			}

			return expanded;
		}
	};

	if ( !rmargin.test( prefix ) ) {
		jQuery.cssHooks[ prefix + suffix ].set = setPositiveNumber;
	}
});

jQuery.fn.extend({
	css: function( name, value ) {
		return access( this, function( elem, name, value ) {
			var styles, len,
				map = {},
				i = 0;

			if ( jQuery.isArray( name ) ) {
				styles = getStyles( elem );
				len = name.length;

				for ( ; i < len; i++ ) {
					map[ name[ i ] ] = jQuery.css( elem, name[ i ], false, styles );
				}

				return map;
			}

			return value !== undefined ?
				jQuery.style( elem, name, value ) :
				jQuery.css( elem, name );
		}, name, value, arguments.length > 1 );
	},
	show: function() {
		return showHide( this, true );
	},
	hide: function() {
		return showHide( this );
	},
	toggle: function( state ) {
		if ( typeof state === "boolean" ) {
			return state ? this.show() : this.hide();
		}

		return this.each(function() {
			if ( isHidden( this ) ) {
				jQuery( this ).show();
			} else {
				jQuery( this ).hide();
			}
		});
	}
});


function Tween( elem, options, prop, end, easing ) {
	return new Tween.prototype.init( elem, options, prop, end, easing );
}
jQuery.Tween = Tween;

Tween.prototype = {
	constructor: Tween,
	init: function( elem, options, prop, end, easing, unit ) {
		this.elem = elem;
		this.prop = prop;
		this.easing = easing || "swing";
		this.options = options;
		this.start = this.now = this.cur();
		this.end = end;
		this.unit = unit || ( jQuery.cssNumber[ prop ] ? "" : "px" );
	},
	cur: function() {
		var hooks = Tween.propHooks[ this.prop ];

		return hooks && hooks.get ?
			hooks.get( this ) :
			Tween.propHooks._default.get( this );
	},
	run: function( percent ) {
		var eased,
			hooks = Tween.propHooks[ this.prop ];

		if ( this.options.duration ) {
			this.pos = eased = jQuery.easing[ this.easing ](
				percent, this.options.duration * percent, 0, 1, this.options.duration
			);
		} else {
			this.pos = eased = percent;
		}
		this.now = ( this.end - this.start ) * eased + this.start;

		if ( this.options.step ) {
			this.options.step.call( this.elem, this.now, this );
		}

		if ( hooks && hooks.set ) {
			hooks.set( this );
		} else {
			Tween.propHooks._default.set( this );
		}
		return this;
	}
};

Tween.prototype.init.prototype = Tween.prototype;

Tween.propHooks = {
	_default: {
		get: function( tween ) {
			var result;

			if ( tween.elem[ tween.prop ] != null &&
				(!tween.elem.style || tween.elem.style[ tween.prop ] == null) ) {
				return tween.elem[ tween.prop ];
			}

			// passing an empty string as a 3rd parameter to .css will automatically
			// attempt a parseFloat and fallback to a string if the parse fails
			// so, simple values such as "10px" are parsed to Float.
			// complex values such as "rotate(1rad)" are returned as is.
			result = jQuery.css( tween.elem, tween.prop, "" );
			// Empty strings, null, undefined and "auto" are converted to 0.
			return !result || result === "auto" ? 0 : result;
		},
		set: function( tween ) {
			// use step hook for back compat - use cssHook if its there - use .style if its
			// available and use plain properties where available
			if ( jQuery.fx.step[ tween.prop ] ) {
				jQuery.fx.step[ tween.prop ]( tween );
			} else if ( tween.elem.style && ( tween.elem.style[ jQuery.cssProps[ tween.prop ] ] != null || jQuery.cssHooks[ tween.prop ] ) ) {
				jQuery.style( tween.elem, tween.prop, tween.now + tween.unit );
			} else {
				tween.elem[ tween.prop ] = tween.now;
			}
		}
	}
};

// Support: IE9
// Panic based approach to setting things on disconnected nodes

Tween.propHooks.scrollTop = Tween.propHooks.scrollLeft = {
	set: function( tween ) {
		if ( tween.elem.nodeType && tween.elem.parentNode ) {
			tween.elem[ tween.prop ] = tween.now;
		}
	}
};

jQuery.easing = {
	linear: function( p ) {
		return p;
	},
	swing: function( p ) {
		return 0.5 - Math.cos( p * Math.PI ) / 2;
	}
};

jQuery.fx = Tween.prototype.init;

// Back Compat <1.8 extension point
jQuery.fx.step = {};




var
	fxNow, timerId,
	rfxtypes = /^(?:toggle|show|hide)$/,
	rfxnum = new RegExp( "^(?:([+-])=|)(" + pnum + ")([a-z%]*)$", "i" ),
	rrun = /queueHooks$/,
	animationPrefilters = [ defaultPrefilter ],
	tweeners = {
		"*": [ function( prop, value ) {
			var tween = this.createTween( prop, value ),
				target = tween.cur(),
				parts = rfxnum.exec( value ),
				unit = parts && parts[ 3 ] || ( jQuery.cssNumber[ prop ] ? "" : "px" ),

				// Starting value computation is required for potential unit mismatches
				start = ( jQuery.cssNumber[ prop ] || unit !== "px" && +target ) &&
					rfxnum.exec( jQuery.css( tween.elem, prop ) ),
				scale = 1,
				maxIterations = 20;

			if ( start && start[ 3 ] !== unit ) {
				// Trust units reported by jQuery.css
				unit = unit || start[ 3 ];

				// Make sure we update the tween properties later on
				parts = parts || [];

				// Iteratively approximate from a nonzero starting point
				start = +target || 1;

				do {
					// If previous iteration zeroed out, double until we get *something*
					// Use a string for doubling factor so we don't accidentally see scale as unchanged below
					scale = scale || ".5";

					// Adjust and apply
					start = start / scale;
					jQuery.style( tween.elem, prop, start + unit );

				// Update scale, tolerating zero or NaN from tween.cur()
				// And breaking the loop if scale is unchanged or perfect, or if we've just had enough
				} while ( scale !== (scale = tween.cur() / target) && scale !== 1 && --maxIterations );
			}

			// Update tween properties
			if ( parts ) {
				start = tween.start = +start || +target || 0;
				tween.unit = unit;
				// If a +=/-= token was provided, we're doing a relative animation
				tween.end = parts[ 1 ] ?
					start + ( parts[ 1 ] + 1 ) * parts[ 2 ] :
					+parts[ 2 ];
			}

			return tween;
		} ]
	};

// Animations created synchronously will run synchronously
function createFxNow() {
	setTimeout(function() {
		fxNow = undefined;
	});
	return ( fxNow = jQuery.now() );
}

// Generate parameters to create a standard animation
function genFx( type, includeWidth ) {
	var which,
		i = 0,
		attrs = { height: type };

	// if we include width, step value is 1 to do all cssExpand values,
	// if we don't include width, step value is 2 to skip over Left and Right
	includeWidth = includeWidth ? 1 : 0;
	for ( ; i < 4 ; i += 2 - includeWidth ) {
		which = cssExpand[ i ];
		attrs[ "margin" + which ] = attrs[ "padding" + which ] = type;
	}

	if ( includeWidth ) {
		attrs.opacity = attrs.width = type;
	}

	return attrs;
}

function createTween( value, prop, animation ) {
	var tween,
		collection = ( tweeners[ prop ] || [] ).concat( tweeners[ "*" ] ),
		index = 0,
		length = collection.length;
	for ( ; index < length; index++ ) {
		if ( (tween = collection[ index ].call( animation, prop, value )) ) {

			// we're done with this property
			return tween;
		}
	}
}

function defaultPrefilter( elem, props, opts ) {
	/* jshint validthis: true */
	var prop, value, toggle, tween, hooks, oldfire, display,
		anim = this,
		orig = {},
		style = elem.style,
		hidden = elem.nodeType && isHidden( elem ),
		dataShow = data_priv.get( elem, "fxshow" );

	// handle queue: false promises
	if ( !opts.queue ) {
		hooks = jQuery._queueHooks( elem, "fx" );
		if ( hooks.unqueued == null ) {
			hooks.unqueued = 0;
			oldfire = hooks.empty.fire;
			hooks.empty.fire = function() {
				if ( !hooks.unqueued ) {
					oldfire();
				}
			};
		}
		hooks.unqueued++;

		anim.always(function() {
			// doing this makes sure that the complete handler will be called
			// before this completes
			anim.always(function() {
				hooks.unqueued--;
				if ( !jQuery.queue( elem, "fx" ).length ) {
					hooks.empty.fire();
				}
			});
		});
	}

	// height/width overflow pass
	if ( elem.nodeType === 1 && ( "height" in props || "width" in props ) ) {
		// Make sure that nothing sneaks out
		// Record all 3 overflow attributes because IE9-10 do not
		// change the overflow attribute when overflowX and
		// overflowY are set to the same value
		opts.overflow = [ style.overflow, style.overflowX, style.overflowY ];

		// Set display property to inline-block for height/width
		// animations on inline elements that are having width/height animated
		display = jQuery.css( elem, "display" );
		// Get default display if display is currently "none"
		if ( display === "none" ) {
			display = defaultDisplay( elem.nodeName );
		}
		if ( display === "inline" &&
				jQuery.css( elem, "float" ) === "none" ) {

			style.display = "inline-block";
		}
	}

	if ( opts.overflow ) {
		style.overflow = "hidden";
		anim.always(function() {
			style.overflow = opts.overflow[ 0 ];
			style.overflowX = opts.overflow[ 1 ];
			style.overflowY = opts.overflow[ 2 ];
		});
	}

	// show/hide pass
	for ( prop in props ) {
		value = props[ prop ];
		if ( rfxtypes.exec( value ) ) {
			delete props[ prop ];
			toggle = toggle || value === "toggle";
			if ( value === ( hidden ? "hide" : "show" ) ) {

				// If there is dataShow left over from a stopped hide or show and we are going to proceed with show, we should pretend to be hidden
				if ( value === "show" && dataShow && dataShow[ prop ] !== undefined ) {
					hidden = true;
				} else {
					continue;
				}
			}
			orig[ prop ] = dataShow && dataShow[ prop ] || jQuery.style( elem, prop );
		}
	}

	if ( !jQuery.isEmptyObject( orig ) ) {
		if ( dataShow ) {
			if ( "hidden" in dataShow ) {
				hidden = dataShow.hidden;
			}
		} else {
			dataShow = data_priv.access( elem, "fxshow", {} );
		}

		// store state if its toggle - enables .stop().toggle() to "reverse"
		if ( toggle ) {
			dataShow.hidden = !hidden;
		}
		if ( hidden ) {
			jQuery( elem ).show();
		} else {
			anim.done(function() {
				jQuery( elem ).hide();
			});
		}
		anim.done(function() {
			var prop;

			data_priv.remove( elem, "fxshow" );
			for ( prop in orig ) {
				jQuery.style( elem, prop, orig[ prop ] );
			}
		});
		for ( prop in orig ) {
			tween = createTween( hidden ? dataShow[ prop ] : 0, prop, anim );

			if ( !( prop in dataShow ) ) {
				dataShow[ prop ] = tween.start;
				if ( hidden ) {
					tween.end = tween.start;
					tween.start = prop === "width" || prop === "height" ? 1 : 0;
				}
			}
		}
	}
}

function propFilter( props, specialEasing ) {
	var index, name, easing, value, hooks;

	// camelCase, specialEasing and expand cssHook pass
	for ( index in props ) {
		name = jQuery.camelCase( index );
		easing = specialEasing[ name ];
		value = props[ index ];
		if ( jQuery.isArray( value ) ) {
			easing = value[ 1 ];
			value = props[ index ] = value[ 0 ];
		}

		if ( index !== name ) {
			props[ name ] = value;
			delete props[ index ];
		}

		hooks = jQuery.cssHooks[ name ];
		if ( hooks && "expand" in hooks ) {
			value = hooks.expand( value );
			delete props[ name ];

			// not quite $.extend, this wont overwrite keys already present.
			// also - reusing 'index' from above because we have the correct "name"
			for ( index in value ) {
				if ( !( index in props ) ) {
					props[ index ] = value[ index ];
					specialEasing[ index ] = easing;
				}
			}
		} else {
			specialEasing[ name ] = easing;
		}
	}
}

function Animation( elem, properties, options ) {
	var result,
		stopped,
		index = 0,
		length = animationPrefilters.length,
		deferred = jQuery.Deferred().always( function() {
			// don't match elem in the :animated selector
			delete tick.elem;
		}),
		tick = function() {
			if ( stopped ) {
				return false;
			}
			var currentTime = fxNow || createFxNow(),
				remaining = Math.max( 0, animation.startTime + animation.duration - currentTime ),
				// archaic crash bug won't allow us to use 1 - ( 0.5 || 0 ) (#12497)
				temp = remaining / animation.duration || 0,
				percent = 1 - temp,
				index = 0,
				length = animation.tweens.length;

			for ( ; index < length ; index++ ) {
				animation.tweens[ index ].run( percent );
			}

			deferred.notifyWith( elem, [ animation, percent, remaining ]);

			if ( percent < 1 && length ) {
				return remaining;
			} else {
				deferred.resolveWith( elem, [ animation ] );
				return false;
			}
		},
		animation = deferred.promise({
			elem: elem,
			props: jQuery.extend( {}, properties ),
			opts: jQuery.extend( true, { specialEasing: {} }, options ),
			originalProperties: properties,
			originalOptions: options,
			startTime: fxNow || createFxNow(),
			duration: options.duration,
			tweens: [],
			createTween: function( prop, end ) {
				var tween = jQuery.Tween( elem, animation.opts, prop, end,
						animation.opts.specialEasing[ prop ] || animation.opts.easing );
				animation.tweens.push( tween );
				return tween;
			},
			stop: function( gotoEnd ) {
				var index = 0,
					// if we are going to the end, we want to run all the tweens
					// otherwise we skip this part
					length = gotoEnd ? animation.tweens.length : 0;
				if ( stopped ) {
					return this;
				}
				stopped = true;
				for ( ; index < length ; index++ ) {
					animation.tweens[ index ].run( 1 );
				}

				// resolve when we played the last frame
				// otherwise, reject
				if ( gotoEnd ) {
					deferred.resolveWith( elem, [ animation, gotoEnd ] );
				} else {
					deferred.rejectWith( elem, [ animation, gotoEnd ] );
				}
				return this;
			}
		}),
		props = animation.props;

	propFilter( props, animation.opts.specialEasing );

	for ( ; index < length ; index++ ) {
		result = animationPrefilters[ index ].call( animation, elem, props, animation.opts );
		if ( result ) {
			return result;
		}
	}

	jQuery.map( props, createTween, animation );

	if ( jQuery.isFunction( animation.opts.start ) ) {
		animation.opts.start.call( elem, animation );
	}

	jQuery.fx.timer(
		jQuery.extend( tick, {
			elem: elem,
			anim: animation,
			queue: animation.opts.queue
		})
	);

	// attach callbacks from options
	return animation.progress( animation.opts.progress )
		.done( animation.opts.done, animation.opts.complete )
		.fail( animation.opts.fail )
		.always( animation.opts.always );
}

jQuery.Animation = jQuery.extend( Animation, {

	tweener: function( props, callback ) {
		if ( jQuery.isFunction( props ) ) {
			callback = props;
			props = [ "*" ];
		} else {
			props = props.split(" ");
		}

		var prop,
			index = 0,
			length = props.length;

		for ( ; index < length ; index++ ) {
			prop = props[ index ];
			tweeners[ prop ] = tweeners[ prop ] || [];
			tweeners[ prop ].unshift( callback );
		}
	},

	prefilter: function( callback, prepend ) {
		if ( prepend ) {
			animationPrefilters.unshift( callback );
		} else {
			animationPrefilters.push( callback );
		}
	}
});

jQuery.speed = function( speed, easing, fn ) {
	var opt = speed && typeof speed === "object" ? jQuery.extend( {}, speed ) : {
		complete: fn || !fn && easing ||
			jQuery.isFunction( speed ) && speed,
		duration: speed,
		easing: fn && easing || easing && !jQuery.isFunction( easing ) && easing
	};

	opt.duration = jQuery.fx.off ? 0 : typeof opt.duration === "number" ? opt.duration :
		opt.duration in jQuery.fx.speeds ? jQuery.fx.speeds[ opt.duration ] : jQuery.fx.speeds._default;

	// normalize opt.queue - true/undefined/null -> "fx"
	if ( opt.queue == null || opt.queue === true ) {
		opt.queue = "fx";
	}

	// Queueing
	opt.old = opt.complete;

	opt.complete = function() {
		if ( jQuery.isFunction( opt.old ) ) {
			opt.old.call( this );
		}

		if ( opt.queue ) {
			jQuery.dequeue( this, opt.queue );
		}
	};

	return opt;
};

jQuery.fn.extend({
	fadeTo: function( speed, to, easing, callback ) {

		// show any hidden elements after setting opacity to 0
		return this.filter( isHidden ).css( "opacity", 0 ).show()

			// animate to the value specified
			.end().animate({ opacity: to }, speed, easing, callback );
	},
	animate: function( prop, speed, easing, callback ) {
		var empty = jQuery.isEmptyObject( prop ),
			optall = jQuery.speed( speed, easing, callback ),
			doAnimation = function() {
				// Operate on a copy of prop so per-property easing won't be lost
				var anim = Animation( this, jQuery.extend( {}, prop ), optall );

				// Empty animations, or finishing resolves immediately
				if ( empty || data_priv.get( this, "finish" ) ) {
					anim.stop( true );
				}
			};
			doAnimation.finish = doAnimation;

		return empty || optall.queue === false ?
			this.each( doAnimation ) :
			this.queue( optall.queue, doAnimation );
	},
	stop: function( type, clearQueue, gotoEnd ) {
		var stopQueue = function( hooks ) {
			var stop = hooks.stop;
			delete hooks.stop;
			stop( gotoEnd );
		};

		if ( typeof type !== "string" ) {
			gotoEnd = clearQueue;
			clearQueue = type;
			type = undefined;
		}
		if ( clearQueue && type !== false ) {
			this.queue( type || "fx", [] );
		}

		return this.each(function() {
			var dequeue = true,
				index = type != null && type + "queueHooks",
				timers = jQuery.timers,
				data = data_priv.get( this );

			if ( index ) {
				if ( data[ index ] && data[ index ].stop ) {
					stopQueue( data[ index ] );
				}
			} else {
				for ( index in data ) {
					if ( data[ index ] && data[ index ].stop && rrun.test( index ) ) {
						stopQueue( data[ index ] );
					}
				}
			}

			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this && (type == null || timers[ index ].queue === type) ) {
					timers[ index ].anim.stop( gotoEnd );
					dequeue = false;
					timers.splice( index, 1 );
				}
			}

			// start the next in the queue if the last step wasn't forced
			// timers currently will call their complete callbacks, which will dequeue
			// but only if they were gotoEnd
			if ( dequeue || !gotoEnd ) {
				jQuery.dequeue( this, type );
			}
		});
	},
	finish: function( type ) {
		if ( type !== false ) {
			type = type || "fx";
		}
		return this.each(function() {
			var index,
				data = data_priv.get( this ),
				queue = data[ type + "queue" ],
				hooks = data[ type + "queueHooks" ],
				timers = jQuery.timers,
				length = queue ? queue.length : 0;

			// enable finishing flag on private data
			data.finish = true;

			// empty the queue first
			jQuery.queue( this, type, [] );

			if ( hooks && hooks.stop ) {
				hooks.stop.call( this, true );
			}

			// look for any active animations, and finish them
			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this && timers[ index ].queue === type ) {
					timers[ index ].anim.stop( true );
					timers.splice( index, 1 );
				}
			}

			// look for any animations in the old queue and finish them
			for ( index = 0; index < length; index++ ) {
				if ( queue[ index ] && queue[ index ].finish ) {
					queue[ index ].finish.call( this );
				}
			}

			// turn off finishing flag
			delete data.finish;
		});
	}
});

jQuery.each([ "toggle", "show", "hide" ], function( i, name ) {
	var cssFn = jQuery.fn[ name ];
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return speed == null || typeof speed === "boolean" ?
			cssFn.apply( this, arguments ) :
			this.animate( genFx( name, true ), speed, easing, callback );
	};
});

// Generate shortcuts for custom animations
jQuery.each({
	slideDown: genFx("show"),
	slideUp: genFx("hide"),
	slideToggle: genFx("toggle"),
	fadeIn: { opacity: "show" },
	fadeOut: { opacity: "hide" },
	fadeToggle: { opacity: "toggle" }
}, function( name, props ) {
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return this.animate( props, speed, easing, callback );
	};
});

jQuery.timers = [];
jQuery.fx.tick = function() {
	var timer,
		i = 0,
		timers = jQuery.timers;

	fxNow = jQuery.now();

	for ( ; i < timers.length; i++ ) {
		timer = timers[ i ];
		// Checks the timer has not already been removed
		if ( !timer() && timers[ i ] === timer ) {
			timers.splice( i--, 1 );
		}
	}

	if ( !timers.length ) {
		jQuery.fx.stop();
	}
	fxNow = undefined;
};

jQuery.fx.timer = function( timer ) {
	jQuery.timers.push( timer );
	if ( timer() ) {
		jQuery.fx.start();
	} else {
		jQuery.timers.pop();
	}
};

jQuery.fx.interval = 13;

jQuery.fx.start = function() {
	if ( !timerId ) {
		timerId = setInterval( jQuery.fx.tick, jQuery.fx.interval );
	}
};

jQuery.fx.stop = function() {
	clearInterval( timerId );
	timerId = null;
};

jQuery.fx.speeds = {
	slow: 600,
	fast: 200,
	// Default speed
	_default: 400
};


// Based off of the plugin by Clint Helfers, with permission.
// http://blindsignals.com/index.php/2009/07/jquery-delay/
jQuery.fn.delay = function( time, type ) {
	time = jQuery.fx ? jQuery.fx.speeds[ time ] || time : time;
	type = type || "fx";

	return this.queue( type, function( next, hooks ) {
		var timeout = setTimeout( next, time );
		hooks.stop = function() {
			clearTimeout( timeout );
		};
	});
};


(function() {
	var input = document.createElement( "input" ),
		select = document.createElement( "select" ),
		opt = select.appendChild( document.createElement( "option" ) );

	input.type = "checkbox";

	// Support: iOS 5.1, Android 4.x, Android 2.3
	// Check the default checkbox/radio value ("" on old WebKit; "on" elsewhere)
	support.checkOn = input.value !== "";

	// Must access the parent to make an option select properly
	// Support: IE9, IE10
	support.optSelected = opt.selected;

	// Make sure that the options inside disabled selects aren't marked as disabled
	// (WebKit marks them as disabled)
	select.disabled = true;
	support.optDisabled = !opt.disabled;

	// Check if an input maintains its value after becoming a radio
	// Support: IE9, IE10
	input = document.createElement( "input" );
	input.value = "t";
	input.type = "radio";
	support.radioValue = input.value === "t";
})();


var nodeHook, boolHook,
	attrHandle = jQuery.expr.attrHandle;

jQuery.fn.extend({
	attr: function( name, value ) {
		return access( this, jQuery.attr, name, value, arguments.length > 1 );
	},

	removeAttr: function( name ) {
		return this.each(function() {
			jQuery.removeAttr( this, name );
		});
	}
});

jQuery.extend({
	attr: function( elem, name, value ) {
		var hooks, ret,
			nType = elem.nodeType;

		// don't get/set attributes on text, comment and attribute nodes
		if ( !elem || nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		// Fallback to prop when attributes are not supported
		if ( typeof elem.getAttribute === strundefined ) {
			return jQuery.prop( elem, name, value );
		}

		// All attributes are lowercase
		// Grab necessary hook if one is defined
		if ( nType !== 1 || !jQuery.isXMLDoc( elem ) ) {
			name = name.toLowerCase();
			hooks = jQuery.attrHooks[ name ] ||
				( jQuery.expr.match.bool.test( name ) ? boolHook : nodeHook );
		}

		if ( value !== undefined ) {

			if ( value === null ) {
				jQuery.removeAttr( elem, name );

			} else if ( hooks && "set" in hooks && (ret = hooks.set( elem, value, name )) !== undefined ) {
				return ret;

			} else {
				elem.setAttribute( name, value + "" );
				return value;
			}

		} else if ( hooks && "get" in hooks && (ret = hooks.get( elem, name )) !== null ) {
			return ret;

		} else {
			ret = jQuery.find.attr( elem, name );

			// Non-existent attributes return null, we normalize to undefined
			return ret == null ?
				undefined :
				ret;
		}
	},

	removeAttr: function( elem, value ) {
		var name, propName,
			i = 0,
			attrNames = value && value.match( rnotwhite );

		if ( attrNames && elem.nodeType === 1 ) {
			while ( (name = attrNames[i++]) ) {
				propName = jQuery.propFix[ name ] || name;

				// Boolean attributes get special treatment (#10870)
				if ( jQuery.expr.match.bool.test( name ) ) {
					// Set corresponding property to false
					elem[ propName ] = false;
				}

				elem.removeAttribute( name );
			}
		}
	},

	attrHooks: {
		type: {
			set: function( elem, value ) {
				if ( !support.radioValue && value === "radio" &&
					jQuery.nodeName( elem, "input" ) ) {
					// Setting the type on a radio button after the value resets the value in IE6-9
					// Reset value to default in case type is set after value during creation
					var val = elem.value;
					elem.setAttribute( "type", value );
					if ( val ) {
						elem.value = val;
					}
					return value;
				}
			}
		}
	}
});

// Hooks for boolean attributes
boolHook = {
	set: function( elem, value, name ) {
		if ( value === false ) {
			// Remove boolean attributes when set to false
			jQuery.removeAttr( elem, name );
		} else {
			elem.setAttribute( name, name );
		}
		return name;
	}
};
jQuery.each( jQuery.expr.match.bool.source.match( /\w+/g ), function( i, name ) {
	var getter = attrHandle[ name ] || jQuery.find.attr;

	attrHandle[ name ] = function( elem, name, isXML ) {
		var ret, handle;
		if ( !isXML ) {
			// Avoid an infinite loop by temporarily removing this function from the getter
			handle = attrHandle[ name ];
			attrHandle[ name ] = ret;
			ret = getter( elem, name, isXML ) != null ?
				name.toLowerCase() :
				null;
			attrHandle[ name ] = handle;
		}
		return ret;
	};
});




var rfocusable = /^(?:input|select|textarea|button)$/i;

jQuery.fn.extend({
	prop: function( name, value ) {
		return access( this, jQuery.prop, name, value, arguments.length > 1 );
	},

	removeProp: function( name ) {
		return this.each(function() {
			delete this[ jQuery.propFix[ name ] || name ];
		});
	}
});

jQuery.extend({
	propFix: {
		"for": "htmlFor",
		"class": "className"
	},

	prop: function( elem, name, value ) {
		var ret, hooks, notxml,
			nType = elem.nodeType;

		// don't get/set properties on text, comment and attribute nodes
		if ( !elem || nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		notxml = nType !== 1 || !jQuery.isXMLDoc( elem );

		if ( notxml ) {
			// Fix name and attach hooks
			name = jQuery.propFix[ name ] || name;
			hooks = jQuery.propHooks[ name ];
		}

		if ( value !== undefined ) {
			return hooks && "set" in hooks && (ret = hooks.set( elem, value, name )) !== undefined ?
				ret :
				( elem[ name ] = value );

		} else {
			return hooks && "get" in hooks && (ret = hooks.get( elem, name )) !== null ?
				ret :
				elem[ name ];
		}
	},

	propHooks: {
		tabIndex: {
			get: function( elem ) {
				return elem.hasAttribute( "tabindex" ) || rfocusable.test( elem.nodeName ) || elem.href ?
					elem.tabIndex :
					-1;
			}
		}
	}
});

// Support: IE9+
// Selectedness for an option in an optgroup can be inaccurate
if ( !support.optSelected ) {
	jQuery.propHooks.selected = {
		get: function( elem ) {
			var parent = elem.parentNode;
			if ( parent && parent.parentNode ) {
				parent.parentNode.selectedIndex;
			}
			return null;
		}
	};
}

jQuery.each([
	"tabIndex",
	"readOnly",
	"maxLength",
	"cellSpacing",
	"cellPadding",
	"rowSpan",
	"colSpan",
	"useMap",
	"frameBorder",
	"contentEditable"
], function() {
	jQuery.propFix[ this.toLowerCase() ] = this;
});




var rclass = /[\t\r\n\f]/g;

jQuery.fn.extend({
	addClass: function( value ) {
		var classes, elem, cur, clazz, j, finalValue,
			proceed = typeof value === "string" && value,
			i = 0,
			len = this.length;

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( j ) {
				jQuery( this ).addClass( value.call( this, j, this.className ) );
			});
		}

		if ( proceed ) {
			// The disjunction here is for better compressibility (see removeClass)
			classes = ( value || "" ).match( rnotwhite ) || [];

			for ( ; i < len; i++ ) {
				elem = this[ i ];
				cur = elem.nodeType === 1 && ( elem.className ?
					( " " + elem.className + " " ).replace( rclass, " " ) :
					" "
				);

				if ( cur ) {
					j = 0;
					while ( (clazz = classes[j++]) ) {
						if ( cur.indexOf( " " + clazz + " " ) < 0 ) {
							cur += clazz + " ";
						}
					}

					// only assign if different to avoid unneeded rendering.
					finalValue = jQuery.trim( cur );
					if ( elem.className !== finalValue ) {
						elem.className = finalValue;
					}
				}
			}
		}

		return this;
	},

	removeClass: function( value ) {
		var classes, elem, cur, clazz, j, finalValue,
			proceed = arguments.length === 0 || typeof value === "string" && value,
			i = 0,
			len = this.length;

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( j ) {
				jQuery( this ).removeClass( value.call( this, j, this.className ) );
			});
		}
		if ( proceed ) {
			classes = ( value || "" ).match( rnotwhite ) || [];

			for ( ; i < len; i++ ) {
				elem = this[ i ];
				// This expression is here for better compressibility (see addClass)
				cur = elem.nodeType === 1 && ( elem.className ?
					( " " + elem.className + " " ).replace( rclass, " " ) :
					""
				);

				if ( cur ) {
					j = 0;
					while ( (clazz = classes[j++]) ) {
						// Remove *all* instances
						while ( cur.indexOf( " " + clazz + " " ) >= 0 ) {
							cur = cur.replace( " " + clazz + " ", " " );
						}
					}

					// only assign if different to avoid unneeded rendering.
					finalValue = value ? jQuery.trim( cur ) : "";
					if ( elem.className !== finalValue ) {
						elem.className = finalValue;
					}
				}
			}
		}

		return this;
	},

	toggleClass: function( value, stateVal ) {
		var type = typeof value;

		if ( typeof stateVal === "boolean" && type === "string" ) {
			return stateVal ? this.addClass( value ) : this.removeClass( value );
		}

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( i ) {
				jQuery( this ).toggleClass( value.call(this, i, this.className, stateVal), stateVal );
			});
		}

		return this.each(function() {
			if ( type === "string" ) {
				// toggle individual class names
				var className,
					i = 0,
					self = jQuery( this ),
					classNames = value.match( rnotwhite ) || [];

				while ( (className = classNames[ i++ ]) ) {
					// check each className given, space separated list
					if ( self.hasClass( className ) ) {
						self.removeClass( className );
					} else {
						self.addClass( className );
					}
				}

			// Toggle whole class name
			} else if ( type === strundefined || type === "boolean" ) {
				if ( this.className ) {
					// store className if set
					data_priv.set( this, "__className__", this.className );
				}

				// If the element has a class name or if we're passed "false",
				// then remove the whole classname (if there was one, the above saved it).
				// Otherwise bring back whatever was previously saved (if anything),
				// falling back to the empty string if nothing was stored.
				this.className = this.className || value === false ? "" : data_priv.get( this, "__className__" ) || "";
			}
		});
	},

	hasClass: function( selector ) {
		var className = " " + selector + " ",
			i = 0,
			l = this.length;
		for ( ; i < l; i++ ) {
			if ( this[i].nodeType === 1 && (" " + this[i].className + " ").replace(rclass, " ").indexOf( className ) >= 0 ) {
				return true;
			}
		}

		return false;
	}
});




var rreturn = /\r/g;

jQuery.fn.extend({
	val: function( value ) {
		var hooks, ret, isFunction,
			elem = this[0];

		if ( !arguments.length ) {
			if ( elem ) {
				hooks = jQuery.valHooks[ elem.type ] || jQuery.valHooks[ elem.nodeName.toLowerCase() ];

				if ( hooks && "get" in hooks && (ret = hooks.get( elem, "value" )) !== undefined ) {
					return ret;
				}

				ret = elem.value;

				return typeof ret === "string" ?
					// handle most common string cases
					ret.replace(rreturn, "") :
					// handle cases where value is null/undef or number
					ret == null ? "" : ret;
			}

			return;
		}

		isFunction = jQuery.isFunction( value );

		return this.each(function( i ) {
			var val;

			if ( this.nodeType !== 1 ) {
				return;
			}

			if ( isFunction ) {
				val = value.call( this, i, jQuery( this ).val() );
			} else {
				val = value;
			}

			// Treat null/undefined as ""; convert numbers to string
			if ( val == null ) {
				val = "";

			} else if ( typeof val === "number" ) {
				val += "";

			} else if ( jQuery.isArray( val ) ) {
				val = jQuery.map( val, function( value ) {
					return value == null ? "" : value + "";
				});
			}

			hooks = jQuery.valHooks[ this.type ] || jQuery.valHooks[ this.nodeName.toLowerCase() ];

			// If set returns undefined, fall back to normal setting
			if ( !hooks || !("set" in hooks) || hooks.set( this, val, "value" ) === undefined ) {
				this.value = val;
			}
		});
	}
});

jQuery.extend({
	valHooks: {
		select: {
			get: function( elem ) {
				var value, option,
					options = elem.options,
					index = elem.selectedIndex,
					one = elem.type === "select-one" || index < 0,
					values = one ? null : [],
					max = one ? index + 1 : options.length,
					i = index < 0 ?
						max :
						one ? index : 0;

				// Loop through all the selected options
				for ( ; i < max; i++ ) {
					option = options[ i ];

					// IE6-9 doesn't update selected after form reset (#2551)
					if ( ( option.selected || i === index ) &&
							// Don't return options that are disabled or in a disabled optgroup
							( support.optDisabled ? !option.disabled : option.getAttribute( "disabled" ) === null ) &&
							( !option.parentNode.disabled || !jQuery.nodeName( option.parentNode, "optgroup" ) ) ) {

						// Get the specific value for the option
						value = jQuery( option ).val();

						// We don't need an array for one selects
						if ( one ) {
							return value;
						}

						// Multi-Selects return an array
						values.push( value );
					}
				}

				return values;
			},

			set: function( elem, value ) {
				var optionSet, option,
					options = elem.options,
					values = jQuery.makeArray( value ),
					i = options.length;

				while ( i-- ) {
					option = options[ i ];
					if ( (option.selected = jQuery.inArray( jQuery(option).val(), values ) >= 0) ) {
						optionSet = true;
					}
				}

				// force browsers to behave consistently when non-matching value is set
				if ( !optionSet ) {
					elem.selectedIndex = -1;
				}
				return values;
			}
		}
	}
});

// Radios and checkboxes getter/setter
jQuery.each([ "radio", "checkbox" ], function() {
	jQuery.valHooks[ this ] = {
		set: function( elem, value ) {
			if ( jQuery.isArray( value ) ) {
				return ( elem.checked = jQuery.inArray( jQuery(elem).val(), value ) >= 0 );
			}
		}
	};
	if ( !support.checkOn ) {
		jQuery.valHooks[ this ].get = function( elem ) {
			// Support: Webkit
			// "" is returned instead of "on" if a value isn't specified
			return elem.getAttribute("value") === null ? "on" : elem.value;
		};
	}
});




// Return jQuery for attributes-only inclusion


jQuery.each( ("blur focus focusin focusout load resize scroll unload click dblclick " +
	"mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave " +
	"change select submit keydown keypress keyup error contextmenu").split(" "), function( i, name ) {

	// Handle event binding
	jQuery.fn[ name ] = function( data, fn ) {
		return arguments.length > 0 ?
			this.on( name, null, data, fn ) :
			this.trigger( name );
	};
});

jQuery.fn.extend({
	hover: function( fnOver, fnOut ) {
		return this.mouseenter( fnOver ).mouseleave( fnOut || fnOver );
	},

	bind: function( types, data, fn ) {
		return this.on( types, null, data, fn );
	},
	unbind: function( types, fn ) {
		return this.off( types, null, fn );
	},

	delegate: function( selector, types, data, fn ) {
		return this.on( types, selector, data, fn );
	},
	undelegate: function( selector, types, fn ) {
		// ( namespace ) or ( selector, types [, fn] )
		return arguments.length === 1 ? this.off( selector, "**" ) : this.off( types, selector || "**", fn );
	}
});


var nonce = jQuery.now();

var rquery = (/\?/);



// Support: Android 2.3
// Workaround failure to string-cast null input
jQuery.parseJSON = function( data ) {
	return JSON.parse( data + "" );
};


// Cross-browser xml parsing
jQuery.parseXML = function( data ) {
	var xml, tmp;
	if ( !data || typeof data !== "string" ) {
		return null;
	}

	// Support: IE9
	try {
		tmp = new DOMParser();
		xml = tmp.parseFromString( data, "text/xml" );
	} catch ( e ) {
		xml = undefined;
	}

	if ( !xml || xml.getElementsByTagName( "parsererror" ).length ) {
		jQuery.error( "Invalid XML: " + data );
	}
	return xml;
};


var
	// Document location
	ajaxLocParts,
	ajaxLocation,

	rhash = /#.*$/,
	rts = /([?&])_=[^&]*/,
	rheaders = /^(.*?):[ \t]*([^\r\n]*)$/mg,
	// #7653, #8125, #8152: local protocol detection
	rlocalProtocol = /^(?:about|app|app-storage|.+-extension|file|res|widget):$/,
	rnoContent = /^(?:GET|HEAD)$/,
	rprotocol = /^\/\//,
	rurl = /^([\w.+-]+:)(?:\/\/(?:[^\/?#]*@|)([^\/?#:]*)(?::(\d+)|)|)/,

	/* Prefilters
	 * 1) They are useful to introduce custom dataTypes (see ajax/jsonp.js for an example)
	 * 2) These are called:
	 *    - BEFORE asking for a transport
	 *    - AFTER param serialization (s.data is a string if s.processData is true)
	 * 3) key is the dataType
	 * 4) the catchall symbol "*" can be used
	 * 5) execution will start with transport dataType and THEN continue down to "*" if needed
	 */
	prefilters = {},

	/* Transports bindings
	 * 1) key is the dataType
	 * 2) the catchall symbol "*" can be used
	 * 3) selection will start with transport dataType and THEN go to "*" if needed
	 */
	transports = {},

	// Avoid comment-prolog char sequence (#10098); must appease lint and evade compression
	allTypes = "*/".concat("*");

// #8138, IE may throw an exception when accessing
// a field from window.location if document.domain has been set
try {
	ajaxLocation = location.href;
} catch( e ) {
	// Use the href attribute of an A element
	// since IE will modify it given document.location
	ajaxLocation = document.createElement( "a" );
	ajaxLocation.href = "";
	ajaxLocation = ajaxLocation.href;
}

// Segment location into parts
ajaxLocParts = rurl.exec( ajaxLocation.toLowerCase() ) || [];

// Base "constructor" for jQuery.ajaxPrefilter and jQuery.ajaxTransport
function addToPrefiltersOrTransports( structure ) {

	// dataTypeExpression is optional and defaults to "*"
	return function( dataTypeExpression, func ) {

		if ( typeof dataTypeExpression !== "string" ) {
			func = dataTypeExpression;
			dataTypeExpression = "*";
		}

		var dataType,
			i = 0,
			dataTypes = dataTypeExpression.toLowerCase().match( rnotwhite ) || [];

		if ( jQuery.isFunction( func ) ) {
			// For each dataType in the dataTypeExpression
			while ( (dataType = dataTypes[i++]) ) {
				// Prepend if requested
				if ( dataType[0] === "+" ) {
					dataType = dataType.slice( 1 ) || "*";
					(structure[ dataType ] = structure[ dataType ] || []).unshift( func );

				// Otherwise append
				} else {
					(structure[ dataType ] = structure[ dataType ] || []).push( func );
				}
			}
		}
	};
}

// Base inspection function for prefilters and transports
function inspectPrefiltersOrTransports( structure, options, originalOptions, jqXHR ) {

	var inspected = {},
		seekingTransport = ( structure === transports );

	function inspect( dataType ) {
		var selected;
		inspected[ dataType ] = true;
		jQuery.each( structure[ dataType ] || [], function( _, prefilterOrFactory ) {
			var dataTypeOrTransport = prefilterOrFactory( options, originalOptions, jqXHR );
			if ( typeof dataTypeOrTransport === "string" && !seekingTransport && !inspected[ dataTypeOrTransport ] ) {
				options.dataTypes.unshift( dataTypeOrTransport );
				inspect( dataTypeOrTransport );
				return false;
			} else if ( seekingTransport ) {
				return !( selected = dataTypeOrTransport );
			}
		});
		return selected;
	}

	return inspect( options.dataTypes[ 0 ] ) || !inspected[ "*" ] && inspect( "*" );
}

// A special extend for ajax options
// that takes "flat" options (not to be deep extended)
// Fixes #9887
function ajaxExtend( target, src ) {
	var key, deep,
		flatOptions = jQuery.ajaxSettings.flatOptions || {};

	for ( key in src ) {
		if ( src[ key ] !== undefined ) {
			( flatOptions[ key ] ? target : ( deep || (deep = {}) ) )[ key ] = src[ key ];
		}
	}
	if ( deep ) {
		jQuery.extend( true, target, deep );
	}

	return target;
}

/* Handles responses to an ajax request:
 * - finds the right dataType (mediates between content-type and expected dataType)
 * - returns the corresponding response
 */
function ajaxHandleResponses( s, jqXHR, responses ) {

	var ct, type, finalDataType, firstDataType,
		contents = s.contents,
		dataTypes = s.dataTypes;

	// Remove auto dataType and get content-type in the process
	while ( dataTypes[ 0 ] === "*" ) {
		dataTypes.shift();
		if ( ct === undefined ) {
			ct = s.mimeType || jqXHR.getResponseHeader("Content-Type");
		}
	}

	// Check if we're dealing with a known content-type
	if ( ct ) {
		for ( type in contents ) {
			if ( contents[ type ] && contents[ type ].test( ct ) ) {
				dataTypes.unshift( type );
				break;
			}
		}
	}

	// Check to see if we have a response for the expected dataType
	if ( dataTypes[ 0 ] in responses ) {
		finalDataType = dataTypes[ 0 ];
	} else {
		// Try convertible dataTypes
		for ( type in responses ) {
			if ( !dataTypes[ 0 ] || s.converters[ type + " " + dataTypes[0] ] ) {
				finalDataType = type;
				break;
			}
			if ( !firstDataType ) {
				firstDataType = type;
			}
		}
		// Or just use first one
		finalDataType = finalDataType || firstDataType;
	}

	// If we found a dataType
	// We add the dataType to the list if needed
	// and return the corresponding response
	if ( finalDataType ) {
		if ( finalDataType !== dataTypes[ 0 ] ) {
			dataTypes.unshift( finalDataType );
		}
		return responses[ finalDataType ];
	}
}

/* Chain conversions given the request and the original response
 * Also sets the responseXXX fields on the jqXHR instance
 */
function ajaxConvert( s, response, jqXHR, isSuccess ) {
	var conv2, current, conv, tmp, prev,
		converters = {},
		// Work with a copy of dataTypes in case we need to modify it for conversion
		dataTypes = s.dataTypes.slice();

	// Create converters map with lowercased keys
	if ( dataTypes[ 1 ] ) {
		for ( conv in s.converters ) {
			converters[ conv.toLowerCase() ] = s.converters[ conv ];
		}
	}

	current = dataTypes.shift();

	// Convert to each sequential dataType
	while ( current ) {

		if ( s.responseFields[ current ] ) {
			jqXHR[ s.responseFields[ current ] ] = response;
		}

		// Apply the dataFilter if provided
		if ( !prev && isSuccess && s.dataFilter ) {
			response = s.dataFilter( response, s.dataType );
		}

		prev = current;
		current = dataTypes.shift();

		if ( current ) {

		// There's only work to do if current dataType is non-auto
			if ( current === "*" ) {

				current = prev;

			// Convert response if prev dataType is non-auto and differs from current
			} else if ( prev !== "*" && prev !== current ) {

				// Seek a direct converter
				conv = converters[ prev + " " + current ] || converters[ "* " + current ];

				// If none found, seek a pair
				if ( !conv ) {
					for ( conv2 in converters ) {

						// If conv2 outputs current
						tmp = conv2.split( " " );
						if ( tmp[ 1 ] === current ) {

							// If prev can be converted to accepted input
							conv = converters[ prev + " " + tmp[ 0 ] ] ||
								converters[ "* " + tmp[ 0 ] ];
							if ( conv ) {
								// Condense equivalence converters
								if ( conv === true ) {
									conv = converters[ conv2 ];

								// Otherwise, insert the intermediate dataType
								} else if ( converters[ conv2 ] !== true ) {
									current = tmp[ 0 ];
									dataTypes.unshift( tmp[ 1 ] );
								}
								break;
							}
						}
					}
				}

				// Apply converter (if not an equivalence)
				if ( conv !== true ) {

					// Unless errors are allowed to bubble, catch and return them
					if ( conv && s[ "throws" ] ) {
						response = conv( response );
					} else {
						try {
							response = conv( response );
						} catch ( e ) {
							return { state: "parsererror", error: conv ? e : "No conversion from " + prev + " to " + current };
						}
					}
				}
			}
		}
	}

	return { state: "success", data: response };
}

jQuery.extend({

	// Counter for holding the number of active queries
	active: 0,

	// Last-Modified header cache for next request
	lastModified: {},
	etag: {},

	ajaxSettings: {
		url: ajaxLocation,
		type: "GET",
		isLocal: rlocalProtocol.test( ajaxLocParts[ 1 ] ),
		global: true,
		processData: true,
		async: true,
		contentType: "application/x-www-form-urlencoded; charset=UTF-8",
		/*
		timeout: 0,
		data: null,
		dataType: null,
		username: null,
		password: null,
		cache: null,
		throws: false,
		traditional: false,
		headers: {},
		*/

		accepts: {
			"*": allTypes,
			text: "text/plain",
			html: "text/html",
			xml: "application/xml, text/xml",
			json: "application/json, text/javascript"
		},

		contents: {
			xml: /xml/,
			html: /html/,
			json: /json/
		},

		responseFields: {
			xml: "responseXML",
			text: "responseText",
			json: "responseJSON"
		},

		// Data converters
		// Keys separate source (or catchall "*") and destination types with a single space
		converters: {

			// Convert anything to text
			"* text": String,

			// Text to html (true = no transformation)
			"text html": true,

			// Evaluate text as a json expression
			"text json": jQuery.parseJSON,

			// Parse text as xml
			"text xml": jQuery.parseXML
		},

		// For options that shouldn't be deep extended:
		// you can add your own custom options here if
		// and when you create one that shouldn't be
		// deep extended (see ajaxExtend)
		flatOptions: {
			url: true,
			context: true
		}
	},

	// Creates a full fledged settings object into target
	// with both ajaxSettings and settings fields.
	// If target is omitted, writes into ajaxSettings.
	ajaxSetup: function( target, settings ) {
		return settings ?

			// Building a settings object
			ajaxExtend( ajaxExtend( target, jQuery.ajaxSettings ), settings ) :

			// Extending ajaxSettings
			ajaxExtend( jQuery.ajaxSettings, target );
	},

	ajaxPrefilter: addToPrefiltersOrTransports( prefilters ),
	ajaxTransport: addToPrefiltersOrTransports( transports ),

	// Main method
	ajax: function( url, options ) {

		// If url is an object, simulate pre-1.5 signature
		if ( typeof url === "object" ) {
			options = url;
			url = undefined;
		}

		// Force options to be an object
		options = options || {};

		var transport,
			// URL without anti-cache param
			cacheURL,
			// Response headers
			responseHeadersString,
			responseHeaders,
			// timeout handle
			timeoutTimer,
			// Cross-domain detection vars
			parts,
			// To know if global events are to be dispatched
			fireGlobals,
			// Loop variable
			i,
			// Create the final options object
			s = jQuery.ajaxSetup( {}, options ),
			// Callbacks context
			callbackContext = s.context || s,
			// Context for global events is callbackContext if it is a DOM node or jQuery collection
			globalEventContext = s.context && ( callbackContext.nodeType || callbackContext.jquery ) ?
				jQuery( callbackContext ) :
				jQuery.event,
			// Deferreds
			deferred = jQuery.Deferred(),
			completeDeferred = jQuery.Callbacks("once memory"),
			// Status-dependent callbacks
			statusCode = s.statusCode || {},
			// Headers (they are sent all at once)
			requestHeaders = {},
			requestHeadersNames = {},
			// The jqXHR state
			state = 0,
			// Default abort message
			strAbort = "canceled",
			// Fake xhr
			jqXHR = {
				readyState: 0,

				// Builds headers hashtable if needed
				getResponseHeader: function( key ) {
					var match;
					if ( state === 2 ) {
						if ( !responseHeaders ) {
							responseHeaders = {};
							while ( (match = rheaders.exec( responseHeadersString )) ) {
								responseHeaders[ match[1].toLowerCase() ] = match[ 2 ];
							}
						}
						match = responseHeaders[ key.toLowerCase() ];
					}
					return match == null ? null : match;
				},

				// Raw string
				getAllResponseHeaders: function() {
					return state === 2 ? responseHeadersString : null;
				},

				// Caches the header
				setRequestHeader: function( name, value ) {
					var lname = name.toLowerCase();
					if ( !state ) {
						name = requestHeadersNames[ lname ] = requestHeadersNames[ lname ] || name;
						requestHeaders[ name ] = value;
					}
					return this;
				},

				// Overrides response content-type header
				overrideMimeType: function( type ) {
					if ( !state ) {
						s.mimeType = type;
					}
					return this;
				},

				// Status-dependent callbacks
				statusCode: function( map ) {
					var code;
					if ( map ) {
						if ( state < 2 ) {
							for ( code in map ) {
								// Lazy-add the new callback in a way that preserves old ones
								statusCode[ code ] = [ statusCode[ code ], map[ code ] ];
							}
						} else {
							// Execute the appropriate callbacks
							jqXHR.always( map[ jqXHR.status ] );
						}
					}
					return this;
				},

				// Cancel the request
				abort: function( statusText ) {
					var finalText = statusText || strAbort;
					if ( transport ) {
						transport.abort( finalText );
					}
					done( 0, finalText );
					return this;
				}
			};

		// Attach deferreds
		deferred.promise( jqXHR ).complete = completeDeferred.add;
		jqXHR.success = jqXHR.done;
		jqXHR.error = jqXHR.fail;

		// Remove hash character (#7531: and string promotion)
		// Add protocol if not provided (prefilters might expect it)
		// Handle falsy url in the settings object (#10093: consistency with old signature)
		// We also use the url parameter if available
		s.url = ( ( url || s.url || ajaxLocation ) + "" ).replace( rhash, "" )
			.replace( rprotocol, ajaxLocParts[ 1 ] + "//" );

		// Alias method option to type as per ticket #12004
		s.type = options.method || options.type || s.method || s.type;

		// Extract dataTypes list
		s.dataTypes = jQuery.trim( s.dataType || "*" ).toLowerCase().match( rnotwhite ) || [ "" ];

		// A cross-domain request is in order when we have a protocol:host:port mismatch
		if ( s.crossDomain == null ) {
			parts = rurl.exec( s.url.toLowerCase() );
			s.crossDomain = !!( parts &&
				( parts[ 1 ] !== ajaxLocParts[ 1 ] || parts[ 2 ] !== ajaxLocParts[ 2 ] ||
					( parts[ 3 ] || ( parts[ 1 ] === "http:" ? "80" : "443" ) ) !==
						( ajaxLocParts[ 3 ] || ( ajaxLocParts[ 1 ] === "http:" ? "80" : "443" ) ) )
			);
		}

		// Convert data if not already a string
		if ( s.data && s.processData && typeof s.data !== "string" ) {
			s.data = jQuery.param( s.data, s.traditional );
		}

		// Apply prefilters
		inspectPrefiltersOrTransports( prefilters, s, options, jqXHR );

		// If request was aborted inside a prefilter, stop there
		if ( state === 2 ) {
			return jqXHR;
		}

		// We can fire global events as of now if asked to
		fireGlobals = s.global;

		// Watch for a new set of requests
		if ( fireGlobals && jQuery.active++ === 0 ) {
			jQuery.event.trigger("ajaxStart");
		}

		// Uppercase the type
		s.type = s.type.toUpperCase();

		// Determine if request has content
		s.hasContent = !rnoContent.test( s.type );

		// Save the URL in case we're toying with the If-Modified-Since
		// and/or If-None-Match header later on
		cacheURL = s.url;

		// More options handling for requests with no content
		if ( !s.hasContent ) {

			// If data is available, append data to url
			if ( s.data ) {
				cacheURL = ( s.url += ( rquery.test( cacheURL ) ? "&" : "?" ) + s.data );
				// #9682: remove data so that it's not used in an eventual retry
				delete s.data;
			}

			// Add anti-cache in url if needed
			if ( s.cache === false ) {
				s.url = rts.test( cacheURL ) ?

					// If there is already a '_' parameter, set its value
					cacheURL.replace( rts, "$1_=" + nonce++ ) :

					// Otherwise add one to the end
					cacheURL + ( rquery.test( cacheURL ) ? "&" : "?" ) + "_=" + nonce++;
			}
		}

		// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
		if ( s.ifModified ) {
			if ( jQuery.lastModified[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-Modified-Since", jQuery.lastModified[ cacheURL ] );
			}
			if ( jQuery.etag[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-None-Match", jQuery.etag[ cacheURL ] );
			}
		}

		// Set the correct header, if data is being sent
		if ( s.data && s.hasContent && s.contentType !== false || options.contentType ) {
			jqXHR.setRequestHeader( "Content-Type", s.contentType );
		}

		// Set the Accepts header for the server, depending on the dataType
		jqXHR.setRequestHeader(
			"Accept",
			s.dataTypes[ 0 ] && s.accepts[ s.dataTypes[0] ] ?
				s.accepts[ s.dataTypes[0] ] + ( s.dataTypes[ 0 ] !== "*" ? ", " + allTypes + "; q=0.01" : "" ) :
				s.accepts[ "*" ]
		);

		// Check for headers option
		for ( i in s.headers ) {
			jqXHR.setRequestHeader( i, s.headers[ i ] );
		}

		// Allow custom headers/mimetypes and early abort
		if ( s.beforeSend && ( s.beforeSend.call( callbackContext, jqXHR, s ) === false || state === 2 ) ) {
			// Abort if not done already and return
			return jqXHR.abort();
		}

		// aborting is no longer a cancellation
		strAbort = "abort";

		// Install callbacks on deferreds
		for ( i in { success: 1, error: 1, complete: 1 } ) {
			jqXHR[ i ]( s[ i ] );
		}

		// Get transport
		transport = inspectPrefiltersOrTransports( transports, s, options, jqXHR );

		// If no transport, we auto-abort
		if ( !transport ) {
			done( -1, "No Transport" );
		} else {
			jqXHR.readyState = 1;

			// Send global event
			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxSend", [ jqXHR, s ] );
			}
			// Timeout
			if ( s.async && s.timeout > 0 ) {
				timeoutTimer = setTimeout(function() {
					jqXHR.abort("timeout");
				}, s.timeout );
			}

			try {
				state = 1;
				transport.send( requestHeaders, done );
			} catch ( e ) {
				// Propagate exception as error if not done
				if ( state < 2 ) {
					done( -1, e );
				// Simply rethrow otherwise
				} else {
					throw e;
				}
			}
		}

		// Callback for when everything is done
		function done( status, nativeStatusText, responses, headers ) {
			var isSuccess, success, error, response, modified,
				statusText = nativeStatusText;

			// Called once
			if ( state === 2 ) {
				return;
			}

			// State is "done" now
			state = 2;

			// Clear timeout if it exists
			if ( timeoutTimer ) {
				clearTimeout( timeoutTimer );
			}

			// Dereference transport for early garbage collection
			// (no matter how long the jqXHR object will be used)
			transport = undefined;

			// Cache response headers
			responseHeadersString = headers || "";

			// Set readyState
			jqXHR.readyState = status > 0 ? 4 : 0;

			// Determine if successful
			isSuccess = status >= 200 && status < 300 || status === 304;

			// Get response data
			if ( responses ) {
				response = ajaxHandleResponses( s, jqXHR, responses );
			}

			// Convert no matter what (that way responseXXX fields are always set)
			response = ajaxConvert( s, response, jqXHR, isSuccess );

			// If successful, handle type chaining
			if ( isSuccess ) {

				// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
				if ( s.ifModified ) {
					modified = jqXHR.getResponseHeader("Last-Modified");
					if ( modified ) {
						jQuery.lastModified[ cacheURL ] = modified;
					}
					modified = jqXHR.getResponseHeader("etag");
					if ( modified ) {
						jQuery.etag[ cacheURL ] = modified;
					}
				}

				// if no content
				if ( status === 204 || s.type === "HEAD" ) {
					statusText = "nocontent";

				// if not modified
				} else if ( status === 304 ) {
					statusText = "notmodified";

				// If we have data, let's convert it
				} else {
					statusText = response.state;
					success = response.data;
					error = response.error;
					isSuccess = !error;
				}
			} else {
				// We extract error from statusText
				// then normalize statusText and status for non-aborts
				error = statusText;
				if ( status || !statusText ) {
					statusText = "error";
					if ( status < 0 ) {
						status = 0;
					}
				}
			}

			// Set data for the fake xhr object
			jqXHR.status = status;
			jqXHR.statusText = ( nativeStatusText || statusText ) + "";

			// Success/Error
			if ( isSuccess ) {
				deferred.resolveWith( callbackContext, [ success, statusText, jqXHR ] );
			} else {
				deferred.rejectWith( callbackContext, [ jqXHR, statusText, error ] );
			}

			// Status-dependent callbacks
			jqXHR.statusCode( statusCode );
			statusCode = undefined;

			if ( fireGlobals ) {
				globalEventContext.trigger( isSuccess ? "ajaxSuccess" : "ajaxError",
					[ jqXHR, s, isSuccess ? success : error ] );
			}

			// Complete
			completeDeferred.fireWith( callbackContext, [ jqXHR, statusText ] );

			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxComplete", [ jqXHR, s ] );
				// Handle the global AJAX counter
				if ( !( --jQuery.active ) ) {
					jQuery.event.trigger("ajaxStop");
				}
			}
		}

		return jqXHR;
	},

	getJSON: function( url, data, callback ) {
		return jQuery.get( url, data, callback, "json" );
	},

	getScript: function( url, callback ) {
		return jQuery.get( url, undefined, callback, "script" );
	}
});

jQuery.each( [ "get", "post" ], function( i, method ) {
	jQuery[ method ] = function( url, data, callback, type ) {
		// shift arguments if data argument was omitted
		if ( jQuery.isFunction( data ) ) {
			type = type || callback;
			callback = data;
			data = undefined;
		}

		return jQuery.ajax({
			url: url,
			type: method,
			dataType: type,
			data: data,
			success: callback
		});
	};
});

// Attach a bunch of functions for handling common AJAX events
jQuery.each( [ "ajaxStart", "ajaxStop", "ajaxComplete", "ajaxError", "ajaxSuccess", "ajaxSend" ], function( i, type ) {
	jQuery.fn[ type ] = function( fn ) {
		return this.on( type, fn );
	};
});


jQuery._evalUrl = function( url ) {
	return jQuery.ajax({
		url: url,
		type: "GET",
		dataType: "script",
		async: false,
		global: false,
		"throws": true
	});
};


jQuery.fn.extend({
	wrapAll: function( html ) {
		var wrap;

		if ( jQuery.isFunction( html ) ) {
			return this.each(function( i ) {
				jQuery( this ).wrapAll( html.call(this, i) );
			});
		}

		if ( this[ 0 ] ) {

			// The elements to wrap the target around
			wrap = jQuery( html, this[ 0 ].ownerDocument ).eq( 0 ).clone( true );

			if ( this[ 0 ].parentNode ) {
				wrap.insertBefore( this[ 0 ] );
			}

			wrap.map(function() {
				var elem = this;

				while ( elem.firstElementChild ) {
					elem = elem.firstElementChild;
				}

				return elem;
			}).append( this );
		}

		return this;
	},

	wrapInner: function( html ) {
		if ( jQuery.isFunction( html ) ) {
			return this.each(function( i ) {
				jQuery( this ).wrapInner( html.call(this, i) );
			});
		}

		return this.each(function() {
			var self = jQuery( this ),
				contents = self.contents();

			if ( contents.length ) {
				contents.wrapAll( html );

			} else {
				self.append( html );
			}
		});
	},

	wrap: function( html ) {
		var isFunction = jQuery.isFunction( html );

		return this.each(function( i ) {
			jQuery( this ).wrapAll( isFunction ? html.call(this, i) : html );
		});
	},

	unwrap: function() {
		return this.parent().each(function() {
			if ( !jQuery.nodeName( this, "body" ) ) {
				jQuery( this ).replaceWith( this.childNodes );
			}
		}).end();
	}
});


jQuery.expr.filters.hidden = function( elem ) {
	// Support: Opera <= 12.12
	// Opera reports offsetWidths and offsetHeights less than zero on some elements
	return elem.offsetWidth <= 0 && elem.offsetHeight <= 0;
};
jQuery.expr.filters.visible = function( elem ) {
	return !jQuery.expr.filters.hidden( elem );
};




var r20 = /%20/g,
	rbracket = /\[\]$/,
	rCRLF = /\r?\n/g,
	rsubmitterTypes = /^(?:submit|button|image|reset|file)$/i,
	rsubmittable = /^(?:input|select|textarea|keygen)/i;

function buildParams( prefix, obj, traditional, add ) {
	var name;

	if ( jQuery.isArray( obj ) ) {
		// Serialize array item.
		jQuery.each( obj, function( i, v ) {
			if ( traditional || rbracket.test( prefix ) ) {
				// Treat each array item as a scalar.
				add( prefix, v );

			} else {
				// Item is non-scalar (array or object), encode its numeric index.
				buildParams( prefix + "[" + ( typeof v === "object" ? i : "" ) + "]", v, traditional, add );
			}
		});

	} else if ( !traditional && jQuery.type( obj ) === "object" ) {
		// Serialize object item.
		for ( name in obj ) {
			buildParams( prefix + "[" + name + "]", obj[ name ], traditional, add );
		}

	} else {
		// Serialize scalar item.
		add( prefix, obj );
	}
}

// Serialize an array of form elements or a set of
// key/values into a query string
jQuery.param = function( a, traditional ) {
	var prefix,
		s = [],
		add = function( key, value ) {
			// If value is a function, invoke it and return its value
			value = jQuery.isFunction( value ) ? value() : ( value == null ? "" : value );
			s[ s.length ] = encodeURIComponent( key ) + "=" + encodeURIComponent( value );
		};

	// Set traditional to true for jQuery <= 1.3.2 behavior.
	if ( traditional === undefined ) {
		traditional = jQuery.ajaxSettings && jQuery.ajaxSettings.traditional;
	}

	// If an array was passed in, assume that it is an array of form elements.
	if ( jQuery.isArray( a ) || ( a.jquery && !jQuery.isPlainObject( a ) ) ) {
		// Serialize the form elements
		jQuery.each( a, function() {
			add( this.name, this.value );
		});

	} else {
		// If traditional, encode the "old" way (the way 1.3.2 or older
		// did it), otherwise encode params recursively.
		for ( prefix in a ) {
			buildParams( prefix, a[ prefix ], traditional, add );
		}
	}

	// Return the resulting serialization
	return s.join( "&" ).replace( r20, "+" );
};

jQuery.fn.extend({
	serialize: function() {
		return jQuery.param( this.serializeArray() );
	},
	serializeArray: function() {
		return this.map(function() {
			// Can add propHook for "elements" to filter or add form elements
			var elements = jQuery.prop( this, "elements" );
			return elements ? jQuery.makeArray( elements ) : this;
		})
		.filter(function() {
			var type = this.type;

			// Use .is( ":disabled" ) so that fieldset[disabled] works
			return this.name && !jQuery( this ).is( ":disabled" ) &&
				rsubmittable.test( this.nodeName ) && !rsubmitterTypes.test( type ) &&
				( this.checked || !rcheckableType.test( type ) );
		})
		.map(function( i, elem ) {
			var val = jQuery( this ).val();

			return val == null ?
				null :
				jQuery.isArray( val ) ?
					jQuery.map( val, function( val ) {
						return { name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
					}) :
					{ name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
		}).get();
	}
});


jQuery.ajaxSettings.xhr = function() {
	try {
		return new XMLHttpRequest();
	} catch( e ) {}
};

var xhrId = 0,
	xhrCallbacks = {},
	xhrSuccessStatus = {
		// file protocol always yields status code 0, assume 200
		0: 200,
		// Support: IE9
		// #1450: sometimes IE returns 1223 when it should be 204
		1223: 204
	},
	xhrSupported = jQuery.ajaxSettings.xhr();

// Support: IE9
// Open requests must be manually aborted on unload (#5280)
if ( window.ActiveXObject ) {
	jQuery( window ).on( "unload", function() {
		for ( var key in xhrCallbacks ) {
			xhrCallbacks[ key ]();
		}
	});
}

support.cors = !!xhrSupported && ( "withCredentials" in xhrSupported );
support.ajax = xhrSupported = !!xhrSupported;

jQuery.ajaxTransport(function( options ) {
	var callback;

	// Cross domain only allowed if supported through XMLHttpRequest
	if ( support.cors || xhrSupported && !options.crossDomain ) {
		return {
			send: function( headers, complete ) {
				var i,
					xhr = options.xhr(),
					id = ++xhrId;

				xhr.open( options.type, options.url, options.async, options.username, options.password );

				// Apply custom fields if provided
				if ( options.xhrFields ) {
					for ( i in options.xhrFields ) {
						xhr[ i ] = options.xhrFields[ i ];
					}
				}

				// Override mime type if needed
				if ( options.mimeType && xhr.overrideMimeType ) {
					xhr.overrideMimeType( options.mimeType );
				}

				// X-Requested-With header
				// For cross-domain requests, seeing as conditions for a preflight are
				// akin to a jigsaw puzzle, we simply never set it to be sure.
				// (it can always be set on a per-request basis or even using ajaxSetup)
				// For same-domain requests, won't change header if already provided.
				if ( !options.crossDomain && !headers["X-Requested-With"] ) {
					headers["X-Requested-With"] = "XMLHttpRequest";
				}

				// Set headers
				for ( i in headers ) {
					xhr.setRequestHeader( i, headers[ i ] );
				}

				// Callback
				callback = function( type ) {
					return function() {
						if ( callback ) {
							delete xhrCallbacks[ id ];
							callback = xhr.onload = xhr.onerror = null;

							if ( type === "abort" ) {
								xhr.abort();
							} else if ( type === "error" ) {
								complete(
									// file: protocol always yields status 0; see #8605, #14207
									xhr.status,
									xhr.statusText
								);
							} else {
								complete(
									xhrSuccessStatus[ xhr.status ] || xhr.status,
									xhr.statusText,
									// Support: IE9
									// Accessing binary-data responseText throws an exception
									// (#11426)
									typeof xhr.responseText === "string" ? {
										text: xhr.responseText
									} : undefined,
									xhr.getAllResponseHeaders()
								);
							}
						}
					};
				};

				// Listen to events
				xhr.onload = callback();
				xhr.onerror = callback("error");

				// Create the abort callback
				callback = xhrCallbacks[ id ] = callback("abort");

				// Do send the request
				// This may raise an exception which is actually
				// handled in jQuery.ajax (so no try/catch here)
				xhr.send( options.hasContent && options.data || null );
			},

			abort: function() {
				if ( callback ) {
					callback();
				}
			}
		};
	}
});




// Install script dataType
jQuery.ajaxSetup({
	accepts: {
		script: "text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"
	},
	contents: {
		script: /(?:java|ecma)script/
	},
	converters: {
		"text script": function( text ) {
			jQuery.globalEval( text );
			return text;
		}
	}
});

// Handle cache's special case and crossDomain
jQuery.ajaxPrefilter( "script", function( s ) {
	if ( s.cache === undefined ) {
		s.cache = false;
	}
	if ( s.crossDomain ) {
		s.type = "GET";
	}
});

// Bind script tag hack transport
jQuery.ajaxTransport( "script", function( s ) {
	// This transport only deals with cross domain requests
	if ( s.crossDomain ) {
		var script, callback;
		return {
			send: function( _, complete ) {
				script = jQuery("<script>").prop({
					async: true,
					charset: s.scriptCharset,
					src: s.url
				}).on(
					"load error",
					callback = function( evt ) {
						script.remove();
						callback = null;
						if ( evt ) {
							complete( evt.type === "error" ? 404 : 200, evt.type );
						}
					}
				);
				document.head.appendChild( script[ 0 ] );
			},
			abort: function() {
				if ( callback ) {
					callback();
				}
			}
		};
	}
});




var oldCallbacks = [],
	rjsonp = /(=)\?(?=&|$)|\?\?/;

// Default jsonp settings
jQuery.ajaxSetup({
	jsonp: "callback",
	jsonpCallback: function() {
		var callback = oldCallbacks.pop() || ( jQuery.expando + "_" + ( nonce++ ) );
		this[ callback ] = true;
		return callback;
	}
});

// Detect, normalize options and install callbacks for jsonp requests
jQuery.ajaxPrefilter( "json jsonp", function( s, originalSettings, jqXHR ) {

	var callbackName, overwritten, responseContainer,
		jsonProp = s.jsonp !== false && ( rjsonp.test( s.url ) ?
			"url" :
			typeof s.data === "string" && !( s.contentType || "" ).indexOf("application/x-www-form-urlencoded") && rjsonp.test( s.data ) && "data"
		);

	// Handle iff the expected data type is "jsonp" or we have a parameter to set
	if ( jsonProp || s.dataTypes[ 0 ] === "jsonp" ) {

		// Get callback name, remembering preexisting value associated with it
		callbackName = s.jsonpCallback = jQuery.isFunction( s.jsonpCallback ) ?
			s.jsonpCallback() :
			s.jsonpCallback;

		// Insert callback into url or form data
		if ( jsonProp ) {
			s[ jsonProp ] = s[ jsonProp ].replace( rjsonp, "$1" + callbackName );
		} else if ( s.jsonp !== false ) {
			s.url += ( rquery.test( s.url ) ? "&" : "?" ) + s.jsonp + "=" + callbackName;
		}

		// Use data converter to retrieve json after script execution
		s.converters["script json"] = function() {
			if ( !responseContainer ) {
				jQuery.error( callbackName + " was not called" );
			}
			return responseContainer[ 0 ];
		};

		// force json dataType
		s.dataTypes[ 0 ] = "json";

		// Install callback
		overwritten = window[ callbackName ];
		window[ callbackName ] = function() {
			responseContainer = arguments;
		};

		// Clean-up function (fires after converters)
		jqXHR.always(function() {
			// Restore preexisting value
			window[ callbackName ] = overwritten;

			// Save back as free
			if ( s[ callbackName ] ) {
				// make sure that re-using the options doesn't screw things around
				s.jsonpCallback = originalSettings.jsonpCallback;

				// save the callback name for future use
				oldCallbacks.push( callbackName );
			}

			// Call if it was a function and we have a response
			if ( responseContainer && jQuery.isFunction( overwritten ) ) {
				overwritten( responseContainer[ 0 ] );
			}

			responseContainer = overwritten = undefined;
		});

		// Delegate to script
		return "script";
	}
});




// data: string of html
// context (optional): If specified, the fragment will be created in this context, defaults to document
// keepScripts (optional): If true, will include scripts passed in the html string
jQuery.parseHTML = function( data, context, keepScripts ) {
	if ( !data || typeof data !== "string" ) {
		return null;
	}
	if ( typeof context === "boolean" ) {
		keepScripts = context;
		context = false;
	}
	context = context || document;

	var parsed = rsingleTag.exec( data ),
		scripts = !keepScripts && [];

	// Single tag
	if ( parsed ) {
		return [ context.createElement( parsed[1] ) ];
	}

	parsed = jQuery.buildFragment( [ data ], context, scripts );

	if ( scripts && scripts.length ) {
		jQuery( scripts ).remove();
	}

	return jQuery.merge( [], parsed.childNodes );
};


// Keep a copy of the old load method
var _load = jQuery.fn.load;

/**
 * Load a url into a page
 */
jQuery.fn.load = function( url, params, callback ) {
	if ( typeof url !== "string" && _load ) {
		return _load.apply( this, arguments );
	}

	var selector, type, response,
		self = this,
		off = url.indexOf(" ");

	if ( off >= 0 ) {
		selector = url.slice( off );
		url = url.slice( 0, off );
	}

	// If it's a function
	if ( jQuery.isFunction( params ) ) {

		// We assume that it's the callback
		callback = params;
		params = undefined;

	// Otherwise, build a param string
	} else if ( params && typeof params === "object" ) {
		type = "POST";
	}

	// If we have elements to modify, make the request
	if ( self.length > 0 ) {
		jQuery.ajax({
			url: url,

			// if "type" variable is undefined, then "GET" method will be used
			type: type,
			dataType: "html",
			data: params
		}).done(function( responseText ) {

			// Save response for use in complete callback
			response = arguments;

			self.html( selector ?

				// If a selector was specified, locate the right elements in a dummy div
				// Exclude scripts to avoid IE 'Permission Denied' errors
				jQuery("<div>").append( jQuery.parseHTML( responseText ) ).find( selector ) :

				// Otherwise use the full result
				responseText );

		}).complete( callback && function( jqXHR, status ) {
			self.each( callback, response || [ jqXHR.responseText, status, jqXHR ] );
		});
	}

	return this;
};




jQuery.expr.filters.animated = function( elem ) {
	return jQuery.grep(jQuery.timers, function( fn ) {
		return elem === fn.elem;
	}).length;
};




var docElem = window.document.documentElement;

/**
 * Gets a window from an element
 */
function getWindow( elem ) {
	return jQuery.isWindow( elem ) ? elem : elem.nodeType === 9 && elem.defaultView;
}

jQuery.offset = {
	setOffset: function( elem, options, i ) {
		var curPosition, curLeft, curCSSTop, curTop, curOffset, curCSSLeft, calculatePosition,
			position = jQuery.css( elem, "position" ),
			curElem = jQuery( elem ),
			props = {};

		// Set position first, in-case top/left are set even on static elem
		if ( position === "static" ) {
			elem.style.position = "relative";
		}

		curOffset = curElem.offset();
		curCSSTop = jQuery.css( elem, "top" );
		curCSSLeft = jQuery.css( elem, "left" );
		calculatePosition = ( position === "absolute" || position === "fixed" ) &&
			( curCSSTop + curCSSLeft ).indexOf("auto") > -1;

		// Need to be able to calculate position if either top or left is auto and position is either absolute or fixed
		if ( calculatePosition ) {
			curPosition = curElem.position();
			curTop = curPosition.top;
			curLeft = curPosition.left;

		} else {
			curTop = parseFloat( curCSSTop ) || 0;
			curLeft = parseFloat( curCSSLeft ) || 0;
		}

		if ( jQuery.isFunction( options ) ) {
			options = options.call( elem, i, curOffset );
		}

		if ( options.top != null ) {
			props.top = ( options.top - curOffset.top ) + curTop;
		}
		if ( options.left != null ) {
			props.left = ( options.left - curOffset.left ) + curLeft;
		}

		if ( "using" in options ) {
			options.using.call( elem, props );

		} else {
			curElem.css( props );
		}
	}
};

jQuery.fn.extend({
	offset: function( options ) {
		if ( arguments.length ) {
			return options === undefined ?
				this :
				this.each(function( i ) {
					jQuery.offset.setOffset( this, options, i );
				});
		}

		var docElem, win,
			elem = this[ 0 ],
			box = { top: 0, left: 0 },
			doc = elem && elem.ownerDocument;

		if ( !doc ) {
			return;
		}

		docElem = doc.documentElement;

		// Make sure it's not a disconnected DOM node
		if ( !jQuery.contains( docElem, elem ) ) {
			return box;
		}

		// If we don't have gBCR, just use 0,0 rather than error
		// BlackBerry 5, iOS 3 (original iPhone)
		if ( typeof elem.getBoundingClientRect !== strundefined ) {
			box = elem.getBoundingClientRect();
		}
		win = getWindow( doc );
		return {
			top: box.top + win.pageYOffset - docElem.clientTop,
			left: box.left + win.pageXOffset - docElem.clientLeft
		};
	},

	position: function() {
		if ( !this[ 0 ] ) {
			return;
		}

		var offsetParent, offset,
			elem = this[ 0 ],
			parentOffset = { top: 0, left: 0 };

		// Fixed elements are offset from window (parentOffset = {top:0, left: 0}, because it is its only offset parent
		if ( jQuery.css( elem, "position" ) === "fixed" ) {
			// We assume that getBoundingClientRect is available when computed position is fixed
			offset = elem.getBoundingClientRect();

		} else {
			// Get *real* offsetParent
			offsetParent = this.offsetParent();

			// Get correct offsets
			offset = this.offset();
			if ( !jQuery.nodeName( offsetParent[ 0 ], "html" ) ) {
				parentOffset = offsetParent.offset();
			}

			// Add offsetParent borders
			parentOffset.top += jQuery.css( offsetParent[ 0 ], "borderTopWidth", true );
			parentOffset.left += jQuery.css( offsetParent[ 0 ], "borderLeftWidth", true );
		}

		// Subtract parent offsets and element margins
		return {
			top: offset.top - parentOffset.top - jQuery.css( elem, "marginTop", true ),
			left: offset.left - parentOffset.left - jQuery.css( elem, "marginLeft", true )
		};
	},

	offsetParent: function() {
		return this.map(function() {
			var offsetParent = this.offsetParent || docElem;

			while ( offsetParent && ( !jQuery.nodeName( offsetParent, "html" ) && jQuery.css( offsetParent, "position" ) === "static" ) ) {
				offsetParent = offsetParent.offsetParent;
			}

			return offsetParent || docElem;
		});
	}
});

// Create scrollLeft and scrollTop methods
jQuery.each( { scrollLeft: "pageXOffset", scrollTop: "pageYOffset" }, function( method, prop ) {
	var top = "pageYOffset" === prop;

	jQuery.fn[ method ] = function( val ) {
		return access( this, function( elem, method, val ) {
			var win = getWindow( elem );

			if ( val === undefined ) {
				return win ? win[ prop ] : elem[ method ];
			}

			if ( win ) {
				win.scrollTo(
					!top ? val : window.pageXOffset,
					top ? val : window.pageYOffset
				);

			} else {
				elem[ method ] = val;
			}
		}, method, val, arguments.length, null );
	};
});

// Add the top/left cssHooks using jQuery.fn.position
// Webkit bug: https://bugs.webkit.org/show_bug.cgi?id=29084
// getComputedStyle returns percent when specified for top/left/bottom/right
// rather than make the css module depend on the offset module, we just check for it here
jQuery.each( [ "top", "left" ], function( i, prop ) {
	jQuery.cssHooks[ prop ] = addGetHookIf( support.pixelPosition,
		function( elem, computed ) {
			if ( computed ) {
				computed = curCSS( elem, prop );
				// if curCSS returns percentage, fallback to offset
				return rnumnonpx.test( computed ) ?
					jQuery( elem ).position()[ prop ] + "px" :
					computed;
			}
		}
	);
});


// Create innerHeight, innerWidth, height, width, outerHeight and outerWidth methods
jQuery.each( { Height: "height", Width: "width" }, function( name, type ) {
	jQuery.each( { padding: "inner" + name, content: type, "": "outer" + name }, function( defaultExtra, funcName ) {
		// margin is only for outerHeight, outerWidth
		jQuery.fn[ funcName ] = function( margin, value ) {
			var chainable = arguments.length && ( defaultExtra || typeof margin !== "boolean" ),
				extra = defaultExtra || ( margin === true || value === true ? "margin" : "border" );

			return access( this, function( elem, type, value ) {
				var doc;

				if ( jQuery.isWindow( elem ) ) {
					// As of 5/8/2012 this will yield incorrect results for Mobile Safari, but there
					// isn't a whole lot we can do. See pull request at this URL for discussion:
					// https://github.com/jquery/jquery/pull/764
					return elem.document.documentElement[ "client" + name ];
				}

				// Get document width or height
				if ( elem.nodeType === 9 ) {
					doc = elem.documentElement;

					// Either scroll[Width/Height] or offset[Width/Height] or client[Width/Height],
					// whichever is greatest
					return Math.max(
						elem.body[ "scroll" + name ], doc[ "scroll" + name ],
						elem.body[ "offset" + name ], doc[ "offset" + name ],
						doc[ "client" + name ]
					);
				}

				return value === undefined ?
					// Get width or height on the element, requesting but not forcing parseFloat
					jQuery.css( elem, type, extra ) :

					// Set width or height on the element
					jQuery.style( elem, type, value, extra );
			}, type, chainable ? margin : undefined, chainable, null );
		};
	});
});


// The number of elements contained in the matched element set
jQuery.fn.size = function() {
	return this.length;
};

jQuery.fn.andSelf = jQuery.fn.addBack;




// Register as a named AMD module, since jQuery can be concatenated with other
// files that may use define, but not via a proper concatenation script that
// understands anonymous AMD modules. A named AMD is safest and most robust
// way to register. Lowercase jquery is used because AMD module names are
// derived from file names, and jQuery is normally delivered in a lowercase
// file name. Do this after creating the global so that if an AMD module wants
// to call noConflict to hide this version of jQuery, it will work.
if ( typeof define === "function" && define.amd ) {
	define( "jquery", [], function() {
		return jQuery;
	});
}




var
	// Map over jQuery in case of overwrite
	_jQuery = window.jQuery,

	// Map over the $ in case of overwrite
	_$ = window.$;

jQuery.noConflict = function( deep ) {
	if ( window.$ === jQuery ) {
		window.$ = _$;
	}

	if ( deep && window.jQuery === jQuery ) {
		window.jQuery = _jQuery;
	}

	return jQuery;
};

// Expose jQuery and $ identifiers, even in
// AMD (#7102#comment:10, https://github.com/jquery/jquery/pull/557)
// and CommonJS for browser emulators (#13566)
if ( typeof noGlobal === strundefined ) {
	window.jQuery = window.$ = jQuery;
}




return jQuery;

}));

/**
 * @license RequireJS text 2.0.10 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/requirejs/text for details
 */
/*jslint regexp: true */
/*global require, XMLHttpRequest, ActiveXObject,
  define, window, process, Packages,
  java, location, Components, FileUtils */

define('text',['module'], function (module) {
    

    var text, fs, Cc, Ci, xpcIsWindows,
        progIds = ['Msxml2.XMLHTTP', 'Microsoft.XMLHTTP', 'Msxml2.XMLHTTP.4.0'],
        xmlRegExp = /^\s*<\?xml(\s)+version=[\'\"](\d)*.(\d)*[\'\"](\s)*\?>/im,
        bodyRegExp = /<body[^>]*>\s*([\s\S]+)\s*<\/body>/im,
        hasLocation = typeof location !== 'undefined' && location.href,
        defaultProtocol = hasLocation && location.protocol && location.protocol.replace(/\:/, ''),
        defaultHostName = hasLocation && location.hostname,
        defaultPort = hasLocation && (location.port || undefined),
        buildMap = {},
        masterConfig = (module.config && module.config()) || {};

    text = {
        version: '2.0.10',

        strip: function (content) {
            //Strips <?xml ...?> declarations so that external SVG and XML
            //documents can be added to a document without worry. Also, if the string
            //is an HTML document, only the part inside the body tag is returned.
            if (content) {
                content = content.replace(xmlRegExp, "");
                var matches = content.match(bodyRegExp);
                if (matches) {
                    content = matches[1];
                }
            } else {
                content = "";
            }
            return content;
        },

        jsEscape: function (content) {
            return content.replace(/(['\\])/g, '\\$1')
                .replace(/[\f]/g, "\\f")
                .replace(/[\b]/g, "\\b")
                .replace(/[\n]/g, "\\n")
                .replace(/[\t]/g, "\\t")
                .replace(/[\r]/g, "\\r")
                .replace(/[\u2028]/g, "\\u2028")
                .replace(/[\u2029]/g, "\\u2029");
        },

        createXhr: masterConfig.createXhr || function () {
            //Would love to dump the ActiveX crap in here. Need IE 6 to die first.
            var xhr, i, progId;
            if (typeof XMLHttpRequest !== "undefined") {
                return new XMLHttpRequest();
            } else if (typeof ActiveXObject !== "undefined") {
                for (i = 0; i < 3; i += 1) {
                    progId = progIds[i];
                    try {
                        xhr = new ActiveXObject(progId);
                    } catch (e) {}

                    if (xhr) {
                        progIds = [progId];  // so faster next time
                        break;
                    }
                }
            }

            return xhr;
        },

        /**
         * Parses a resource name into its component parts. Resource names
         * look like: module/name.ext!strip, where the !strip part is
         * optional.
         * @param {String} name the resource name
         * @returns {Object} with properties "moduleName", "ext" and "strip"
         * where strip is a boolean.
         */
        parseName: function (name) {
            var modName, ext, temp,
                strip = false,
                index = name.indexOf("."),
                isRelative = name.indexOf('./') === 0 ||
                             name.indexOf('../') === 0;

            if (index !== -1 && (!isRelative || index > 1)) {
                modName = name.substring(0, index);
                ext = name.substring(index + 1, name.length);
            } else {
                modName = name;
            }

            temp = ext || modName;
            index = temp.indexOf("!");
            if (index !== -1) {
                //Pull off the strip arg.
                strip = temp.substring(index + 1) === "strip";
                temp = temp.substring(0, index);
                if (ext) {
                    ext = temp;
                } else {
                    modName = temp;
                }
            }

            return {
                moduleName: modName,
                ext: ext,
                strip: strip
            };
        },

        xdRegExp: /^((\w+)\:)?\/\/([^\/\\]+)/,

        /**
         * Is an URL on another domain. Only works for browser use, returns
         * false in non-browser environments. Only used to know if an
         * optimized .js version of a text resource should be loaded
         * instead.
         * @param {String} url
         * @returns Boolean
         */
        useXhr: function (url, protocol, hostname, port) {
            var uProtocol, uHostName, uPort,
                match = text.xdRegExp.exec(url);
            if (!match) {
                return true;
            }
            uProtocol = match[2];
            uHostName = match[3];

            uHostName = uHostName.split(':');
            uPort = uHostName[1];
            uHostName = uHostName[0];

            return (!uProtocol || uProtocol === protocol) &&
                   (!uHostName || uHostName.toLowerCase() === hostname.toLowerCase()) &&
                   ((!uPort && !uHostName) || uPort === port);
        },

        finishLoad: function (name, strip, content, onLoad) {
            content = strip ? text.strip(content) : content;
            if (masterConfig.isBuild) {
                buildMap[name] = content;
            }
            onLoad(content);
        },

        load: function (name, req, onLoad, config) {
            //Name has format: some.module.filext!strip
            //The strip part is optional.
            //if strip is present, then that means only get the string contents
            //inside a body tag in an HTML string. For XML/SVG content it means
            //removing the <?xml ...?> declarations so the content can be inserted
            //into the current doc without problems.

            // Do not bother with the work if a build and text will
            // not be inlined.
            if (config.isBuild && !config.inlineText) {
                onLoad();
                return;
            }

            masterConfig.isBuild = config.isBuild;

            var parsed = text.parseName(name),
                nonStripName = parsed.moduleName +
                    (parsed.ext ? '.' + parsed.ext : ''),
                url = req.toUrl(nonStripName),
                useXhr = (masterConfig.useXhr) ||
                         text.useXhr;

            // Do not load if it is an empty: url
            if (url.indexOf('empty:') === 0) {
                onLoad();
                return;
            }

            //Load the text. Use XHR if possible and in a browser.
            if (!hasLocation || useXhr(url, defaultProtocol, defaultHostName, defaultPort)) {
                text.get(url, function (content) {
                    text.finishLoad(name, parsed.strip, content, onLoad);
                }, function (err) {
                    if (onLoad.error) {
                        onLoad.error(err);
                    }
                });
            } else {
                //Need to fetch the resource across domains. Assume
                //the resource has been optimized into a JS module. Fetch
                //by the module name + extension, but do not include the
                //!strip part to avoid file system issues.
                req([nonStripName], function (content) {
                    text.finishLoad(parsed.moduleName + '.' + parsed.ext,
                                    parsed.strip, content, onLoad);
                });
            }
        },

        write: function (pluginName, moduleName, write, config) {
            if (buildMap.hasOwnProperty(moduleName)) {
                var content = text.jsEscape(buildMap[moduleName]);
                write.asModule(pluginName + "!" + moduleName,
                               "define(function () { return '" +
                                   content +
                               "';});\n");
            }
        },

        writeFile: function (pluginName, moduleName, req, write, config) {
            var parsed = text.parseName(moduleName),
                extPart = parsed.ext ? '.' + parsed.ext : '',
                nonStripName = parsed.moduleName + extPart,
                //Use a '.js' file name so that it indicates it is a
                //script that can be loaded across domains.
                fileName = req.toUrl(parsed.moduleName + extPart) + '.js';

            //Leverage own load() method to load plugin value, but only
            //write out values that do not have the strip argument,
            //to avoid any potential issues with ! in file names.
            text.load(nonStripName, req, function (value) {
                //Use own write() method to construct full module value.
                //But need to create shell that translates writeFile's
                //write() to the right interface.
                var textWrite = function (contents) {
                    return write(fileName, contents);
                };
                textWrite.asModule = function (moduleName, contents) {
                    return write.asModule(moduleName, fileName, contents);
                };

                text.write(pluginName, nonStripName, textWrite, config);
            }, config);
        }
    };

    if (masterConfig.env === 'node' || (!masterConfig.env &&
            typeof process !== "undefined" &&
            process.versions &&
            !!process.versions.node &&
            !process.versions['node-webkit'])) {
        //Using special require.nodeRequire, something added by r.js.
        fs = require.nodeRequire('fs');

        text.get = function (url, callback, errback) {
            try {
                var file = fs.readFileSync(url, 'utf8');
                //Remove BOM (Byte Mark Order) from utf8 files if it is there.
                if (file.indexOf('\uFEFF') === 0) {
                    file = file.substring(1);
                }
                callback(file);
            } catch (e) {
                errback(e);
            }
        };
    } else if (masterConfig.env === 'xhr' || (!masterConfig.env &&
            text.createXhr())) {
        text.get = function (url, callback, errback, headers) {
            var xhr = text.createXhr(), header;
            xhr.open('GET', url, true);

            //Allow plugins direct access to xhr headers
            if (headers) {
                for (header in headers) {
                    if (headers.hasOwnProperty(header)) {
                        xhr.setRequestHeader(header.toLowerCase(), headers[header]);
                    }
                }
            }

            //Allow overrides specified in config
            if (masterConfig.onXhr) {
                masterConfig.onXhr(xhr, url);
            }

            xhr.onreadystatechange = function (evt) {
                var status, err;
                //Do not explicitly handle errors, those should be
                //visible via console output in the browser.
                if (xhr.readyState === 4) {
                    status = xhr.status;
                    if (status > 399 && status < 600) {
                        //An http 4xx or 5xx error. Signal an error.
                        err = new Error(url + ' HTTP status: ' + status);
                        err.xhr = xhr;
                        errback(err);
                    } else {
                        callback(xhr.responseText);
                    }

                    if (masterConfig.onXhrComplete) {
                        masterConfig.onXhrComplete(xhr, url);
                    }
                }
            };
            xhr.send(null);
        };
    } else if (masterConfig.env === 'rhino' || (!masterConfig.env &&
            typeof Packages !== 'undefined' && typeof java !== 'undefined')) {
        //Why Java, why is this so awkward?
        text.get = function (url, callback) {
            var stringBuffer, line,
                encoding = "utf-8",
                file = new java.io.File(url),
                lineSeparator = java.lang.System.getProperty("line.separator"),
                input = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(file), encoding)),
                content = '';
            try {
                stringBuffer = new java.lang.StringBuffer();
                line = input.readLine();

                // Byte Order Mark (BOM) - The Unicode Standard, version 3.0, page 324
                // http://www.unicode.org/faq/utf_bom.html

                // Note that when we use utf-8, the BOM should appear as "EF BB BF", but it doesn't due to this bug in the JDK:
                // http://bugs.sun.com/bugdatabase/view_bug.do?bug_id=4508058
                if (line && line.length() && line.charAt(0) === 0xfeff) {
                    // Eat the BOM, since we've already found the encoding on this file,
                    // and we plan to concatenating this buffer with others; the BOM should
                    // only appear at the top of a file.
                    line = line.substring(1);
                }

                if (line !== null) {
                    stringBuffer.append(line);
                }

                while ((line = input.readLine()) !== null) {
                    stringBuffer.append(lineSeparator);
                    stringBuffer.append(line);
                }
                //Make sure we return a JavaScript string and not a Java string.
                content = String(stringBuffer.toString()); //String
            } finally {
                input.close();
            }
            callback(content);
        };
    } else if (masterConfig.env === 'xpconnect' || (!masterConfig.env &&
            typeof Components !== 'undefined' && Components.classes &&
            Components.interfaces)) {
        //Avert your gaze!
        Cc = Components.classes,
        Ci = Components.interfaces;
        Components.utils['import']('resource://gre/modules/FileUtils.jsm');
        xpcIsWindows = ('@mozilla.org/windows-registry-key;1' in Cc);

        text.get = function (url, callback) {
            var inStream, convertStream, fileObj,
                readData = {};

            if (xpcIsWindows) {
                url = url.replace(/\//g, '\\');
            }

            fileObj = new FileUtils.File(url);

            //XPCOM, you so crazy
            try {
                inStream = Cc['@mozilla.org/network/file-input-stream;1']
                           .createInstance(Ci.nsIFileInputStream);
                inStream.init(fileObj, 1, 0, false);

                convertStream = Cc['@mozilla.org/intl/converter-input-stream;1']
                                .createInstance(Ci.nsIConverterInputStream);
                convertStream.init(inStream, "utf-8", inStream.available(),
                Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);

                convertStream.readString(inStream.available(), readData);
                convertStream.close();
                inStream.close();
                callback(readData.value);
            } catch (e) {
                throw new Error((fileObj && fileObj.path || '') + ': ' + e);
            }
        };
    }
    return text;
});

/** @license
 * RequireJS plugin for loading JSON files
 * - depends on Text plugin and it was HEAVILY "inspired" by it as well.
 * Author: Miller Medeiros
 * Version: 0.3.1 (2013/02/04)
 * Released under the MIT license
 */
define('json',['text'], function(text){

    var CACHE_BUST_QUERY_PARAM = 'bust',
        CACHE_BUST_FLAG = '!bust',
        jsonParse = (typeof JSON !== 'undefined' && typeof JSON.parse === 'function')? JSON.parse : function(val){
            return eval('('+ val +')'); //quick and dirty
        },
        buildMap = {};

    function cacheBust(url){
        url = url.replace(CACHE_BUST_FLAG, '');
        url += (url.indexOf('?') < 0)? '?' : '&';
        return url + CACHE_BUST_QUERY_PARAM +'='+ Math.round(2147483647 * Math.random());
    }

    //API
    return {

        load : function(name, req, onLoad, config) {
            if ( config.isBuild && (config.inlineJSON === false || name.indexOf(CACHE_BUST_QUERY_PARAM +'=') !== -1) ) {
                //avoid inlining cache busted JSON or if inlineJSON:false
                onLoad(null);
            } else {
                text.get(req.toUrl(name), function(data){
                    if (config.isBuild) {
                        buildMap[name] = data;
                        onLoad(data);
                    } else {
                        onLoad(jsonParse(data));
                    }
                },
                    onLoad.error, {
                        accept: 'application/json'
                    }
                );
            }
        },

        normalize : function (name, normalize) {
            //used normalize to avoid caching references to a "cache busted" request
            return (name.indexOf(CACHE_BUST_FLAG) === -1)? name : cacheBust(name);
        },

        //write method based on RequireJS official text plugin by James Burke
        //https://github.com/jrburke/requirejs/blob/master/text.js
        write : function(pluginName, moduleName, write){
            if(moduleName in buildMap){
                var content = buildMap[moduleName];
                write('define("'+ pluginName +'!'+ moduleName +'", function(){ return '+ content +';});\n');
            }
        }

    };
});

define("json!../media/photos.json", function(){ return {
  "paths": [
    "media/Finn.png",
    "media/finn___the_human_by_sbddbz-d5ks7oo.png",
    "media/Original_Finn.png"
  ]
};});

if(typeof Magi=="undefined"){Magi={}}if(!Magi.Stats){Magi.Stats={vec2CreateCount:0,vec3CreateCount:0,vec4CreateCount:0,mat3CreateCount:0,mat4CreateCount:0,quat4CreateCount:0}}if(typeof Float32Array!="undefined"){glMatrixArrayType=Float32Array}else{glMatrixArrayType=Array}var vec3={};vec3.create=function(b,d,c){var a=new glMatrixArrayType(3);Magi.Stats.vec3CreateCount++;if(d!=null){a[0]=b;a[1]=d;a[2]=c}else{if(b){a[0]=b[0];a[1]=b[1];a[2]=b[2]}}return a};vec4={};vec4.create=function(c,e,d,a){var b=new glMatrixArrayType(4);Magi.Stats.vec4CreateCount++;if(e!=null){b[0]=c;b[1]=e;b[2]=d;b[3]=a}else{if(c){b[0]=c[0];b[1]=c[1];b[2]=c[2];b[3]=c[3]}}return b};vec4.set=function(b,a){a[0]=b[0];a[1]=b[1];a[2]=b[2];a[3]=b[3];return a};vec4.setLeft=function(a,b){a[0]=b[0];a[1]=b[1];a[2]=b[2];a[3]=b[3];return a};vec2={};vec2.create=function(b,c){var a=new glMatrixArrayType(2);Magi.Stats.vec2CreateCount++;if(c!=null){a[0]=b;a[1]=c}else{if(b){a[0]=b[0];a[1]=b[1]}}return a};vec2.set=function(b,a){a[0]=b[0];a[1]=b[1];return a};vec2.setLeft=function(a,b){a[0]=b[0];a[1]=b[1];return a};vec3.set=function(b,a){a[0]=b[0];a[1]=b[1];a[2]=b[2];return a};vec3.setLeft=function(a,b){a[0]=b[0];a[1]=b[1];a[2]=b[2];return a};vec3.set3=function(b,a){a[0]=a[1]=a[2]=b;return a};vec3.add=function(b,c,a){if(!a||b==a){b[0]+=c[0];b[1]+=c[1];b[2]+=c[2];return b}a[0]=b[0]+c[0];a[1]=b[1]+c[1];a[2]=b[2]+c[2];return a};vec3.subtract=function(b,c,a){if(!a||b==a){b[0]-=c[0];b[1]-=c[1];b[2]-=c[2];return b}a[0]=b[0]-c[0];a[1]=b[1]-c[1];a[2]=b[2]-c[2];return a};vec3.sub=vec3.subtract;vec3.negate=function(b,a){if(!a){a=b}a[0]=-b[0];a[1]=-b[1];a[2]=-b[2];return a};vec3.scale=function(b,c,a){if(!a||b==a){b[0]*=c;b[1]*=c;b[2]*=c;return b}a[0]=b[0]*c;a[1]=b[1]*c;a[2]=b[2]*c;return a};vec3.multiply=function(b,c,a){if(!a||b==a){b[0]*=c[0];b[1]*=c[1];b[2]*=c[2];return b}a[0]=b[0]*c[0];a[1]=b[1]*c[1];a[2]=b[2]*c[2];return a};vec3.mul=vec3.multiply;vec3.normalize=function(d,c){if(!c){c=d}var b=d[0],f=d[1],e=d[2];var a=Math.sqrt(b*b+f*f+e*e);if(!a){c[0]=0;c[1]=0;c[2]=0;return c}else{if(a==1){c[0]=b;c[1]=f;c[2]=e;return c}}a=1/a;c[0]=b*a;c[1]=f*a;c[2]=e*a;return c};vec3.cross=function(b,d,i){if(!i){i=b}var h=b[0],f=b[1],e=b[2];var a=d[0],g=d[1],c=d[2];i[0]=f*c-e*g;i[1]=e*a-h*c;i[2]=h*g-f*a;return i};vec3.length=function(b){var a=b[0],d=b[1],c=b[2];return Math.sqrt(a*a+d*d+c*c)};vec3.lengthSquare=function(b){var a=b[0],d=b[1],c=b[2];return a*a+d*d+c*c};vec3.dot=function(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]};vec3.direction=function(d,e,c){if(!c){c=d}var b=d[0]-e[0];var g=d[1]-e[1];var f=d[2]-e[2];var a=Math.sqrt(b*b+g*g+f*f);if(!a){c[0]=0;c[1]=0;c[2]=0;return c}a=1/a;c[0]=b*a;c[1]=g*a;c[2]=f*a;return c};vec3.distance=function(c,d){var b=c[0]-d[0];var f=c[1]-d[1];var e=c[2]-d[2];var a=Math.sqrt(b*b+f*f+e*e);return a};vec3.str=function(a){return"["+a[0]+", "+a[1]+", "+a[2]+"]"};var mat3={};mat3.create=function(b){var a=new glMatrixArrayType(9);Magi.Stats.mat3CreateCount++;if(b){a[0]=b[0];a[1]=b[1];a[2]=b[2];a[3]=b[3];a[4]=b[4];a[5]=b[5];a[6]=b[6];a[7]=b[7];a[8]=b[8];a[9]=b[9]}return a};mat3.set=function(b,a){a[0]=b[0];a[1]=b[1];a[2]=b[2];a[3]=b[3];a[4]=b[4];a[5]=b[5];a[6]=b[6];a[7]=b[7];a[8]=b[8];return a};mat3.identity=function(a){if(a==null){a=mat3.create()}a[0]=1;a[1]=0;a[2]=0;a[3]=0;a[4]=1;a[5]=0;a[6]=0;a[7]=0;a[8]=1;return a};mat3.toMat4=function(b,a){if(!a){a=mat4.create()}a[0]=b[0];a[1]=b[1];a[2]=b[2];a[3]=0;a[4]=b[3];a[5]=b[4];a[6]=b[5];a[7]=0;a[8]=b[6];a[9]=b[7];a[10]=b[8];a[11]=0;a[12]=0;a[13]=0;a[14]=0;a[15]=1;return a};mat3.transpose=function(d,c){if(!c||d==c){var b=d[1],a=d[2],e=d[5];d[1]=d[3];d[2]=d[6];d[5]=d[7];d[3]=b;d[6]=a;d[7]=e;return d}c[0]=d[0];c[1]=d[3];c[2]=d[6];c[3]=d[1];c[4]=d[4];c[5]=d[7];c[6]=d[2];c[7]=d[5];c[8]=d[8];return c};mat3.multiplyVec3=function(d,c,b){if(!b){b=c}var a=c[0],f=c[1],e=c[2];b[0]=d[0]*a+d[3]*f+d[6]*e;b[1]=d[1]*a+d[4]*f+d[7]*e;b[2]=d[2]*a+d[5]*f+d[8]*e;return b};mat3.str=function(a){return"["+a[0]+", "+a[1]+", "+a[2]+", "+a[3]+", "+a[4]+", "+a[5]+", "+a[6]+", "+a[7]+", "+a[8]+"]"};var mat4={};mat4.create=function(b){var a=new glMatrixArrayType(16);Magi.Stats.mat4CreateCount++;if(b){a[0]=b[0];a[1]=b[1];a[2]=b[2];a[3]=b[3];a[4]=b[4];a[5]=b[5];a[6]=b[6];a[7]=b[7];a[8]=b[8];a[9]=b[9];a[10]=b[10];a[11]=b[11];a[12]=b[12];a[13]=b[13];a[14]=b[14];a[15]=b[15]}return a};mat4.set=function(b,a){a[0]=b[0];a[1]=b[1];a[2]=b[2];a[3]=b[3];a[4]=b[4];a[5]=b[5];a[6]=b[6];a[7]=b[7];a[8]=b[8];a[9]=b[9];a[10]=b[10];a[11]=b[11];a[12]=b[12];a[13]=b[13];a[14]=b[14];a[15]=b[15];return a};mat4.identity=function(a){if(a==null){a=mat4.create()}a[0]=1;a[1]=0;a[2]=0;a[3]=0;a[4]=0;a[5]=1;a[6]=0;a[7]=0;a[8]=0;a[9]=0;a[10]=1;a[11]=0;a[12]=0;a[13]=0;a[14]=0;a[15]=1;return a};mat4.transpose=function(d,c){if(!c||d==c){var h=d[1],f=d[2],e=d[3];var a=d[6],g=d[7];var b=d[11];d[1]=d[4];d[2]=d[8];d[3]=d[12];d[4]=h;d[6]=d[9];d[7]=d[13];d[8]=f;d[9]=a;d[11]=d[14];d[12]=e;d[13]=g;d[14]=b;return d}c[0]=d[0];c[1]=d[4];c[2]=d[8];c[3]=d[12];c[4]=d[1];c[5]=d[5];c[6]=d[9];c[7]=d[13];c[8]=d[2];c[9]=d[6];c[10]=d[10];c[11]=d[14];c[12]=d[3];c[13]=d[7];c[14]=d[11];c[15]=d[15];return c};mat4.determinant=function(o){var h=o[0],g=o[1],e=o[2],c=o[3];var q=o[4],p=o[5],n=o[6],m=o[7];var l=o[8],k=o[9],j=o[10],i=o[11];var f=o[12],d=o[13],b=o[14],a=o[15];return f*k*n*c-l*d*n*c-f*p*j*c+q*d*j*c+l*p*b*c-q*k*b*c-f*k*e*m+l*d*e*m+f*g*j*m-h*d*j*m-l*g*b*m+h*k*b*m+f*p*e*i-q*d*e*i-f*g*n*i+h*d*n*i+q*g*b*i-h*p*b*i-l*p*e*a+q*k*e*a+l*g*n*a-h*k*n*a-q*g*j*a+h*p*j*a};mat4.inverse=function(v,k){if(!k){k=v}var C=v[0],A=v[1],z=v[2],x=v[3];var d=v[4],c=v[5],b=v[6],a=v[7];var s=v[8],r=v[9],q=v[10],p=v[11];var F=v[12],D=v[13],B=v[14],y=v[15];var o=C*c-A*d;var n=C*b-z*d;var m=C*a-x*d;var l=A*b-z*c;var j=A*a-x*c;var i=z*a-x*b;var h=s*D-r*F;var g=s*B-q*F;var f=s*y-p*F;var e=r*B-q*D;var w=r*y-p*D;var u=q*y-p*B;var t=1/(o*u-n*w+m*e+l*f-j*g+i*h);k[0]=(c*u-b*w+a*e)*t;k[1]=(-A*u+z*w-x*e)*t;k[2]=(D*i-B*j+y*l)*t;k[3]=(-r*i+q*j-p*l)*t;k[4]=(-d*u+b*f-a*g)*t;k[5]=(C*u-z*f+x*g)*t;k[6]=(-F*i+B*m-y*n)*t;k[7]=(s*i-q*m+p*n)*t;k[8]=(d*w-c*f+a*h)*t;k[9]=(-C*w+A*f-x*h)*t;k[10]=(F*j-D*m+y*o)*t;k[11]=(-s*j+r*m-p*o)*t;k[12]=(-d*e+c*g-b*h)*t;k[13]=(C*e-A*g+z*h)*t;k[14]=(-F*l+D*n-B*o)*t;k[15]=(s*l-r*n+q*o)*t;return k};mat4.toRotationMat=function(b,a){if(!a){a=mat4.create()}a[0]=b[0];a[1]=b[1];a[2]=b[2];a[3]=b[3];a[4]=b[4];a[5]=b[5];a[6]=b[6];a[7]=b[7];a[8]=b[8];a[9]=b[9];a[10]=b[10];a[11]=b[11];a[12]=0;a[13]=0;a[14]=0;a[15]=1;return a};mat4.toMat3=function(b,a){if(!a){a=mat3.create()}a[0]=b[0];a[1]=b[1];a[2]=b[2];a[3]=b[4];a[4]=b[5];a[5]=b[6];a[6]=b[8];a[7]=b[9];a[8]=b[10];return a};mat4.toInverseMat3=function(o,m){var f=o[0],e=o[1],c=o[2];var q=o[4],p=o[5],n=o[6];var j=o[8],i=o[9],h=o[10];var g=h*p-n*i;var b=-h*q+n*j;var l=i*q-p*j;var k=f*g+e*b+c*l;if(!k){return null}var a=1/k;if(!m){m=mat3.create()}m[0]=g*a;m[1]=(-h*e+c*i)*a;m[2]=(n*e-c*p)*a;m[3]=b*a;m[4]=(h*f-c*j)*a;m[5]=(-n*f+c*q)*a;m[6]=l*a;m[7]=(-i*f+e*j)*a;m[8]=(p*f-e*q)*a;return m};mat4.multiply=function(z,i,j){if(!j){j=z}var H=z[0],G=z[1],D=z[2],B=z[3];var h=z[4],g=z[5],f=z[6],e=z[7];var v=z[8],u=z[9],t=z[10],s=z[11];var J=z[12],I=z[13],F=z[14],C=z[15];var q=i[0],o=i[1],m=i[2],k=i[3];var A=i[4],y=i[5],x=i[6],w=i[7];var d=i[8],c=i[9],b=i[10],a=i[11];var r=i[12],p=i[13],n=i[14],l=i[15];j[0]=q*H+o*h+m*v+k*J;j[1]=q*G+o*g+m*u+k*I;j[2]=q*D+o*f+m*t+k*F;j[3]=q*B+o*e+m*s+k*C;j[4]=A*H+y*h+x*v+w*J;j[5]=A*G+y*g+x*u+w*I;j[6]=A*D+y*f+x*t+w*F;j[7]=A*B+y*e+x*s+w*C;j[8]=d*H+c*h+b*v+a*J;j[9]=d*G+c*g+b*u+a*I;j[10]=d*D+c*f+b*t+a*F;j[11]=d*B+c*e+b*s+a*C;j[12]=r*H+p*h+n*v+l*J;j[13]=r*G+p*g+n*u+l*I;j[14]=r*D+p*f+n*t+l*F;j[15]=r*B+p*e+n*s+l*C;return j};mat4.multiplyVec3=function(d,c,b){if(!b){b=c}var a=c[0],f=c[1],e=c[2];b[0]=d[0]*a+d[4]*f+d[8]*e+d[12];b[1]=d[1]*a+d[5]*f+d[9]*e+d[13];b[2]=d[2]*a+d[6]*f+d[10]*e+d[14];return b};mat4.multiplyVec4=function(e,d,c){if(!c){c=d}var a=d[0],g=d[1],f=d[2],b=d[3];c[0]=e[0]*a+e[4]*g+e[8]*f+e[12]*b;c[1]=e[1]*a+e[5]*g+e[9]*f+e[13]*b;c[2]=e[2]*a+e[6]*g+e[10]*f+e[14]*b;c[3]=e[3]*a+e[7]*g+e[11]*f+e[15]*b;return c};mat4.translate=function(n,i,g){var h=i[0],f=i[1],e=i[2];if(!g||n==g){n[12]=n[0]*h+n[4]*f+n[8]*e+n[12];n[13]=n[1]*h+n[5]*f+n[9]*e+n[13];n[14]=n[2]*h+n[6]*f+n[10]*e+n[14];n[15]=n[3]*h+n[7]*f+n[11]*e+n[15];return n}var r=n[0],q=n[1],p=n[2],o=n[3];var d=n[4],c=n[5],b=n[6],a=n[7];var m=n[8],l=n[9],k=n[10],j=n[11];g[0]=r;g[1]=q;g[2]=p;g[3]=o;g[4]=d;g[5]=c;g[6]=b;g[7]=a;g[8]=m;g[9]=l;g[10]=k;g[11]=j;g[12]=r*h+d*f+m*e+n[12];g[13]=q*h+c*f+l*e+n[13];g[14]=p*h+b*f+k*e+n[14];g[15]=o*h+a*f+j*e+n[15];return g};mat4.scale=function(d,c,b){var a=c[0],f=c[1],e=c[2];if(!b||d===b){d[0]*=a;d[1]*=a;d[2]*=a;d[3]*=a;d[4]*=f;d[5]*=f;d[6]*=f;d[7]*=f;d[8]*=e;d[9]*=e;d[10]*=e;d[11]*=e;return d}b[0]=d[0]*a;b[1]=d[1]*a;b[2]=d[2]*a;b[3]=d[3]*a;b[4]=d[4]*f;b[5]=d[5]*f;b[6]=d[6]*f;b[7]=d[7]*f;b[8]=d[8]*e;b[9]=d[9]*e;b[10]=d[10]*e;b[11]=d[11]*e;b[12]=d[12];b[13]=d[13];b[14]=d[14];b[15]=d[15];return b};mat4.billboard=function(g,f){var e=g[0],d=g[5],i=g[10];e=e*e;d=d*d;i=i*i;var h=e>d?e:d;h=h>i?h:i;h=Math.sqrt(h);if(!f||g===f){g[0]=h;g[1]=0;g[2]=0;g[4]=0;g[5]=h;g[6]=0;g[8]=0;g[9]=0;g[10]=h;return g}f[0]=h;f[1]=0;f[2]=0;f[3]=g[3];f[4]=0;f[5]=h;f[6]=0;f[7]=g[7];f[8]=0;f[9]=0;f[10]=h;f[11]=g[11];f[12]=g[12];f[13]=g[13];f[14]=g[14];f[15]=g[15];return f};mat4.rotate=function(G,D,a,l){var m=a[0],k=a[1],j=a[2];var B=Math.sqrt(m*m+k*k+j*j);if(!B){return null}if(B!=1){B=1/B;m*=B;k*=B;j*=B}var r=Math.sin(D);var I=Math.cos(D);var q=1-I;var M=G[0],L=G[1],K=G[2],J=G[3];var i=G[4],h=G[5],g=G[6],f=G[7];var A=G[8],w=G[9],v=G[10],u=G[11];var p=m*m*q+I,o=k*m*q+j*r,n=j*m*q-k*r;var H=m*k*q-j*r,F=k*k*q+I,C=j*k*q+m*r;var e=m*j*q+k*r,d=k*j*q-m*r,b=j*j*q+I;if(!l){l=G}else{if(G!=l){l[12]=G[12];l[13]=G[13];l[14]=G[14];l[15]=G[15]}}l[0]=M*p+i*o+A*n;l[1]=L*p+h*o+w*n;l[2]=K*p+g*o+v*n;l[3]=J*p+f*o+u*n;l[4]=M*H+i*F+A*C;l[5]=L*H+h*F+w*C;l[6]=K*H+g*F+v*C;l[7]=J*H+f*F+u*C;l[8]=M*e+i*d+A*b;l[9]=L*e+h*d+w*b;l[10]=K*e+g*d+v*b;l[11]=J*e+f*d+u*b;return l};mat4.rotateX=function(k,a,i){var n=Math.sin(a);var g=Math.cos(a);var m=k[4],l=k[5],j=k[6],h=k[7];var f=k[8],e=k[9],d=k[10],b=k[11];if(!i){i=k}else{if(k!=i){i[0]=k[0];i[1]=k[1];i[2]=k[2];i[3]=k[3];i[12]=k[12];i[13]=k[13];i[14]=k[14];i[15]=k[15]}}i[4]=m*g+f*n;i[5]=l*g+e*n;i[6]=j*g+d*n;i[7]=h*g+b*n;i[8]=m*-n+f*g;i[9]=l*-n+e*g;i[10]=j*-n+d*g;i[11]=h*-n+b*g;return i};mat4.rotateY=function(m,e,l){var n=Math.sin(e);var k=Math.cos(e);var f=m[0],d=m[1],b=m[2],a=m[3];var j=m[8],i=m[9],h=m[10],g=m[11];if(!l){l=m}else{if(m!=l){l[4]=m[4];l[5]=m[5];l[6]=m[6];l[7]=m[7];l[12]=m[12];l[13]=m[13];l[14]=m[14];l[15]=m[15]}}l[0]=f*k+j*-n;l[1]=d*k+i*-n;l[2]=b*k+h*-n;l[3]=a*k+g*-n;l[8]=f*n+j*k;l[9]=d*n+i*k;l[10]=b*n+h*k;l[11]=a*n+g*k;return l};mat4.rotateZ=function(l,e,i){var n=Math.sin(e);var g=Math.cos(e);var f=l[0],d=l[1],b=l[2],a=l[3];var m=l[4],k=l[5],j=l[6],h=l[7];if(!i){i=l}else{if(l!=i){i[8]=l[8];i[9]=l[9];i[10]=l[10];i[11]=l[11];i[12]=l[12];i[13]=l[13];i[14]=l[14];i[15]=l[15]}}i[0]=f*g+m*n;i[1]=d*g+k*n;i[2]=b*g+j*n;i[3]=a*g+h*n;i[4]=f*-n+m*g;i[5]=d*-n+k*g;i[6]=b*-n+j*g;i[7]=a*-n+h*g;return i};mat4.frustum=function(b,j,a,h,e,d,i){if(!i){i=mat4.create()}var f=(j-b);var c=(h-a);var g=(d-e);i[0]=(e*2)/f;i[1]=0;i[2]=0;i[3]=0;i[4]=0;i[5]=(e*2)/c;i[6]=0;i[7]=0;i[8]=(j+b)/f;i[9]=(h+a)/c;i[10]=-(d+e)/g;i[11]=-1;i[12]=0;i[13]=0;i[14]=-(d*e*2)/g;i[15]=0;return i};mat4.perspective=function(c,b,f,a,d){var g=f*Math.tan(c*Math.PI/360);var e=g*b;return mat4.frustum(-e,e,-g,g,f,a,d)};mat4.ortho=function(b,j,a,h,e,d,i){if(!i){i=mat4.create()}var f=(j-b);var c=(h-a);var g=(d-e);i[0]=2/f;i[1]=0;i[2]=0;i[3]=0;i[4]=0;i[5]=2/c;i[6]=0;i[7]=0;i[8]=0;i[9]=0;i[10]=-2/g;i[11]=0;i[12]=-(b+j)/f;i[13]=-(h+a)/c;i[14]=-(d+e)/g;i[15]=1;return i};mat4.lookAt=function(v,w,h,g){if(!g){g=mat4.create()}var t=v[0],r=v[1],o=v[2],f=h[0],e=h[1],d=h[2],n=w[0],m=w[1],l=w[2];if(t==n&&r==m&&o==l){return mat4.identity(g)}var k,j,i,u,s,q,c,b,a,p;k=t-w[0];j=r-w[1];i=o-w[2];p=1/Math.sqrt(k*k+j*j+i*i);k*=p;j*=p;i*=p;u=e*i-d*j;s=d*k-f*i;q=f*j-e*k;p=Math.sqrt(u*u+s*s+q*q);if(!p){u=0;s=0;q=0}else{p=1/p;u*=p;s*=p;q*=p}c=j*q-i*s;b=i*u-k*q;a=k*s-j*u;p=Math.sqrt(c*c+b*b+a*a);if(!p){c=0;b=0;a=0}else{p=1/p;c*=p;b*=p;a*=p}g[0]=u;g[1]=c;g[2]=k;g[3]=0;g[4]=s;g[5]=b;g[6]=j;g[7]=0;g[8]=q;g[9]=a;g[10]=i;g[11]=0;g[12]=-(u*t+s*r+q*o);g[13]=-(c*t+b*r+a*o);g[14]=-(k*t+j*r+i*o);g[15]=1;return g};mat4.str=function(a){return"["+a[0]+", "+a[1]+", "+a[2]+", "+a[3]+", "+a[4]+", "+a[5]+", "+a[6]+", "+a[7]+", "+a[8]+", "+a[9]+", "+a[10]+", "+a[11]+", "+a[12]+", "+a[13]+", "+a[14]+", "+a[15]+"]"};quat4={};quat4.create=function(b){var a=new glMatrixArrayType(4);Magi.Stats.quat4CreateCount++;if(b){a[0]=b[0];a[1]=b[1];a[2]=b[2];a[3]=b[3]}return a};quat4.set=function(b,a){a[0]=b[0];a[1]=b[1];a[2]=b[2];a[3]=b[3];return a};quat4.calculateW=function(c,b){var a=c[0],e=c[1],d=c[2];if(!b||c==b){c[3]=-Math.sqrt(Math.abs(1-a*a-e*e-d*d));return c}b[0]=a;b[1]=e;b[2]=d;b[3]=-Math.sqrt(Math.abs(1-a*a-e*e-d*d));return b};quat4.inverse=function(b,a){if(!a||b==a){b[0]*=1;b[1]*=1;b[2]*=1;return b}a[0]=-b[0];a[1]=-b[1];a[2]=-b[2];a[3]=b[3];return a};quat4.length=function(c){var a=c[0],e=c[1],d=c[2],b=c[3];return Math.sqrt(a*a+e*e+d*d+b*b)};quat4.normalize=function(e,d){if(!d){d=e}var b=e[0],g=e[1],f=e[2],c=e[3];var a=Math.sqrt(b*b+g*g+f*f+c*c);if(a==0){d[0]=0;d[1]=0;d[2]=0;d[3]=0;return d}a=1/a;d[0]=b*a;d[1]=g*a;d[2]=f*a;d[3]=c*a;return d};quat4.multiply=function(b,d,k){if(!k){k=b}var i=b[0],h=b[1],g=b[2],j=b[3];var e=d[0],c=d[1],a=d[2],f=d[3];k[0]=i*f+j*e+h*a-g*c;k[1]=h*f+j*c+g*e-i*a;k[2]=g*f+j*a+i*c-h*e;k[3]=j*f-i*e-h*c-g*a;return k};quat4.multiplyVec3=function(b,d,n){if(!n){n=d}var m=d[0],l=d[1],k=d[2];var i=b[0],h=b[1],g=b[2],j=b[3];var e=j*m+h*k-g*l;var c=j*l+g*m-i*k;var a=j*k+i*l-h*m;var f=-i*m-h*l-g*k;n[0]=e*j+f*-i+c*-g-a*-h;n[1]=c*j+f*-h+a*-i-e*-g;n[2]=a*j+f*-g+e*-h-c*-i;return n};quat4.toMat3=function(a,h){if(!h){h=mat3.create()}var i=a[0],g=a[1],f=a[2],j=a[3];var n=i+i;var b=g+g;var k=f+f;var e=i*n;var d=i*b;var c=i*k;var m=g*b;var l=g*k;var q=f*k;var r=j*n;var p=j*b;var o=j*k;h[0]=1-(m+q);h[1]=d-o;h[2]=c+p;h[3]=d+o;h[4]=1-(e+q);h[5]=l-r;h[6]=c-p;h[7]=l+r;h[8]=1-(e+m);return h};quat4.toMat4=function(a,h){if(!h){h=mat4.create()}var i=a[0],g=a[1],f=a[2],j=a[3];var n=i+i;var b=g+g;var k=f+f;var e=i*n;var d=i*b;var c=i*k;var m=g*b;var l=g*k;var q=f*k;var r=j*n;var p=j*b;var o=j*k;h[0]=1-(m+q);h[1]=d-o;h[2]=c+p;h[3]=0;h[4]=d+o;h[5]=1-(e+q);h[6]=l-r;h[7]=0;h[8]=c-p;h[9]=l+r;h[10]=1-(e+m);h[11]=0;h[12]=0;h[13]=0;h[14]=0;h[15]=1;return h};quat4.str=function(a){return"["+a[0]+", "+a[1]+", "+a[2]+", "+a[3]+"]"};if(typeof Magi=="undefined"){Magi={}}Magi.Stats={shaderBindCount:0,materialUpdateCount:0,uniformSetCount:0,textureSetCount:0,textureCreationCount:0,vertexAttribPointerCount:0,bindBufferCount:0,drawElementsCount:0,drawArraysCount:0,vec2CreateCount:0,vec3CreateCount:0,vec4CreateCount:0,mat3CreateCount:0,mat4CreateCount:0,quat4CreateCount:0,reset:function(){for(var a in this){if(typeof this[a]=="number"){this[a]=0}}},print:function(a){a.textContent="Shader bind count: "+this.shaderBindCount+"\nMaterial update count: "+this.materialUpdateCount+"\nUniform set count: "+this.uniformSetCount+"\nTexture creation count: "+this.textureCreationCount+"\nTexture set count: "+this.textureSetCount+"\nVertexAttribPointer count: "+this.vertexAttribPointerCount+"\nBind buffer count: "+this.bindBufferCount+"\nDraw elements count: "+this.drawElementsCount+"\nDraw arrays count: "+this.drawArraysCount+"\nvec2 create count: "+this.vec2CreateCount+"\nvec3 create count: "+this.vec3CreateCount+"\nvec4 create count: "+this.vec4CreateCount+"\nmat3 create count: "+this.mat3CreateCount+"\nmat4 create count: "+this.mat4CreateCount+"\nquat4 create count: "+this.quat4CreateCount+"\n"}};if(!window.toArray){toArray=function(d){var b=new Array(d.length);for(var c=0;c<d.length;c++){b[c]=d[c]}return b}}Object.forceExtend=function(d,c){for(var a in c){try{d[a]=c[a]}catch(b){}}return d};if(!Object.extend){Object.extend=Object.forceExtend}Klass=function(){var e=function(){this.initialize.apply(this,arguments)};e.ancestors=toArray(arguments);e.prototype={};for(var d=0;d<arguments.length;d++){var b=arguments[d];if(b.prototype){Object.extend(e.prototype,b.prototype)}else{Object.extend(e.prototype,b)}}Object.extend(e,e.prototype);return e};Magi.Curves={angularDistance:function(e,c){var f=Math.PI*2;var g=(c-e)%f;if(g>Math.PI){g-=f}if(g<-Math.PI){g+=f}return g},linePoint:function(d,c,f,e){if(!e){e=vec3.create()}e[0]=d[0]+(c[0]-d[0])*f;e[1]=d[1]+(c[1]-d[1])*f;e[2]=d[2]+(c[2]-d[2])*f;return e},quadraticPoint:function(k,j,h,p,m){if(!m){m=vec3.create()}var q=k[0]+(j[0]-k[0])*p;var f=j[0]+(h[0]-j[0])*p;var l=q+(f-q)*p;var o=k[1]+(j[1]-k[1])*p;var e=j[1]+(h[1]-j[1])*p;var i=o+(e-o)*p;var n=k[2]+(j[2]-k[2])*p;var d=j[2]+(h[2]-j[2])*p;var g=n+(d-n)*p;m[0]=l;m[1]=i;m[2]=g;return m},cubicPoint:function(v,u,s,q,m,k){if(!k){k=vec3.create()}var j=v[0]*3;var w=u[0]*3;var n=s[0]*3;var p=v[1]*3;var g=u[1]*3;var r=s[1]*3;var e=v[2]*3;var o=u[2]*3;var f=s[2]*3;var l=v[0]+m*(w-j+m*(j-2*w+n+m*(w-v[0]-n+q[0])));var i=v[1]+m*(g-p+m*(p-2*g+r+m*(g-v[1]-r+q[1])));var h=v[2]+m*(o-e+m*(e-2*o+f+m*(o-v[2]-f+q[2])));k[0]=l;k[1]=i;k[2]=h;return k},linearValue:function(d,c,e){return d+(c-d)*e},quadraticValue:function(g,f,k,h){var j=g+(f-g)*h;var i=f+(k-f)*h;return j+(i-j)*h},cubicValue:function(g,e,l,j,i){var k=g*3,f=e*3,h=l*3;return g+i*(f-k+i*(k-2*f+h+i*(f-g-h+j)))},catmullRomPoint:function(n,k,i,g,q,o){if(o==null){o=vec3.create()}var p=((-q+2)*q-1)*q*0.5;var f=(((3*q-5)*q)*q+2)*0.5;var e=((-3*q+4)*q+1)*q*0.5;var m=((q-1)*q*q)*0.5;var l=n[0]*p+k[0]*f+i[0]*e+g[0]*m;var j=n[1]*p+k[1]*f+i[1]*e+g[1]*m;var h=n[2]*p+k[2]*f+i[2]*e+g[2]*m;o[0]=l;o[1]=j;o[2]=h;return o},catmullRomVector:function(i,h,f,e,k,g){var m=0.5*(f[0]-i[0]+2*k*(2*i[0]-5*h[0]+4*f[0]-e[0])+3*k*k*(3*h[0]+e[0]-i[0]-3*f[0]));var l=0.5*(f[1]-i[1]+2*k*(2*i[1]-5*h[1]+4*f[1]-e[1])+3*k*k*(3*h[1]+e[1]-i[1]-3*f[1]));var j=0.5*(f[2]-i[2]+2*k*(2*i[2]-5*h[2]+4*f[2]-e[2])+3*k*k*(3*h[2]+e[2]-i[2]-3*f[2]));if(!g){g=vec3.create()}g[0]=m;g[1]=l;g[2]=j;vec3.normalize(g);return g},catmullRomPointVector:function(f,e,j,h,g,i){if(i==null){i={point:vec3.create(),vector:vec3.create()}}this.catmullRomPoint(f,e,j,h,g,i.point);this.catmullRomVector(f,e,j,h,g,i.vector);return i},lineVector:function(d,c,e){if(e==null){e=vec3.create()}vec3.sub(c,d,e);e.normalize();return e},linePointVector:function(d,c,e,f){if(f==null){f={point:vec3.create(),vector:vec3.create()}}this.linePoint(d,c,e,f.point);this.lineVector(d,c,f.vector);return f},__tmp0:vec3.create(),__tmp1:vec3.create(),__tmp2:vec3.create(),__tmp3:vec3.create(),__tmp4:vec3.create(),__tmp5:vec3.create(),quadraticVector:function(g,f,l,h,k){if(k==null){k=vec3.create()}var j=this.__tmp0,i=this.__tmp1;j=this.linePoint(g,f,h,j);i=this.linePoint(f,l,h,i);return this.lineVector(j,i,k)},quadraticPointVector:function(e,d,h,f,g){if(g==null){g={point:vec3.create(),vector:vec3.create()}}this.quadraticPoint(e,d,f,g.point);this.quadraticVector(e,d,f,g.vector);return g},cubicVector:function(h,g,n,l,i,m){if(m==null){m=vec3.create()}var k=this.__tmp2,j=this.__tmp3;k=this.quadraticPoint(h,g,n,i,k);j=this.quadraticPoint(g,n,l,i,j);return this.lineVector(k,j,m)},cubicPointVector:function(f,e,j,h,g,i){if(i==null){i={point:vec3.create(),vector:vec3.create()}}this.cubicPoint(f,e,g,i.point);this.cubicVector(f,e,g,i.vector);return i},lineLength:function(e,d){var c=(d[0]-e[0]);var g=(d[1]-e[1]);var f=(d[2]-e[2]);return Math.sqrt(c*c+g*g+f*f)},squareLineLength:function(e,d){var c=(d[0]-e[0]);var g=(d[1]-e[1]);var f=(d[2]-e[2]);return c*c+g*g+f*f},quadraticLength:function(e,d,i,f){var h=this.__tmp4,g=this.__tmp5;h=this.linePoint(e,d,2/3,h);g=this.linePoint(d,i,1/3,g);return this.cubicLength(e,h,g,i,f)},cubicLength:(function(){var a=function(c){var g=[c.slice(0)];for(var f=1;f<4;f++){g[f]=[[],[],[],[]];for(var d=0;d<4-f;d++){g[f][d][0]=0.5*(g[f-1][d][0]+g[f-1][d+1][0]);g[f][d][1]=0.5*(g[f-1][d][1]+g[f-1][d+1][1])}}var h=[];var e=[];for(var d=0;d<4;d++){h[d]=g[d][0];e[d]=g[3-d][d]}return[h,e]};var b=function(e,f){var c=0;for(var g=0;g<3;g++){c+=Curves.lineLength(e[g],e[g+1])}var h=Curves.lineLength(e[0],e[3]);if((c-h)>f){var d=a(e);c=b(d[0],f)+b(d[1],f)}return c};return function(f,e,i,h,g){if(!g){g=1}return b([f,e,i,h],g)}})(),quadraticLengthPointVector:function(f,e,k,d,g,j){var i=this.__tmp0,h=this.__tmp1;i=this.linePoint(f,e,2/3,i);h=this.linePoint(e,k,1/3,h);return this.cubicLengthPointVector(f,i,h,k,g,j)},cubicLengthPointVector:function(v,u,t,s,g,o,w){if(w==null){w={point:vec3.create(),vector:vec3.create()}}var r=this.cubicLength(v,u,t,s,o);var n=this.__tmp4;vec3.set(v,n);var j=this.__tmp5;vec3.set(v,j);var k=0;var e=0;var f=g*r;var m=20;var h=1/m;for(var q=1;q<=m;q++){vec3.set(n,j);this.cubicPoint(v,u,t,s,h*q,n);k=e;e+=this.lineLength(j,n);if(e>=f){if(e==k){vec3.set(n,w.point);this.lineVector(v,u,w.vector);return w}var p=e-f;var l=p/(e-k);this.linePoint(j,n,1-l,w.point);this.cubicVector(v,u,t,s,h*(q-l),w.vector);return w}}vec3.set(s,w.point);this.lineVector(t,s,w.vector);return w}};Magi.Colors={hsl2rgb:function(k,t,i){var a,m,o;if(t==0){a=m=o=i}else{var c=(i<0.5?i*(1+t):i+t-(i*t));var d=2*i-c;var f=(k%360)/360;var n=f+1/3;var e=f;var j=f-1/3;if(n<0){n++}if(n>1){n--}if(e<0){e++}if(e>1){e--}if(j<0){j++}if(j>1){j--}if(n<1/6){a=d+((c-d)*6*n)}else{if(n<1/2){a=c}else{if(n<2/3){a=d+((c-d)*6*(2/3-n))}else{a=d}}}if(e<1/6){m=d+((c-d)*6*e)}else{if(e<1/2){m=c}else{if(e<2/3){m=d+((c-d)*6*(2/3-e))}else{m=d}}}if(j<1/6){o=d+((c-d)*6*j)}else{if(j<1/2){o=c}else{if(j<2/3){o=d+((c-d)*6*(2/3-j))}else{o=d}}}}return[a,m,o]},hsv2rgb:function(j,u,n){var a,k,m;if(u==0){a=k=m=n}else{j=(j%360)/60;var e=Math.floor(j);var l=j-e;var d=n*(1-u);var c=n*(1-u*l);var o=n*(1-u*(1-l));switch(e){case 0:a=n;k=o;m=d;break;case 1:a=c;k=n;m=d;break;case 2:a=d;k=n;m=o;break;case 3:a=d;k=c;m=n;break;case 4:a=o;k=d;m=n;break;case 5:a=n;k=d;m=c;break}}return[a,k,m]}};R=function(e,c){var b=[];for(var d=e;d<c;d++){b.push(d)}return b};Rg=function(b,a){return R(b,a+1)};Array.prototype.deleteFirst=function(b){for(var a=0;a<this.length;a++){if(this[a]==b){this.splice(a,1);return true}}return false};Array.prototype.stableSort=function(b){for(var a=0;a<this.length;a++){this[a].__stableSortIndex=a}this.sort(function(d,c){var e=b(d,c);if(e==0){e=d.__stableSortIndex-c.__stableSortIndex}return e});for(var a=0;a<this.length;a++){delete this[a].__stableSortIndex}};Array.prototype.all=function(b){for(var a=0;a<this.length;a++){if(!b(this[a],a,this)){return false}}return true};Array.prototype.any=function(b){for(var a=0;a<this.length;a++){if(b(this[a],a,this)){return true}}return false};Array.prototype.allIn=function(a){return this.all(function(b){return a[b]!=null})};Array.prototype.anyIn=function(a){return this.any(function(b){return a[b]!=null})};Array.prototype.equals=function(f){if(!f){return false}if(this.length!=f.length){return false}for(var e=0;e<this.length;e++){var d=this[e];var c=f[e];if(d.equals&&typeof(d.equals)=="function"){if(!d.equals(c)){return false}}else{if(d!=c){return false}}}return true};Array.prototype.rotate=function(a){if(a){this.unshift(this.pop());return this[0]}else{this.push(this.shift());return this[this.length-1]}};Array.prototype.random=function(){return this[Math.floor(Math.random()*this.length)]};Array.prototype.flatten=function(){var c=[];for(var f=0;f<this.length;f++){var g=this[f];if(g.flatten){var b=g.flatten();for(var d=0;d<b.length;d++){c[c.length]=b[d]}}else{c[c.length]=g}}return c};Array.prototype.take=function(){var b=[];for(var d=0;d<this.length;d++){var f=[];for(var c=0;c<arguments.length;c++){f[c]=this[d][arguments[c]]}b[d]=f}return b};if(!Array.prototype.pluck){Array.prototype.pluck=function(d){var b=[];for(var c=0;c<this.length;c++){b[c]=this[c][d]}return b}}Array.prototype.setProperty=function(b,c){for(var a=0;a<this.length;a++){this[a][b]=c}};Object.match=function(d,c){for(var a in c){var b=c[a];if(typeof d[a]=="object"&&typeof b=="object"){if(!Object.match(d[a],b)){return false}}else{if(d[a]!=b){return false}}}return};Array.prototype.allWith=function(){var b=[];topLoop:for(var d=0;d<this.length;d++){var g=this[d];for(var c=0;c<arguments.length;c++){var f=arguments[c];if(typeof f=="object"){if(!Object.match(this[d],f)){continue topLoop}}else{if(typeof f=="function"){if(!this[d][f(d)]){continue topLoop}}else{if(!this[d][f]){continue topLoop}}}}b[b.length]=g}return b};Array.prototype.bsearch=function(c){var a=0;var d=this.length-1;while(a<=d){var b=a+((d-a)>>1);var e=this[b];if(e<c){a=b+1}else{if(e>c){d=b-1}else{return b}}}return -1};Array.prototype.sortNum=function(){return this.sort(function(d,c){return(d>c?1:(d<c?-1:0))})};Element.prototype.append=function(){for(var a=0;a<arguments.length;a++){if(typeof(arguments[a])=="string"){this.appendChild(T(arguments[a]))}else{this.appendChild(arguments[a])}}};if(!Function.prototype.bind){Function.prototype.bind=function(a){var b=this;return function(){return b.apply(a,arguments)}}}if(!Array.prototype.last){Array.prototype.last=function(){return this[this.length-1]}}if(!Array.prototype.indexOf){Array.prototype.indexOf=function(b){for(var a=0;a<this.length;a++){if(b==this[a]){return a}}return -1}}Array.prototype.map=function(c){var a=new Array(this.length);if(c){for(var b=0;b<this.length;b++){a[b]=c(this[b],b,this)}}else{for(var b=0;b<this.length;b++){a[b]=this[b]}}return a};Array.prototype.unique=function(){var b=[this[0]];for(var c=1;c<this.length;c++){if(this[c]!=this[c-1]){b.push(this[c])}}return b};Array.prototype.forEach=function(b){for(var a=0;a<this.length;a++){b(this[a],a,this)}};Array.prototype.set=function(a){this.splice(a.length);for(var b=0;b<a.length;b++){this[b]=a[b]}return this};if(!Array.prototype.reduce){Array.prototype.reduce=function(c,b){var a=0;if(arguments.length==1){b=this[0];a++}for(;a<this.length;a++){b=c(b,this[a],a,this)}return b}}if(!Array.prototype.find){Array.prototype.find=function(b){for(var a=0;a<this.length;a++){if(b(this[a],a,this)){return this[a]}}}}if(!String.prototype.capitalize){String.prototype.capitalize=function(){return this.replace(/^./,this.slice(0,1).toUpperCase())}}if(!String.prototype.escape){String.prototype.escape=function(){return'"'+this.replace(/"/g,'\\"')+'"'}}if(!String.prototype.splice){String.prototype.splice=function(c,b,a){return this.slice(0,c)+a+this.slice(c+b)}}if(!String.prototype.strip){String.prototype.strip=function(){return this.replace(/^\s+|\s+$/g,"")}}if(!Math.sinh){Math.sinh=function(a){return 0.5*(Math.exp(a)-Math.exp(-a))};Math.asinh=function(a){return Math.log(a+Math.sqrt(a*a+1))}}if(!Math.cosh){Math.cosh=function(a){return 0.5*(Math.exp(a)+Math.exp(-a))};Math.acosh=function(a){return Math.log(a+Math.sqrt(a*a-1))}}Math.Ln2=Math.log(2);Math.Ln10=Math.log(10);Math.log2=function(a){return Math.log(a)/Math.Ln2};Math.log10=function(a){return Math.log(a)/Math.Ln10};Math.isPowerOfTwo=function(a){var b=Math.log2(a);return(Math.floor(b)==b)};E=function(d){var g=document.createElement(d);for(var e=1;e<arguments.length;e++){var k=arguments[e];if(typeof(k)=="string"){g.innerHTML+=k}else{if(k.DOCUMENT_NODE){g.appendChild(k)}else{if(k.length){for(var c=0;c<k.length;c++){var h=k[c];if(k.DOCUMENT_NODE){g.appendChild(h)}else{g.innerHTML+=h}}}else{if(k.style){var f=k.style;k=Object.clone(k);delete k.style;Object.forceExtend(g.style,f)}if(k.content){if(typeof(k.content)=="string"){g.appendChild(T(k.content))}else{var b=k.content;if(!b.length){b=[b]}b.forEach(function(a){g.appendChild(a)})}k=Object.clone(k);delete k.content}Object.forceExtend(g,k)}}}}return g};E.lastCanvasId=0;E.canvas=function(a,c,b){var d="canvas-uuid-"+E.lastCanvasId;E.lastCanvasId++;if(!b){b={}}return E("canvas",Object.extend(b,{id:d,width:a,height:c}))};E.byId=function(a){return document.getElementById(a)};E.byClass=function(a){return toArray(document.getElementsByClassName(a))};E.byTag=function(a){return toArray(document.getElementsByTagName(a))};if(typeof byId=="undefined"){byId=E.byId}if(typeof byClass=="undefined"){byClass=E.byClass}if(typeof byTag=="undefined"){byTag=E.byTag}E.make=function(a){return(function(){var b=[a];for(var c=0;c<arguments.length;c++){b.push(arguments[c])}return E.apply(E,b)})};E.tags="a abbr acronym address area audio b base bdo big blockquote body br button canvas caption center cite code col colgroup dd del dfn div dl dt em fieldset form frame frameset h1 h2 h3 h4 h5 h6 head hr html i iframe img input ins kbd label legend li link map meta noframes noscript object ol optgroup option p param pre q s samp script select small span strike strong style sub sup table tbody td textarea tfoot th thead title tr tt u ul var video".toUpperCase().split(" ");(function(){E.tags.forEach(function(c){window[c]=E[c]=E.make(c)});var b=function(c){return(function(f){var d=[{type:c}];var e=0;if(typeof(f)=="string"){d[0].value=f;e++}for(;e<arguments.length;e++){d.push(arguments[e])}return E.INPUT.apply(E,d)})};var a=["SUBMIT","TEXT","RESET","HIDDEN","CHECKBOX"];a.forEach(function(c){window[c]=E[c]=b(c)})})();E.cropImage=function(g,a,j,b,d){var c=g.cloneNode(false);Object.forceExtend(c.style,{position:"relative",left:-a+"px",top:-j+"px",margin:"0px",padding:"0px",border:"0px"});var f=E("div",{style:{display:"block",width:b+"px",height:d+"px",overflow:"hidden"}});f.appendChild(c);return f};T=function(a){return document.createTextNode(a)};Object.conditionalExtend=function(c,b){for(var a in b){if(c[a]==null){c[a]=b[a]}}return c};Object.clone=function(src){if(!src||src==true){return src}switch(typeof(src)){case"string":return Object.extend(src+"",src);break;case"number":return src;break;case"function":obj=eval(src.toSource());return Object.extend(obj,src);break;case"object":if(src instanceof Array){return Object.extend([],src)}else{return Object.extend({},src)}break}};Image.load=function(c,b){var a=new Image();if(b){a.onload=b}a.src=c;return a};Object.isImageLoaded=function(a){if(a.tagName=="CANVAS"){return true}if(a.tagName=="VIDEO"){return a.duration>0}if(!a.complete){return false}if(a.naturalWidth!=null&&a.naturalWidth==0){return false}if(a.width==null||a.width==0){return false}return true};Object.sum=function(d,c){if(d instanceof Array){if(c instanceof Array){var f=[];for(var e=0;e<d.length;e++){f[e]=d[e]+c[e]}return f}else{return d.map(function(a){return a+c})}}else{if(c instanceof Array){return c.map(function(a){return a+d})}else{return d+c}}};Object.sub=function(d,c){if(d instanceof Array){if(c instanceof Array){var f=[];for(var e=0;e<d.length;e++){f[e]=d[e]-c[e]}return f}else{return d.map(function(a){return a-c})}}else{if(c instanceof Array){return c.map(function(a){return d-a})}else{return d-c}}};Object.clear=function(b){for(var a in b){delete b[a]}return b};if(!window.Mouse){Mouse={}}Mouse.getRelativeCoords=function(a,c){var e={x:0,y:0};var d=0;var f=0;var b=a;while(b){d+=b.offsetLeft;f+=b.offsetTop;b=b.offsetParent}e.x=c.pageX-d;e.y=c.pageY-f;return e};Browser=(function(){var d=window.navigator.userAgent;var a=d.match(/Chrome\/\d+/);var e=d.match(/Safari/);var c=d.match(/Mobile/);var b=d.match(/WebKit\/\d+/);var f=d.match(/KHTML/);var h=d.match(/Gecko/);var g=d.match(/Explorer/);if(a){return"Chrome"}if(c&&e){return"Mobile Safari"}if(e){return"Safari"}if(b){return"Webkit"}if(f){return"KHTML"}if(h){return"Gecko"}if(g){return"IE"}return"UNKNOWN"})();Mouse.LEFT=0;Mouse.MIDDLE=1;Mouse.RIGHT=2;if(Browser=="IE"){Mouse.LEFT=1;Mouse.MIDDLE=4}Mouse.state={};window.addEventListener("mousedown",function(a){Mouse.state[a.button]=true},true);window.addEventListener("mouseup",function(a){Mouse.state[a.button]=false},true);Event={cancel:function(a){if(a.preventDefault){a.preventDefault()}},stop:function(a){Event.cancel(a);if(a.stopPropagation){a.stopPropagation()}}};Key={matchCode:function(b,a){if(typeof a=="string"){var c=a.toLowerCase().charCodeAt(0);var d=a.toUpperCase().charCodeAt(0);return(b.which==c||b.which==d||b.keyCode==c||b.keyCode==d||b.charCode==c||b.charCode==d)}else{return(b.which==a||b.keyCode==a||b.charCode==a)}},match:function(e,d){for(var c=1;c<arguments.length;c++){var a=arguments[c];if(a==null){continue}if(a.length!=null&&typeof a!="string"){for(var b=0;b<a.length;b++){if(Key.matchCode(e,a[b])){return true}}}else{if(Key.matchCode(e,a)){return true}}}return false},isNumber:function(c,b){var a=c.which||c.keyCode||c.charCode;return a>=Key.N_0&&a<=Key.N_9},number:function(c,b){var a=c.which||c.keyCode||c.charCode;if(a<Key.N_0||a>Key.N_9){return NaN}return a-Key.N_0},getString:function(b){var a=b.which||b.keyCode||b.charCode;return String.fromCharCode(a)},N_0:48,N_1:49,N_2:50,N_3:51,N_4:52,N_5:53,N_6:54,N_7:55,N_8:56,N_9:57,BACKSPACE:8,TAB:9,ENTER:13,ESC:27,SPACE:32,PAGE_UP:33,PAGE_DOWN:34,END:35,HOME:36,LEFT:37,UP:38,RIGHT:39,DOWN:40,INSERT:45,DELETE:46};if(typeof window.Query=="undefined"){window.Query={}}Object.extend(window.Query,{parse:function(b){var a={};if(!b){return a}b.split("&").forEach(function(d){var c=d.replace(/\+/g," ").split("=").map(decodeURIComponent);a[c[0]]=c[1]});return a},build:function(d){if(typeof d=="string"){return encodeURIComponent(d)}if(d instanceof Array){b=d}else{var b=[];for(var c in d){if(d[c]!=null){b.push([c,d[c]])}}}return b.map(function(a){return a.map(encodeURIComponent).join("=")}).join("&")}});if(typeof window.URL=="undefined"){window.URL={}}Object.extend(window.URL,{build:function(b,c,a){return b+(c!=null?"?"+Query.build(c):"")+(a!=null?"#"+Query.build(a):"")},parse:function(a){var b=a.split("#");var c=b[0].split("?");var d=c[0];var g=d.split("://");var f=g[0];var e=g[1]||g[0];return{base:d,path:e,protocol:f,query:Query.parse(c[1]),fragment:b[1],build:URL.__build__}},__build__:function(){return URL.build(this.base,this.query,this.fragment)}});Magi.log=function(b){if(window.console){console.log(b)}if(this.logCanvas){var d=this.logCanvas;var a=d.getContext("2d");a.font="14px Sans-serif";a.textAlign="center";a.fillStyle="#c24";a.fillText(b,d.width/2,d.height/2,d.width-20)}if(this.logElement){this.logElement.appendChild(P(T(b)))}};Magi.GL_CONTEXT_ID=null;Magi.findGLContextId=function(e,a){var b=function(c,k){for(var h=0,g;g=c[h],h++<c.length;){if(k(g)){return g}}};var d=b(["webgl","experimental-webgl"],function(f){try{return e.getContext(f,a)}catch(c){}});return d};Magi.getGLContext=function(e,d){if(!this.GL_CONTEXT_ID){this.GL_CONTEXT_ID=Magi.findGLContextId(e,d)}if(!this.GL_CONTEXT_ID){this.logCanvas=e;this.log("No WebGL context found. Click here for more details.");var b=document.createElement("a");b.href="http://khronos.org/webgl/wiki/Getting_a_WebGL_Implementation";e.parentNode.insertBefore(b,e);b.appendChild(e)}else{return e.getContext(this.GL_CONTEXT_ID,d)}};Magi.errorName=function(e,d){var c=[];for(var b in e){if(e[b]==d){c.push(b)}}var a=c.join("|");return a};Magi.checkError=function(c,b){var a=c.getError();if(a!=0){Magi.log("Error "+a+":"+Magi.errorName(c,a)+" at "+b)}return a};Magi.throwError=function(c,b){var a=c.getError();if(a!=0){throw (new Error("Error "+a+":"+Magi.errorName(c,a)+" at "+b))}};Magi.AllocatedResources={textures:[],vbos:[],shaders:[],fbos:[],deleteAll:function(){while(this.textures.length>0){this.textures[0].permanent=false;this.textures[0].destroy()}while(this.vbos.length>0){this.vbos[0].destroy()}while(this.fbos.length>0){this.fbos[0].destroy()}while(this.shaders.length>0){this.shaders[0].destroy()}},addTexture:function(a){if(this.textures.indexOf(a)==-1){this.textures.push(a)}},addShader:function(a){if(this.shaders.indexOf(a)==-1){this.shaders.push(a)}},addVBO:function(a){if(this.vbos.indexOf(a)==-1){this.vbos.push(a)}},addFBO:function(a){if(this.fbos.indexOf(a)==-1){this.fbos.push(a)}},deleteTexture:function(a){var b=this.textures.indexOf(a);if(b>=0){this.textures.splice(b,1)}},deleteShader:function(a){var b=this.shaders.indexOf(a);if(b>=0){this.shaders.splice(b,1)}},deleteVBO:function(a){var b=this.vbos.indexOf(a);if(b>=0){this.vbos.splice(b,1)}},deleteFBO:function(a){var b=this.fbos.indexOf(a);if(b>=0){this.fbos.splice(b,1)}}};window.addEventListener("unload",function(){Magi.AllocatedResources.deleteAll()},false);Magi.Texture=Klass({target:"TEXTURE_2D",generateMipmaps:true,width:null,height:null,data:null,changed:false,initialize:function(a){this.gl=a;Magi.AllocatedResources.addTexture(this)},load:function(d,e,c){var b=new Image();var a=new Magi.Texture();a.generateMipmaps=c;b.onload=function(){a.changed=true;if(e){e(a)}};b.src=d;a.image=b;return a},defaultTexCache:{},getDefaultTexture:function(b){if(!this.defaultTexCache[b]){var a=new this(b);a.image=E.canvas(1,1);a.generateMipmaps=false;this.defaultTexCache[b]=a}return this.defaultTexCache[b]},upload:function(){var c=this.gl;var b=c[this.target];if(this.image){var a=this.image;if(!Object.isImageLoaded(a)){this.changed=true;return}if((this.image.tagName=="IMG"&&(/\.svgz?$/i).test(this.image.src))||(this.image.tagName=="VIDEO"&&(/WebKit\/\d+/).test(window.navigator.userAgent))){if(!this.image.tmpCanvas||this.image.tmpCanvas.width!=this.image.width||this.image.tmpCanvas.height!=this.image.height){this.image.tmpCanvas=E.canvas(this.image.width,this.image.height)}this.image.tmpCanvas.getContext("2d").drawImage(this.image,0,0,this.image.width,this.image.height);a=this.image.tmpCanvas}this.width=a.naturalWidth||a.videoWidth||a.width;this.height=a.naturalHeight||a.videoHeight||a.height;if(this.previousWidth==this.width&&this.previousHeight==this.height){c.texSubImage2D(b,0,0,0,c.RGBA,c.UNSIGNED_BYTE,a)}else{c.texImage2D(b,0,c.RGBA,c.RGBA,c.UNSIGNED_BYTE,a)}}else{if(this.previousWidth==this.width&&this.previousHeight==this.height){c.texSubImage2D(b,0,0,0,this.width,this.height,c.RGBA,c.UNSIGNED_BYTE,this.data)}else{c.texImage2D(b,0,c.RGBA,this.width,this.height,0,c.RGBA,c.UNSIGNED_BYTE,this.data)}}this.previousWidth=this.width;this.previousHeight=this.height;Magi.throwError(c,"Texture.upload")},regenerateMipmap:function(){var e=this.gl;var g=e[this.target];e.texParameteri(g,e.TEXTURE_MIN_FILTER,e.LINEAR);if(this.generateMipmaps){if(this.width==this.height&&Math.isPowerOfTwo(this.width)){e.generateMipmap(g);Magi.throwError(e,"Texture.regenerateMipmap: generateMipmap");e.texParameteri(g,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR)}else{if(this.image){var b=this.width,f=this.height;var m=Math.floor(Math.log2(Math.max(b,f))+0.1)+1;var a=this.image;for(var c=1;c<m;c++){var k=Math.max(1,Math.floor(b/Math.pow(2,c)+0.1));var d=Math.max(1,Math.floor(f/Math.pow(2,c)+0.1));var j=E.canvas(k,d);var l=j.getContext("2d");l.globalCompositeOperation="copy";l.drawImage(a,0,0,k,d);e.texImage2D(g,c,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,j);Magi.throwError(e,"Texture.regenerateMipmap loop: "+[c,k,d].join(","));a=j}e.texParameteri(g,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR)}}}},compile:function(){var b=this.gl;var a=b[this.target];this.textureObject=b.createTexture();Magi.Stats.textureCreationCount++;b.bindTexture(a,this.textureObject);Magi.throwError(b,"Texture.compile");this.upload();b.texParameteri(a,b.TEXTURE_WRAP_S,b.CLAMP_TO_EDGE);b.texParameteri(a,b.TEXTURE_WRAP_T,b.CLAMP_TO_EDGE);b.texParameteri(a,b.TEXTURE_MAG_FILTER,b.LINEAR);this.regenerateMipmap()},needsUpload:function(){if(this.image&&this.image.tagName=="VIDEO"){if(this.image.currentTime!=this.previousVideoTime){this.previousVideoTime=this.image.currentTime;return true}}if(this.image&&this.image.tagName=="CANVAS"&&this.image.changed){return true}return this.changed},use:function(){if(this.textureObject==null){this.compile()}this.gl.bindTexture(this.gl[this.target],this.textureObject);if(this.needsUpload()){this.changed=false;this.upload();this.regenerateMipmap()}},clear:function(){if(this.permanent==true){return}if(this.textureObject){this.gl.deleteTexture(this.textureObject)}this.previousWidth=this.previousHeight=null;this.textureObject=null},destroy:function(){if(this.permanent==true){return}this.clear();Magi.AllocatedResources.deleteTexture(this)}});Magi.Shader=Klass({id:null,gl:null,compiled:false,shader:null,shaders:[],initialize:function(b){this.gl=b;this.shaders=[];this.uniformLocations={};this.attribLocations={};for(var a=1;a<arguments.length;a++){this.shaders.push(arguments[a])}Magi.AllocatedResources.addShader(this)},destroy:function(){if(this.shader!=null){Magi.Shader.deleteShader(this.gl,this.shader)}Magi.AllocatedResources.deleteShader(this)},compile:function(){this.shader=Magi.Shader.getProgramByMixedArray(this.gl,this.shaders)},use:function(){if(this.shader==null){this.compile()}this.gl.useProgram(this.shader.program)},getInfoLog:function(){if(this.shader==null){this.compile()}var b=this.gl;var c=b.getProgramInfoLog(this.shader.program);var a=this.shader.shaders.map(function(d){return b.getShaderInfoLog(d)}).join("\n\n");return c+"\n\n"+a},uniform1fv:function(a,b){var c=this.uniform(a).index;if(c!=null){this.gl.uniform1fv(c,b)}},uniform2fv:function(a,b){var c=this.uniform(a).index;if(c!=null){this.gl.uniform2fv(c,b)}},uniform3fv:function(a,b){var c=this.uniform(a).index;if(c!=null){this.gl.uniform3fv(c,b)}},uniform4fv:function(a,b){var c=this.uniform(a).index;if(c!=null){this.gl.uniform4fv(c,b)}},uniform1f:function(a,b){var c=this.uniform(a).index;if(c!=null){this.gl.uniform1f(c,b)}},uniform2f:function(a,d,c){var b=this.uniform(a).index;if(b!=null){this.gl.uniform2f(b,d,c)}},uniform3f:function(a,e,d,b){var c=this.uniform(a).index;if(c!=null){this.gl.uniform3f(c,e,d,b)}},uniform4f:function(a,f,e,c,b){var d=this.uniform(a).index;if(d!=null){this.gl.uniform4f(d,f,e,c,b)}},uniform1iv:function(a,b){var c=this.uniform(a).index;if(c!=null){this.gl.uniform1iv(c,b)}},uniform2iv:function(a,b){var c=this.uniform(a).index;if(c!=null){this.gl.uniform2iv(c,b)}},uniform3iv:function(a,b){var c=this.uniform(a).index;if(c!=null){this.gl.uniform3iv(c,b)}},uniform4iv:function(a,b){var c=this.uniform(a).index;if(c!=null){this.gl.uniform4iv(c,b)}},uniform1i:function(a,b){var c=this.uniform(a).index;if(c!=null){this.gl.uniform1i(c,b)}},uniform2i:function(a,d,c){var b=this.uniform(a).index;if(b!=null){this.gl.uniform2i(b,d,c)}},uniform3i:function(a,e,d,b){var c=this.uniform(a).index;if(c!=null){this.gl.uniform3i(c,e,d,b)}},uniform4i:function(a,f,e,c,b){var d=this.uniform(a).index;if(d!=null){this.gl.uniform4i(d,f,e,c,b)}},uniformMatrix4fv:function(a,b){var c=this.uniform(a).index;if(c!=null){this.gl.uniformMatrix4fv(c,false,b)}},uniformMatrix3fv:function(a,b){var c=this.uniform(a).index;if(c!=null){this.gl.uniformMatrix3fv(c,false,b)}},uniformMatrix2fv:function(a,b){var c=this.uniform(a).index;if(c!=null){this.gl.uniformMatrix2fv(c,false,b)}},attrib:function(a){if(this.attribLocations[a]==null){var b=this.gl.getAttribLocation(this.shader.program,a);this.attribLocations[a]={index:b,current:null}}return this.attribLocations[a]},uniform:function(a){if(this.uniformLocations[a]==null){var b=this.gl.getUniformLocation(this.shader.program,a);this.uniformLocations[a]={index:b,current:null}}return this.uniformLocations[a]}});Magi.Shader.createShader=function(e,a,c){if(typeof a=="string"){a=e[a]}var b=e.createShader(a);e.shaderSource(b,c);e.compileShader(b);if(e.getShaderParameter(b,e.COMPILE_STATUS)!=1){var d=e.getShaderInfoLog(b);e.deleteShader(b);throw (new Error("Failed to compile shader. Shader info log: "+d+" Shader source: "+c))}return b};Magi.Shader.getShaderById=function(d,e){var c=document.getElementById(e);if(!c){throw (new Error("getShaderById: No element has id "+e))}var b,a=c.getAttribute("type");if(a=="text/x-glsl-fs"){b=d.FRAGMENT_SHADER}else{if(a=="text/x-glsl-vs"){b=d.VERTEX_SHADER}else{throw (new Error("getShaderById: Unknown shader type "+a))}}return this.createShader(d,b,c.textContent)};Magi.Shader.loadShader=function(d,b,h,f,e){if(!e){var g=b.split(".");var c=g[g.length-1].toLowerCase();if(c=="frag"){e=d.FRAGMENT_SHADER}else{if(c=="vert"){e=d.VERTEX_SHADER}else{throw (new Error("loadShader: Unknown shader extension "+c))}}}var j=this;var i=new XMLHttpRequest;i.onsuccess=function(a){var k=j.createShader(d,e,a.responseText);h(k,a)};i.onerror=function(a){if(f){f(a)}else{throw (new Error("loadShader: Failed to load shader "+a.status))}};i.open("GET",b,true);i.send(null);return i};Magi.Shader.createProgram=function(f,j){var b=f.createProgram();var k=[];for(var c=0;c<j.length;++c){try{var g=j[c];k.push(g);f.attachShader(b,g)}catch(h){var a={program:b,shaders:k};this.deleteShader(f,a);throw (h)}}var d={program:b,shaders:k};f.linkProgram(b);f.validateProgram(b);if(f.getProgramParameter(b,f.LINK_STATUS)!=1){this.deleteShader(f,d);throw (new Error("Failed to link shader: "+f.getProgramInfoLog(b)))}if(f.getProgramParameter(b,f.VALIDATE_STATUS)!=1){this.deleteShader(f,d);throw (new Error("Failed to validate shader"))}return d};Magi.Shader.loadProgramArray=function(d,b,g,f){var i=this;var e=b.slice(0);var h=[];var c;c=function(j){h.push(j);if(e.length==0){try{var l=i.createProgram(d,h);g(l)}catch(k){f(k)}}else{var m=e.shift();i.loadShader(d,m,c,f)}};var a=e.shift();i.loadShader(d,a,c,f)};Magi.Shader.loadProgram=function(c,d){var b=[];for(var a=1;a<arguments.length;++a){b.push(arguments[a])}return this.loadProgramArray(c,b,d)};Magi.Shader.getProgramBySourceArray=function(d,c){var b=this;var a=c.map(function(e){return b.createShader(d,e.type,e.text)});return this.createProgram(d,a)};Magi.Shader.getProgramByIdArray=function(d,c){var b=this;var a=c.map(function(e){return b.getShaderById(d,e)});return this.createProgram(d,a)};Magi.Shader.getProgramByMixedArray=function(d,c){var b=this;var a=c.map(function(e){if(e.type){return b.createShader(d,e.type,e.text)}else{return b.getShaderById(d,e)}});return this.createProgram(d,a)};Magi.Shader.getProgramByIds=function(c){var b=[];for(var a=1;a<arguments.length;++a){b.push(arguments[a])}return this.getProgramByIdArray(c,b)};Magi.Shader.deleteShader=function(b,a){b.useProgram(null);a.shaders.forEach(function(c){b.detachShader(a.program,c);b.deleteShader(c)});b.deleteProgram(a.program)};Magi.Shader.load=function(d,e){var b=[];for(var a=1;a<arguments.length;++a){b.push(arguments[a])}var c=new Shader(d);Magi.Shader.loadProgramArray(d,b,function(f){c.shader=f;c.compile=function(){};e(c)})};Magi.Filter=Klass(Magi.Shader,{initialize:function(b,a){Magi.Shader.initialize.apply(this,arguments)},apply:function(d){this.use();var b=this.attrib("Vertex");var a=this.attrib("TexCoord");var c=Magi.Geometry.Quad.getCachedVBO(this.gl);if(d){d(this)}c.draw(b,null,a)}});Magi.VBO=Klass({initialized:false,length:0,vbos:null,type:"TRIANGLES",elementsVBO:null,elements:null,initialize:function(b){this.gl=b;this.data=[];this.elementsVBO=null;for(var a=1;a<arguments.length;a++){if(arguments[a].elements){this.elements=arguments[a]}else{this.data.push(arguments[a])}}Magi.AllocatedResources.addVBO(this)},setData:function(){this.clear();this.data=[];for(var a=0;a<arguments.length;a++){if(arguments[a].elements){this.elements=arguments[a]}else{this.data.push(arguments[a])}}},clear:function(){if(this.vbos!=null){for(var a=0;a<this.vbos.length;a++){this.gl.deleteBuffer(this.vbos[a])}}if(this.elementsVBO!=null){this.gl.deleteBuffer(this.elementsVBO)}this.length=this.elementsLength=0;this.vbos=this.elementsVBO=null;this.initialized=false},destroy:function(){this.clear();Magi.AllocatedResources.deleteVBO(this)},init:function(){this.clear();var j=this.gl;j.getError();var h=[];var b=0;for(var a=0;a<this.data.length;a++){h.push(j.createBuffer())}if(this.elements!=null){this.elementsVBO=j.createBuffer()}try{Magi.throwError(j,"genBuffers");for(var a=0;a<this.data.length;a++){var g=this.data[a];if(g.data==null){continue}var f=Math.floor(g.data.length/g.size);if(a==0||f<b){b=f}if(!g.typedArray){switch(g.type){case j.UNSIGNED_INT:g.typedArray=new Uint32Array(g.data);break;case j.INT:g.typedArray=new Int32Array(g.data);break;case j.UNSIGNED_SHORT:g.typedArray=new Uint16Array(g.data);break;case j.SHORT:g.typedArray=new Int16Array(g.data);break;case j.UNSIGNED_BYTE:g.typedArray=new Uint8Array(g.data);break;case j.BYTE:g.typedArray=new Int8Array(g.data);break;default:g.type=j.FLOAT;g.typedArray=new Float32Array(g.data)}}j.bindBuffer(j.ARRAY_BUFFER,h[a]);Magi.Stats.bindBufferCount++;Magi.throwError(j,"bindBuffer");j.bufferData(j.ARRAY_BUFFER,g.typedArray,j.STATIC_DRAW);Magi.throwError(j,"bufferData")}if(this.elementsVBO!=null){var g=this.elements;this.elementsLength=g.data.length;this.elementsType=g.type==j.UNSIGNED_BYTE?j.UNSIGNED_BYTE:j.UNSIGNED_SHORT;j.bindBuffer(j.ELEMENT_ARRAY_BUFFER,this.elementsVBO);Magi.Stats.bindBufferCount++;Magi.throwError(j,"bindBuffer ELEMENT_ARRAY_BUFFER");if(!g.typedArray){if(this.elementsType==j.UNSIGNED_SHORT){g.typedArray=new Uint16Array(g.data)}else{if(this.elementsType==j.UNSIGNED_BYTE){g.typedArray=new Uint8Array(g.data)}}j.bufferData(j.ELEMENT_ARRAY_BUFFER,g.typedArray,j.STATIC_DRAW)}Magi.throwError(j,"bufferData ELEMENT_ARRAY_BUFFER")}}catch(c){for(var a=0;a<h.length;a++){j.deleteBuffer(h[a])}throw (c)}j.bindBuffer(j.ARRAY_BUFFER,null);j.bindBuffer(j.ELEMENT_ARRAY_BUFFER,null);Magi.Stats.bindBufferCount++;Magi.Stats.bindBufferCount++;this.length=b;this.vbos=h;this.initialized=true},use:function(){if(!this.initialized){this.init()}var d=this.gl;for(var b=0;b<arguments.length;b++){var a=arguments[b];var c=(this.data[b]&&this.data[b].data!=null)?this.vbos[b]:null;if(a==null||a.index==null||a.index==-1){continue}if(!c){d.disableVertexAttribArray(a.index);continue}if(Magi.VBO[a.index]!==c){d.bindBuffer(d.ARRAY_BUFFER,c);d.vertexAttribPointer(a.index,this.data[b].size,this.data[b].type,false,0,0);Magi.Stats.bindBufferCount++;Magi.Stats.vertexAttribPointerCount++}d.enableVertexAttribArray(a.index);Magi.VBO[a.index]=c}if(this.elementsVBO!=null){d.bindBuffer(d.ELEMENT_ARRAY_BUFFER,this.elementsVBO);Magi.Stats.bindBufferCount++}},draw:function(){var a=[];this.use.apply(this,arguments);var b=this.gl;if(this.elementsVBO!=null){b.drawElements(b[this.type],this.elementsLength,this.elementsType,0);Magi.Stats.drawElementsCount++}else{b.drawArrays(b[this.type],0,this.length);Magi.Stats.drawArraysCount++}}});Magi.FBO=Klass({initialized:false,useDepth:true,fbo:null,rbo:null,texture:null,initialize:function(d,c,b,a){this.gl=d;this.width=c;this.height=b;if(a!=null){this.useDepth=a}Magi.AllocatedResources.addFBO(this)},destroy:function(){if(this.fbo){this.gl.deleteFramebuffer(this.fbo)}if(this.rbo){this.gl.deleteRenderbuffer(this.rbo)}if(this.texture){this.texture.permanent=false;this.texture.destroy()}Magi.AllocatedResources.deleteFBO(this)},setSize:function(a,b){if(a==this.width&&b==this.height){return}this.width=a;this.height=b;if(!this.initialized){return}var c=this.gl;this.texture.width=this.width;this.texture.height=this.height;this.texture.changed=true;this.texture.use();if(this.useDepth){c.bindRenderbuffer(c.RENDERBUFFER,this.rbo);Magi.throwError(c,"FBO.resize bindRenderbuffer");c.renderbufferStorage(c.RENDERBUFFER,c.stencilWorks?c.DEPTH_STENCIL:c.DEPTH_COMPONENT16,this.width,this.height);Magi.throwError(c,"FBO.resize renderbufferStorage")}},resize:function(a,b){return this.setSize(a,b)},init:function(){var d=this.gl;var j=this.width,f=this.height;var c=this.fbo!=null?this.fbo:d.createFramebuffer();var a;d.bindFramebuffer(d.FRAMEBUFFER,c);Magi.throwError(d,"FBO.init bindFramebuffer");var l=this.texture!=null?this.texture:new Magi.Texture(d);l.width=j;l.height=f;l.data=null;l.generateMipmaps=false;l.permanent=true;l.use();Magi.throwError(d,"FBO.init tex");d.framebufferTexture2D(d.FRAMEBUFFER,d.COLOR_ATTACHMENT0,d.TEXTURE_2D,l.textureObject,0);Magi.throwError(d,"FBO.init bind tex");if(this.useDepth){a=this.rbo!=null?this.rbo:d.createRenderbuffer();d.bindRenderbuffer(d.RENDERBUFFER,a);Magi.throwError(d,"FBO.init bindRenderbuffer");try{d.renderbufferStorage(d.RENDERBUFFER,d.DEPTH_STENCIL,j,f);Magi.throwError(d,"FBO.init depth renderbufferStorage");d.framebufferRenderbuffer(d.FRAMEBUFFER,d.DEPTH_STENCIL_ATTACHMENT,d.RENDERBUFFER,a);Magi.throwError(d,"FBO.init bind depth buffer");d.stencilWorks=true}catch(g){d.stencilWorks=false}if(!d.stencilWorks){d.renderbufferStorage(d.RENDERBUFFER,d.DEPTH_COMPONENT16,j,f);Magi.throwError(d,"FBO.init depth renderbufferStorage");d.framebufferRenderbuffer(d.FRAMEBUFFER,d.DEPTH_ATTACHMENT,d.RENDERBUFFER,a);Magi.throwError(d,"FBO.init bind depth buffer")}}var b=d.checkFramebufferStatus(d.FRAMEBUFFER);if(b!=d.FRAMEBUFFER_COMPLETE){var i;for(var k in d){try{i=d[k]}catch(g){i=null}if(i==b){b=k;break}}}Magi.throwError(d,"FBO.init check fbo");this.fbo=c;this.rbo=a;this.texture=l;this.initialized=true},use:function(){if(!this.initialized){this.init()}this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,this.fbo);Magi.throwError(this.gl,"FBO.use")}});Magi.makeGLErrorWrapper=function(a,b){return(function(){var d;try{d=a[b].apply(a,arguments)}catch(c){throw (new Error("GL error "+c.name+" in "+b+"\n"+c.message+"\n"+arguments.callee.caller))}var c=a.getError();if(c!=0){throw (new Error("GL error "+c+" in "+b))}return d})};Magi.wrapGLContext=function(d){var b={};for(var a in d){try{if(typeof d[a]=="function"){b[a]=Magi.makeGLErrorWrapper(d,a)}else{b[a]=d[a]}}catch(c){}}b.getError=function(){return d.getError()};return b};Magi.Geometry={};Magi.Geometry.Quad={vertices:new Float32Array([-1,-1,0,1,-1,0,-1,1,0,1,-1,0,1,1,0,-1,1,0]),normals:new Float32Array([0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,-1]),texcoords:new Float32Array([0,0,1,0,0,1,1,0,1,1,0,1]),indices:new Float32Array([0,1,2,1,5,2]),makeVBO:function(a){return new Magi.VBO(a,{size:3,data:this.vertices},{size:3,data:this.normals},{size:2,data:this.texcoords})},cache:{},getCachedVBO:function(a){if(!this.cache[a]){this.cache[a]=this.makeVBO(a)}return this.cache[a]}};Magi.Geometry.QuadMesh={makeVBO:function(g,d,c){var b=[],e=[],f=[];for(var a=0;a<d;a++){for(var h=0;h<c;h++){b.push((a-(d/2))/(d/2),(h-(c/2))/(c/2),0);b.push(((a+1)-(d/2))/(d/2),(h-(c/2))/(c/2),0);b.push((a-(d/2))/(d/2),((h+1)-(c/2))/(c/2),0);b.push(((a+1)-(d/2))/(d/2),(h-(c/2))/(c/2),0);b.push(((a+1)-(d/2))/(d/2),((h+1)-(c/2))/(c/2),0);b.push((a-(d/2))/(d/2),((h+1)-(c/2))/(c/2),0);e.push(0,0,-1);e.push(0,0,-1);e.push(0,0,-1);e.push(0,0,-1);e.push(0,0,-1);e.push(0,0,-1);f.push(a/d,h/c);f.push((a+1)/d,h/c);f.push(a/d,(h+1)/c);f.push((a+1)/d,h/c);f.push((a+1)/d,(h+1)/c);f.push(a/d,(h+1)/c)}}return new Magi.VBO(g,{size:3,data:new Float32Array(b)},{size:3,data:new Float32Array(e)},{size:2,data:new Float32Array(f)})},cache:{},getCachedVBO:function(d,c,b){c=c||50;b=b||50;var a=c+":"+b;if(!this.cache[d]){this.cache[d]={}}if(!this.cache[d][a]){this.cache[d][a]=this.makeVBO(d,c,b)}return this.cache[d][a]}};Magi.Geometry.Cube={vertices:new Float32Array([0.5,-0.5,0.5,0.5,-0.5,-0.5,0.5,0.5,-0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,-0.5,-0.5,0.5,-0.5,-0.5,0.5,0.5,0.5,0.5,0.5,-0.5,0.5,0.5,-0.5,-0.5,0.5,0.5,-0.5,0.5,-0.5,-0.5,0.5,-0.5,0.5,0.5,-0.5,0.5,-0.5,-0.5,-0.5,-0.5,-0.5,-0.5,0.5,-0.5,-0.5,-0.5,0.5,-0.5,-0.5,0.5,-0.5,0.5,-0.5,-0.5,-0.5,-0.5,0.5,-0.5,0.5,0.5,-0.5,0.5,-0.5,-0.5]),normals:new Float32Array([1,0,0,1,0,0,1,0,0,1,0,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0,1,0,0,1,0,0,1,0,0,1,-1,0,0,-1,0,0,-1,0,0,-1,0,0,0,-1,0,0,-1,0,0,-1,0,0,-1,0,0,0,-1,0,0,-1,0,0,-1,0,0,-1]),texcoords:new Float32Array([0,0,0,1,1,1,1,0,0,0,0,1,1,1,1,0,0,0,0,1,1,1,1,0,0,0,0,1,1,1,1,0,0,0,0,1,1,1,1,0,0,0,0,1,1,1,1,0]),indices:[],create:function(){for(var a=0;a<6;a++){this.indices.push(a*4+0);this.indices.push(a*4+1);this.indices.push(a*4+3);this.indices.push(a*4+1);this.indices.push(a*4+2);this.indices.push(a*4+3)}this.indices=new Float32Array(this.indices)},makeVBO:function(a){return new Magi.VBO(a,{size:3,data:this.vertices},{size:3,data:this.normals},{size:2,data:this.texcoords},{elements:true,data:this.indices})},cache:{},getCachedVBO:function(a){if(!this.cache[a]){this.cache[a]=this.makeVBO(a)}return this.cache[a]}};Magi.Geometry.Cube.create();Magi.Geometry.CubeArray={pushNormals:function(b,a){b.push(Magi.Geometry.Cube.normals[a*3+0]);b.push(Magi.Geometry.Cube.normals[a*3+1]);b.push(Magi.Geometry.Cube.normals[a*3+2])},pushCubeNormals:function(b){for(var a=0;a<6;a++){this.pushNormals(b,a*4+0);this.pushNormals(b,a*4+1);this.pushNormals(b,a*4+3);this.pushNormals(b,a*4+1);this.pushNormals(b,a*4+2);this.pushNormals(b,a*4+3)}},pushCubeVerts:function(f,b,e,c,d,a){f.push((2*Magi.Geometry.Cube.vertices[a*3+0]+1+2*b)/c-1);f.push((2*Magi.Geometry.Cube.vertices[a*3+1]+1+2*e)/d-1);f.push(Magi.Geometry.Cube.vertices[a*3+2])},pushCube:function(f,a,e,b,d){for(var c=0;c<6;c++){this.pushCubeVerts(f,a,e,b,d,c*4+0);this.pushCubeVerts(f,a,e,b,d,c*4+1);this.pushCubeVerts(f,a,e,b,d,c*4+3);this.pushCubeVerts(f,a,e,b,d,c*4+1);this.pushCubeVerts(f,a,e,b,d,c*4+2);this.pushCubeVerts(f,a,e,b,d,c*4+3)}},makeVBO:function(d,a,c){var e=[],g=[],j=[];for(var h=0;h<a;h++){for(var f=0;f<c;f++){this.pushCube(e,h,f,a,c);this.pushCubeNormals(g);for(var b=0;b<6*6;b++){j.push(h/a,f/c)}}}return new Magi.VBO(d,{size:3,data:new Float32Array(e)},{size:3,data:new Float32Array(g)},{size:2,data:new Float32Array(j)})},cache:{},getCachedVBO:function(d,c,b){c=c||50;b=b||50;var a=c+":"+b;if(!this.cache[d]){this.cache[d]={}}if(!this.cache[d][a]){this.cache[d][a]=this.makeVBO(d,c,b)}return this.cache[d][a]}};Magi.Geometry.Sphere={vert:function(a,e,f,i,l,k){var j,h,g,d,c,b;d=Math.sin(a)*Math.cos(e);b=Math.sin(e);c=Math.cos(a)*Math.cos(e);i.push(d,c,b);j=Math.sin(a)*Math.cos(e);g=Math.sin(e);h=Math.cos(a)*Math.cos(e);f.push(j,h,g);l.push(1-(a/(2*Math.PI)),k?((e+Math.PI/2)/Math.PI):0.5+0.5*Math.sin(e))},makeVBO:function(e,a,c,l){var g=[],k=[],m=[];var n=this;for(var i=0;i<c;i++){var f=-Math.PI/2+Math.PI*i/c;var h=f+Math.PI/c;for(var j=0;j<a;j++){var b=2*Math.PI*j/a;var d=b+2*Math.PI/a;this.vert(b,f,g,k,m,l);this.vert(b,h,g,k,m,l);this.vert(d,h,g,k,m,l);this.vert(b,f,g,k,m,l);this.vert(d,h,g,k,m,l);this.vert(d,f,g,k,m,l)}}return new Magi.VBO(e,{size:3,data:new Float32Array(g)},{size:3,data:new Float32Array(k)},{size:2,data:new Float32Array(m)})},cache:{},getCachedVBO:function(e,c,b,d){c=c||10;b=b||10;var a=c+":"+b+":"+d;if(!this.cache[e]){this.cache[e]={}}if(!this.cache[e][a]){this.cache[e][a]=this.makeVBO(e,c,b,d)}return this.cache[e][a]}};Magi.Geometry.Disk={OUT:1,IN:2,UP:3,DOWN:4,vert:function(d,i,b,h,l,n,e,m,f){var c=Math.sin(d);var a=Math.cos(d);var k=c*b;var j=a*b;h.push(k,j,i);var g=d/(2*Math.PI);switch(e){case this.OUT:l.push(c,a,0);n.push(g,i/m);break;case this.IN:l.push(-c,-a,0);n.push(g,i/m);break;case this.UP:l.push(0,0,1);n.push(g,f);break;case this.DOWN:l.push(0,0,-1);n.push(g,f);break}},makeVBO:function(h,d,c,n,a,f){var i=[],m=[],p=[];var o=this;for(var e=0;e<f;e++){var k=e*n/f;var j=k+n/f;for(var l=0;l<a;l++){var b=l*2*Math.PI/a;var g=b+2*Math.PI/a;this.vert(b,k,c,i,m,p,this.OUT,n,0);this.vert(b,j,c,i,m,p,this.OUT,n,0);this.vert(g,j,c,i,m,p,this.OUT,n,0);this.vert(b,k,c,i,m,p,this.OUT,n,0);this.vert(g,j,c,i,m,p,this.OUT,n,0);this.vert(g,k,c,i,m,p,this.OUT,n,0);this.vert(g,j,d,i,m,p,this.IN,n,0);this.vert(b,j,d,i,m,p,this.IN,n,0);this.vert(b,k,d,i,m,p,this.IN,n,0);this.vert(g,k,d,i,m,p,this.IN,n,0);this.vert(g,j,d,i,m,p,this.IN,n,0);this.vert(b,k,d,i,m,p,this.IN,n,0);this.vert(b,j,c,i,m,p,this.UP,n,0);this.vert(b,j,d,i,m,p,this.UP,n,1);this.vert(g,j,d,i,m,p,this.UP,n,1);this.vert(b,j,c,i,m,p,this.UP,n,0);this.vert(g,j,d,i,m,p,this.UP,n,1);this.vert(g,j,c,i,m,p,this.UP,n,0);this.vert(g,k,d,i,m,p,this.DOWN,n,1);this.vert(b,k,d,i,m,p,this.DOWN,n,1);this.vert(b,k,c,i,m,p,this.DOWN,n,0);this.vert(g,k,c,i,m,p,this.DOWN,n,0);this.vert(g,k,d,i,m,p,this.DOWN,n,1);this.vert(b,k,c,i,m,p,this.DOWN,n,0)}}return new Magi.VBO(h,{size:3,data:new Float32Array(i)},{size:3,data:new Float32Array(m)},{size:2,data:new Float32Array(p)})},cache:{},getCachedVBO:function(g,d,b,a,f,e){d=d==null?0.5:d;b=b==null?1:b;a=a==null?0.01:a;f=f||50;e=e||2;var c=[d,b,a,f,e].join(":");if(!this.cache[g]){this.cache[g]={}}if(!this.cache[g][c]){this.cache[g][c]=this.makeVBO(g,d,b,a,f,e)}return this.cache[g][c]}};Magi.Geometry.Ring={makeXZQuad:function(a,g,f,b,d,e,c){c.push(a,g,f);c.push(b,g,e);c.push(a,d,f);c.push(b,g,e);c.push(b,d,e);c.push(a,d,f)},makeVBO:function(o,k,m,g,r){var e=[],l=[],n=[];for(var j=0;j<m;j++){var b=j/m;var a=(j+1)/m;var u=b*r;var t=a*r;var q=Math.cos(u);var p=Math.cos(t);var i=Math.sin(u);var h=Math.sin(t);for(var f=0;f<g;f++){var d=2*k*(-0.5+f/g);var c=2*k*(-0.5+(f+1)/g);this.makeXZQuad(q,d,i,p,c,h,e);l.push(i,0,-q);l.push(h,0,-p);l.push(i,0,-q);l.push(h,0,-p);l.push(h,0,-p);l.push(i,0,-q);n.push(b,d);n.push(a,d);n.push(b,c);n.push(a,d);n.push(a,c);n.push(b,c)}}return new Magi.VBO(o,{size:3,data:new Float32Array(e)},{size:3,data:new Float32Array(l)},{size:2,data:new Float32Array(n)})},cache:{},getCachedVBO:function(f,a,d,c,e){a=a==null?0.1:a;d=d||256;c=c||10;e=e==null?Math.PI*2:e;var b=d+":"+c+":"+e+":"+a;if(!this.cache[f]){this.cache[f]={}}if(!this.cache[f][b]){this.cache[f][b]=this.makeVBO(f,a,d,c,e)}return this.cache[f][b]}};Magi.Motion={makeBounce:function(){this.addFrameListener(function(a,b){var c=2*Math.abs(Math.sin(a/500));this.position[1]=c});return this},makeRotate:function(a){a=a||0.2;this.addFrameListener(function(b,c){this.rotation.angle=(Math.PI*2*b/(1000/a))%(Math.PI*2)});return this}};Magi.Node=Klass(Magi.Motion,{model:null,position:null,rotation:null,scaling:null,polygonOffset:null,scaleAfterRotate:false,depthMask:null,depthTest:null,display:true,transparent:false,id:null,parentNode:null,initialize:function(a){this.model=a;this.absolutePosition=vec3.create();this.renderPasses={normal:true};this.material=new Magi.Material();this.matrix=mat4.identity();this.normalMatrix=mat3.identity();this.rotation={angle:0,axis:vec3.create([0,1,0])};this.position=vec3.create([0,0,0]);this.scaling=vec3.create([1,1,1]);this.frameListeners=[];this.childNodes=[];this.afterTransformListeners=[]},getNodeById:function(a){var b=null;try{this.filterNodes(function(d){if(d.id==a){b=d;throw (null)}})}catch(c){return b}},getNodesById:function(a){return this.filterNodes(function(b){return(b.id==a)})},getNodesByKlass:function(a){return this.filterNodes(function(b){return(b instanceof a)})},getNodesByMethod:function(a){return this.filterNodes(function(b){return b[a]})},getNodesByKeyValue:function(a,b){return this.filterNodes(function(c){return c[a]==b})},filterNodes:function(b){var a=[];this.forEach(function(c){if(b(c)){a.push(c)}});return a},forEach:function(a){a.call(this,this);this.childNodes.forEach(function(b){b.forEach(a)})},setX:function(a){this.position[0]=a;return this},setY:function(a){this.position[1]=a;return this},setZ:function(a){this.position[2]=a;return this},setPosition:function(a,c,b){if(a.length!=null){vec3.set(a,this.position)}else{if(c==null){vec3.set3(a,this.position)}else{this.position[0]=a;this.position[1]=c;if(b!=null){this.position[2]=b}}}return this},setScale:function(a,c,b){if(a.length!=null){vec3.set(a,this.scaling)}else{if(c==null){vec3.set3(a,this.scaling)}else{this.scaling[0]=a;this.scaling[1]=c;if(b!=null){this.scaling[2]=b}}}return this},setAngle:function(b){this.rotation.angle=b;return this},setAxis:function(a,c,b){if(a.length!=null){vec3.set(a,this.rotation.axis)}else{if(c==null){vec3.set3(a,this.rotation.axis)}else{this.rotation.axis[0]=a;this.rotation.axis[1]=c;if(b!=null){this.rotation.axis[2]=b}}}return this},draw:function(f,a,l){if(!this.model||!this.display){return}if(this.material){this.material.apply(f,a,l,this.matrix,this.normalMatrix)}if(this.model.gl==null){this.model.gl=f}var j=a.blendFuncSrc;var g=a.blendFuncDst;var h=a.depthMask;var c=a.depthTest;var b=a.polygonOffset;var d=a.blend;var k=a.cullFace;if(this.polygonOffset){f.polygonOffset(this.polygonOffset.factor,this.polygonOffset.units)}if(this.depthMask!=null&&this.depthMask!=a.depthMask){f.depthMask(this.depthMask)}if(this.depthTest!=null&&this.depthTest!=a.depthTest){if(this.depthTest){f.enable(f.DEPTH_TEST)}else{f.disable(f.DEPTH_TEST)}}if(this.blendFuncSrc&&this.blendFuncDst){f.blendFunc(f[this.blendFuncSrc],f[this.blendFuncDst])}if(this.blend!=null&&this.blend!=a.blend){if(this.blend){f.enable(f.BLEND)}else{f.disable(f.BLEND)}}if(this.cullFace!=null&&this.cullFace!=a.cullFace){f.enable(f.CULL_FACE);f.cullFace(f[this.cullFace])}if(this.model.attributes){if(!this.model.attributeIdxs){this.model.attributeIdxs=[]}for(var e=0;e<this.model.attributes.length;e++){this.model.attributeIdxs[e]=a.currentShader.attrib(this.model.attributes[e])}this.model.draw.apply(this.model,this.model.attributeIdxs)}else{this.model.draw(a.currentShader.attrib("Vertex"),a.currentShader.attrib("Normal"),a.currentShader.attrib("TexCoord"))}if(this.cullFace!=null&&this.cullFace!=a.cullFace){if(k){f.cullFace(f[k])}else{f.disable(f.CULL_FACE)}}if(this.blend!=null&&this.blend!=a.blend){if(d){f.enable(f.BLEND)}else{f.disable(f.BLEND)}}if(this.blendFuncSrc&&this.blendFuncDst){f.blendFunc(f[j],f[g])}if(this.depthTest!=null&&this.depthTest!=a.depthTest){if(c){f.enable(f.DEPTH_TEST)}else{f.disable(f.DEPTH_TEST)}}if(this.depthMask!=null&&this.depthMask!=a.depthMask){f.depthMask(h)}if(this.polygonOffset){f.polygonOffset(b.factor,b.units)}},addFrameListener:function(a){this.frameListeners.push(a)},afterTransform:function(a){this.afterTransformListeners.push(a)},update:function(d,e){var b=[];for(var c=0;c<this.frameListeners.length;c++){b.push(this.frameListeners[c])}for(var c=0;c<b.length;c++){if(this.frameListeners.indexOf(b[c])!=-1){b[c].call(this,d,e,this)}}for(var c=0;c<this.childNodes.length;c++){this.childNodes[c].parentNode=this;this.childNodes[c].update(d,e)}},appendChild:function(a){this.childNodes.push(a);a.parentNode=this},removeChild:function(b){var a=this.childNodes.indexOf(b);while(a!=-1){this.childNodes[a].parentNode=null;this.childNodes.splice(a,1);a=this.childNodes.indexOf(b)}b.parentNode=null},removeSelf:function(){if(this.parentNode){this.parentNode.removeChild(this)}},updateTransform:function(b,e,g){var a=this.matrix;mat4.set(b,a);var h=this.position;var f=this.scaling;var c=(f[0]!=1)||(f[1]!=1)||(f[2]!=1);if(h[0]||h[1]||h[2]){mat4.translate(a,h)}if(this.scaleAfterRotate&&c){mat4.scale(a,f)}if(this.rotation.angle!=0){mat4.rotate(a,this.rotation.angle,this.rotation.axis)}if(!this.scaleAfterRotate&&c){mat4.scale(a,f)}if(this.transform){mat4.multiply(this.transform,a,a)}if(this.isBillboard){mat4.billboard(a)}mat4.toInverseMat3(a,this.normalMatrix);mat3.transpose(this.normalMatrix);this.absolutePosition[0]=a[12];this.absolutePosition[1]=a[13];this.absolutePosition[2]=a[14];for(var d=0;d<this.afterTransformListeners.length;d++){this.afterTransformListeners[d].call(this,a,e,g)}for(var d=0;d<this.childNodes.length;d++){this.childNodes[d].updateTransform(a,e,g)}},getWorldPosition:function(a,b){if(b==null){b=vec3.create()}return vec3.sub(this.absolutePosition,a,b)},collectDrawList:function(a){if(!a){a=[]}if(this.display){a.push(this);for(var b=0;b<this.childNodes.length;b++){this.childNodes[b].collectDrawList(a)}}return a}});Magi.Material=Klass({initialize:function(b){this.shader=b;this.textures={};for(var a in this.textures){delete this.textures[a]}this.floats={};for(var a in this.floats){delete this.floats[a]}this.ints={};for(var a in this.ints){delete this.ints[a]}},copyValue:function(c){if(typeof c=="number"){return c}var b=new c.__proto__.constructor(c.length);for(var d=0;d<c.length;d++){b[d]=c[d]}return b},copy:function(){var a=new Magi.Material();for(var b in this.floats){a.floats[b]=this.copyValue(this.floats[b])}for(var b in this.ints){a.ints[b]=this.copyValue(this.ints[b])}for(var b in this.textures){a.textures[b]=this.textures[b]}a.shader=this.shader;return a},apply:function(e,c,f,a,d){var b=this.shader;if(b&&b.gl==null){b.gl=e}if(c.currentShader!=b){b.use();b.uniformMatrix4fv("PMatrix",f);Magi.Stats.uniformSetCount++;c.currentShader=this.shader;Magi.Stats.shaderBindCount++}c.currentShader.uniformMatrix4fv("MVMatrix",a);c.currentShader.uniformMatrix3fv("NMatrix",d);Magi.Stats.uniformSetCount+=2;if(c.currentMaterial==this){return}c.currentMaterial=this;Magi.Stats.materialUpdateCount++;this.applyTextures(e,c);this.applyFloats();this.applyInts()},applyTextures:function(e,d){var c=0;for(var b in this.textures){var a=this.textures[b];if(!a){a=Magi.Texture.getDefaultTexture(e)}if(a.gl==null){a.gl=e}if(d.textures[c]!=a){d.textures[c]=a;e.activeTexture(e.TEXTURE0+c);a.use();Magi.Stats.textureSetCount++}this.shader.uniform1i(b,c);Magi.Stats.uniformSetCount++;++c}},cmp:function(d,c){var f=false;if(d&&c&&d.length&&c.length){if(d.length==c.length){f=true;for(var e=0;e<d.length;e++){f=f&&(d[e]==c[e])}}}else{f=d==c}return f},cloneVec:function(b,c){if(!c||c.length!=b.length){c=new b.constructor(b.length)}for(var a=0;a<b.length;a++){c[a]=b[a]}return c},applyFloats:function(){var c=this.shader;for(var a in this.floats){var d=this.floats[a];var b=c.uniform(a);if(this.cmp(b.current,d)){continue}if(d.length){b.current=this.cloneVec(d,b.current)}else{b.current=d}Magi.Stats.uniformSetCount++;if(d.length==null){c.uniform1f(a,d)}else{switch(d.length){case 4:c.uniform4fv(a,d);break;case 3:c.uniform3fv(a,d);break;case 16:c.uniformMatrix4fv(a,d);break;case 9:c.uniformMatrix3fv(a,d);break;case 2:c.uniform2fv(a,d);break;default:c.uniform1fv(a,d)}}}},applyInts:function(){var c=this.shader;for(var a in this.ints){var d=this.ints[a];var b=c.uniform(a);if(this.cmp(b.current,d)){continue}if(d.length){b.current=this.cloneVec(d,b.current)}else{b.current=d}Magi.Stats.uniformSetCount++;if(d.length==null){c.uniform1i(a,d)}else{switch(d.length){case 4:c.uniform4iv(a,d);break;case 3:c.uniform3iv(a,d);break;case 2:c.uniform2iv(a,d);break;default:c.uniform1iv(a,d)}}}}});Magi.GLDrawState=Klass({textures:null,currentMaterial:null,currentShader:null,polygonOffset:null,blendFuncSrc:"ONE",blendFuncDst:"ONE_MINUS_SRC_ALPHA",depthMask:true,depthTest:true,blend:true,initialize:function(){this.polygonOffset={factor:0,units:0},this.textures=[]}});Magi.Camera=Klass({fov:30,targetFov:30,zNear:1,zFar:10000,useLookAt:true,ortho:false,stereo:false,stereoSeparation:0.025,renderPass:"normal",blend:true,blendFuncSrc:"ONE",blendFuncDst:"ONE_MINUS_SRC_ALPHA",useProjectionMatrix:false,initialize:function(){this.position=vec3.create([0,0,10]);this.lookAt=vec3.create([0,0,0]);this.up=vec3.create([0,1,0]);this.matrix=mat4.create();this.perspectiveMatrix=mat4.create();this.frameListeners=[];this.afterTransformListeners=[]},addFrameListener:Magi.Node.prototype.addFrameListener,update:function(d,e){var b=[];for(var c=0;c<this.frameListeners.length;c++){b.push(this.frameListeners[c])}for(var c=0;c<b.length;c++){if(this.frameListeners.indexOf(b[c])!=-1){b[c].call(this,d,e,this)}}if(this.targetFov&&this.fov!=this.targetFov){this.fov+=(this.targetFov-this.fov)*(1-Math.pow(0.7,(e/30)))}},afterTransform:function(a){this.afterTransformListeners.push(a)},getLookMatrix:function(){if(this.useLookAt&&!this.useProjectionMatrix){mat4.lookAt(this.position,this.lookAt,this.up,this.matrix)}else{mat4.identity(this.matrix)}return this.matrix},moveTo:function(a){var b=vec3.create();vec3.sub(a,this.lookAt,b);vec3.add(this.lookAt,b);vec3.add(this.position,b)},setDistance:function(b){var a=vec3.create();vec3.sub(this.position,this.lookAt,a);vec3.scale(a,b/vec3.length(a));vec3.add(this.lookAt,a,this.position)},multiplyDistance:function(b){var a=vec3.create();vec3.sub(this.position,this.lookAt,a);vec3.scale(a,b);vec3.add(this.lookAt,a,this.position)},drawViewport:function(f,l,k,a,m,g,o,b){f.enable(f.SCISSOR_TEST);f.viewport(l,k,a,m);f.scissor(l,k,a,m);g.updateTransform(mat4.identity(),o,b);for(var e=0;e<this.afterTransformListeners.length;e++){this.afterTransformListeners[e].call(this,this.perspectiveMatrix,o,b)}if(!this.useProjectionMatrix){if(this.ortho){mat4.ortho(l,a,-m,-k,this.zNear,this.zFar,this.perspectiveMatrix)}else{mat4.perspective(this.fov,a/m,this.zNear,this.zFar,this.perspectiveMatrix)}}mat4.multiply(this.perspectiveMatrix,this.getLookMatrix());var n=new Magi.GLDrawState();this.resetState(f,n);var o=new Date();var c=g.collectDrawList();var h=[];for(var e=0;e<c.length;e++){var j=c[e];if(!j.renderPasses[this.renderPass]){continue}if(j.transparent){h.push(j)}else{j.draw(f,n,this.perspectiveMatrix)}}this.normalDrawTime=new Date()-o;h.stableSort(function(i,d){return i.matrix[14]-d.matrix[14]});var n=new Magi.GLDrawState();this.resetState(f,n);f.depthMask(false);n.depthMask=false;for(var e=0;e<h.length;e++){var j=h[e];j.draw(f,n,this.perspectiveMatrix)}f.depthMask(true);this.transparentDrawTime=new Date()-o-this.normalDrawTime;f.disable(f.SCISSOR_TEST);this.drawTime=new Date()-o},resetState:function(b,a){b.depthFunc(b.LESS);b.disable(b.CULL_FACE);b.cullFace(b.BACK);b.frontFace(b.CCW);b.enable(b.DEPTH_TEST);a.depthTest=true;if(this.blendFuncSrc&&this.blendFuncDst){a.blendFuncSrc=this.blendFuncSrc;a.blendFuncDst=this.blendFuncDst;b.blendFunc(b[this.blendFuncSrc],b[this.blendFuncDst])}if(this.blend){b.enable(b.BLEND)}else{b.disable(b.BLEND)}a.blend=this.blend;b.depthMask(true);a.depthMask=true},draw:function(h,d,a,g,c,e){if(this.stereo){var f=vec3.create(this.position);var b=vec3.create();vec3.subtract(this.lookAt,f,b);vec3.cross(this.up,b,b);vec3.scale(b,this.stereoSeparation/2,b);vec3.subtract(f,b,this.position);this.drawViewport(h,0,0,d/2,a,g,c,e);vec3.add(f,b,this.position);this.drawViewport(h,d/2,0,d/2,a,g,c,e);vec3.set(f,this.position)}else{this.drawViewport(h,0,0,d,a,g,c,e)}}});window.requestAnimFrame=(function(){return window.requestAnimationFrame||window.webkitRequestAnimationFrame||window.mozRequestAnimationFrame||window.oRequestAnimationFrame||window.msRequestAnimationFrame||function(b,a){window.setTimeout(b,1000/60)}})();Magi.Scene=Klass({frameDuration:13,time:0,timeDir:1,timeSpeed:1,previousTime:0,frameTimes:[],fpsCanvas:null,bg:[1,1,1,1],clear:true,paused:false,showStats:false,supersample:2,initialize:function(b,e,c,a){if(!e){e=new Magi.Node()}if(!c){c=Magi.Scene.getDefaultCamera()}if(b.tagName=="CANVAS"){this.canvas=b;var d={alpha:true,depth:true,stencil:true,antialias:false,premultipliedAlpha:true};if(a){Object.extend(d,a)}this.gl=Magi.getGLContext(b,d);this.fbo=new Magi.FBO(this.gl,b.width*this.supersample,b.height*this.supersample,true)}else{this.fbo=b;this.gl=this.fbo.gl}this.idFilter=new Magi.IdFilter();this.postFBO1=new Magi.FBO(this.gl,1,1,false);this.postFBO2=new Magi.FBO(this.gl,1,1,false);this.preEffects=[];this.postEffects=[];this.clearBits=this.gl.COLOR_BUFFER_BIT|this.gl.DEPTH_BUFFER_BIT|this.gl.STENCIL_BUFFER_BIT;this.scene=e;this.root=e;this.camera=c;this.mouse={x:0,y:0,pressure:1,tiltX:0,tiltY:0,deviceType:0,left:false,middle:false,right:false};this.setupEventListeners();if(this.canvas){this.startFrameLoop()}},getDefaultCamera:function(){var a=new Magi.Camera();vec3.set([0,0,0],a.lookAt);vec3.set([0,0,10],a.position);a.fov=45;a.angle=1;return a},animLoop:function(){this.draw();var a=this;requestAnimFrame(function(){a.animLoop()},this.canvas)},startFrameLoop:function(){this.previousTime=new Date;var a=this;requestAnimFrame(function(){a.animLoop()},this.canvas)},updateMouse:function(a){this.mouse.deviceType=a.mozDeviceType||0;this.mouse.tiltX=a.mozTiltX||0;this.mouse.tiltY=a.mozTiltY||0;this.mouse.pressure=a.mozPressure||0;this.mouse.x=a.clientX;this.mouse.y=a.clientY},setupEventListeners:function(){var a=this;window.addEventListener("mousedown",function(b){switch(b.button){case Mouse.LEFT:a.mouse.left=true;break;case Mouse.RIGHT:a.mouse.right=true;break;case Mouse.MIDDLE:a.mouse.middle=true;break}a.updateMouse(b)},false);window.addEventListener("mouseup",function(b){switch(b.button){case Mouse.LEFT:a.mouse.left=false;break;case Mouse.RIGHT:a.mouse.right=false;break;case Mouse.MIDDLE:a.mouse.middle=false;break}a.updateMouse(b)},false);window.addEventListener("mousemove",function(b){a.updateMouse(b)},false)},draw:function(d,g){if(this.paused){return}d=d==null?new Date():d;g=g==null?d-this.previousTime:g;var c=this.timeDir*this.timeSpeed*g;this.time+=c;this.previousTime=d;this.frameTime=g;this.camera.update(this.time,c);this.scene.update(this.time,c);var b=new Date();this.updateTime=b-d;if(this.drawOnlyWhenChanged&&!this.changed){return}if(this.canvas){this.width=this.canvas.width;this.height=this.canvas.height;this.fbo.resize(this.width*this.supersample,this.height*this.supersample)}else{this.width=this.fbo.width;this.height=this.fbo.height}this.fbo.use();if(this.clear){this.gl.depthMask(true);this.gl.clearColor(this.bg[0],this.bg[1],this.bg[2],this.bg[3]);this.gl.clear(this.clearBits);Magi.throwError(this.gl,"clear")}if(this.preEffects.length>0){this.drawEffects(this.fbo,this.preEffects,this.fbo.texture,b,c)}var e=this.canvas?this.supersample:1;this.camera.draw(this.gl,this.width*e,this.height*e,this.root,b,c);if(this.canvas){this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,null);this.gl.depthMask(true);this.gl.clearColor(0,0,0,0);this.gl.clear(this.clearBits);Magi.throwError(this.gl,"clear")}this.drawEffects(this.canvas||this.fbo,this.postEffects,this.fbo.texture,b,c);this.drawTime=new Date()-b;this.updateFps(this.frameTimes,g);if(!this.firstFrameDoneTime){this.firstFrameDoneTime=new Date()}this.changed=false;Magi.throwError(this.gl,"Scene draw loop");if(this.showStats){var a=E.byId("stats");if(a){Magi.Stats.print(a);Magi.Stats.reset()}}},drawEffects:function(h,a,j,k,b){if(a.length==0&&j==h.texture){return}var c=this.postFBO1;var e=this.postFBO2;c.resize(h.width,h.height);e.resize(h.width,h.height);for(var g=0;g<a.length;g++){e.use();var d=a[g];d.material.textures.Texture0=j;j=e.texture;this.camera.draw(this.gl,e.width,e.height,d,k,b);var f=c;c=e;e=f}if(h.tagName){this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,null)}else{h.use()}this.idFilter.material.textures.Texture0=j;this.camera.draw(this.gl,h.width,h.height,this.idFilter)},updateFps:function(f,e){var d=this.fpsCanvas||document.getElementById("fps");if(!d){return}var a=d.getContext("2d");a.clearRect(0,0,d.width,d.height);var c=d.height;f.push(1000/(1+e));if(f.length>1000){f.splice(200)}var g=Math.max(0,f.length-200);for(var b=g;b<f.length;b++){a.fillRect(b-g,c,1,-f[b]/3)}},useDefaultCameraControls:function(d){var i=this;d=d||this.canvas;var e=new Magi.Node();vec3.set([1,0,0],e.rotation.axis);var h=new Magi.Node();vec3.set([0,1,0],h.rotation.axis);e.appendChild(h);this.root=e;this.yRot=e;this.xRot=h;this.root=this.scene;var c=function(j){var k=(j.detail<0||j.wheelDelta>0)?(1/1.25):1.25;if(j.shiftKey){i.camera.targetFov*=k}else{i.camera.multiplyDistance(k)}i.changed=true;j.preventDefault()};i.camera.addFrameListener(function(){if(Math.abs(this.targetFov-this.fov)>0.01){i.changed=true}});d.addEventListener("DOMMouseScroll",c,false);d.addEventListener("mousewheel",c,false);d.addEventListener("mousedown",function(j){i.dragging=true;i.sx=j.clientX;i.sy=j.clientY;j.preventDefault()},false);window.addEventListener("mousemove",function(o){if(i.dragging){var m=o.clientX-i.sx,k=o.clientY-i.sy;i.sx=o.clientX,i.sy=o.clientY;if(i.mouse.left){h.rotation.angle+=m/200;e.rotation.angle+=k/200}else{if(i.mouse.middle){e.position[0]+=m*0.01*(i.camera.fov/45);e.position[1]-=k*0.01*(i.camera.fov/45)}}var p=h.rotation.angle;var j=e.rotation.angle;var n=vec3.distance(i.camera.lookAt,i.camera.position);var l=vec3.scale(vec3.normalize(vec3.create(Math.cos(p),Math.sin(j),Math.sin(p))),n);vec3.add(l,i.camera.lookAt,i.camera.position);o.preventDefault();i.changed=true}},false);window.addEventListener("mouseup",function(j){if(i.dragging){i.dragging=false;j.preventDefault()}},false);var a=h.rotation.angle;var f=e.rotation.angle;var b=vec3.distance(i.camera.lookAt,i.camera.position);var g=vec3.scale(vec3.normalize(vec3.create(Math.cos(a),Math.sin(f),Math.sin(a))),b);vec3.add(g,i.camera.lookAt,i.camera.position);i.changed=true}});Magi.UberShader=Klass({initialize:function(b,a){this.verts=b;this.frags=a;this.shaderCache=[]},build:function(m,j){var d=[];for(var e in j){d.push("#define "+e+" "+j[e])}d.sort();var c=m.join("¤")+"¤"+d.join("¤");if(!this.shaderCache[c]){var k=[];var g=[];for(var e=0;e<m.length;e++){var l=this.verts[m[e]];if(l){k.push(l)}var h=this.frags[m[e]];if(h){g.push(h)}}var b=d.join("\n")+"\n";var o=b+k.join("\n");var a=b+g.join("\n");var n=new Magi.Shader(null,{type:"VERTEX_SHADER",text:o},{type:"FRAGMENT_SHADER",text:a});this.shaderCache[c]=n}return this.shaderCache[c]}});Magi.Cube=Klass(Magi.Node,{initialize:function(){Magi.Node.initialize.call(this,Magi.Geometry.Cube.getCachedVBO());this.material=Magi.DefaultMaterial.get()}});Magi.CubeArray=Klass(Magi.Node,{initialize:function(){Magi.Node.initialize.call(this,Magi.Geometry.CubeArray.getCachedVBO());this.material=Magi.DefaultMaterial.get()}});Magi.Ring=Klass(Magi.Node,{initialize:function(a,d,c,b){Magi.Node.initialize.call(this,Magi.Geometry.Ring.getCachedVBO(null,a,c,b,d));this.material=Magi.DefaultMaterial.get()}});Magi.Sphere=Klass(Magi.Node,{initialize:function(b,a,c){Magi.Node.initialize.call(this,Magi.Geometry.Sphere.getCachedVBO(null,b,a,c));this.material=Magi.DefaultMaterial.get()}});Magi.Disk=Klass(Magi.Node,{initialize:function(c,b,a,e,d){Magi.Node.initialize.call(this,Magi.Geometry.Disk.getCachedVBO(null,c,b,a,e,d));this.material=Magi.DefaultMaterial.get()}});Magi.Quad=Klass(Magi.Node,{initialize:function(a){Magi.Node.initialize.call(this,Magi.Geometry.Quad.getCachedVBO());this.material=Magi.DefaultMaterial.get()}});Magi.FilterQuad=Klass(Magi.Node,{identityTransform:true,depthMask:false,initialize:function(a){Magi.Node.initialize.call(this,Magi.Geometry.Quad.getCachedVBO());this.material=Magi.FilterQuadMaterial.make(null,a)}});Magi.FlipFilterQuad=Klass(Magi.Node,{identityTransform:true,depthMask:false,initialize:function(a){Magi.Node.initialize.call(this,Magi.Geometry.Quad.getCachedVBO());this.material=Magi.FlipFilterQuadMaterial.make(null,a)}});Magi.ColorQuad=Klass(Magi.Node,{initialize:function(f,e,c,d){Magi.Node.initialize.call(this,Magi.Geometry.Quad.getCachedVBO());this.material=Magi.ColorQuadMaterial.get(null);this.transparent=this.a<1;this.material.floats.Color=vec4.create([f,e,c,d])}});Magi.RadialGlowFilter=Klass(Magi.FilterQuad,{initialize:function(){Magi.FilterQuad.initialize.call(this);this.material=Magi.RadialGlowMaterial.get()}});Magi.FlipRadialGlowFilter=Klass(Magi.FilterQuad,{initialize:function(){Magi.FilterQuad.initialize.call(this);this.material=Magi.FlipRadialGlowMaterial.get()}});Magi.IdFilter=Klass(Magi.FilterQuad,{initialize:function(){Magi.FilterQuad.initialize.call(this);this.material=Magi.IdFilterMaterial.get()}});Magi.Alignable={leftAlign:1,rightAlign:-1,topAlign:-1,bottomAlign:1,centerAlign:0,align:0,valign:0,alignQuad:function(c,a,b){c.position[0]=this.align*a/2;c.position[1]=this.valign*b/2},updateAlign:function(){this.alignQuad(this.alignedNode,this.width,this.height)},setAlign:function(b,a){this.align=b;if(a!=null){this.valign=a}this.updateAlign();return this},setVAlign:function(a){this.valign=a;this.updateAlign();return this}};Magi.Image=Klass(Magi.Node,Magi.Alignable,{initialize:function(b,a){Magi.Node.initialize.call(this);this.alignedNode=new Magi.Node(Magi.Geometry.Quad.getCachedVBO());this.alignedNode.material=a?Magi.FlipFilterMaterial.get():Magi.FilterMaterial.get();this.alignedNode.transparent=true;this.appendChild(this.alignedNode);this.setTexture(new Magi.Texture());this.texture.generateMipmaps=false;if(b){this.setImage(b)}},setTexture:function(a){if(a!=this.texture){if(this.texture){this.texture.destroy()}this.texture=a;this.alignedNode.material.textures.Texture0=this.texture}return this},setSize:function(a){this.size=a;if(this.image&&this.image.tagName&&Object.isImageLoaded(this.image)){this.reposition()}return this},reposition:function(){var a=this.image.width,b=this.image.height;if(this.size!=null){var c=Math.min(this.size/a,this.size/b);a=(a*c);b=(b*c)}this.width=a;this.height=b;this.alignedNode.scaling[0]=a/2;this.alignedNode.scaling[1]=b/2;this.updateAlign()},setImage:function(c){var b=c;if(typeof c=="string"){b=new Image();b.src=c}if(this.image&&this.image.__imageLoadHandler){this.image.removeEventListener("load",this.image.__imageLoadHandler,false)}this.image=b;if(b.tagName&&!Object.isImageLoaded(b)){var a=this;b.__imageLoadHandler=function(){if(a.image==this){a.setImage(this)}};b.addEventListener("load",b.__imageLoadHandler,false)}this.image.width;this.reposition();if(this.image instanceof Magi.Texture){this.setTexture(this.image)}else{this.texture.image=this.image;this.texture.changed=true}return this}});Magi.Text=Klass(Magi.Image,Magi.Alignable,{fontSize:24,font:"Arial",color:"black",initialize:function(c,d,b,a){this.canvas=E.canvas(1,1);Magi.Image.initialize.call(this,this.canvas);if(d){this.fontSize=d}if(a){this.font=a}if(b){this.color=b}this.setText(c)},setText:function(d){this.text=d;var a=this.canvas.getContext("2d");var b=this.fontSize+"px "+this.font;a.font=b;var c=a.measureText(d);this.canvas.width=Math.max(1,Math.min(2048,c.width));this.canvas.height=Math.max(1,Math.min(2048,Math.ceil(this.fontSize*1.25)));var a=this.canvas.getContext("2d");a.font=b;a.clearRect(0,0,this.canvas.width,this.canvas.height);a.fillStyle=this.color;a.fillText(this.text,0,this.fontSize);this.setImage(this.canvas);return this},setFontSize:function(a){this.fontSize=a;this.setText(this.text);return this},setFont:function(a){this.font=a;this.setText(this.text);return this},setColor:function(a){this.color=a;this.setText(this.text);return this},});Magi.MeshText=Klass(Magi.Text,{initialize:function(c,d,b,a){Magi.Text.initialize.apply(this,arguments);this.alignedNode.model=Magi.Geometry.QuadMesh.getCachedVBO(null,20,100)}});Magi.MeshImage=Klass(Magi.Image,{initialize:function(a){Magi.Image.initialize.apply(this,arguments);this.alignedNode.model=Magi.Geometry.QuadMesh.getCachedVBO()}});Magi.CubeText=Klass(Magi.Text,{initialize:function(c,d,b,a){Magi.Text.initialize.apply(this,arguments);this.alignedNode.model=Magi.Geometry.CubeArray.getCachedVBO(null,200,24);this.alignedNode.material=Magi.CubeArrayMaterial.get();this.alignedNode.material.textures.Texture0=this.texture},setText:function(a){Magi.Text.setText.apply(this,arguments);this.alignedNode.material.floats.width=this.width;this.alignedNode.material.floats.height=this.height;return this}});Magi.ShaderLib={defaultTransform:("precision highp float;attribute vec3 Vertex;attribute vec2 TexCoord;uniform mat4 PMatrix;uniform mat4 MVMatrix;uniform mat3 NMatrix;varying vec2 texCoord0;vec4 transform(){  vec4 v = vec4(Vertex, 1.0);  vec4 worldPos = MVMatrix * v;  return PMatrix * worldPos;}vec2 texCoord(){ return TexCoord.st; }vec2 flipTexCoord(){ return vec2(TexCoord.s, 1.0-TexCoord.t); }void defaultTransform(){  gl_Position = transform();  texCoord0 = texCoord();}void defaultImageTransform(){  gl_Position = transform();  texCoord0 = flipTexCoord();}")};Magi.FilterMaterial={vert:{type:"VERTEX_SHADER",text:(Magi.ShaderLib.defaultTransform+"void main(){  defaultImageTransform();}")},frag:{type:"FRAGMENT_SHADER",text:("precision highp float;uniform sampler2D Texture0;uniform float offsetY;uniform float offsetX;varying vec2 texCoord0;void main(){  vec2 v = vec2(texCoord0.s/(1.0-offsetX), texCoord0.t/(1.0-offsetY));  vec4 c = texture2D(Texture0, v);  if (v.s < 0.0 || v.s > 1.0 || v.t < 0.0 || v.t > 1.0) c = vec4(0.0);  gl_FragColor = c*c.a;}")},make:function(c,a){var b=new Magi.Filter(null,this.vert,a||this.frag);return this.setupMaterial(b)},get:function(a){if(!this.cached){this.cached=this.make(a)}return this.cached.copy()},setupMaterial:function(b){var a=new Magi.Material(b);a.textures.Texture0=null;return a}};Magi.FlipFilterMaterial=Object.clone(Magi.FilterMaterial);Magi.FlipFilterMaterial.vert={type:"VERTEX_SHADER",text:(Magi.ShaderLib.defaultTransform+"void main(){  defaultTransform();}")};Magi.FilterQuadMaterial=Object.clone(Magi.FilterMaterial);Magi.FilterQuadMaterial.vert={type:"VERTEX_SHADER",text:(Magi.ShaderLib.defaultTransform+"void main(){  vec4 v = vec4(Vertex, 1.0);  texCoord0 = texCoord();  gl_Position = v;}")};Magi.FlipFilterQuadMaterial=Object.clone(Magi.FilterMaterial);Magi.FlipFilterQuadMaterial.vert={type:"VERTEX_SHADER",text:(Magi.ShaderLib.defaultTransform+"void main(){  vec4 v = vec4(Vertex, 1.0);  texCoord0 = flipTexCoord();  gl_Position = v;}")};Magi.IdFilterMaterial=Object.clone(Magi.FilterQuadMaterial);Magi.IdFilterMaterial.frag={type:"FRAGMENT_SHADER",text:("precision highp float;uniform sampler2D Texture0;varying vec2 texCoord0;void main(){  vec4 c = texture2D(Texture0, texCoord0);  gl_FragColor = c;}")};Magi.RadialGlowMaterial=Object.clone(Magi.FilterQuadMaterial);Magi.RadialGlowMaterial.frag={type:"FRAGMENT_SHADER",text:("precision highp float;uniform sampler2D Texture0;varying vec2 texCoord0;uniform vec2 center;uniform float radius;uniform float currentFactor;uniform float intensity;uniform float falloff;void main(){  float samples = 15.0;  float len = length(center - texCoord0);  float rs = min(len,radius)/samples;  vec2 dir = rs * normalize(center - texCoord0);  vec4 c = currentFactor * texture2D(Texture0, texCoord0);  float d = intensity/10.0;  for (float r=1.0; r <= samples; r++) {    vec2 tc = texCoord0 + (r*dir);    vec4 pc = texture2D(Texture0, tc + rs);    c += pc*d;    d *= falloff;  }  gl_FragColor = c*c.a;}")};Magi.RadialGlowMaterial.setupMaterial=function(b){var a=new Magi.Material(b);a.textures.Texture0=null;a.floats.center=vec2.create(0.5,0.5);a.floats.radius=0.034;a.floats.intensity=1;a.floats.falloff=0.9;a.floats.currentFactor=1;return a};Magi.FlipRadialGlowMaterial=Object.clone(Magi.RadialGlowMaterial);Magi.FlipRadialGlowMaterial.vert=Magi.FlipFilterQuadMaterial.vert;Magi.CubeArrayMaterial=Object.clone(Magi.FilterMaterial);Magi.CubeArrayMaterial.vert={type:"VERTEX_SHADER",text:(Magi.ShaderLib.defaultTransform+"uniform float width;uniform float height;varying vec2 texCoord0;float grid(float c, float sz){  return (0.5+floor(c*sz))/sz;}void main(){  texCoord0 = vec2(grid(TexCoord.s, width), grid(1.0-TexCoord.t, height));  if (texture2D(Texture0, texCoord0).a == 0.0) {    gl_Position = vec4(-3.0, -3.0, -3.0, 1.0);  } else {    gl_Position = transform();  }}")};Magi.ColorQuadMaterial=Object.clone(Magi.FilterMaterial);Magi.ColorQuadMaterial.vert={type:"VERTEX_SHADER",text:(Magi.ShaderLib.defaultTransform+"void main(){  vec4 v = vec4(Vertex, 1.0);  gl_Position = v;}")};Magi.ColorQuadMaterial.frag={type:"FRAGMENT_SHADER",text:("precision highp float;uniform vec4 Color;void main(){  gl_FragColor = Color;}")};Magi.ColorMaterial=Object.clone(Magi.FilterMaterial);Magi.ColorMaterial.vert={type:"VERTEX_SHADER",text:(Magi.ShaderLib.defaultTransform+"void main(){  gl_Position = transform();}")};Magi.ColorMaterial.frag={type:"FRAGMENT_SHADER",text:("precision highp float;uniform vec4 Color;void main(){  gl_FragColor = Color;}")};Magi.DefaultMaterial={vert:{type:"VERTEX_SHADER",text:("precision highp float;attribute vec3 Vertex;attribute vec3 Normal;attribute vec2 TexCoord;uniform mat4 PMatrix;uniform mat4 MVMatrix;uniform mat4 LightMatrix;uniform mat3 NMatrix;uniform float LightConstantAtt;uniform float LightLinearAtt;uniform float LightQuadraticAtt;uniform vec4 LightPos;varying vec3 normal, lightDir, eyeVec;varying vec2 texCoord0;varying float attenuation;void main(){  vec3 lightVector;  vec4 v = vec4(Vertex, 1.0);  texCoord0 = vec2(TexCoord.s, 1.0-TexCoord.t);  normal = normalize(NMatrix * Normal);  vec4 worldPos = MVMatrix * v;  vec4 lightWorldPos = LightMatrix * LightPos;  lightVector = vec3(lightWorldPos - worldPos);  lightDir = normalize(lightVector);  float dist = length(lightVector);  eyeVec = -vec3(worldPos);  attenuation = 1.0 / (1.0 + LightConstantAtt + LightLinearAtt*dist + LightQuadraticAtt * dist*dist);  gl_Position = PMatrix * worldPos;}")},frag:{type:"FRAGMENT_SHADER",text:("precision highp float;uniform vec4 LightDiffuse;uniform vec4 LightSpecular;uniform vec4 LightAmbient;uniform vec4 MaterialSpecular;uniform vec4 MaterialDiffuse;uniform vec4 MaterialAmbient;uniform vec4 MaterialEmit;uniform vec4 GlobalAmbient;uniform float MaterialShininess;uniform sampler2D DiffTex, SpecTex, EmitTex;varying vec3 normal, lightDir, eyeVec;varying vec2 texCoord0;varying float attenuation;void main(){  vec4 color = GlobalAmbient * LightAmbient * MaterialAmbient;  vec4 matDiff = MaterialDiffuse + texture2D(DiffTex, texCoord0);  matDiff.a = 1.0 - (1.0-MaterialDiffuse.a) * (1.0-texture2D(DiffTex, texCoord0).a);  vec4 matSpec = MaterialSpecular + texture2D(SpecTex, texCoord0);  matSpec.a = 1.0 - (1.0-MaterialSpecular.a) * (1.0-texture2D(SpecTex, texCoord0).a);  vec4 diffuse = LightDiffuse * matDiff;  float lambertTerm = dot(normal, lightDir);  vec4 lcolor = diffuse * lambertTerm * attenuation;  vec3 E = normalize(eyeVec);  vec3 R = reflect(-lightDir, normal);  float specular = pow( max(dot(R, E), 0.0), MaterialShininess );  lcolor += matSpec * LightSpecular * specular * attenuation;  if (lambertTerm > 0.0) color += lcolor * lambertTerm;  else color += diffuse * attenuation * MaterialAmbient.a * -lambertTerm;  color += MaterialEmit + texture2D(EmitTex, texCoord0);  color *= matDiff.a;  color.a = matDiff.a;  gl_FragColor = color;}")},get:function(b){if(!this.cached){var a=new Magi.Shader(null,this.vert,this.frag);this.cached=this.setupMaterial(a)}var d=this.cached.copy();d.floats.LightMatrix=this.lightMatrix;return d},lightMatrix:mat4.identity(),setupMaterial:function(b){var a=new Magi.Material(b);a.textures.DiffTex=a.textures.SpecTex=a.textures.EmitTex=null;a.floats.MaterialSpecular=vec4.create([1,1,1,0]);a.floats.MaterialDiffuse=vec4.create([0.5,0.5,0.5,1]);a.floats.MaterialAmbient=vec4.create([1,1,1,0.3]);a.floats.MaterialEmit=vec4.create([0,0,0,0]);a.floats.MaterialShininess=1.5;a.floats.LightMatrix=this.lightMatrix;a.floats.LightPos=vec4.create([1,1,1,1]);a.floats.GlobalAmbient=vec4.create([1,1,1,1]);a.floats.LightSpecular=vec4.create([0.8,0.8,0.95,1]);a.floats.LightDiffuse=vec4.create([0.7,0.6,0.9,1]);a.floats.LightAmbient=vec4.create([0.1,0.1,0.2,1]);a.floats.LightConstantAtt=0;a.floats.LightLinearAtt=0;a.floats.LightQuadraticAtt=0;return a}};Magi.MultiMaterial={frag:{type:Magi.DefaultMaterial.frag.type,text:Magi.DefaultMaterial.frag.text.replace(/uniform (\S+ Material)/g,"varying $1")},vert:{type:"VERTEX_SHADER",text:("#define MAX_MATERIALS 4\nprecision highp float;precision highp int;struct material {  vec4 diffuse; vec4 specular; vec4 ambient; vec4 emit; float shininess;};attribute vec3 Vertex;attribute vec3 Normal;attribute vec2 TexCoord;attribute float MaterialIndex;uniform mat4 PMatrix;uniform mat4 MVMatrix;uniform mat4 LightMatrix;uniform mat3 NMatrix;uniform float LightConstantAtt;uniform float LightLinearAtt;uniform float LightQuadraticAtt;uniform vec4 LightPos;uniform material Material0;uniform material Material1;uniform material Material2;uniform material Material3;varying vec3 normal, lightDir, eyeVec;varying vec2 texCoord0;varying float attenuation;varying vec4 MaterialDiffuse;varying vec4 MaterialSpecular;varying vec4 MaterialAmbient;varying vec4 MaterialEmit;varying float MaterialShininess;void main(){  vec3 lightVector;  vec4 v = vec4(Vertex, 1.0);  texCoord0 = vec2(TexCoord.s, 1.0-TexCoord.t);  normal = normalize(NMatrix * Normal);  vec4 worldPos = MVMatrix * v;  vec4 lightWorldPos = LightMatrix * LightPos;  lightVector = vec3(lightWorldPos - worldPos);  lightDir = normalize(lightVector);  float dist = length(lightVector);  eyeVec = normalize(-vec3(worldPos));  attenuation = 1.0 / (1.0 + LightConstantAtt + LightLinearAtt*dist + LightQuadraticAtt * dist*dist);  gl_Position = PMatrix * worldPos;  float midx = MaterialIndex;  material mat = Material3;  if (midx == 0.0) mat = Material0;  if (midx == 1.0) mat = Material1;  if (midx == 2.0) mat = Material2;  MaterialDiffuse = mat.diffuse;  MaterialSpecular = mat.specular;  MaterialAmbient = mat.ambient;  MaterialEmit = mat.emit;  MaterialShininess = mat.shininess;}")},get:function(b){if(!this.cached){var a=new Magi.Shader(null,this.vert,this.frag);this.cached=this.setupMaterial(a)}var d=this.cached.copy();d.floats.LightMatrix=this.lightMatrix;return d},lightMatrix:mat4.identity(),setupMaterial:function(b){var a=new Magi.Material(b);a.textures.DiffTex=a.textures.SpecTex=a.textures.EmitTex=null;a.floats.LightMatrix=this.lightMatrix;a.floats.LightPos=vec4.create([1,1,1,1]);a.floats.GlobalAmbient=vec4.create([1,1,1,1]);a.floats.LightSpecular=vec4.create([1,1,1,1]);a.floats.LightDiffuse=vec4.create([1,1,1,1]);a.floats.LightAmbient=vec4.create([0.1,0.1,0.1,1]);a.floats.LightConstantAtt=0;a.floats.LightLinearAtt=0;a.floats.LightQuadraticAtt=0;return a}};Magi.Tar=function(){};Magi.Tar.load=function(b,d,c,a){var e=new Magi.Tar();e.onload=d;e.onerror=a;e.onstream=c;e.load(b);return e};Magi.Tar.loadGZip=function(b,d,c,a){var e=new Magi.Tar();e.onload=d;e.onerror=a;e.onstream=c;e.loadGZip(b);return e};Magi.Tar.stream=function(b,c,d,a){var e=new Magi.Tar();e.onload=d;e.onerror=a;e.onstream=c;e.load(b);return e};Magi.Tar.streamGZip=function(b,c,d,a){var e=new Tar();e.onload=d;e.onerror=a;e.onstream=c;e.loadGZip(b);return e};Magi.Tar.prototype={onerror:null,onload:null,onstream:null,ondata:null,cleanupAfterLoad:true,initLoad:function(){this.byteOffset=0;this.parseTime=0;this.files={};this.fileArray=[]},onloadHandler:function(a){this.byteOffset=this.processTarChunks(a.data,this.byteOffset,a.outputSize);if(this.cleanUpAfterLoad){a.cleanup()}if(this.onload){this.onload(this.files)}},onprogressHandler:function(a){this.gzip=a;if(this.ondata){this.ondata(a)}this.byteOffset=this.processTarChunks(a.data,this.byteOffset,a.outputSize)},onerrorHandler:function(c,b,a){if(this.onerror){this.onerror(c,b,a)}},loadGZip:function(b){this.initLoad();var a=this;GZip.load(b,function(c){a.onloadHandler(c)},function(c){a.onprogressHandler(c)},function(f,d,c){a.onerrorHandler(f,d,c)})},load:function(b){var d=new XMLHttpRequest();this.initLoad();var a=this;var c={data:[],inputSize:0,outputSize:0,offset:0,xhr:d,cleanup:function(){delete this.data;delete this.xhr}};d.onload=function(){c.data[0]=this.responseText;c.inputSize=c.outputSize=c.offset=c.data[0].length;try{a.onloadHandler(c)}catch(f){if(a.onerror){a.onerror(this,f,c)}else{throw (f)}}};d.onprogress=function(){c.data[0]=this.responseText;c.inputSize=c.outputSize=c.offset=c.data[0].length;a.onprogressHandler(c)};d.open("GET",b,true);d.overrideMimeType("text/plain; charset=x-user-defined");d.setRequestHeader("Content-Type","text/plain");d.send(null)},cleanHighByte:function(a){return a.replace(/./g,function(b){return String.fromCharCode(b.charCodeAt(0)&255)})},parseTar:function(a){this.initLoad();this.processTarChunks([a],0,a.length)},processTarChunks:function(f,d,a){var b=new Date();while(a>=d+512){var e=this.fileArray.length==0?null:this.fileArray[this.fileArray.length-1];if(e&&e.data==null){if(d+e.length<=a){e.data=this.chunkSubstring(f,d,d+e.length);e.toDataURL=this.__toDataURL;d+=512*Math.ceil(e.length/512);if(this.onstream){this.onstream(e,this.gzip)}}else{break}}else{var c=this.chunkSubstring(f,d,d+512);var e=this.parseTarHeader(c,0);if(e.length>0||e.filename!=""){this.fileArray.push(e);this.files[e.filename]=e;d+=512;e.offset=d}else{d=a}}}this.parseTime+=new Date()-b;return d},parseTarHeader:function(d,c){var a=c||0;var b={};b.filename=this.parseTarField(d,a,a+=100);b.mode=this.parseTarNumber(d,a,a+=8);b.uid=this.parseTarNumber(d,a,a+=8);b.gid=this.parseTarNumber(d,a,a+=8);b.length=this.parseTarNumber(d,a,a+=12);b.lastModified=this.parseTarNumber(d,a,a+=12);b.checkSum=this.parseTarField(d,a,a+=8);b.fileType=this.parseTarField(d,a,a+=1);b.linkName=this.parseTarField(d,a,a+=100);b.ustar=this.parseTarField(d,a,a+=6);b.ustarVersion=this.parseTarField(d,a,a+=2);b.userName=this.parseTarField(d,a,a+=32);b.groupName=this.parseTarField(d,a,a+=32);b.deviceMajor=this.parseTarField(d,a,a+=8);b.deviceMinor=this.parseTarField(d,a,a+=8);b.filenamePrefix=this.parseTarField(d,a,a+=155);return b},parseTarField:function(b,c,a){return b.substring(c,a).split("\0",1)[0]},parseTarNumber:function(c,d,a){var b=c.substring(d,a);return parseInt("0"+b.replace(/[^\d]+/g,""))},chunkSubstring:function(f,a,c){var b=0,h=0,e=0,d=0;for(e=0;e<f.length;e++){if(b+f[e].length>a){break}b+=f[e].length}var g=[];h=b;for(d=e;d<f.length;d++){g.push(f[d]);if(h+f[d].length>c){break}h+=f[d].length}var k=g.join("");return k.substring(a-b,a-b+(c-a))},__toDataURL:function(){if(this.data.substring(0,40).match(/^data:[^\/]+\/[^,]+,/)){return this.data}else{if(Magi.Tar.prototype.cleanHighByte(this.data.substring(0,10)).match(/\377\330\377\340..JFIF/)){return"data:image/jpeg;base64,"+btoa(Magi.Tar.prototype.cleanHighByte(this.data))}else{if(Magi.Tar.prototype.cleanHighByte(this.data.substring(0,6))=="\211PNG\r\n"){return"data:image/png;base64,"+btoa(Magi.Tar.prototype.cleanHighByte(this.data))}else{if(Magi.Tar.prototype.cleanHighByte(this.data.substring(0,6)).match(/GIF8[79]a/)){return"data:image/gif;base64,"+btoa(Magi.Tar.prototype.cleanHighByte(this.data))}else{throw ("toDataURL: I don't know how to handle "+this.filename)}}}}}};Magi.Obj=function(){};Magi.Obj.load=function(a){var b=new Magi.Obj();b.load(a);return b};Magi.Obj.prototype={load:function(b){var c=new XMLHttpRequest();var a=this;a.loadStartTime=new Date();c.onreadystatechange=function(){if(c.readyState==4){if(c.status==200||c.status==0){a.downloadTime=new Date()-a.loadStartTime;a.parse(c.responseText);if(a.onload){a.onload(c)}}else{if(a.onerror){a.onerror(c)}}}};c.open("GET",b,true);c.overrideMimeType("text/plain; charset=x-user-defined");c.setRequestHeader("Content-Type","text/plain");c.send(null)},onerror:function(a){alert("Error: "+a.status)},makeVBO:function(a){if(this.texcoords){return new Magi.VBO(a,{size:3,data:this.vertices},{size:3,data:this.normals},{size:2,data:this.texcoords})}else{return new Magi.VBO(a,{size:3,data:this.vertices},{size:3,data:this.normals})}},cache:{},getCachedVBO:function(a){if(!this.cache[a]){this.cache[a]=this.makeVBO(a)}return this.cache[a]},parse:function(G){var q=new Date;var F=[],e=[],u=[],o=[],g=[],h=[];var c=G.split("\n");var r="#".charCodeAt(0);for(var B=0;B<c.length;B++){var w=c[B];var s=w.replace(/^\s+|\s+$/g,"").split(" ");if(s.length==0){continue}if(s[0].charCodeAt(0)==r){continue}switch(s[0]){case"g":break;case"v":o.push(parseFloat(s[1]));o.push(parseFloat(s[2]));o.push(parseFloat(s[3]));break;case"vn":g.push(parseFloat(s[1]));g.push(parseFloat(s[2]));g.push(parseFloat(s[3]));break;case"vt":h.push(parseFloat(s[1]));h.push(parseFloat(s[2]));break;case"f":var d=[];for(var A=1,p;A<s.length;A++){if(A>3){d.push(d[0]);d.push(p)}p=s[A];d.push(p)}for(var A=0;A<d.length;A++){var C=d[A];var D=C.split("/");F.push(parseInt(D[0])-1);if(D.length>1){u.push(parseInt(D[1])-1)}if(D.length>2){e.push(parseInt(D[2])-1)}}break}}this.vertices=this.lookup_faces(o,F,3);if(u.length>0){this.texcoords=this.lookup_faces(h,u,2)}if(e.length>0&&!this.overrideNormals){this.normals=this.lookup_faces(g,e,3)}else{this.normals=this.calculate_normals(this.vertices)}var b={min:[0,0,0],max:[0,0,0]};for(var B=0;B<o.length;B+=3){var n=o[B],m=o[B+1],k=o[B+2];if(n<b.min[0]){b.min[0]=n}else{if(n>b.max[0]){b.max[0]=n}}if(m<b.min[1]){b.min[1]=m}else{if(m>b.max[1]){b.max[1]=m}}if(k<b.min[2]){b.min[2]=k}else{if(k>b.max[2]){b.max[2]=k}}}b.width=b.max[0]-b.min[0];b.height=b.max[1]-b.min[1];b.depth=b.max[2]-b.min[2];b.diameter=Math.max(b.width,b.height,b.depth);this.boundingBox=b;this.parseTime=new Date()-q},lookup_faces:function(g,a,e){var b=[];for(var d=0;d<a.length;d++){var f=a[d]*e;for(var c=0;c<e;c++){b.push(g[f+c])}}return b},calculate_normals:function(e){var c=[];for(var b=0;b<e.length;b+=9){var d=this.find_normal(e[b],e[b+1],e[b+2],e[b+3],e[b+4],e[b+5],e[b+6],e[b+7],e[b+8]);for(var a=0;a<3;a++){c.push(d[0]);c.push(d[1]);c.push(d[2])}}return c},find_normal:function(c,k,g,b,i,f,a,h,e){var m=[c-b,k-i,g-f];var l=[b-a,i-h,f-e];var j=[a-c,h-k,e-g];var d=Vec3.cross(m,l);if(Vec3.lengthSquare(d)==0){d=Vec3.cross(l,j)}if(Vec3.lengthSquare(d)==0){d=Vec3.cross(j,m)}if(Vec3.lengthSquare(d)==0){d=[0,0,1]}return Vec3.normalize(d)}};Magi.Bin=function(){};Magi.Bin.load=function(b,c,a){var d=new Magi.Bin();if(c){d.onload=c}if(a){d.onerror=a}d.load(b);return d};Magi.Bin.prototype={load:function(b){var c=new XMLHttpRequest();var a=this;a.loadStartTime=new Date();c.onreadystatechange=function(){if(c.readyState==4){if(c.status==200||c.status==0){a.downloadTime=new Date()-a.loadStartTime;a.parse(c.responseText);if(a.onload){a.onload(a,c)}}else{if(a.onerror){a.onerror(c)}}}};c.open("GET",b,true);c.overrideMimeType("text/plain; charset=x-user-defined");c.setRequestHeader("Content-Type","text/plain");c.send(null)},onerror:function(a){alert("Error: "+a.status)},makeVBO:function(a){if(this.texcoords){return new Magi.VBO(a,{size:3,data:this.vertices},{size:3,data:this.normals},{size:2,data:this.texcoords})}else{return new Magi.VBO(a,{size:3,data:this.vertices},{size:3,data:this.normals})}},cache:{},getCachedVBO:function(a){if(!this.cache[a]){this.cache[a]=this.makeVBO(a)}return this.cache[a]},readFloat32:function(d,c){var h=d.charCodeAt(c)&255,g=d.charCodeAt(c+1)&255,f=d.charCodeAt(c+2)&255,e=d.charCodeAt(c+3)&255;var a=1-(2*(h>>7));var b=(((h<<1)&255)|(g>>7))-127;var i=((g&127)<<16)|(f<<8)|e;if(i==0&&b==-127){return 0}return a*(1+i*Math.pow(2,-23))*Math.pow(2,b)},readUInt32:function(a,b){return((a.charCodeAt(b)&255)<<24)+((a.charCodeAt(b+1)&255)<<16)+((a.charCodeAt(b+2)&255)<<8)+(a.charCodeAt(b+3)&255)},readUInt16:function(a,b){return((a.charCodeAt(b)&255)<<8)+(a.charCodeAt(b+1)&255)},readNormalizedFixedPoint16:function(a,b){return 2*(this.readUInt16(a,b)/65535-0.5)},readNormalizedUFixedPoint16:function(a,b){return this.readUInt16(a,b)/65535},readVerts:function(e,d,b,c){for(var a=d+c*3*2;d<a;d+=2){b.push(this.readNormalizedFixedPoint16(e,d))}return d},readTexVerts:function(e,d,b,c){for(var a=d+c*2*2;d<a;d+=2){b.push(this.readNormalizedUFixedPoint16(e,d))}return d},readTris:function(h,f,g,d,a){var c=[];for(var b=f+d*4*2;f<b;f+=2){c.push(this.readUInt16(h,f))}for(var b=f+a*3*2;f<b;f+=2){g.push(this.readUInt16(h,f))}for(var e=0;e<c.length;e+=4){g.push(c[e]);g.push(c[e+1]);g.push(c[e+2]);g.push(c[e]);g.push(c[e+2]);g.push(c[e+3])}return f},translateAndScaleVertices:function(b,c,f,h,a,e,g){c*=0.5;f*=0.5;h*=0.5;for(var d=0;d<b.length;d+=3){b[d]=a+c*(b[d]+1);b[d+1]=e+f*(b[d+1]+1);b[d+2]=g+h*(b[d+2]+1)}},parse:function(u){var k=new Date();var p=[],g=[],l=[],h=[],d=[],f=[];var o=0;var b=this.readUInt32(u,o);o+=4;var m=this.readUInt32(u,o);o+=4;var q=this.readUInt32(u,o);o+=4;var e=this.readUInt32(u,o);o+=4;var j=this.readUInt32(u,o);o+=4;var n=this.readFloat32(u,o);o+=4;var r=this.readFloat32(u,o);o+=4;var v=this.readFloat32(u,o);o+=4;var s=this.readFloat32(u,o);o+=4;var a=this.readFloat32(u,o);o+=4;var c=this.readFloat32(u,o);o+=4;o=this.readVerts(u,o,h,b);this.translateAndScaleVertices(h,n,r,v,s,a,c);o=this.readTris(u,o,p,e,j);if(m>0){o=this.readTexVerts(u,o,f,m);o=this.readTris(u,o,g,e,j)}if(q>0){o=this.readVerts(u,o,d,q);o=this.readTris(u,o,l,e,j)}this.vertices=this.lookup_faces(h,p,3);if(g.length>0&&!this.noTexCoords){this.texcoords=this.lookup_faces(f,g,2)}if(l.length>0&&!this.overrideNormals){this.normals=this.lookup_faces(d,l,3)}else{this.normals=this.calculate_normals(this.vertices,p,this.flatNormals)}this.boundingBox=this.calculateBoundingBox(h);this.parseTime=new Date()-k},calculateBoundingBox:function(b){var e={min:[0,0,0],max:[0,0,0]};for(var c=0;c<b.length;c+=3){var a=b[c],f=b[c+1],d=b[c+2];if(a<e.min[0]){e.min[0]=a}else{if(a>e.max[0]){e.max[0]=a}}if(f<e.min[1]){e.min[1]=f}else{if(f>e.max[1]){e.max[1]=f}}if(d<e.min[2]){e.min[2]=d}else{if(d>e.max[2]){e.max[2]=d}}}e.width=e.max[0]-e.min[0];e.height=e.max[1]-e.min[1];e.depth=e.max[2]-e.min[2];e.diameter=Math.max(e.width,e.height,e.depth);return e},lookup_faces:function(g,a,e){var b=[];for(var d=0;d<a.length;d++){var f=a[d]*e;for(var c=0;c<e;c++){b.push(g[f+c])}}return b},calculate_normals:function(f,a,g){var b=[];var k={normals:[],addNormal:function(i,l){var j=(this.normals[i]||(this.normals[i]=[0,0,0]));j[0]+=l[0];j[1]+=l[1];j[2]+=l[2]},getNormal:function(i){return this.normals[i]},normalize:function(){for(var j=0;j<this.normals.length;j++){var m=this.normals[j];if(m){var l=1/Math.sqrt(m[0]*m[0]+m[1]*m[1]+m[2]*m[2]);m[0]*=l;m[1]*=l;m[2]*=l}}}};for(var d=0,h=0;d<f.length;d+=9,h+=3){var e=this.find_normal(f[d],f[d+1],f[d+2],f[d+3],f[d+4],f[d+5],f[d+6],f[d+7],f[d+8]);if(g){for(var c=0;c<3;c++){b.push(e[0]);b.push(e[1]);b.push(e[2])}}else{k.addNormal(a[h],e);k.addNormal(a[h+1],e);k.addNormal(a[h+2],e)}}if(!g){k.normalize();for(var d=0;d<a.length;d++){var e=k.getNormal(a[d]);b.push(e[0]);b.push(e[1]);b.push(e[2])}}return b},find_normal:function(c,k,g,b,i,f,a,h,e){var m=vec3.create([c-b,k-i,g-f]);var l=vec3.create([b-a,i-h,f-e]);var j=vec3.create([a-c,h-k,e-g]);var d=vec3.cross(m,l,vec3.create());if(vec3.lengthSquare(d)==0){vec3.cross(l,j,d)}if(vec3.lengthSquare(d)==0){vec3.cross(j,m,d)}if(vec3.lengthSquare(d)==0){vec3.set([0,0,1],d)}return vec3.normalize(d)}};
define("components/magi/src/magi", function(){});

/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 * 
 * For further information please contact.
 *   ilmari.heikkinen@gmail.com
 *
 */

if (!window.console) console = { log : function(){} };

ASVector = function(elements) {
  elements = elements || 0;
  if (elements.length) {
    this.length = elements.length;
    for (var i=0; i<elements.length; i++)
      this[i] = elements[i];
  } else {
    this.length = elements;
    for (var i=0; i<elements; i++)
      this[i] = 0;
  }
}
ASVector.prototype = {};
ASVector.prototype.set = function(idx, val) {
  if (idx.length)
    ASVector.call(this, idx);
  else
    this[idx] = val;
}

if (typeof Float32Array == 'undefined') {
  FloatVector = ASVector;
  IntVector = ASVector;
  UintVector = ASVector;
} else {
  FloatVector = Float32Array;
  IntVector = Int32Array;
  UintVector = Uint32Array;
}

toInt = Math.floor;

Object.extend = function(dst, src) {
  for (var i in src) {
    try{ dst[i] = src[i]; } catch(e) {}
  }
  return dst;
}

toArray = function(obj) {
  var a = new Array(obj.length);
  for (var i=0; i<obj.length; i++)
    a[i] = obj[i];
  return a;
}

Klass = (function() {
  var c = function() {
    if (this.initialize)
      this.initialize.apply(this, arguments);
  }
  c.ancestors = toArray(arguments);
  c.prototype = {};
  for(var i = 0; i<arguments.length; i++) {
    var a = arguments[i];
    if (a.prototype) {
      Object.extend(c.prototype, a.prototype);
    } else {
      Object.extend(c.prototype, a);
    }
  }
  Object.extend(c, c.prototype);
  return c;
})

Object.asCopy = function(obj) {
  if (typeof obj != 'object') {
    return obj;
  } else if (obj instanceof FloatVector) {
    var v = new FloatVector(obj.length);
    for (var i=0; i<v.length; i++)
      v[i] = obj[i];
    return v;
  } else if (obj instanceof IntVector) {
    var v = new IntVector(obj.length);
    for (var i=0; i<v.length; i++)
      v[i] = obj[i];
    return v;
  } else if (obj instanceof UintVector) {
    var v = new UintVector(obj.length);
    for (var i=0; i<v.length; i++)
      v[i] = obj[i];
    return v;
  } else if (obj instanceof Array) {
    return obj.map(Object.asCopy);
  } else {
    var newObj = {};
    for (var i in obj) {
      var v = obj[i];
      if (typeof v == 'object') {
        v = Object.asCopy(v);
      }
      newObj[i] = v;
    }
    return newObj;
  }
}

ASKlass = (function(name) {
  var c = function() {
    var cc = this.__copyObjects__;
    for (var i=0; i<cc.length; i++)
      this[cc[i]] = Object.asCopy(this[cc[i]])
    if (this.initialize)
      this.initialize.apply(this, arguments);
  }
  c.ancestors = toArray(arguments).slice(1);
  c.prototype = {};
  for(var i = 1; i<arguments.length; i++) {
    var a = arguments[i];
    if (a.prototype) {
      Object.extend(c.prototype, a.prototype);
    } else {
      Object.extend(c.prototype, a);
    }
  }
  c.prototype.className = name;
  c.prototype.initialize = c.prototype[name];
  c.prototype.__copyObjects__ = [];
  for (var i in c.prototype) {
    var v = c.prototype[i];
    if (i != '__copyObjects__') {
      if (typeof v == 'object') {
        c.prototype.__copyObjects__.push(i);
      }
    }
  }
  Object.extend(c, c.prototype);
  return c;
})


/**
 * A partial implementation of the ActionScript3 BitmapData class.
 * See: http://www.adobe.com/livedocs/flash/9.0/ActionScriptLangRefV3/flash/display/BitmapData.html
 */
BitmapData = Klass({
  initialize : function(i_width, i_height, transparent, fill) {
    this.width = i_width;
    this.height = i_height;
    this.transparent = (transparent == null ? true : transparent);
    this.fill = (fill == null ? 0xffffffff : fill);
    this.data = new UintVector(i_width*i_height);
    for (var i=0; i<this.data.length; i++) {
      this.data[i] = fill;
    }
    this.rect = new Rectangle(0,0,this.width, this.height);
  },
  fillRect : function(rect, value) {
    var stride = this.width;
    var y = Math.clamp(rect.y,0,this.height)*stride
      , y2 = Math.clamp(rect.y+rect.height,0,this.height)*stride
      , x = Math.clamp(rect.x,0,this.width)
      , x2 = Math.clamp(rect.x+rect.width,0,this.width);
    var d = this.data;
    for (var y1=y;y1<y2; y1+=stride)
      for (var x1=x;x1<x2; x1++)
        d[y1+x1] = value;
  },
  getPixel32 : function(x,y) {
    return this.data[y*this.width + x];
  },
  setPixel32 : function(x,y,v) {
    return this.data[y*this.width + x] = v;
  },
  getPixel : function(x,y) {
    return this.data[y*this.width + x] & 0x00ffffff;
  },
  setPixel : function(x,y,v) {
    return this.data[y*this.width + x] = v | (this.data[y*this.width + x] & 0xff000000);
  },
  getWidth : function () { return this.width; },
  getHeight : function () { return this.height; },
  copyPixels : function(source, rect, offset) {
    var tstride = this.width;
    var stride = source.width;
    var d = source.data;
    var td = this.data;
    var ty = Math.clamp(offset.y,0,this.height)*tstride
      , ty2 = Math.clamp(offset.y+rect.height,0,this.height)*tstride
      , tx = Math.clamp(offset.x,0,this.width)
      , tx2 = Math.clamp(offset.x+rect.width,0,this.width);
    var y = Math.clamp(rect.y,0,source.height)*stride
      , y2 = Math.clamp(rect.y+rect.height,0,source.height)*stride
      , x = Math.clamp(rect.x,0,source.width)
      , x2 = Math.clamp(rect.x+rect.width,0,source.width);
    for (var y1=y,ty1=ty; y1<y2 && ty1<ty2; y1+=stride,ty1+=tstride)
      for (var x1=x,tx1=tx; x1<x2 && tx1<tx2; x1++,tx1++)
        td[ty1+tx1] = d[y1+x1];
  },
  getColorBoundsRect : function(mask, color, findColor) {
    if (findColor) {
      return this.getColorBoundsRect_true(mask, color);
    } else {
      return this.getColorBoundsRect_false(mask, color);
    }
  },
  getColorBoundsRect_true : function(mask, color) {
    var minX=this.width, minY=this.height, maxX=0, maxY=0;
    var w = this.width; h=this.height;
    var d = this.data;
    var m = 0, off = 0;
    minYfor: for (var y=0; y<h; y++) {
      off = y*w-1;
      for (var x=0; x<w; x++) {
        m = (d[++off] & mask) - color;
        if (!m) {
          minX = maxX = x;
          minY = maxY = y;
          break minYfor;
        }
      }
    }
    maxYfor: for (var y=h-1; y>minY; y--) {
      off = y*w-1;
      for (var x=0; x<w; x++) {
        m = (d[++off] & mask) - color;
        if (!m) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          maxY = y;
          break maxYfor;
        }
      }
    }
    for (var y=minY; y<=maxY; y++) {
      off = y*w-1;
      for (var x=0; x<minX; x++) {
        m = (d[++off] & mask) - color;
        if (!m) {
          minX = x;
          break;
        }
      }
      off = y*w+w;
      for (var x=w-1; x>maxX; x--) {
        m = (d[--off] & mask) - color;
        if (!m) {
          maxX = x;
          break;
        }
      }
    }
    return new Rectangle(minX, minY, Math.max(0,maxX-minX), Math.max(0,maxY-minY));
  },
  getColorBoundsRect_false : function(mask, color) {
    var minX=this.width, minY=this.height, maxX=0, maxY=0;
    var w = this.width; h=this.height;
    var d = this.data;
    minYfor: for (var y=0; y<h; y++) {
      for (var x=0; x<w; x++) {
        var m = (d[y*w+x] & mask) - color;
        if (m) {
          minX = maxX = x;
          minY = maxY = y;
          break minYfor;
        }
      }
    }
    maxYfor: for (var y=h-1; y>minY; y--) {
      for (var x=0; x<w; x++) {
        var m = (d[y*w+x] & mask) - color;
        if (m) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          maxY = y;
          break maxYfor;
        }
      }
    }
    for (var y=minY; y<=maxY; y++) {
      for (var x=0; x<minX; x++) {
        var m = (d[y*w+x] & mask) - color;
        if (m) {
          minX = x;
          break;
        }
      }
      for (var x=h-1; x>maxX; x--) {
        var m = (d[y*w+x] & mask) - color;
        if (m) {
          maxX = x;
          break;
        }
      }
    }
    return new Rectangle(minX, minY, Math.max(0,maxX-minX), Math.max(0,maxY-minY));
  },
  putImageData : function(imageData, x,y, w,h) {
    w = Math.clamp(w,0,imageData.width), h = Math.clamp(h,0,imageData.height);
    var stride = this.width;
    var d = this.data;
    var td = imageData.data;
    var y = Math.clamp(y,0,this.height)*stride
      , y2 = Math.clamp(y+h,0,this.height)*stride
      , x = Math.clamp(x,0,this.width)
      , x2 = Math.clamp(x+w,0,this.width);
    for (var y1=y,ty1=0; y1<y2; y1+=stride,ty1+=imageData.width*4) {
      for (var x1=x,tx1=0; x1<x2; x1++,tx1+=4) {
        d[y1+x1] = ( // transform canvas pixel to 32-bit ARGB int
          (td[ty1+tx1] << 16) |
          (td[ty1+tx1+1] << 8) |
          (td[ty1+tx1+2]) |
          (td[ty1+tx1+3] << 24)
        );
      }
    }
  },
  drawCanvas : function(canvas, x,y,w,h) {
    this.putImageData(canvas.getContext('2d').getImageData(0,0,w,h),x,y,w,h);
  },
  drawOnCanvas : function(canvas) {
    var ctx = canvas.getContext('2d');
    var id = ctx.getImageData(0,0,this.width,this.height);
    var stride = this.width;
    var length = this.height*stride;
    var d = this.data;
    var td = id.data;
    for (var y=0; y<length; y+=stride) {
      for (var x=0; x<stride; x++) {
        var base = 4*(y+x);
        var c = d[y+x];
        td[base] = (c >> 16) & 0xff;
        td[++base] = (c >> 8) & 0xff;
        td[++base] = (c) & 0xff;
        td[++base] = (c >> 24) & 0xff;
      }
    }
    ctx.putImageData(id, 0,0);
  },
  floodFill : function(x, y, nv) {
    var l=0, x1=0, x2=0, dy=0;
    var ov=0; /* old pixel value */
    var stack = [];
    var w = this.width, h = this.height;
    var stride = this.width;
    var data = this.data;

    ov = data[y*stride + x];
    if (ov==nv || x<0 || x>=w || y<0 || y>=h) return;
    stack.push([y, x, x, 1]);     /* needed in some cases */
    stack.push([y+1, x, x, -1]);    /* seed segment (popped 1st) */

    while (stack.length > 0) {
      /* pop segment off stack and fill a neighboring scan line */
      var a = stack.pop();
      y = a[0]+a[3], x1 = a[1], x2 = a[2], dy = a[3];
      /*
      * segment of scan line y-dy for x1<=x<=x2 was previously filled,
      * now explore adjacent pixels in scan line y
      */
      for (x=x1; x>=0 && data[y*stride + x]==ov; x--)
        data[y*stride + x] = nv;
      if (x<x1) {
        l = x+1;
        if (l<x1) stack.push([y, l, x1-1, -dy]);    /* leak on left? */
        x = x1+1;
        for (; x<w && data[y*stride + x]==ov; x++)
          data[y*stride + x] = nv;
        stack.push([y, l, x-1, dy]);
        if (x>x2+1) stack.push([y, x2+1, x-1, -dy]);  /* leak on right? */
      }
      for (x++; x<=x2 && data[y*stride + x]!=ov; x++)
        null;
      l = x;
      while (x<=x2) {
        for (; x<w && data[y*stride + x]==ov; x++)
          data[y*stride + x] = nv;
        stack.push([y, l, x-1, dy]);
        if (x>x2+1) stack.push([y, x2+1, x-1, -dy]);  /* leak on right? */
        for (x++; x<=x2 && data[y*stride + x]!=ov; x++)
          null;
        l = x;
      }
    }
  }
})

Rectangle = Klass({
  initialize : function(x,y,w,h){
    this.x = x; this.y = y;
    this.top = y; this.left = x;
    this.bottom = y+h; this.right = x+w;
    this.width = w; this.height = h;
    this.updateCalc();
  },
  updateCalc : function() {
    this.top = this.y;
    this.left = this.x;
    this.bottom = this.y+this.height;
    this.right = this.x+this.width;
  },
  clone : function() {
    return new Rectangle(this.x, this.y, this.width, this.height);
  },
  inflate : function(dx,dy) {
    this.x -= dx;
    this.y -= dy;
    this.width += 2 * dx;
    this.height += 2 * dy;
    this.updateCalc();
  },
  isEmpty : function() {
    return (this.width <= 0 && this.height <= 0)
  }
})

/**
  * The Exception object used by NyARToolkit.
  */
NyARException = Klass(Error,
{
  initialize : function(m)
  {
    Error.call(this,m);
  },
  trap : function(m)
  {
    throw new NyARException("trap:" + m);
  },

  notImplement : function()
  {
    throw new NyARException("Not Implement!");
  }
})

NyAS3Const_Inherited = Klass({
})

NyAS3Utils = Klass(
{
  assert : function(e, mess)
  {
    if(!e){throw new Error("NyAS3Utils.assert:"+mess!=null?mess:"");}
  }
})

NyARVec = Klass(
{
  clm : null,
  v : null,

  initialize : function(i_clm)
  {
    this.v = new FloatVector(i_clm);
    this.clm = i_clm;
  },

  getClm : function()
  {
    return this.clm;
  },
  getArray : function()
  {
    return this.v;
  }
})

/**
  * ARMat構造体に対応するクラス typedef struct { double *m; int row; int clm; }ARMat;
  *
  */
NyARMat = Klass(
{
  /**
    * 配列サイズと行列サイズは必ずしも一致しないことに注意 返された配列のサイズを行列の大きさとして使わないこと！
    *
    */
  m : null,
  __matrixSelfInv_nos : null,

  clm : null,
  row : null,

  initialize : function(i_row,i_clm)
  {
    this.m = new Array(i_row);
    for (var i=0; i<i_row; i++) {
      this.m[i] = new FloatVector(i_clm);
      for (var j=0; j<i_clm; j++)
        this.m[i][j] = 0.0;
    }
    this.__matrixSelfInv_nos=new FloatVector(i_row);
    this.clm = i_clm;
    this.row = i_row;
    return;
  }
  /**
    * 行列の列数を返します。
    * @return
    */
  ,getClm : function()
  {
    return this.clm;
  }
  /**
    * 行列の行数を返します。
    * @return
    */
  ,getRow : function()
  {
    return this.row;
  }
  ,getArray : function()
  {
    return this.m;
  }
  /**
    * 逆行列を計算して、thisへ格納します。
    * @throws NyARException
    */
  ,matrixSelfInv : function()
  {
    var ap = this.m;
    var dimen = this.row;
    var dimen_1 = dimen - 1;
    var ap_n, ap_ip, ap_i;// wap;
    var j, ip, nwork;
    var nos = this.__matrixSelfInv_nos;//ワーク変数
    // double epsl;
    var p, pbuf, work;

    /* check size */
    switch (dimen) {
    case 0:
      throw new NyARException();
    case 1:
      ap[0][0] = 1.0 / ap[0][0];// *ap = 1.0 / (*ap);
      return true;/* 1 dimension */
    }
    var n;
    for (n = 0; n < dimen; n++) {
      nos[n] = n;
    }

    /*
      * nyatla memo ipが定まらないで計算が行われる場合があるので挿入。 ループ内で0初期化していいかが判らない。
      */
    ip = 0;
    // For順変更禁止
    for (n = 0; n < dimen; n++) {
      ap_n = ap[n];// wcp = ap + n * rowa;
      p = 0.0;
      for (var i = n; i < dimen; i++) {
        if (p < (pbuf = Math.abs(ap[i][0]))) {
          p = pbuf;
          ip = i;
        }
      }
      // if (p <= matrixSelfInv_epsl){
      if (p == 0.0) {
        return false;
        // throw new NyARException();
      }

      nwork = nos[ip];
      nos[ip] = nos[n];
      nos[n] = nwork;

      ap_ip = ap[ip];
      for (j = 0; j < dimen; j++) {// for(j = 0, wap = ap + ip * rowa,
                      // wbp = wcp; j < dimen ; j++) {
        work = ap_ip[j]; // work = *wap;
        ap_ip[j] = ap_n[j];
        ap_n[j] = work;
      }

      work = ap_n[0];
      for (j = 0; j < dimen_1; j++) {
        ap_n[j] = ap_n[j + 1] / work;// *wap = *(wap + 1) / work;
      }
      ap_n[j] = 1.0 / work;// *wap = 1.0 / work;
      for (i = 0; i < dimen; i++) {
        if (i != n) {
          ap_i = ap[i];// wap = ap + i * rowa;
          work = ap_i[0];
          for (j = 0; j < dimen_1; j++) {// for(j = 1, wbp = wcp,work = *wap;j < dimen ;j++, wap++, wbp++)
            ap_i[j] = ap_i[j + 1] - work * ap_n[j];// wap = *(wap +1) - work *(*wbp);
          }
          ap_i[j] = -work * ap_n[j];// *wap = -work * (*wbp);
        }
      }
    }

    for (n = 0; n < dimen; n++) {
      for (j = n; j < dimen; j++) {
        if (nos[j] == n) {
          break;
        }
      }
      nos[j] = nos[n];
      for (i = 0; i < dimen; i++) {
        ap_i = ap[i];
        work = ap_i[j];// work = *wap;
        ap_i[j] = ap_i[n];// *wap = *wbp;
        ap_i[n] = work;// *wbp = work;
      }
    }
    return true;
  }
})

ArrayUtils = ASKlass('ArrayUtils',
{
  create2dInt : function(height, width)
  {
    var r = new Array(height);
    for (var i = 0; i < height; i++){
      r[i] = new IntVector(width);
    }
    return r;
  }
  ,create2dNumber : function(height, width)
  {
    var r = new Array(height);
    for (var i = 0; i < height; i++){
      r[i] = new FloatVector(width);
    }
    return r;
  }
  ,copyInt : function(src, srcPos, dest, destPos, length) {
    for (var i = 0; i < length; i++) {
      dest[destPos + i] = src[srcPos + i];
    }
  }
})
/*
 * PROJECT: FLARToolKit
 * --------------------------------------------------------------------------------
 * This work is based on the NyARToolKit developed by
 *   R.Iizuka (nyatla)
 * http://nyatla.jp/nyatoolkit/
 *
 * The FLARToolKit is ActionScript 3.0 version ARToolkit class library.
 * Copyright (C)2008 Saqoosha
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 2
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this framework; if not, write to the Free Software
 * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
 *
 * For further information please contact.
 *  http://www.libspark.org/wiki/saqoosha/FLARToolKit
 *  <saq(at)saqoosha.net>
 *
 */
ArrayUtil = ASKlass('ArrayUtil', {
  createJaggedArray : function(len) {
    var arr = new Array(len);
    var args = toArray(arguments).slice(1);
    while (len--) {
      arr[len] = args.length ? this.createJaggedArray.apply(null, args) : 0;
    }
    return arr;
  }
  ,create2d : function(height, width) {
    return this.createJaggedArray(height, width);
  }
  ,create3d : function(depth, height, width) {
    return this.createJaggedArray(depth, height, width);
  }
  ,copy : function(src, srcPos, dest, destPos, length) {
    for (var i = 0; i < length; i++) {
      dest[destPos + i] = src[srcPos + i];
    }
  }
})
/*
 * PROJECT: FLARToolKit
 * --------------------------------------------------------------------------------
 * This work is based on the NyARToolKit developed by
 *   R.Iizuka (nyatla)
 * http://nyatla.jp/nyatoolkit/
 *
 * The FLARToolKit is ActionScript 3.0 version ARToolkit class library.
 * Copyright (C)2008 Saqoosha
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 2
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this framework; if not, write to the Free Software
 * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
 *
 * For further information please contact.
 *  http://www.libspark.org/wiki/saqoosha/FLARToolKit
 *  <saq(at)saqoosha.net>
 *
 */
FLARException = ASKlass('FLARException', NyARException,
{
  FLARException : function(m)
  {
    NyARException.initialize.call(this,m||'');
  }
  ,trap : function(m)
  {
    throw new FLARException("trap:" + m);
  }
  ,notImplement : function()
  {
    throw new FLARException("Not Implement!");
  }
})
/*
 * PROJECT: FLARToolKit
 * --------------------------------------------------------------------------------
 * This work is based on the NyARToolKit developed by
 *   R.Iizuka (nyatla)
 * http://nyatla.jp/nyatoolkit/
 *
 * The FLARToolKit is ActionScript 3.0 version ARToolkit class library.
 * Copyright (C)2008 Saqoosha
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  http://www.libspark.org/wiki/saqoosha/FLARToolKit
 *  <saq(at)saqoosha.net>
 *
 */
FLARMat = NyARMat;
/*
 * PROJECT: FLARToolKit
 * --------------------------------------------------------------------------------
 * This work is based on the NyARToolKit developed by
 *   R.Iizuka (nyatla)
 * http://nyatla.jp/nyatoolkit/
 *
 * The FLARToolKit is ActionScript 3.0 version ARToolkit class library.
 * Copyright (C)2008 Saqoosha
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  http://www.libspark.org/wiki/saqoosha/FLARToolKit
 *  <saq(at)saqoosha.net>
 *
 */
FLARRgbPixelReader_BitmapData = ASKlass('FLARRgbPixelReader_BitmapData',
{
  _ref_bitmap : null
  ,FLARRgbPixelReader_BitmapData : function(i_buffer)
  {
    this._ref_bitmap = i_buffer;
  }
  ,getPixel : function(i_x, i_y, o_rgb)
  {
    var c = this._ref_bitmap.getPixel(i_x, i_y);
    o_rgb[0] = (c >> 16) & 0xff;// R
    o_rgb[1] = (c >> 8) & 0xff;// G
    o_rgb[2] = c & 0xff;// B
    return;
  }
  ,getPixelSet : function(i_x, i_y, i_num, o_rgb)
  {
    var bmp = this._ref_bitmap;
    var c;
    var i;
    for (i = 0; i < i_num; i++) {
      c = bmp.getPixel(i_x[i], i_y[i]);
      o_rgb[i*3+0] = (c >> 16) & 0xff;
      o_rgb[i*3+1] = (c >> 8) & 0xff;
      o_rgb[i*3+2] = c & 0xff;
    }
  }
  ,setPixel : function(i_x, i_y, i_rgb)
  {
    NyARException.notImplement();
  }
  ,setPixels : function(i_x, i_y, i_num, i_intrgb)
  {
    NyARException.notImplement();
  }
  ,switchBuffer : function(i_ref_buffer)
  {
    NyARException.notImplement();
  }
})
FLARGrayPixelReader_BitmapData = ASKlass('FLARGrayPixelReader_BitmapData',
{
  _ref_bitmap : null
  ,FLARGrayPixelReader_BitmapData : function(i_buffer)
  {
    this._ref_bitmap = i_buffer;
  }
  ,getPixel : function(i_x, i_y, i_num, o_gray)
  {
    NyARException.notImplement();
    var w = this._ref_bitmap.getWidth();
    var d = this._ref_bitmap.getBuffer();
    o_gray[0] = o_gray[1] = o_gray[2] = ~d(i_x + w*i_y) & 0xff;
  }
  ,getPixelSet : function(i_x, i_y, i_num, o_gray)
  {
    var w = this._ref_bitmap.getWidth();
    var d = this._ref_bitmap.data;
    for (var i = 0; i < i_num; i++) {
      o_gray[i] = ~d[i_x[i] + w*i_y[i]] & 0xff;
    }
  }
  ,setPixel : function(i_x, i_y, i_rgb)
  {
    NyARException.notImplement();
  }
  ,setPixels : function(i_x, i_y, i_num, i_intrgb)
  {
    NyARException.notImplement();
  }
  ,switchBuffer : function(i_ref_buffer)
  {
    NyARException.notImplement();
  }
})/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */
INyARHistogramAnalyzer_Threshold = ASKlass('INyARHistogramAnalyzer_Threshold',
{
  getThreshold : function(i_histgram){}
})
NyARHistogramAnalyzer_SlidePTile = ASKlass('NyARHistogramAnalyzer_SlidePTile', INyARHistogramAnalyzer_Threshold,
{
  _persentage : 0,
  NyARHistogramAnalyzer_SlidePTile : function(i_persentage)
  {
    NyAS3Utils.assert (0 <= i_persentage && i_persentage <= 50);
    //初期化
    this._persentage=i_persentage;
  }
  ,getThreshold : function(i_histgram)
  {
    //総ピクセル数を計算
    var n=i_histgram.length;
    var sum_of_pixel=i_histgram.total_of_data;
    var hist=i_histgram.data;
    // 閾値ピクセル数確定
    var th_pixcels = sum_of_pixel * this._persentage / 100;
    var th_wk;
    var th_w, th_b;
    // 黒点基準
    th_wk = th_pixcels;
    for (th_b = 0; th_b < n-2; th_b++) {
      th_wk -= hist[th_b];
      if (th_wk <= 0) {
        break;
      }
    }
    // 白点基準
    th_wk = th_pixcels;
    for (th_w = n-1; th_w > 1; th_w--) {
      th_wk -= hist[th_w];
      if (th_wk <= 0) {
        break;
      }
    }
    // 閾値の保存
    return (th_w + th_b) / 2;
  }
})
/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */
INyARPca2d = ASKlass('INyARPca2d',
{
  /**
   * 通常のPCA
   * @param i_v1
   * @param i_v2
   * @param i_start
   * @param i_number_of_point
   * @param o_evec
   * 要素2の変数を指定してください。
   * @param o_ev
   * 要素2の変数を指定してください。
   * @param o_mean
   * @throws NyARException
   */
  pca : function(i_v1, i_v2, i_number_of_point, o_evec, o_ev, o_mean){}
})
NyARPca2d_MatrixPCA_O2 = ASKlass('NyARPca2d_MatrixPCA_O2', INyARPca2d,
{
  PCA_EPS : 1e-6, // #define EPS 1e-6
  PCA_MAX_ITER : 100, // #define MAX_ITER 100
  PCA_VZERO : 1e-16, // #define VZERO 1e-16
  /**
   * static int QRM( ARMat *a, ARVec *dv )の代替関数
   *
   * @param a
   * @param dv
   * @throws NyARException
   */
  PCA_QRM : function(o_matrix,dv)
  {
    var w, t, s, x, y, c;
    var ev1;
    var dv_x,dv_y;
    var mat00,mat01,mat10,mat11;
    // <this.vecTridiagonalize2d(i_mat, dv, ev);>
    dv_x = o_matrix.m00;// this.m[dim - 2][dim - 2];// d.v[dim-2]=a.m[dim-2][dim-2];//d->v[dim-2]=a->m[(dim-2)*dim+(dim-2)];
    ev1 = o_matrix.m01;// this.m[dim - 2][dim - 1];// e.v[dim-2+i_e_start]=a.m[dim-2][dim-1];//e->v[dim-2] = a->m[(dim-2)*dim+(dim-1)];
    dv_y = o_matrix.m11;// this.m[dim - 1][dim - 1];// d.v[dim-1]=a_array[dim-1][dim-1];//d->v[dim-1] =a->m[(dim-1)*dim+(dim-1)];
    // 単位行列にする。
    mat00 = mat11 = 1;
    mat01 = mat10 = 0;
    // </this.vecTridiagonalize2d(i_mat, dv, ev);>
    // int j = 1;
    // // while(j>0 && fabs(ev->v[j])>EPS*(fabs(dv->v[j-1])+fabs(dv->v[j])))
    // while (j > 0 && Math.abs(ev1) > PCA_EPS * (Math.abs(dv.x) + Math.abs(dv.y))) {
    // j--;
    // }
    // if (j == 0) {
    var iter = 0;
    do {
      iter++;
      if (iter > this.PCA_MAX_ITER) {
        break;
      }
      w = (dv_x - dv_y) / 2;// w = (dv->v[h-1] -dv->v[h]) / 2;//ここ？
      t = ev1 * ev1;// t = ev->v[h] * ev->v[h];
      s = Math.sqrt(w * w + t);
      if (w < 0) {
        s = -s;
      }
      x = dv_x - dv_y + t / (w + s);// x = dv->v[j] -dv->v[h] +t/(w+s);
      y = ev1;// y = ev->v[j+1];
      if (Math.abs(x) >= Math.abs(y)) {
        if (Math.abs(x) > this.PCA_VZERO) {
          t = -y / x;
          c = 1 / Math.sqrt(t * t + 1);
          s = t * c;
        } else {
          c = 1.0;
          s = 0.0;
        }
      } else {
        t = -x / y;
        s = 1.0 / Math.sqrt(t * t + 1);
        c = t * s;
      }
      w = dv_x - dv_y;// w = dv->v[k] -dv->v[k+1];
      t = (w * s + 2 * c * ev1) * s;// t = (w * s +2 * c *ev->v[k+1]) *s;
      dv_x -= t;// dv->v[k] -= t;
      dv_y += t;// dv->v[k+1] += t;
      ev1 += s * (c * w - 2 * s * ev1);// ev->v[k+1]+= s * (c* w- 2* s *ev->v[k+1]);
      x = mat00;// x = a->m[k*dim+i];
      y = mat10;// y = a->m[(k+1)*dim+i];
      mat00 = c * x - s * y;// a->m[k*dim+i] = c * x - s* y;
      mat10 = s * x + c * y;// a->m[(k+1)*dim+i] = s* x + c * y;
      x = mat01;// x = a->m[k*dim+i];
      y = mat11;// y = a->m[(k+1)*dim+i];
      mat01 = c * x - s * y;// a->m[k*dim+i] = c * x - s* y;
      mat11 = s * x + c * y;// a->m[(k+1)*dim+i] = s* x + c * y;
    } while (Math.abs(ev1) > this.PCA_EPS * (Math.abs(dv_x) + Math.abs(dv_y)));
    // }
    t = dv_x;// t = dv->v[h];
    if (dv_y > t) {// if( dv->v[i] > t ) {
      t = dv_y;// t = dv->v[h];
      dv_y = dv_x;// dv->v[h] = dv->v[k];
      dv_x = t;// dv->v[k] = t;
      // 行の入れ替え
      o_matrix.m00 = mat10;
      o_matrix.m01 = mat11;
      o_matrix.m10 = mat00;
      o_matrix.m11 = mat01;
    } else {
      // 行の入れ替えはなし
      o_matrix.m00 = mat00;
      o_matrix.m01 = mat01;
      o_matrix.m10 = mat10;
      o_matrix.m11 = mat11;
    }
    dv[0]=dv_x;
    dv[1]=dv_y;
    return;
  }
  /**
   * static int PCA( ARMat *input, ARMat *output, ARVec *ev )
   *
   * @param output
   * @param o_ev
   * @throws NyARException
   */
  ,PCA_PCA : function(i_v1,i_v2,i_number_of_data,o_matrix,o_ev,o_mean)
  {
    var i;
    // double[] mean_array=mean.getArray();
    // mean.zeroClear();
    //PCA_EXの処理
    var sx = 0;
    var sy = 0;
    for (i = 0; i < i_number_of_data; i++) {
      sx += i_v1[i];
      sy += i_v2[i];
    }
    sx = sx / i_number_of_data;
    sy = sy / i_number_of_data;
    //PCA_CENTERとPCA_xt_by_xを一緒に処理
    var srow = Math.sqrt((i_number_of_data));
    var w00, w11, w10;
    w00 = w11 = w10 = 0.0;// *out = 0.0;
    for (i = 0; i < i_number_of_data; i++) {
      var x = (i_v1[i] - sx) / srow;
      var y = (i_v2[i] - sy) / srow;
      w00 += (x * x);// *out += *in1 * *in2;
      w10 += (x * y);// *out += *in1 * *in2;
      w11 += (y * y);// *out += *in1 * *in2;
    }
    o_matrix.m00=w00;
    o_matrix.m01=o_matrix.m10=w10;
    o_matrix.m11=w11;
    //PCA_PCAの処理
    this.PCA_QRM(o_matrix, o_ev);
    // m2 = o_output.m;// m2 = output->m;
    if (o_ev[0] < this.PCA_VZERO) {// if( ev->v[i] < VZERO ){
      o_ev[0] = 0.0;// ev->v[i] = 0.0;
      o_matrix.m00 = 0.0;// *(m2++) = 0.0;
      o_matrix.m01 = 0.0;// *(m2++) = 0.0;
    }
    if (o_ev[1] < this.PCA_VZERO) {// if( ev->v[i] < VZERO ){
      o_ev[1] = 0.0;// ev->v[i] = 0.0;
      o_matrix.m10 = 0.0;// *(m2++) = 0.0;
      o_matrix.m11 = 0.0;// *(m2++) = 0.0;
    }
    o_mean[0]=sx;
    o_mean[1]=sy;
    // }
    return;
  }
  ,pca : function(i_v1,i_v2,i_number_of_point,o_evec,o_ev,o_mean)
  {
    this.PCA_PCA(i_v1,i_v2,i_number_of_point,o_evec, o_ev,o_mean);
    var sum = o_ev[0] + o_ev[1];
    // For順変更禁止
    o_ev[0] /= sum;// ev->v[i] /= sum;
    o_ev[1] /= sum;// ev->v[i] /= sum;
    return;
  }
})
/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */

/**
 * R8G8B8でピクセルを読み出すインタフェイス
 *
 */
INyARRgbPixelReader = ASKlass('INyARRgbPixelReader', {
  /**
   * 1ピクセルをint配列にして返します。
   *
   * @param i_x
   * @param i_y
   * @param o_rgb
   */
  getPixel : function(i_x, i_y, o_rgb){},
  /**
   * 複数のピクセル値をi_rgbへ返します。
   *
   * @param i_x
   * xのインデックス配列
   * @param i_y
   * yのインデックス配列
   * @param i_num
   * 返すピクセル値の数
   * @param i_rgb
   * ピクセル値を返すバッファ
   */
  getPixelSet : function(i_x, i_y, i_num, o_rgb){},
  /**
   * 1ピクセルを設定します。
   * @param i_x
   * @param i_y
   * @param i_rgb
   * @throws NyARException
   */
  setPixel : function(i_x, i_y, i_rgb){},
  /**
   * 複数のピクセル値をint配列から設定します。
   * @param i_x
   * @param i_y
   * @param i_num
   * @param i_intrgb
   * @throws NyARException
   */
  setPixels : function(i_x, i_y, i_num, i_intrgb){},
  switchBuffer : function(i_ref_buffer){}
})
NyARRgbPixelReader_INT1D_X8R8G8B8_32 = ASKlass('NyARRgbPixelReader_INT1D_X8R8G8B8_32', INyARRgbPixelReader,
{
  _ref_buf : null,
  _size : null,
  NyARRgbPixelReader_INT1D_X8R8G8B8_32 : function(i_buf, i_size)
  {
    this._ref_buf = i_buf;
    this._size = i_size;
  }
  ,getPixel : function(i_x,i_y,o_rgb)
  {
    var rgb= this._ref_buf[i_x + i_y * this._size.w];
    o_rgb[0] = (rgb>>16)&0xff;// R
    o_rgb[1] = (rgb>>8)&0xff;// G
    o_rgb[2] = rgb&0xff;// B
    return;
  }
  ,getPixelSet : function(i_x,i_y,i_num, o_rgb)
  {
    var width = this._size.w;
    var ref_buf = this._ref_buf;
    for (var i = i_num - 1; i >= 0; i--) {
      var rgb=ref_buf[i_x[i] + i_y[i] * width];
      o_rgb[i * 3 + 0] = (rgb>>16)&0xff;// R
      o_rgb[i * 3 + 1] = (rgb>>8)&0xff;// G
      o_rgb[i * 3 + 2] = rgb&0xff;// B
    }
    return;
  }
  ,setPixel : function(i_x,i_y,i_rgb)
  {
    this._ref_buf[i_x + i_y * this._size.w]=((i_rgb[0]<<16)&0xff)|((i_rgb[1]<<8)&0xff)|((i_rgb[2])&0xff);
  }
  ,setPixels : function(i_x,i_y, i_num,i_intrgb)
  {
    throw new NyARException();
  }
  /**
   * 参照しているバッファをi_ref_bufferへ切り替えます。
   * 内部パラメータのチェックは、実装依存です。
   * @param i_ref_buffer
   * @throws NyARException
   */
  ,switchBuffer : function(i_ref_buffer)
  {
    NyAS3Utils.assert(i_ref_buffer.length>=this._size.w*this._size.h);
    this._ref_buf = (i_ref_buffer);
  }
})


NyARRgbPixelReader_Canvas2D = ASKlass("NyARRgbPixelReader_Canvas2D", INyARRgbPixelReader,
{
  _ref_canvas: null,
  _data : null,

  NyARRgbPixelReader_Canvas2D : function(i_canvas)
  {
    this._ref_canvas = i_canvas;
  },

  getData : function() {
    if (this._ref_canvas.changed || !this._data) {
      var canvas = this._ref_canvas;
      var ctx = canvas.getContext('2d');
      this._data = ctx.getImageData(0,0,canvas.width,canvas.height);
      this._ref_canvas.changed = false;
    }
    return this._data;
  },

  getPixel: function(i_x, i_y, o_rgb)
  {
    var idata = this.getData();
    var w = idata.width;
    var h = idata.height;
    var d = idata.data;
    o_rgb[0] = d[i_y*w+i_x];// R
    o_rgb[1] = d[i_y*w+i_x+1];// G
    o_rgb[2] = d[i_y*w+i_x+2];// B
    return;
  },

  getPixelSet: function(i_x, i_y, i_num, o_rgb)
  {
    var idata = this.getData();
    var w = idata.width;
    var h = idata.height;
    var d = idata.data;
    for (var i = 0; i < i_num; i++) {
      var idx = i_y[i]*w*4 + i_x[i]*4;
      o_rgb[i*3+0] = d[idx+0];
      o_rgb[i*3+1] = d[idx+1];
      o_rgb[i*3+2] = d[idx+2];
    }
  },

  setPixel: function(i_x, i_y, i_rgb)
  {
    NyARException.notImplement();
  },
  setPixels: function(i_x, i_y, i_num, i_intrgb)
  {
    NyARException.notImplement();
  },
  switchBuffer:function(i_canvas)
  {
    NyARException.notImplement();
  }

})

/*
* JSARToolkit
* --------------------------------------------------------------------------------
* This work is based on the original ARToolKit developed by
*   Hirokazu Kato
*   Mark Billinghurst
*   HITLab, University of Washington, Seattle
* http://www.hitl.washington.edu/artoolkit/
*
* And the NyARToolkitAS3 ARToolKit class library.
*   Copyright (C)2010 Ryo Iizuka
*
* JSARToolkit is a JavaScript port of NyARToolkitAS3.
*   Copyright (C)2010 Ilmari Heikkinen
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <http://www.gnu.org/licenses/>.
*
* For further information please contact.
*   ilmari.heikkinen@gmail.com
*
*/




INyARDoubleMatrix = Klass({

  /**
    * 配列の内容を行列に設定する。
    * 遅いので余り使わないでね。
    * @param o_value
    */
  setValue : function(o_value){}, // double[]

  /**
    * 行列の内容を配列に返す。
    * 遅いので余り使わないでね。
    * @param o_value
    */
  getValue : function(o_value){} // double[]
})



NyARDoubleMatrix22 = Klass(INyARDoubleMatrix,
{
  m00 : 0,
  m01 : 0,
  m10 : 0,
  m11 : 0,
  /**
    * 遅いからあんまり使わないでね。
    */
  setValue : function(i_value)
  {
    this.m00=i_value[0];
    this.m01=i_value[1];
    this.m10=i_value[3];
    this.m11=i_value[4];
    return;
  }
  /**
    * 遅いからあんまり使わないでね。
    */
  ,getValue : function(o_value)
  {
    o_value[0]=this.m00;
    o_value[1]=this.m01;
    o_value[3]=this.m10;
    o_value[4]=this.m11;
    return;
  }
  ,inverse : function(i_src)
  {
    var a11,a12,a21,a22;
    a11=i_src.m00;
    a12=i_src.m01;
    a21=i_src.m10;
    a22=i_src.m11;
    var det=a11*a22-a12*a21;
    if(det==0){
      return false;
    }
    det=1/det;
    this.m00=a22*det;
    this.m01=-a12*det;
    this.m10=-a21*det;
    this.m11=a11*det;
    return true;
  }
})







NyARDoubleMatrix33 = Klass( INyARDoubleMatrix,
{
  m00 : 0,
  m01 : 0,
  m02 : 0,
  m10 : 0,
  m11 : 0,
  m12 : 0,
  m20 : 0,
  m21 : 0,
  m22 : 0,
  createArray : function(i_number)
  {
    var ret=new Array(i_number);
    for(var i=0;i<i_number;i++)
    {
      ret[i]=new NyARDoubleMatrix33();
    }
    return ret;
  }
  /**
    * 遅いからあんまり使わないでね。
    */
  ,setValue : function(i_value)
  {
    this.m00=i_value[0];
    this.m01=i_value[1];
    this.m02=i_value[2];
    this.m10=i_value[3];
    this.m11=i_value[4];
    this.m12=i_value[5];
    this.m20=i_value[6];
    this.m21=i_value[7];
    this.m22=i_value[8];
    return;
  }
  ,setValue_NyARDoubleMatrix33 : function(i_value)
  {
    this.m00=i_value.m00;
    this.m01=i_value.m01;
    this.m02=i_value.m02;
    this.m10=i_value.m10;
    this.m11=i_value.m11;
    this.m12=i_value.m12;
    this.m20=i_value.m20;
    this.m21=i_value.m21;
    this.m22=i_value.m22;
    return;
  }
  /**
    * 遅いからあんまり使わないでね。
    */
  ,getValue : function(o_value)
  {
    o_value[0]=this.m00;
    o_value[1]=this.m01;
    o_value[2]=this.m02;
    o_value[3]=this.m10;
    o_value[4]=this.m11;
    o_value[5]=this.m12;
    o_value[6]=this.m20;
    o_value[7]=this.m21;
    o_value[8]=this.m22;
    return;
  }
  ,inverse : function(i_src)
  {
    var a11,a12,a13,a21,a22,a23,a31,a32,a33;
    var b11,b12,b13,b21,b22,b23,b31,b32,b33;
    a11=i_src.m00;a12=i_src.m01;a13=i_src.m02;
    a21=i_src.m10;a22=i_src.m11;a23=i_src.m12;
    a31=i_src.m20;a32=i_src.m21;a33=i_src.m22;

    b11=a22*a33-a23*a32;
    b12=a32*a13-a33*a12;
    b13=a12*a23-a13*a22;

    b21=a23*a31-a21*a33;
    b22=a33*a11-a31*a13;
    b23=a13*a21-a11*a23;

    b31=a21*a32-a22*a31;
    b32=a31*a12-a32*a11;
    b33=a11*a22-a12*a21;

    var det_1=a11*b11+a21*b12+a31*b13;
    if(det_1==0){
      return false;
    }
    det_1=1/det_1;

    this.m00=b11*det_1;
    this.m01=b12*det_1;
    this.m02=b13*det_1;

    this.m10=b21*det_1;
    this.m11=b22*det_1;
    this.m12=b23*det_1;

    this.m20=b31*det_1;
    this.m21=b32*det_1;
    this.m22=b33*det_1;

    return true;
  }
  /**
    * この関数は、0-PIの間で値を返します。
    * @param o_out
    */
  ,getZXYAngle : function(o_out)
  {
    var sina = this.m21;
    if (sina >= 1.0) {
      o_out.x = Math.PI / 2;
      o_out.y = 0;
      o_out.z = Math.atan2(-this.m10, this.m00);
    } else if (sina <= -1.0) {
      o_out.x = -Math.PI / 2;
      o_out.y = 0;
      o_out.z = Math.atan2(-this.m10, this.m00);
    } else {
      o_out.x = Math.asin(sina);
      o_out.z = Math.atan2(-this.m01, this.m11);
      o_out.y = Math.atan2(-this.m20, this.m22);
    }
  }
  ,setZXYAngle_NyARDoublePoint3d : function(i_angle)
  {
    this.setZXYAngle_Number(i_angle.x,i_angle.y,i_angle.z);
    return;
  }
  ,setZXYAngle_Number : function(i_x,i_y,i_z)
  {
    var sina = Math.sin(i_x);
    var cosa = Math.cos(i_x);
    var sinb = Math.sin(i_y);
    var cosb = Math.cos(i_y);
    var sinc = Math.sin(i_z);
    var cosc = Math.cos(i_z);
    this.m00 = cosc * cosb - sinc * sina * sinb;
    this.m01 = -sinc * cosa;
    this.m02 = cosc * sinb + sinc * sina * cosb;
    this.m10 = sinc * cosb + cosc * sina * sinb;
    this.m11 = cosc * cosa;
    this.m12 = sinc * sinb - cosc * sina * cosb;
    this.m20 = -cosa * sinb;
    this.m21 = sina;
    this.m22 = cosb * cosa;
    return;
  }
  /**
    * 回転行列を適応して座標変換します。
    * @param i_angle
    * @param o_out
    */
  ,transformVertex_NyARDoublePoint3d : function(i_position,o_out)
  {
    transformVertex_double(i_position.x,i_position.y,i_position.z,o_out);
    return;
  }

  ,transformVertex_double : function(i_x,i_y,i_z,o_out)
  {
    o_out.x=this.m00*i_x+this.m01*i_y+this.m02*i_z;
    o_out.y=this.m10*i_x+this.m11*i_y+this.m12*i_z;
    o_out.z=this.m20*i_x+this.m21*i_y+this.m22*i_z;
    return;
  }
})





NyARDoubleMatrix34 = Klass( INyARDoubleMatrix,
{

  m00 : 0,
  m01 : 0,
  m02 : 0,
  m03 : 0,
  m10 : 0,
  m11 : 0,
  m12 : 0,
  m13 : 0,
  m20 : 0,
  m21 : 0,
  m22 : 0,
  m23 : 0,

  setValue : function(i_value)
  {
    this.m00 = i_value[0];
    this.m01 = i_value[1];
    this.m02 = i_value[2];
    this.m03 = i_value[3];
    this.m10 = i_value[4];
    this.m11 = i_value[5];
    this.m12 = i_value[6];
    this.m13 = i_value[7];
    this.m20 = i_value[8];
    this.m21 = i_value[9];
    this.m22 = i_value[10];
    this.m23 = i_value[11];
    return;
  }
  ,setValue_NyARDoubleMatrix34 : function(i_value)
  {
    this.m00=i_value.m00;
    this.m01=i_value.m01;
    this.m02=i_value.m02;
    this.m03=i_value.m03;
    this.m10=i_value.m10;
    this.m11=i_value.m11;
    this.m12=i_value.m12;
    this.m13=i_value.m13;
    this.m20=i_value.m20;
    this.m21=i_value.m21;
    this.m22=i_value.m22;
    this.m23=i_value.m23;
    return;
  }

  ,getValue : function(o_value)
  {
    o_value[0] = this.m00;
    o_value[1] = this.m01;
    o_value[2] = this.m02;
    o_value[3] = this.m03;
    o_value[4] = this.m10;
    o_value[5] = this.m11;
    o_value[6] = this.m12;
    o_value[7] = this.m13;
    o_value[8] = this.m20;
    o_value[9] = this.m21;
    o_value[10] = this.m22;
    o_value[11] = this.m23;
    return;
  }
})



NyARDoubleMatrix44 = Klass( INyARDoubleMatrix,
{
  m00 : 0,
  m01 : 0,
  m02 : 0,
  m03 : 0,
  m10 : 0,
  m11 : 0,
  m12 : 0,
  m13 : 0,
  m20 : 0,
  m21 : 0,
  m22 : 0,
  m23 : 0,
  m30 : 0,
  m31 : 0,
  m32 : 0,
  m33 : 0,
  createArray : function(i_number)
  {
    var ret=new Array(i_number);
    for(var i=0;i<i_number;i++)
    {
      ret[i]=new NyARDoubleMatrix44();
    }
    return ret;
  }
  /**
    * 遅いからあんまり使わないでね。
    */
  ,setValue : function(i_value)
  {
    this.m00=i_value[ 0];
    this.m01=i_value[ 1];
    this.m02=i_value[ 2];
    this.m03=i_value[ 3];
    this.m10=i_value[ 4];
    this.m11=i_value[ 5];
    this.m12=i_value[ 6];
    this.m13=i_value[ 7];
    this.m20=i_value[ 8];
    this.m21=i_value[ 9];
    this.m22=i_value[10];
    this.m23=i_value[11];
    this.m30=i_value[12];
    this.m31=i_value[13];
    this.m32=i_value[14];
    this.m33=i_value[15];
    return;
  }
  /**
    * 遅いからあんまり使わないでね。
    */
  ,getValue : function(o_value)
  {
    o_value[ 0]=this.m00;
    o_value[ 1]=this.m01;
    o_value[ 2]=this.m02;
    o_value[ 3]=this.m03;
    o_value[ 4]=this.m10;
    o_value[ 5]=this.m11;
    o_value[ 6]=this.m12;
    o_value[ 7]=this.m13;
    o_value[ 8]=this.m20;
    o_value[ 9]=this.m21;
    o_value[10]=this.m22;
    o_value[11]=this.m23;
    o_value[12]=this.m30;
    o_value[13]=this.m31;
    o_value[14]=this.m32;
    o_value[15]=this.m33;
    return;
  }
  ,inverse : function(i_src)
  {
    var a11,a12,a13,a14,a21,a22,a23,a24,a31,a32,a33,a34,a41,a42,a43,a44;
    var b11,b12,b13,b14,b21,b22,b23,b24,b31,b32,b33,b34,b41,b42,b43,b44;
    var t1,t2,t3,t4,t5,t6;
    a11=i_src.m00;a12=i_src.m01;a13=i_src.m02;a14=i_src.m03;
    a21=i_src.m10;a22=i_src.m11;a23=i_src.m12;a24=i_src.m13;
    a31=i_src.m20;a32=i_src.m21;a33=i_src.m22;a34=i_src.m23;
    a41=i_src.m30;a42=i_src.m31;a43=i_src.m32;a44=i_src.m33;

    t1=a33*a44-a34*a43;
    t2=a34*a42-a32*a44;
    t3=a32*a43-a33*a42;
    t4=a34*a41-a31*a44;
    t5=a31*a43-a33*a41;
    t6=a31*a42-a32*a41;

    b11=a22*t1+a23*t2+a24*t3;
    b21=-(a23*t4+a24*t5+a21*t1);
    b31=a24*t6-a21*t2+a22*t4;
    b41=-(a21*t3-a22*t5+a23*t6);

    t1=a43*a14-a44*a13;
    t2=a44*a12-a42*a14;
    t3=a42*a13-a43*a12;
    t4=a44*a11-a41*a14;
    t5=a41*a13-a43*a11;
    t6=a41*a12-a42*a11;

    b12=-(a32*t1+a33*t2+a34*t3);
    b22=a33*t4+a34*t5+a31*t1;
    b32=-(a34*t6-a31*t2+a32*t4);
    b42=a31*t3-a32*t5+a33*t6;

    t1=a13*a24-a14*a23;
    t2=a14*a22-a12*a24;
    t3=a12*a23-a13*a22;
    t4=a14*a21-a11*a24;
    t5=a11*a23-a13*a21;
    t6=a11*a22-a12*a21;

    b13=a42*t1+a43*t2+a44*t3;
    b23=-(a43*t4+a44*t5+a41*t1);
    b33=a44*t6-a41*t2+a42*t4;
    b43=-(a41*t3-a42*t5+a43*t6);

    t1=a23*a34-a24*a33;
    t2=a24*a32-a22*a34;
    t3=a22*a33-a23*a32;
    t4=a24*a31-a21*a34;
    t5=a21*a33-a23*a31;
    t6=a21*a32-a22*a31;

    b14=-(a12*t1+a13*t2+a14*t3);
    b24=a13*t4+a14*t5+a11*t1;
    b34=-(a14*t6-a11*t2+a12*t4);
    b44=a11*t3-a12*t5+a13*t6;

    var det_1=(a11*b11+a21*b12+a31*b13+a41*b14);
    if(det_1==0){
      return false;
    }
    det_1=1/det_1;

    this.m00=b11*det_1;
    this.m01=b12*det_1;
    this.m02=b13*det_1;
    this.m03=b14*det_1;

    this.m10=b21*det_1;
    this.m11=b22*det_1;
    this.m12=b23*det_1;
    this.m13=b24*det_1;

    this.m20=b31*det_1;
    this.m21=b32*det_1;
    this.m22=b33*det_1;
    this.m23=b34*det_1;

    this.m30=b41*det_1;
    this.m31=b42*det_1;
    this.m32=b43*det_1;
    this.m33=b44*det_1;

    return true;
  }
})





/**
  * スタック型の可変長配列。
  * 配列には実体を格納します。
  *
  * 注意事項
  * JavaのGenericsの制限突破を狙ったものの、Vector.&lt;*&gt;では、不具合が多いため、Vector.&lt;Object&gt;に変更
  * いくつかの場所でエラーがでる場合がありますが、コンパイルオプションなどで、
  * strict = false を設定して回避してください。
  * 根本修正は次バージョン以降で対応する予定です。
  */
NyARObjectStack = Klass(
{
  _items : null,

  _length : 0,

  /**
    * 最大ARRAY_MAX個の動的割り当てバッファを準備する。
    *
    *
    * @param i_array
    * @param i_element_type
    */
  initialize : function(i_length)
  {
    //領域確保
    i_length = toInt(i_length);
    this._items = this.createArray(i_length);
    //使用中個数をリセット
    this._length = 0;
    return;
  }

  /**
    * どのような配列(Vector)を格納するかを決める場所。
    * この関数を上書きしてください。
    *
    */
  ,createArray : function(i_length)
  {
    throw new NyARException();
  }

  /**
    * 新しい領域を予約します。
    * @return
    * 失敗するとnull
    * @throws NyARException
    */
  ,prePush : function()
  {
    // 必要に応じてアロケート
    if (this._length >= this._items.length){
      return null;
    }
    // 使用領域を+1して、予約した領域を返す。
    var ret = this._items[this._length];
    this._length++;
    return ret;
  }

  /**
    * スタックを初期化します。
    * @param i_reserv_length
    * 使用済みにするサイズ
    * @return
    */
  ,init : function(i_reserv_length)
  {
    // 必要に応じてアロケート
    if (i_reserv_length >= this._items.length){
      throw new NyARException();
    }
    this._length=i_reserv_length;
  }

  /**
    * 見かけ上の要素数を1減らして、そのオブジェクトを返します。
    * 返却したオブジェクトの内容は、次回のpushまで有効です。
    * @return
    */
  ,pop : function()
  {
    NyAS3Utils.assert(this._length>=1);
    this._length--;
    return this._items[this._length];
  }

  /**
    * 見かけ上の要素数をi_count個減らします。
    * @param i_count
    * @return
    */
  ,pops : function(i_count)
  {
    NyAS3Utils.assert(this._length>=i_count);
    this._length-=i_count;
    return;
  }

  /**
    * 配列を返します。
    *
    * @return
    */
  ,getArray : function()
  {
    return this._items;
  }

  ,getItem : function(i_index)
  {
    return this._items[i_index];
  }

  /**
    * 配列の見かけ上の要素数を返却します。
    * @return
    */
  ,getLength : function()
  {
    return this._length;
  }

  /**
    * 見かけ上の要素数をリセットします。
    */
  ,clear : function()
  {
    this._length = 0;
  }
})

/**
  * ...
  * @author
  */
NyARIntPointStack = Klass( NyARObjectStack,
{
  initialize : function(i_length)
  {
    NyARObjectStack.initialize.call(this, i_length);
  }
  ,createArray : function(i_length)
  {
    var ret= new Array(i_length);
    for (var i =0; i < i_length; i++){
      ret[i] = new NyARIntPoint2d();
    }
    return ret;
  }

})







//	import jp.nyatla.nyartoolkit.as3.core.types.*;

NyARIntRectStack = Klass( //NyARObjectStack,
{
  _items : null,

  _length : null,

  initialize : function(i_length)
  {
    //領域確保
    this._items = this.createArray(i_length);
    //使用中個数をリセット
    this._length = 0;
    return;
  }
  ,createArray : function(i_length)
  {
    var ret= new Array(i_length);
    for (var i =0; i < i_length; i++){
      ret[i] = new  NyARIntRect();
    }
    return ret;
  }
  /**
    * 新しい領域を予約します。
    * @return
    * 失敗するとnull
    * @throws NyARException
    */
  ,prePush : function()
  {
    // 必要に応じてアロケート
    if (this._length >= this._items.length){
      return null;
    }
    // 使用領域を+1して、予約した領域を返す。
    var ret = this._items[this._length];
    this._length++;
    return ret;
  }

  /**
    * スタックを初期化します。
    * @param i_reserv_length
    * 使用済みにするサイズ
    * @return
    */
  ,init : function(i_reserv_length)
  {
    // 必要に応じてアロケート
    if (i_reserv_length >= this._items.length){
      throw new NyARException();
    }
    this._length=i_reserv_length;
  }

  /**
    * 見かけ上の要素数を1減らして、そのオブジェクトを返します。
    * 返却したオブジェクトの内容は、次回のpushまで有効です。
    * @return
    */
  ,pop : function()
  {
    NyAS3Utils.assert(this._length>=1);
    this._length--;
    return this._items[this._length];
  }

  /**
    * 見かけ上の要素数をi_count個減らします。
    * @param i_count
    * @return
    */
  ,pops : function(i_count)
  {
    NyAS3Utils.assert(this._length>=i_count);
    this._length-=i_count;
    return;
  }

  /**
    * 配列を返します。
    *
    * @return
    */
  ,getArray : function()
  {
    return this._items;
  }

  ,getItem : function(i_index)
  {
    return this._items[i_index];
  }

  /**
    * 配列の見かけ上の要素数を返却します。
    * @return
    */
  ,getLength : function()
  {
    return this._length;
  }

  /**
    * 見かけ上の要素数をリセットします。
    */
  ,clear : function()
  {
    this._length = 0;
  }
})









NyARBufferType = Klass(
  (function() {
    var T_BYTE1D =0x00010000;
    var T_INT2D  =0x00020000;
    var T_SHORT1D=0x00030000;
    var T_INT1D  =0x00040000;
    var T_OBJECT =0x00100000;
    var T_USER   =0x00FF0000;

    return ({
      //  24-31(8)予約
      //  16-27(8)型ID
      //      00:無効/01[]/02[][]/03[]
      //  08-15(8)ビットフォーマットID
      //      00/01/02
      //  00-07(8)型番号
      //
      /**
        * RGB24フォーマットで、全ての画素が0
        */
      NULL_ALLZERO : 0x00000001,
      /**
        * USER - USER+0xFFFFはユーザー定義型。実験用に。
        */
      USER_DEFINE  : T_USER,

      /**
        * byte[]で、R8G8B8の24ビットで画素が格納されている。
        */
      BYTE1D_R8G8B8_24   : T_BYTE1D|0x0001,
      /**
        * byte[]で、B8G8R8の24ビットで画素が格納されている。
        */
      BYTE1D_B8G8R8_24   : T_BYTE1D|0x0002,
      /**
        * byte[]で、R8G8B8X8の32ビットで画素が格納されている。
        */
      BYTE1D_B8G8R8X8_32 : T_BYTE1D|0x0101,
      /**
        * byte[]で、X8R8G8B8の32ビットで画素が格納されている。
        */
      BYTE1D_X8R8G8B8_32 : T_BYTE1D|0x0102,

      /**
        * byte[]で、RGB565の16ビット(little/big endian)で画素が格納されている。
        */
      BYTE1D_R5G6B5_16LE : T_BYTE1D|0x0201,
      BYTE1D_R5G6B5_16BE : T_BYTE1D|0x0202,
      /**
        * short[]で、RGB565の16ビット(little/big endian)で画素が格納されている。
        */
      WORD1D_R5G6B5_16LE : T_SHORT1D|0x0201,
      WORD1D_R5G6B5_16BE : T_SHORT1D|0x0202,


      /**
        * int[][]で特に値範囲を定めない
        */
      INT2D        : T_INT2D|0x0000,
      /**
        * int[][]で0-255のグレイスケール画像
        */
      INT2D_GRAY_8 : T_INT2D|0x0001,
      /**
        * int[][]で0/1の2値画像
        * これは、階調値1bitのBUFFERFORMAT_INT2D_GRAY_1と同じです。
        */
      INT2D_BIN_8  : T_INT2D|0x0002,

      /**
        * int[]で特に値範囲を定めない
        */
      INT1D        : T_INT1D|0x0000,
      /**
        * int[]で0-255のグレイスケール画像
        */
      INT1D_GRAY_8 : T_INT1D|0x0001,
      /**
        * int[]で0/1の2値画像
        * これは、階調1bitのINT1D_GRAY_1と同じです。
        */
      INT1D_BIN_8  : T_INT1D|0x0002,


      /**
        * int[]で、XRGB32の32ビットで画素が格納されている。
        */
      INT1D_X8R8G8B8_32:T_INT1D|0x0102,

      /**
        * H(0-359),S(0-255),V(0-255)
        */
      INT1D_X7H9S8V8_32:T_INT1D|0x0103,


      /**
        * プラットフォーム固有オブジェクト
        */
      OBJECT_Java: T_OBJECT|0x0100,
      OBJECT_CS  : T_OBJECT|0x0200,
      OBJECT_AS3 : T_OBJECT|0x0300,
      OBJECT_JS : T_OBJECT|0x0400,

      /**
        * JavaのBufferedImageを格納するラスタ
        */
      OBJECT_Java_BufferedImage: T_OBJECT|0x0100|0x01,

      OBJECT_AS3_BitmapData : T_OBJECT|0x0300|0x01,
      /**
        * JavaScriptのCanvasを格納するラスタ
        */
      OBJECT_JS_Canvas : T_OBJECT|0x0400|0x01
    });
  })()
)





NyARDoublePoint2d = Klass(
{
  x : 0,
  y : 0,
  /**
    * 配列ファクトリ
    * @param i_number
    * @return
    */
  createArray : function(i_number)
  {
    var ret=new Array(i_number);
    for(var i=0;i<i_number;i++)
    {
      ret[i]=new NyARDoublePoint2d();
    }
    return ret;
  }
  ,initialize : function()
  {
    switch(arguments.length) {
    case 0:
      {//public function NyARDoublePoint2d()
        this.x = 0;
        this.y = 0;
      }
      return;
    case 1:
      this.x=args[0].x;
      this.y=args[0].y;
      return;
      break;
    case 2:
      {	//public function NyARDoublePoint2d(i_x,i_y)
        this.x = Number(args[0]);
        this.y = Number(args[1]);
        return;
      }
    default:
      break;
    }
    throw new NyARException();
  }
  ,setValue_NyARDoublePoint2d : function(i_src)
  {
    this.x=i_src.x;
    this.y=i_src.y;
    return;
  }
  ,setValue_NyARIntPoint2d : function(i_src)
  {
    this.x=(i_src.x);
    this.y=(i_src.y);
    return;
  }
  /**
    * 格納値をベクトルとして、距離を返します。
    * @return
    */
  ,dist : function()
  {
    return Math.sqrt(this.x*this.x+this.y+this.y);
  }
  ,sqNorm : function()
  {
    return this.x*this.x+this.y+this.y;
  }
})





NyARDoublePoint3d = Klass(
{
  x : 0,
  y : 0,
  z : 0,
  /**
    * 配列ファクトリ
    * @param i_number
    * @return
    */
  createArray : function(i_number)
  {
    var ret=new Array(i_number);
    for(var i=0;i<i_number;i++)
    {
      ret[i]=new NyARDoublePoint3d();
    }
    return ret;
  }
  ,setValue : function(i_in)
  {
    this.x=i_in.x;
    this.y=i_in.y;
    this.z=i_in.z;
    return;
  }
  /**
    * i_pointとのベクトルから距離を計算します。
    * @return
    */
  ,dist : function(i_point)
  {
    var x,y,z;
    x=this.x-i_point.x;
    y=this.y-i_point.y;
    z=this.z-i_point.z;
    return Math.sqrt(x*x+y*y+z*z);
  }
})




/**
  * ヒストグラムを格納するクラスです。
  */
NyARHistogram = Klass(
{
  /**
    * サンプリング値の格納変数
    */
  data : null,
  /**
    * 有効なサンプリング値の範囲。[0-data.length-1]
    */
  length : 0,
  /**
    * 有効なサンプルの総数 data[i]
    */
  total_of_data : 0,



  initialize : function(i_length)
  {
    this.data=new FloatVector(i_length);
    this.length=i_length;
    this.total_of_data=0;
  }
  /**
    * 区間i_stからi_edまでの総データ数を返します。
    * @param i_st
    * @param i_ed
    * @return
    */
  ,getTotal : function(i_st,i_ed)
  {
    NyAS3Utils.assert(i_st<i_ed && i_ed<this.length);
    var result=0;
    var s=this.data;
    for(var i=i_st;i<=i_ed;i++){
      result+=s[i];
    }
    return result;
  }
  /**
    * 指定したi_pos未満サンプルを０にします。
    * @param i_pos
    */
  ,lowCut : function(i_pos)
  {
    var s= 0;
    for(var i=0;i<i_pos;i++){
      s+=this.data[i];
      this.data[i]=0;
    }
    this.total_of_data-=s;
  }
  /**
    * 指定したi_pos以上のサンプルを０にします。
    * @param i_pos
    */
  ,highCut : function(i_pos)
  {
    var s=0;
    for(var i=this.length-1;i>=i_pos;i--){
      s+=this.data[i];
      this.data[i]=0;
    }
    this.total_of_data-=s;
  }
  /**
    * 最小の値が格納されているサンプル番号を返します。
    */
  ,getMinSample : function()
  {
    var data=this.data;
    var ret=this.length-1;
    var min=data[ret];
    for(var i=this.length-2;i>=0;i--)
    {
      if(data[i]<min){
        min=data[i];
        ret=i;
      }
    }
    return ret;
  }
  /**
    * サンプルの中で最小の値を返します。
    * @return
    */
  ,getMinData : function()
  {
    return this.data[this.getMinSample()];
  }
  /**
    * 平均値を計算します。
    * @return
    */
  ,getAverage : function()
  {
    var sum=0;
    for(var i=this.length-1;i>=0;i--)
    {
      sum+=this.data[i]*i;
    }
    return toInt(sum/this.total_of_data);
  }

})





NyARIntPoint2d = Klass(
{
  x : 0,

  y : 0,
  /**
    * 配列ファクトリ
    * @param i_number
    * @return
    */
  createArray : function(i_number)
  {
    var ret=new Array(i_number);
    for(var i=0;i<i_number;i++)
    {
      ret[i]=new NyARIntPoint2d();
    }
    return ret;
  }
  ,copyArray : function(i_from,i_to)
  {
    for(var i=i_from.length-1;i>=0;i--)
    {
      i_to[i].x=i_from[i].x;
      i_to[i].y=i_from[i].y;
    }
    return;
  }
})





NyARIntRect = Klass(
{
  x : 0,

  y : 0,

  w : 0,

  h : 0
})





NyARIntSize = Klass(
{
  h : 0,
  w : 0,
  /*	public function NyARIntSize()
    * 	public function NyARIntSize(i_width,i_height)
    *	public function NyARIntSize(i_ref_object)
  */
  initialize : function()
  {
    switch(arguments.length) {
    case 0:
      {//public function NyARIntSize()
        this.w = 0;
        this.h = 0;
        return;
      }
    case 1:
      this.w = arguments[0].w;
      this.h = arguments[0].h;
      return;
      break;
    case 2:
      {	//public function NyARIntSize(i_ref_object)
        this.w=toInt(arguments[0]);
        this.h=toInt(arguments[1]);
        return;
      }
      break;
    default:
      break;
    }
    throw new NyARException();
  }

  /**
    * サイズが同一であるかを確認する。
    *
    * @param i_width
    * @param i_height
    * @return
    * @throws NyARException
    */
  ,isEqualSize_int : function(i_width,i_height)
  {
    if (i_width == this.w && i_height == this.h) {
      return true;
    }
    return false;
  }

  /**
    * サイズが同一であるかを確認する。
    *
    * @param i_width
    * @param i_height
    * @return
    * @throws NyARException
    */
  ,isEqualSize_NyARIntSize : function(i_size)
  {
    if (i_size.w == this.w && i_size.h == this.h) {
      return true;
    }
    return false;

  }
})




/**
  * 0=dx*x+dy*y+cのパラメータを格納します。
  * x,yの増加方向は、x=L→R,y=B→Tです。
  *
  */
NyARLinear = Klass(
{
  dx : 0,//dx軸の増加量
  dy : 0,//dy軸の増加量
  c : 0,//切片
  createArray : function(i_number)
  {
    var ret=new Array(i_number);
    for(var i=0;i<i_number;i++)
    {
      ret[i]=new NyARLinear();
    }
    return ret;
  }
  ,copyFrom : function(i_source)
  {
    this.dx=i_source.dx;
    this.dy=i_source.dy;
    this.c=i_source.c;
    return;
  }
  /**
    * 2直線の交点を計算します。
    * @param l_line_i
    * @param l_line_2
    * @param o_point
    * @return
    */
  ,crossPos : function(l_line_i,l_line_2 ,o_point)
  {
    var w1 = l_line_2.dy * l_line_i.dx - l_line_i.dy * l_line_2.dx;
    if (w1 == 0.0) {
      return false;
    }
    o_point.x = (l_line_2.dx * l_line_i.c - l_line_i.dx * l_line_2.c) / w1;
    o_point.y = (l_line_i.dy * l_line_2.c - l_line_2.dy * l_line_i.c) / w1;
    return true;
  }
})

/*
 * PROJECT: FLARToolKit
 * --------------------------------------------------------------------------------
 * This work is based on the NyARToolKit developed by
 *   R.Iizuka (nyatla)
 * http://nyatla.jp/nyatoolkit/
 *
 * The FLARToolKit is ActionScript 3.0 version ARToolkit class library.
 * Copyright (C)2008 Saqoosha
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  http://www.libspark.org/wiki/saqoosha/FLARToolKit
 *  <saq(at)saqoosha.net>
 *
 */



/**
 * 各ラスタ用のフィルタ実装
 */
IFLdoThFilterImpl = ASKlass('IFLdoThFilterImpl',
{
  doThFilter : function(i_input,i_output,i_size,i_threshold){}
})


/**
 * 定数閾値による2値化をする。
 *
 */
FLARRasterFilter_Threshold = ASKlass('FLARRasterFilter_Threshold',
{
  _threshold : 0
  ,_do_threshold_impl : null
  ,FLARRasterFilter_Threshold : function(i_threshold)
  {
  }
  /**
   * 画像を２値化するための閾値。暗点&lt;=th&lt;明点となります。
   * @param i_threshold
   */
  ,setThreshold : function(i_threshold )
  {
    this._threshold = i_threshold;
  }
  ,doFilter : function(i_input, i_output)
  {
    NyAS3Utils.assert (i_input._width == i_output._width && i_input._height == i_output._height);
    var out_buf = (i_output.getBuffer());
    var in_reader = i_input.getRgbPixelReader();
    var d = in_reader.getData().data;
    var obd = out_buf.data;
    var th3 = this._threshold*10000;
    for (var i=0,j=0; i<d.length; i+=4,++j) {
      //var c = d[i]*0.2989 + d[i+1]*0.5866 + d[i+2]*0.1145;
      var c = d[i]*2989+d[i+1]*5866+d[i+2]*1145;
      var t = (c <= th3) ? 0xffffffff : 0xff000000;
      obd[j] = t;
    }
    if (window.DEBUG) {
      var debugCanvas = document.getElementById('debugCanvas');
      out_buf.drawOnCanvas(debugCanvas);
    }
    return;
  }
})
Point = function(x,y) {
  this.x = x||0;
  this.y = y||0;
}
doThFilterImpl_BUFFERFORMAT_OBJECT_AS_BitmapData = {
  doThFilter : function(i_input, i_output, i_threshold)
  {
    var out_buf = (i_output.getBuffer());
    var in_buf= (i_input.getBuffer());
    var d = in_buf.data;
    var obd = out_buf.data;
    for (var i=0; i<d.length; i++) {
      var dc = d[i];
      var c = ((dc>>16)&0xff)*0.2989 + ((dc>>8)&0xff)*0.5866 + (dc&0xff)*0.1145;
      var f = (c <= i_threshold);
      var t = f*0xffffffff + (1-f)*0xff000000;
      obd[j] = t;
    }
  }
}/*
 * PROJECT: FLARToolKit
 * --------------------------------------------------------------------------------
 * This work is based on the NyARToolKit developed by
 *   R.Iizuka (nyatla)
 * http://nyatla.jp/nyatoolkit/
 *
 * The FLARToolKit is ActionScript 3.0 version ARToolkit class library.
 * Copyright (C)2008 Saqoosha
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  http://www.libspark.org/wiki/saqoosha/FLARToolKit
 *  <saq(at)saqoosha.net>
 *
 */
FLARDoublePoint2d = NyARDoublePoint2d;
FLARDoublePoint3d = NyARDoublePoint3d;
FLARIntSize = NyARIntSize;
/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */


/**
 * ...
 * @author
 */
NyARLabelInfo = ASKlass('NyARLabelInfo',
{
  area : 0,
  clip_r : 0,
  clip_l : 0,
  clip_b : 0,
  clip_t : 0,
  pos_x : 0,
  pos_y : 0,
  NyARLabelInfo : function()
  {
  }
})


//  import jp.nyatla.nyartoolkit.as3.core.types.stack.*;
NyARLabelInfoStack = ASKlass('NyARLabelInfoStack', // NyARObjectStack,
{
  _items : null,
  _length : 0,
  NyARLabelInfoStack : function(i_length)
  {
    //領域確保
    this._items = this.createArray(i_length);
    //使用中個数をリセット
    this._length = 0;
    return;
  }
  ,createArray : function(i_length)
  {
    var ret= new Array(i_length);
    for (var i =0; i < i_length; i++){
      ret[i] = new NyARLabelInfo();
    }
    return (ret);
  }
  /**
   * エリアの大きい順にラベルをソートします。
   */
  ,sortByArea : function()
  {
    var len=this._length;
    if(len<1){
      return;
    }
    var h = Math.floor(len * 13/10);
    var item=this._items;
    for(;;){
      var swaps = 0;
      for (var i = 0; i + h < len; i++) {
        if (item[i + h].area > item[i].area) {
          var temp = item[i + h];
          item[i + h] = item[i];
          item[i] = temp;
          swaps++;
        }
      }
      if (h == 1) {
        if (swaps == 0){
          break;
        }
      }else{
        h=Math.floor(h*10/13);
      }
    }
  }
  /**
   * 新しい領域を予約します。
   * @return
   * 失敗するとnull
   * @throws NyARException
   */
  ,prePush : function()
  {
    // 必要に応じてアロケート
    if (this._length >= this._items.length){
      return null;
    }
    // 使用領域を+1して、予約した領域を返す。
    var ret = this._items[this._length];
    this._length++;
    return ret;
  }
  /**
   * スタックを初期化します。
   * @param i_reserv_length
   * 使用済みにするサイズ
   * @return
   */
  ,init : function(i_reserv_length)
  {
    // 必要に応じてアロケート
    if (i_reserv_length >= this._items.length){
      throw new NyARException();
    }
    this._length=i_reserv_length;
  }
  /**
   * 見かけ上の要素数を1減らして、そのオブジェクトを返します。
   * 返却したオブジェクトの内容は、次回のpushまで有効です。
   * @return
   */
  ,pop : function()
  {
    NyAS3Utils.assert(this._length>=1);
    this._length--;
    return this._items[this._length];
  }
  /**
   * 見かけ上の要素数をi_count個減らします。
   * @param i_count
   * @return
   */
  ,pops : function(i_count)
  {
    NyAS3Utils.assert(this._length>=i_count);
    this._length-=i_count;
    return;
  }
  /**
   * 配列を返します。
   *
   * @return
   */
  ,getArray : function()
  {
    return this._items;
  }
  ,getItem : function(i_index)
  {
    return this._items[i_index];
  }
  /**
   * 配列の見かけ上の要素数を返却します。
   * @return
   */
  ,getLength : function()
  {
    return this._length;
  }
  /**
   * 見かけ上の要素数をリセットします。
   */
  ,clear : function()
  {
    this._length = 0;
  }
})
NyARLabelOverlapChecker = ASKlass('NyARLabelOverlapChecker',
{
  _labels : null,
  _length : 0,
  /*
  */
  NyARLabelOverlapChecker : function(i_max_label)
  {
    this._labels = this.createArray(i_max_label);
  }
  ,createArray : function(i_length)
  {
    return new Array(i_length);
  }
  /**
   * チェック対象のラベルを追加する。
   *
   * @param i_label_ref
   */
  ,push : function(i_label_ref)
  {
    this._labels[this._length] = i_label_ref;
    this._length++;
  }
  /**
   * 現在リストにあるラベルと重なっているかを返す。
   *
   * @param i_label
   * @return 何れかのラベルの内側にあるならばfalse,独立したラベルである可能性が高ければtrueです．
   */
  ,check : function(i_label)
  {
    // 重なり処理かな？
    var label_pt  = this._labels;
    var px1 = toInt(i_label.pos_x);
    var py1 = toInt(i_label.pos_y);
    for (var i = this._length - 1; i >= 0; i--) {
      var px2 = toInt(label_pt[i].pos_x);
      var py2 = toInt(label_pt[i].pos_y);
      var d = (px1 - px2) * (px1 - px2) + (py1 - py2) * (py1 - py2);
      if (d < label_pt[i].area / 4) {
        // 対象外
        return false;
      }
    }
    // 対象
    return true;
  }
  /**
   * 最大i_max_label個のラベルを蓄積できるようにオブジェクトをリセットする
   *
   * @param i_max_label
   */
  ,setMaxLabels : function(i_max_label)
  {
    if (i_max_label > this._labels.length) {
      this._labels = this.createArray(i_max_label);
    }
    this._length = 0;
  }
})




// RleImageをラベリングする。
NyARLabeling_Rle = ASKlass('NyARLabeling_Rle',
{
  AR_AREA_MAX : 100000,// #define AR_AREA_MAX 100000
  AR_AREA_MIN : 70,// #define AR_AREA_MIN 70
  _rlestack : null,
  _rle1 : null,
  _rle2 : null,
  _max_area : 0,
  _min_area : 0,
  NyARLabeling_Rle : function(i_width,i_height)
  {
    this._rlestack=new RleInfoStack(i_width*i_height*2048/(320*240)+32);
    this._rle1 = RleElement.createArray(i_width/2+1);
    this._rle2 = RleElement.createArray(i_width/2+1);
    this.setAreaRange(this.AR_AREA_MAX,this.AR_AREA_MIN);
    return;
  }
  /**
   * 対象サイズ
   * @param i_max
   * @param i_min
   */
  ,setAreaRange : function(i_max,i_min)
  {
    this._max_area=i_max;
    this._min_area=i_min;
    return;
  }
  /**
   * i_bin_bufのgsイメージをRLE圧縮する。
   * @param i_bin_buf
   * @param i_st
   * @param i_len
   * @param i_out
   * @param i_th
   * BINラスタのときは0,GSラスタの時は閾値を指定する。
   * この関数は、閾値を暗点と認識します。
   * 暗点<=th<明点
   * @return
   */
  ,toRLE : function(i_bin_buf,i_st,i_len,i_out,i_th)
  {
    var current = 0;
    var lidx=0,ridx=1,fidx=2,off=3;
    var r = -1;
    // 行確定開始
    var x = i_st;
    var right_edge = i_st + i_len - 1;
    while (x < right_edge) {
      // 暗点(0)スキャン
      if (i_bin_buf[x] != 0xffffffff) {
        x++;//明点
        continue;
      }
      // 暗点発見→暗点長を調べる
      r = (x - i_st);
      i_out[current+lidx] = r;
      r++;// 暗点+1
      x++;
      while (x < right_edge) {
        if (i_bin_buf[x] != 0xffffffff) {
          // 明点(1)→暗点(0)配列終了>登録
          i_out[current+ridx] = r;
          current+=off;
          x++;// 次点の確認。
          r = -1;// 右端の位置を0に。
          break;
        } else {
          // 暗点(0)長追加
          r++;
          x++;
        }
      }
    }
    // 最後の1点だけ判定方法が少し違うの。
    if (i_bin_buf[x] != 0xffffffff) {
      // 明点→rカウント中なら暗点配列終了>登録
      if (r >= 0) {
        i_out[current+ridx] = r;
        current+=off;
      }
    } else {
      // 暗点→カウント中でなければl1で追加
      if (r >= 0) {
        i_out[current+ridx] = (r + 1);
      } else {
        // 最後の1点の場合
        i_out[current+lidx] = (i_len - 1);
        i_out[current+ridx] = (i_len);
      }
      current+=off;
    }
    // 行確定
    return current/off;
  }
  ,addFragment : function(i_rel_img,i_img_idx,i_nof,i_row_index,o_stack)
  {
    var lidx=0,ridx=1,fidx=2,off=3;
    var l = i_rel_img[i_img_idx+lidx];
    var r = i_rel_img[i_img_idx+ridx];
    var len=r - l;
    i_rel_img[i_img_idx+fidx] = i_nof;// REL毎の固有ID
    var v = o_stack.prePush();
    v.entry_x = l;
    v.area =len;
    v.clip_l=l;
    v.clip_r=r-1;
    v.clip_t=i_row_index;
    v.clip_b=i_row_index;
    v.pos_x=(len*(2*l+(len-1)))/2;
    v.pos_y=i_row_index*len;
    return;
  }
  //所望のラスタからBIN-RLEに変換しながらの低速系も準備しようかな
  /**
   * 単一閾値を使ってGSラスタをBINラスタに変換しながらラベリングします。
   * @param i_gs_raster
   * @param i_top
   * @param i_bottom
   * @param o_stack
   * @return
   * @throws NyARException
   */
  ,labeling_NyARBinRaster : function(i_bin_raster,i_top,i_bottom,o_stack)
  {
    NyAS3Utils.assert(i_bin_raster.isEqualBufferType(NyARBufferType.INT1D_BIN_8));
    return this.imple_labeling(i_bin_raster,0,i_top,i_bottom,o_stack);
  }
  /**
   * BINラスタをラベリングします。
   * @param i_gs_raster
   * @param i_th
   * 画像を２値化するための閾値。暗点&lt;=th&lt;明点となります。
   * @param i_top
   * @param i_bottom
   * @param o_stack
   * @return
   * @throws NyARException
   */
  ,labeling_NyARGrayscaleRaster : function(i_gs_raster,i_th,i_top,i_bottom,o_stack)
  {
    NyAS3Utils.assert(i_gs_raster.isEqualBufferType(NyARBufferType.INT1D_GRAY_8));
    return this.imple_labeling(i_gs_raster,i_th,i_top,i_bottom,o_stack);
  }
  ,labeling : function(i_bin_raster,o_stack)
  {
    return this.imple_labeling(i_bin_raster,0,0,i_bin_raster.getHeight(),o_stack);
  }
  ,imple_labeling : function(i_raster,i_th,i_top,i_bottom,o_stack)
  {
    // リセット処理
    var rlestack=this._rlestack;
    rlestack.clear();
    //
    var rle_prev = this._rle1;
    var rle_current = this._rle2;
    var len_prev = 0;
    var len_current = 0;
    var width = i_raster.getWidth();
    var in_buf = (i_raster.getBuffer().data);
    var id_max = 0;
    var label_count=0;
    var lidx=0,ridx=1,fidx=2,off=3;
    // 初段登録
    len_prev = this.toRLE(in_buf, i_top, width, rle_prev, i_th);
    var i;
    for (i = 0; i < len_prev; i++) {
      // フラグメントID=フラグメント初期値、POS=Y値、RELインデクス=行
      this.addFragment(rle_prev, i*off, id_max, i_top,rlestack);
      id_max++;
      // nofの最大値チェック
      label_count++;
    }
    var f_array = (rlestack.getArray());
    // 次段結合
    for (var y = i_top + 1; y < i_bottom; y++) {
      // カレント行の読込
      len_current = this.toRLE(in_buf, y * width, width, rle_current,i_th);
      var index_prev = 0;
      SCAN_CUR: for (i = 0; i < len_current; i++) {
        // index_prev,len_prevの位置を調整する
        var id = -1;
        // チェックすべきprevがあれば確認
        SCAN_PREV: while (index_prev < len_prev) {
          if (rle_current[i*off+lidx] - rle_prev[index_prev*off+ridx] > 0) {// 0なら8方位ラベリング
            // prevがcurの左方にある→次のフラグメントを探索
            index_prev++;
            continue;
          } else if (rle_prev[index_prev*off+lidx] - rle_current[i*off+ridx] > 0) {// 0なら8方位ラベリングになる
            // prevがcur右方にある→独立フラグメント
            this.addFragment(rle_current, i*off, id_max, y,rlestack);
            id_max++;
            label_count++;
            // 次のindexをしらべる
            continue SCAN_CUR;
          }
          id=rle_prev[index_prev*off+fidx];//ルートフラグメントid
          var id_ptr = f_array[id];
          //結合対象(初回)->prevのIDをコピーして、ルートフラグメントの情報を更新
          rle_current[i*off+fidx] = id;//フラグメントIDを保存
          //
          var l= rle_current[i*off+lidx];
          var r= rle_current[i*off+ridx];
          var len=r-l;
          //結合先フラグメントの情報を更新する。
          id_ptr.area += len;
          //tとentry_xは、結合先のを使うので更新しない。
          id_ptr.clip_l=l<id_ptr.clip_l?l:id_ptr.clip_l;
          id_ptr.clip_r=r>id_ptr.clip_r?r-1:id_ptr.clip_r;
          id_ptr.clip_b=y;
          id_ptr.pos_x+=(len*(2*l+(len-1)))/2;
          id_ptr.pos_y+=y*len;
          //多重結合の確認（２個目以降）
          index_prev++;
          while (index_prev < len_prev) {
            if (rle_current[i*off+lidx] - rle_prev[index_prev*off+ridx] > 0) {// 0なら8方位ラベリング
              // prevがcurの左方にある→prevはcurに連結していない。
              break SCAN_PREV;
            } else if (rle_prev[index_prev*off+lidx] - rle_current[i*off+ridx] > 0) {// 0なら8方位ラベリングになる
              // prevがcurの右方にある→prevはcurに連結していない。
              index_prev--;
              continue SCAN_CUR;
            }
            // prevとcurは連結している→ルートフラグメントの統合
            //結合するルートフラグメントを取得
            var prev_id =rle_prev[index_prev*off+fidx];
            var prev_ptr = f_array[prev_id];
            if (id != prev_id){
              label_count--;
              //prevとcurrentのフラグメントidを書き換える。
              var i2;
              for(i2=index_prev;i2<len_prev;i2++){
                //prevは現在のidから最後まで
                if(rle_prev[i2*off+fidx]==prev_id){
                  rle_prev[i2*off+fidx]=id;
                }
              }
              for(i2=0;i2<i;i2++){
                //currentは0から現在-1まで
                if(rle_current[i2*off+fidx]==prev_id){
                  rle_current[i2*off+fidx]=id;
                }
              }
              //現在のルートフラグメントに情報を集約
              id_ptr.area +=prev_ptr.area;
              id_ptr.pos_x+=prev_ptr.pos_x;
              id_ptr.pos_y+=prev_ptr.pos_y;
              //tとentry_xの決定
              if (id_ptr.clip_t > prev_ptr.clip_t) {
                // 現在の方が下にある。
                id_ptr.clip_t = prev_ptr.clip_t;
                id_ptr.entry_x = prev_ptr.entry_x;
              }else if (id_ptr.clip_t < prev_ptr.clip_t) {
                // 現在の方が上にある。prevにフィードバック
              } else {
                // 水平方向で小さい方がエントリポイント。
                if (id_ptr.entry_x > prev_ptr.entry_x) {
                  id_ptr.entry_x = prev_ptr.entry_x;
                }else{
                }
              }
              //lの決定
              if (id_ptr.clip_l > prev_ptr.clip_l) {
                id_ptr.clip_l=prev_ptr.clip_l;
              }else{
              }
              //rの決定
              if (id_ptr.clip_r < prev_ptr.clip_r) {
                id_ptr.clip_r=prev_ptr.clip_r;
              }else{
              }
              //bの決定
              //結合済のルートフラグメントを無効化する。
              prev_ptr.area=0;
            }
            index_prev++;
          }
          index_prev--;
          break;
        }
        // curにidが割り当てられたかを確認
        // 右端独立フラグメントを追加
        if (id < 0){
          this.addFragment(rle_current, i*off, id_max, y,rlestack);
          id_max++;
          label_count++;
        }
      }
      // prevとrelの交換
      var tmp = rle_prev;
      rle_prev = rle_current;
      len_prev = len_current;
      rle_current = tmp;
    }
    //対象のラベルだけ転写
    o_stack.init(label_count);
    var o_dest_array=(o_stack.getArray());
    var max=this._max_area;
    var min=this._min_area;
    var active_labels=0;
    for(i=id_max-1;i>=0;i--){
      var area=f_array[i].area;
      if(area<min || area>max){//対象外のエリア0のもminではじく
        continue;
      }
      //
      var src_info=f_array[i];
      var dest_info=o_dest_array[active_labels];
      dest_info.area=area;
      dest_info.clip_b=src_info.clip_b;
      dest_info.clip_r=src_info.clip_r;
      dest_info.clip_t=src_info.clip_t;
      dest_info.clip_l=src_info.clip_l;
      dest_info.entry_x=src_info.entry_x;
      dest_info.pos_x=src_info.pos_x/src_info.area;
      dest_info.pos_y=src_info.pos_y/src_info.area;
      active_labels++;
    }
    //ラベル数を再設定
    o_stack.pops(label_count-active_labels);
    //ラベル数を返却
    return active_labels;
  }
})
RleInfo = ASKlass('RleInfo',
{
//継承メンバ
entry_x : 0, // フラグメントラベルの位置
area : 0,
clip_r : 0,
clip_l : 0,
clip_b : 0,
clip_t : 0,
pos_x : 0,
pos_y : 0
})

RleInfoStack = ASKlass('RleInfoStack', NyARObjectStack,
{
  RleInfoStack : function(i_length)
  {
    NyARObjectStack.initialize.call(this,i_length);
    return;
  }
  ,createArray : function(i_length)
  {
    var ret= new Array(toInt(i_length));
    for (var i =0; i < i_length; i++){
      ret[i] = new RleInfo();
    }
    return ret;
  }
})
RleElement = ASKlass('RleElement',
{
  l : 0,
  r : 0,
  fid : 0,
  createArray : function(i_length)
  {
    return new IntVector(toInt(i_length)*3);
    var ret = new Array(toInt(i_length));
    for (var i = 0; i < i_length; i++) {
      ret[i] = new RleElement();
    }
    return ret;
  }
})
NyARRleLabelFragmentInfo = ASKlass('NyARRleLabelFragmentInfo', NyARLabelInfo,
{
  //継承メンバ
  //int area; // フラグメントラベルの領域数
  entry_x : 0 // フラグメントラベルの位置
})
NyARRleLabelFragmentInfoStack = ASKlass('NyARRleLabelFragmentInfoStack',  NyARLabelInfoStack,
{
  NyARRleLabelFragmentInfoStack : function(i_length)
  {
    NyARLabelInfoStack.initialize.call(this,i_length);
    return;
  }
  ,createArray : function(i_length)
  {
    var ret= new Array(toInt(i_length));
    for (var i =0; i < i_length; i++){
      ret[i] = new NyARRleLabelFragmentInfo();
    }
    return (ret);
  }
})
/*
 * PROJECT: FLARToolKit
 * --------------------------------------------------------------------------------
 * This work is based on the NyARToolKit developed by
 *   R.Iizuka (nyatla)
 * http://nyatla.jp/nyatoolkit/
 *
 * The FLARToolKit is ActionScript 3.0 version ARToolkit class library.
 * Copyright (C)2008 Saqoosha
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  http://www.libspark.org/wiki/saqoosha/FLARToolKit
 *  <saq(at)saqoosha.net>
 *
 */
FLARLabeling = ASKlass('FLARLabeling',
{
  AR_AREA_MAX : 100000// #define AR_AREA_MAX 100000
  ,AR_AREA_MIN : 70// #define AR_AREA_MIN 70
  ,ZERO_POINT : new Point()
  ,ONE_POINT : new Point(1, 1)
  ,hSearch : null
  ,hLineRect : null
  ,_tmp_bmp : null
  ,areaMax : 0
  ,areaMin : 0
  ,FLARLabeling : function(i_width,i_height)
  {
    this._tmp_bmp = new BitmapData(i_width, i_height, false,0x00);
    this.hSearch = new BitmapData(i_width, 1, false, 0x000000);
    this.hLineRect = new Rectangle(0, 0, 1, 1);
    this.setAreaRange(this.AR_AREA_MAX, this.AR_AREA_MIN);
    return;
  }
  /**
   * 白領域の検査対象サイズ
   *  最大サイズは 一辺約320px、最小サイズは 一辺約 8px まで解析対象としている
   *  解析画像中で上記範囲内であれば解析対象となるが、最小サイズは小さすぎて意味をなさない。
   *
   * @param i_max 解析対象とする白領域の最大pixel数(一辺の二乗)
   * @param i_min 解析対象とする白領域の最小pixel数(一辺の二乗)
   */
  ,setAreaRange : function(i_max, i_min)
  {
    this.areaMax=i_max;
    this.areaMin=i_min;
  }
  ,labeling : function(i_bin_raster,o_stack)
  {
    var label_img = this._tmp_bmp;
    label_img.fillRect(label_img.rect, 0x0);
    var rect = label_img.rect.clone();
    rect.inflate(-1, -1);
    label_img.copyPixels(i_bin_raster.getBuffer(), rect, this.ONE_POINT);
    var currentRect = label_img.getColorBoundsRect(0xffffff, 0xffffff, true);
    var hLineRect = this.hLineRect;
    hLineRect.y = 0;
    hLineRect.width = label_img.width;
    var hSearch = this.hSearch;
    var hSearchRect;
    var labelRect;
    var index = 0;
    var label;
    o_stack.clear();
//     try {
      while (!currentRect.isEmpty()) {
        hLineRect.y = currentRect.top;
        hSearch.copyPixels(label_img, hLineRect, this.ZERO_POINT);
        hSearchRect = hSearch.getColorBoundsRect(0xffffff, 0xffffff, true);
        label_img.floodFill(hSearchRect.x, hLineRect.y, ++index);
        labelRect = label_img.getColorBoundsRect(0xffffff, index, true);
        label = o_stack.prePush();
        var area = labelRect.width * labelRect.height;
        //エリア規制
        if (area <= this.areaMax && area >= this.areaMin){
          label.area = area;
          label.clip_l = labelRect.left;
          label.clip_r = labelRect.right - 1;
          label.clip_t = labelRect.top;
          label.clip_b = labelRect.bottom - 1;
          label.pos_x = (labelRect.left + labelRect.right - 1) * 0.5;
          label.pos_y = (labelRect.top + labelRect.bottom - 1) * 0.5;
          //エントリ・ポイントを探す
          label.entry_x=this.getTopClipTangentX(label_img,index,label);
          if (label.entry_x == -1) {
            return -1;
          }
        }else {
          o_stack.pop();
        }
        currentRect = label_img.getColorBoundsRect(0xffffff, 0xffffff, true);
      }
/*    } catch (e) {
      throw("too many labeled area!! gave up")
      console.log('Too many labeled area!! gave up....',e);
    }*/
    return o_stack.getLength();
  }
  ,getTopClipTangentX : function(i_image, i_index, i_label)
  {
    var w;
    var clip1 = i_label.clip_r;
    var i;
    for (i = i_label.clip_l; i <= clip1; i++) { // for( i = clip[0]; i <=clip[1]; i++, p1++ ) {
      w = i_image.getPixel(i, i_label.clip_t);
      if (w > 0 && w == i_index) {
        return i;
      }
    }
    //あれ？見つからないよ？
    return -1;
  }
})
/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */
INyARCameraDistortionFactor = ASKlass('INyARCameraDistortionFactor',
{
  ideal2Observ : function(i_in,o_out){},
  ideal2ObservBatch : function(i_in,o_out,i_size){},
  observ2Ideal : function(ix,iy,o_point){},
  observ2IdealBatch : function(i_x_coord,i_y_coord,i_start,i_num,o_x_coord,o_y_coord){}
})

/**
 * カメラの歪み成分を格納するクラスと、補正関数群
 * http://www.hitl.washington.edu/artoolkit/Papers/ART02-Tutorial.pdf
 * 11ページを読むといいよ。
 *
 * x=x(xi-x0),y=s(yi-y0)
 * d^2=x^2+y^2
 * p=(1-fd^2)
 * xd=px+x0,yd=py+y0
 */
NyARCameraDistortionFactor = ASKlass('NyARCameraDistortionFactor', INyARCameraDistortionFactor,
{
  PD_LOOP : 3,
  _f0 : 0,//x0
  _f1 : 0,//y0
  _f2 : 0,//100000000.0*ｆ
  _f3 : 0,//s
  copyFrom : function(i_ref)
  {
    this._f0=i_ref._f0;
    this._f1=i_ref._f1;
    this._f2=i_ref._f2;
    this._f3=i_ref._f3;
    return;
  }
  /**
   * 配列の値をファクタ値としてセットする。
   * @param i_factor
   * 4要素以上の配列
   */
  ,setValue : function(i_factor)
  {
    this._f0=i_factor[0];
    this._f1=i_factor[1];
    this._f2=i_factor[2];
    this._f3=i_factor[3];
    return;
  }
  ,getValue : function(o_factor)
  {
    o_factor[0]=this._f0;
    o_factor[1]=this._f1;
    o_factor[2]=this._f2;
    o_factor[3]=this._f3;
    return;
  }
  ,changeScale : function(i_scale)
  {
    this._f0=this._f0*i_scale;// newparam->dist_factor[0] =source->dist_factor[0] *scale;
    this._f1=this._f1*i_scale;// newparam->dist_factor[1] =source->dist_factor[1] *scale;
    this._f2=this._f2/ (i_scale * i_scale);// newparam->dist_factor[2]=source->dist_factor[2]/ (scale*scale);
    //this.f3=this.f3;// newparam->dist_factor[3] =source->dist_factor[3];
    return;
  }
  /**
   * int arParamIdeal2Observ( const double dist_factor[4], const double ix,const double iy,double *ox, double *oy ) 関数の代替関数
   *
   * @param i_in
   * @param o_out
   */
  ,ideal2Observ : function(i_in,o_out)
  {
    var x = (i_in.x - this._f0) * this._f3;
    var y = (i_in.y - this._f1) * this._f3;
    if (x == 0.0 && y == 0.0) {
      o_out.x = this._f0;
      o_out.y = this._f1;
    } else {
      var d = 1.0 - this._f2 / 100000000.0 * (x * x + y * y);
      o_out.x = x * d + this._f0;
      o_out.y = y * d + this._f1;
    }
    return;
  }
  /**
   * ideal2Observをまとめて実行します。
   * @param i_in
   * @param o_out
   */
  ,ideal2ObservBatch : function(i_in, o_out ,i_size)
  {
    var x, y;
    var d0 = this._f0;
    var d1 = this._f1;
    var d3 = this._f3;
    var d2_w = this._f2 / 100000000.0;
    for (var i = 0; i < i_size; i++) {
      x = (i_in[i].x - d0) * d3;
      y = (i_in[i].y - d1) * d3;
      if (x == 0.0 && y == 0.0) {
        o_out[i].x = d0;
        o_out[i].y = d1;
      } else {
        var d = 1.0 - d2_w * (x * x + y * y);
        o_out[i].x = x * d + d0;
        o_out[i].y = y * d + d1;
      }
    }
    return;
  }
  /**
   * int arParamObserv2Ideal( const double dist_factor[4], const double ox,const double oy,double *ix, double *iy );
   *
   * @param ix
   * @param iy
   * @param ix
   * @param iy
   * @return
   */
  ,observ2Ideal : function(ix, iy, o_point)
  {
    var z02, z0, p, q, z, px, py, opttmp_1;
    var d0 = this._f0;
    var d1 = this._f1;
    px = ix - d0;
    py = iy - d1;
    p = this._f2 / 100000000.0;
    z02 = px * px + py * py;
    q = z0 = Math.sqrt(z02);// Optimize//q = z0 = Math.sqrt(px*px+ py*py);
    for (var i = 1;; i++) {
      if (z0 != 0.0) {
        // Optimize opttmp_1
        opttmp_1 = p * z02;
        z = z0 - ((1.0 - opttmp_1) * z0 - q) / (1.0 - 3.0 * opttmp_1);
        px = px * z / z0;
        py = py * z / z0;
      } else {
        px = 0.0;
        py = 0.0;
        break;
      }
      if (i == this.PD_LOOP) {
        break;
      }
      z02 = px * px + py * py;
      z0 = Math.sqrt(z02);// Optimize//z0 = Math.sqrt(px*px+ py*py);
    }
    o_point.x = px / this._f3 + d0;
    o_point.y = py / this._f3 + d1;
    return;
  }
  /**
   * 指定範囲のobserv2Idealをまとめて実行して、結果をo_idealに格納します。
   * @param i_x_coord
   * @param i_y_coord
   * @param i_start
   *            coord開始点
   * @param i_num
   *            計算数
   * @param o_ideal
   *            出力バッファ[i_num][2]であること。
   */
  ,observ2IdealBatch : function(i_x_coord,i_y_coord,i_start,i_num,o_x_coord,o_y_coord)
  {
    var z02, z0, q, z, px, py, opttmp_1;
    var d0 = this._f0;
    var d1 = this._f1;
    var d3 = this._f3;
    var p = this._f2 / 100000000.0;
    for (var j = 0; j < i_num; j++) {
      px = i_x_coord[i_start + j] - d0;
      py = i_y_coord[i_start + j] - d1;
      z02 = px * px + py * py;
      q = z0 = Math.sqrt(z02);// Optimize//q = z0 = Math.sqrt(px*px+py*py);
      for (var i = 1;; i++) {
        if (z0 != 0.0) {
          // Optimize opttmp_1
          opttmp_1 = p * z02;
          z = z0 - ((1.0 - opttmp_1) * z0 - q)/ (1.0 - 3.0 * opttmp_1);
          px = px * z / z0;
          py = py * z / z0;
        } else {
          px = 0.0;
          py = 0.0;
          break;
        }
        if (i == PD_LOOP) {
          break;
        }
        z02 = px * px + py * py;
        z0 = Math.sqrt(z02);// Optimize//z0 = Math.sqrt(px*px+ py*py);
      }
      o_x_coord[j] = px / d3 + d0;
      o_y_coord[j] = py / d3 + d1;
    }
    return;
  }
})
NyARObserv2IdealMap = ASKlass('NyARObserv2IdealMap',
{
  _stride : 0,
  _mapx : null,
  _mapy : null,
  NyARObserv2IdealMap : function(i_distfactor,i_screen_size)
  {
    var opoint=new NyARDoublePoint2d();
    this._mapx=new FloatVector(i_screen_size.w*i_screen_size.h);
    this._mapy=new FloatVector(i_screen_size.w*i_screen_size.h);
    this._stride=i_screen_size.w;
    var ptr=i_screen_size.h*i_screen_size.w-1;
    //歪みマップを構築
    for(var i=i_screen_size.h-1;i>=0;i--)
    {
      for(var i2=i_screen_size.w-1;i2>=0;i2--)
      {
        i_distfactor.observ2Ideal(i2,i, opoint);
        this._mapx[ptr]=opoint.x;
        this._mapy[ptr]=opoint.y;
        ptr--;
      }
    }
    return;
  }
  ,observ2Ideal : function(ix,iy,o_point)
  {
    var idx=ix+iy*this._stride;
    o_point.x=this._mapx[idx];
    o_point.y=this._mapy[idx];
    return;
  }
  ,observ2IdealBatch : function(i_x_coord,i_y_coord,i_start,i_num,o_x_coord,o_y_coord,i_out_start_index)
  {
    var idx;
    var ptr=i_out_start_index;
    var mapx=this._mapx;
    var mapy=this._mapy;
    var stride=this._stride;
    for (var j = 0; j < i_num; j++){
      idx=i_x_coord[i_start + j]+i_y_coord[i_start + j]*stride;
      o_x_coord[ptr]=mapx[idx];
      o_y_coord[ptr]=mapy[idx];
      ptr++;
    }
    return;
  }
})

NyARPerspectiveProjectionMatrix = ASKlass('NyARPerspectiveProjectionMatrix', NyARDoubleMatrix34,
{
  /*
   * static double dot( double a1, double a2, double a3,double b1, double b2,double b3 )
   */
  dot : function(a1,a2,a3,b1,b2,b3)
  {
    return (a1 * b1 + a2 * b2 + a3 * b3);
  }
  /* static double norm( double a, double b, double c ) */
  ,norm : function(a,b,c)
  {
    return Math.sqrt(a * a + b * b + c * c);
  }
  /**
   * int arParamDecompMat( double source[3][4], double cpara[3][4], double trans[3][4] ); 関数の置き換え Optimize STEP[754->665]
   *
   * @param o_cpara
   *            戻り引数。3x4のマトリクスを指定すること。
   * @param o_trans
   *            戻り引数。3x4のマトリクスを指定すること。
   * @return
   */
  ,decompMat : function(o_cpara,o_trans)
  {
    var r, c;
    var rem1, rem2, rem3;
    var c00,c01,c02,c03,c10,c11,c12,c13,c20,c21,c22,c23;
    if (this.m23>= 0) {// if( source[2][3] >= 0 ) {
      // <Optimize>
      // for(int r = 0; r < 3; r++ ){
      // for(int c = 0; c < 4; c++ ){
      // Cpara[r][c]=source[r][c];//Cpara[r][c] = source[r][c];
      // }
      // }
      c00=this.m00;
      c01=this.m01;
      c02=this.m02;
      c03=this.m03;
      c10=this.m10;
      c11=this.m11;
      c12=this.m12;
      c13=this.m13;
      c20=this.m20;
      c21=this.m21;
      c22=this.m22;
      c23=this.m23;
    } else {
      // <Optimize>
      // for(int r = 0; r < 3; r++ ){
      // for(int c = 0; c < 4; c++ ){
      // Cpara[r][c]=-source[r][c];//Cpara[r][c] = -(source[r][c]);
      // }
      // }
      c00=-this.m00;
      c01=-this.m01;
      c02=-this.m02;
      c03=-this.m03;
      c10=-this.m10;
      c11=-this.m11;
      c12=-this.m12;
      c13=-this.m13;
      c20=-this.m20;
      c21=-this.m21;
      c22=-this.m22;
      c23=-this.m23;
    }
    var cpara= o_cpara.getArray();
    var trans= o_trans.getArray();
    for (r = 0; r < 3; r++) {
      for (c = 0; c < 4; c++) {
        cpara[r][c] = 0.0;// cpara[r][c] = 0.0;
      }
    }
    cpara[2][2] = this.norm(c20, c21, c22);// cpara[2][2] =norm( Cpara[2][0],Cpara[2][1],Cpara[2][2]);
    trans[2][0] = c20 / cpara[2][2];// trans[2][0] = Cpara[2][0] /cpara[2][2];
    trans[2][1] = c21 / cpara[2][2];// trans[2][1] = Cpara[2][1] / cpara[2][2];
    trans[2][2] = c22 / cpara[2][2];// trans[2][2] =Cpara[2][2] /cpara[2][2];
    trans[2][3] = c23 / cpara[2][2];// trans[2][3] =Cpara[2][3] /cpara[2][2];
    cpara[1][2] = this.dot(trans[2][0], trans[2][1], trans[2][2], c10, c11, c12);// cpara[1][2]=dot(trans[2][0],trans[2][1],trans[2][2],Cpara[1][0],Cpara[1][1],Cpara[1][2]);
    rem1 = c10 - cpara[1][2] * trans[2][0];// rem1 =Cpara[1][0] -cpara[1][2] *trans[2][0];
    rem2 = c11 - cpara[1][2] * trans[2][1];// rem2 =Cpara[1][1] -cpara[1][2] *trans[2][1];
    rem3 = c12 - cpara[1][2] * trans[2][2];// rem3 =Cpara[1][2] -cpara[1][2] *trans[2][2];
    cpara[1][1] = this.norm(rem1, rem2, rem3);// cpara[1][1] = norm( rem1,// rem2, rem3 );
    trans[1][0] = rem1 / cpara[1][1];// trans[1][0] = rem1 / cpara[1][1];
    trans[1][1] = rem2 / cpara[1][1];// trans[1][1] = rem2 / cpara[1][1];
    trans[1][2] = rem3 / cpara[1][1];// trans[1][2] = rem3 / cpara[1][1];
    cpara[0][2] = this.dot(trans[2][0], trans[2][1], trans[2][2], c00, c01, c02);// cpara[0][2] =dot(trans[2][0], trans[2][1],trans[2][2],Cpara[0][0],Cpara[0][1],Cpara[0][2]);
    cpara[0][1] = this.dot(trans[1][0], trans[1][1], trans[1][2], c00, c01, c02);// cpara[0][1]=dot(trans[1][0],trans[1][1],trans[1][2],Cpara[0][0],Cpara[0][1],Cpara[0][2]);
    rem1 = c00 - cpara[0][1] * trans[1][0] - cpara[0][2]* trans[2][0];// rem1 = Cpara[0][0] - cpara[0][1]*trans[1][0]- cpara[0][2]*trans[2][0];
    rem2 = c01 - cpara[0][1] * trans[1][1] - cpara[0][2]* trans[2][1];// rem2 = Cpara[0][1] - cpara[0][1]*trans[1][1]- cpara[0][2]*trans[2][1];
    rem3 = c02 - cpara[0][1] * trans[1][2] - cpara[0][2]* trans[2][2];// rem3 = Cpara[0][2] - cpara[0][1]*trans[1][2] - cpara[0][2]*trans[2][2];
    cpara[0][0] = this.norm(rem1, rem2, rem3);// cpara[0][0] = norm( rem1,rem2, rem3 );
    trans[0][0] = rem1 / cpara[0][0];// trans[0][0] = rem1 / cpara[0][0];
    trans[0][1] = rem2 / cpara[0][0];// trans[0][1] = rem2 / cpara[0][0];
    trans[0][2] = rem3 / cpara[0][0];// trans[0][2] = rem3 / cpara[0][0];
    trans[1][3] = (c13 - cpara[1][2] * trans[2][3])/ cpara[1][1];// trans[1][3] = (Cpara[1][3] -cpara[1][2]*trans[2][3]) / cpara[1][1];
    trans[0][3] = (c03 - cpara[0][1] * trans[1][3] - cpara[0][2]* trans[2][3])/ cpara[0][0];// trans[0][3] = (Cpara[0][3] -cpara[0][1]*trans[1][3]-cpara[0][2]*trans[2][3]) / cpara[0][0];
    for (r = 0; r < 3; r++) {
      for (c = 0; c < 3; c++) {
        cpara[r][c] /= cpara[2][2];// cpara[r][c] /= cpara[2][2];
      }
    }
    return;
  }
  /**
   * int arParamChangeSize( ARParam *source, int xsize, int ysize, ARParam *newparam );
   * Matrixのスケールを変換します。
   * @param i_scale
   *
   */
  ,changeScale : function(i_scale)
  {
    this.m00=this.m00*i_scale;
    this.m10=this.m10*i_scale;
    this.m01=this.m01*i_scale;
    this.m11=this.m11*i_scale;
    this.m02=this.m02*i_scale;
    this.m12=this.m12*i_scale;
    this.m03=this.m03*i_scale;
    this.m13=this.m13*i_scale;
    //for (int i = 0; i < 4; i++) {
    //  array34[0 * 4 + i] = array34[0 * 4 + i] * scale;// newparam->mat[0][i]=source->mat[0][i]* scale;
    //  array34[1 * 4 + i] = array34[1 * 4 + i] * scale;// newparam->mat[1][i]=source->mat[1][i]* scale;
    //  array34[2 * 4 + i] = array34[2 * 4 + i];// newparam->mat[2][i] = source->mat[2][i];
    //}
    return;
  }
  /**
   * 現在の行列で３次元座標を射影変換します。
   * @param i_3dvertex
   * @param o_2d
   */
  ,projectionConvert_NyARDoublePoint3d : function(i_3dvertex,o_2d)
  {
    var w=i_3dvertex.z*this.m22;
    o_2d.x=(i_3dvertex.x*this.m00+i_3dvertex.y*this.m01+i_3dvertex.z*this.m02)/w;
    o_2d.y=(i_3dvertex.y*this.m11+i_3dvertex.z*this.m12)/w;
    return;
  }
  ,projectionConvert_Number : function(i_x,i_y,i_z,o_2d)
  {
    var w=i_z*this.m22;
    o_2d.x=(i_x*this.m00+i_y*this.m01+i_z*this.m02)/w;
    o_2d.y=(i_y*this.m11+i_z*this.m12)/w;
    return;
  }
})


/**
 * typedef struct { int xsize, ysize; double mat[3][4]; double dist_factor[4]; } ARParam;
 * NyARの動作パラメータを格納するクラス
 *
 */
NyARParam = ASKlass('NyARParam',
{
  _screen_size : new NyARIntSize(),
  SIZE_OF_PARAM_SET : 4 + 4 + (3 * 4 * 8) + (4 * 8),
  _dist : new NyARCameraDistortionFactor(),
  _projection_matrix : new NyARPerspectiveProjectionMatrix(),
  getScreenSize : function()
  {
    return this._screen_size;
  }
  ,getPerspectiveProjectionMatrix : function()
  {
    return this._projection_matrix;
  }
  ,getDistortionFactor : function()
  {
    return this._dist;
  }
  /**
   * Copy the perspective projection matrix to the given m_projection FloatVector GL camera matrix.
   */
  ,copyCameraMatrix : function(m_projection, NEAR_CLIP, FAR_CLIP) {
    var trans_mat = new FLARMat(3,4);
    var icpara_mat = new FLARMat(3,4);
    var p = ArrayUtil.createJaggedArray(3, 3);
    var q = ArrayUtil.createJaggedArray(4, 4);
    var i = 0;
    var j = 0;
    var size = this.getScreenSize();
    var  width = size.w;
    var height = size.h;

    this.getPerspectiveProjectionMatrix().decompMat(icpara_mat, trans_mat);

    var icpara = icpara_mat.getArray();
    var trans = trans_mat.getArray();
    for (i = 0; i < 4; i++) {
      icpara[1][i] = (height - 1) * (icpara[2][i]) - icpara[1][i];
    }

    for(i = 0; i < 3; i++) {
      for(j = 0; j < 3; j++) {
        p[i][j] = icpara[i][j] / icpara[2][2];
      }
    }
    q[0][0] = (2.0 * p[0][0] / (width - 1));
    q[0][1] = (2.0 * p[0][1] / (width - 1));
    q[0][2] = -((2.0 * p[0][2] / (width - 1))  - 1.0);
    q[0][3] = 0.0;

    q[1][0] = 0.0;
    q[1][1] = -(2.0 * p[1][1] / (height - 1));
    q[1][2] = -((2.0 * p[1][2] / (height - 1)) - 1.0);
    q[1][3] = 0.0;

    q[2][0] = 0.0;
    q[2][1] = 0.0;
    q[2][2] = -(FAR_CLIP + NEAR_CLIP) / (NEAR_CLIP - FAR_CLIP);
    q[2][3] = 2.0 * FAR_CLIP * NEAR_CLIP / (NEAR_CLIP - FAR_CLIP);

    q[3][0] = 0.0;
    q[3][1] = 0.0;
    q[3][2] = 1.0;
    q[3][3] = 0.0;

    for (i = 0; i < 4; i++) { // Row.
      // First 3 columns of the current row.
      for (j = 0; j < 3; j++) { // Column.
        m_projection[j*4 + i] =
          q[i][0] * trans[0][j] +
          q[i][1] * trans[1][j] +
          q[i][2] * trans[2][j];
      }
      // Fourth column of the current row.
      m_projection[i+4*3]=
        q[i][0] * trans[0][3] +
        q[i][1] * trans[1][3] +
        q[i][2] * trans[2][3] +
        q[i][3];
    }
  }
  /**
   *
   * @param i_factor
   * NyARCameraDistortionFactorにセットする配列を指定する。要素数は4であること。
   * @param i_projection
   * NyARPerspectiveProjectionMatrixセットする配列を指定する。要素数は12であること。
   */
  ,setValue : function(i_factor,i_projection)
  {
    this._dist.setValue(i_factor);
    this._projection_matrix.setValue(i_projection);
    return;
  }
  /**
   * int arParamChangeSize( ARParam *source, int xsize, int ysize, ARParam *newparam );
   * 関数の代替関数 サイズプロパティをi_xsize,i_ysizeに変更します。
   * @param i_xsize
   * @param i_ysize
   * @param newparam
   * @return
   *
   */
  ,changeScreenSize : function(i_xsize,i_ysize)
  {
    var scale = i_xsize / this._screen_size.w;// scale = (double)xsize / (double)(source->xsize);
    //スケールを変更
    this._dist.changeScale(scale);
    this._projection_matrix.changeScale(scale);
    this._screen_size.w = i_xsize;// newparam->xsize = xsize;
    this._screen_size.h = i_ysize;// newparam->ysize = ysize;
    return;
  }
  ,loadARParam : function(i_stream)
  {
    var tmp = new FloatVector(12);//new double[12];
    i_stream.endian = Endian.BIG_ENDIAN;
    this._screen_size.w = i_stream.readInt();//bb.getInt();
    this._screen_size.h = i_stream.readInt();//bb.getInt();
    //double値を12個読み込む
    var i;
    for(i = 0; i < 12; i++){
      tmp[i] = i_stream.readDouble();//bb.getDouble();
    }
    //Projectionオブジェクトにセット
    this._projection_matrix.setValue(tmp);
    //double値を4個読み込む
    for (i = 0; i < 4; i++) {
      tmp[i] = i_stream.readDouble();//bb.getDouble();
    }
    //Factorオブジェクトにセット
    this._dist.setValue(tmp);
    return;
  }
})
/*
 * PROJECT: FLARToolKit
 * --------------------------------------------------------------------------------
 * This work is based on the NyARToolKit developed by
 *   R.Iizuka (nyatla)
 * http://nyatla.jp/nyatoolkit/
 *
 * The FLARToolKit is ActionScript 3.0 version ARToolkit class library.
 * Copyright (C)2008 Saqoosha
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  http://www.libspark.org/wiki/saqoosha/FLARToolKit
 *  <saq(at)saqoosha.net>
 *
 */

/**
 * typedef struct { int xsize, ysize; double mat[3][4]; double dist_factor[4]; } ARParam;
 * NyARの動作パラメータを格納するクラス
 *
 * @see jp.nyatla.nyartoolkit.as3.core.param.NyARParam
 */
FLARParam = ASKlass('FLARParam', NyARParam,
{
  FLARParam : function(w,h)
  {
    w = w || 640;
    h = h || 480;
    this._screen_size.w = w;
    this._screen_size.h = h;
    var f = (w/h) / (4/3);
    var dist = new FloatVector([w/2, 1.1*h/2, 26.2, 1.0127565206658486]);
    var projection = new FloatVector([f*700.9514702992245, 0, w/2-0.5, 0,
                                      0, 726.0941816535367, h/2-0.5, 0,
                                      0, 0,                 1,     0]);
    this.setValue(dist, projection);
  }

})
/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */

INyARRaster = ASKlass('INyARRaster',
{
  getWidth : function(){},
  getHeight : function(){},
  getSize : function(){},
  /**
   * バッファオブジェクトを返します。
   * @return
   */
  getBuffer : function(){},
  /**
   * バッファオブジェクトのタイプを返します。
   * @return
   */
  getBufferType : function(){},
  /**
   * バッファのタイプがi_type_valueであるか、チェックします。
   * この値は、NyARBufferTypeに定義された定数値です。
   * @param i_type_value
   * @return
   */
  isEqualBufferType : function(i_type_value){},
  /**
   * getBufferがオブジェクトを返せるかの真偽値です。
   * @return
   */
  hasBuffer : function(){},
  /**
   * i_ref_bufをラップします。できる限り整合性チェックを行います。
   * バッファの再ラッピングが可能な関数のみ、この関数を実装してください。
   * @param i_ref_buf
   */
  wrapBuffer : function(i_ref_buf){}
})

NyARRaster_BasicClass = ASKlass('NyARRaster_BasicClass', INyARRaster,
{
  _size : null,
  _buffer_type : 0,
  /*
   * ,NyARRaster_BasicClass : function(int i_width,int i_height,int i_buffer_type)
   */
  NyARRaster_BasicClass : function()
  {
    switch(arguments.length) {
    case 1:
      if (arguments[0] == NyAS3Const_Inherited) {
        //blank
      }
      break;
    case 3:
      this.overload_NyARRaster_BasicClass(toInt(arguments[0]),toInt(arguments[1]),toInt(arguments[2]));
      break;
    default:
      throw new NyARException();
    }
  }
  ,overload_NyARRaster_BasicClass : function(i_width ,i_height,i_buffer_type)
  {
    this._size = new NyARIntSize(i_width, i_height);
    this._buffer_type=i_buffer_type;
  }
  ,getWidth : function()
  {
    return this._size.w;
  }
  ,getHeight : function()
  {
    return this._size.h;
  }
  ,getSize : function()
  {
    return this._size;
  }
  ,getBufferType : function()
  {
    return this._buffer_type;
  }
  ,isEqualBufferType : function(i_type_value)
  {
    return this._buffer_type==i_type_value;
  }
  ,getBuffer : function()
  {
    throw new NyARException();
  }
  ,hasBuffer : function()
  {
    throw new NyARException();
  }
  ,wrapBuffer : function(i_ref_buf)
  {
    throw new NyARException();
  }
})

NyARBinRaster = ASKlass('NyARBinRaster', NyARRaster_BasicClass,
{
  _buf : null,
  /**
   * バッファオブジェクトがアタッチされていればtrue
   */
  _is_attached_buffer : null,
  /**
   *
   */
  NyARBinRaster : function()
  {
    NyARRaster_BasicClass.initialize.call(this, NyAS3Const_Inherited);
    switch(arguments.length) {
    case 1:
      if (arguments[0] == NyAS3Const_Inherited) {
        //blank
      }
      break;
    case 2:
      //(int,int)
      this.override_NyARBinRaster2(toInt(arguments[0]), toInt(arguments[1]));
      break;
    case 3:
      //(int,int,bool)
      this.override_NyARBinRaster3(toInt(arguments[0]), toInt(arguments[1]),Boolean(arguments[2]));
      break;
    case 4:
      //(int,int,int,bool)
      this.override_NyARBinRaster4(toInt(arguments[0]), toInt(arguments[1]),toInt(arguments[2]),Boolean(arguments[3]));
      break;
    default:
      throw new NyARException();
    }
  }
  /**
   *
   * @param i_width
   * @param i_height
   * @param i_raster_type
   * NyARBufferTypeに定義された定数値を指定してください。
   * @param i_is_alloc
   * @throws NyARException
   */
  ,override_NyARBinRaster4 : function(i_width, i_height, i_raster_type, i_is_alloc)
  {
    NyARRaster_BasicClass.overload_NyARRaster_BasicClass.call(this,i_width,i_height,i_raster_type);
    if(!this.initInstance(this._size,i_raster_type,i_is_alloc)){
      throw new NyARException();
    }
  }
  ,override_NyARBinRaster3 : function(i_width, i_height, i_is_alloc)
  {
    NyARRaster_BasicClass.overload_NyARRaster_BasicClass.call(this,i_width,i_height,NyARBufferType.INT1D_BIN_8);
    if(!this.initInstance(this._size,NyARBufferType.INT1D_BIN_8,i_is_alloc)){
      throw new NyARException();
    }
  }
  ,override_NyARBinRaster2 : function(i_width, i_height)
  {
    NyARRaster_BasicClass.overload_NyARRaster_BasicClass.call(this,i_width,i_height,NyARBufferType.INT1D_BIN_8);
    if(!this.initInstance(this._size,NyARBufferType.INT1D_BIN_8,true)){
      throw new NyARException();
    }
  }
  ,initInstance : function(i_size,i_buf_type,i_is_alloc)
  {
    switch(i_buf_type)
    {
      case NyARBufferType.INT1D_BIN_8:
        this._buf = i_is_alloc?new IntVector(i_size.w*i_size.h):null;
        break;
      default:
        return false;
    }
    this._is_attached_buffer=i_is_alloc;
    return true;
  }
  ,getBuffer : function()
  {
    return this._buf;
  }
  /**
   * インスタンスがバッファを所有するかを返します。
   * コンストラクタでi_is_allocをfalseにしてラスタを作成した場合、
   * バッファにアクセスするまえに、バッファの有無をこの関数でチェックしてください。
   * @return
   */
  ,hasBuffer : function()
  {
    return this._buf!=null;
  }
  ,wrapBuffer : function(i_ref_buf)
  {
    NyAS3Utils.assert(!this._is_attached_buffer);//バッファがアタッチされていたら機能しない。
    this._buf=i_ref_buf;
  }
})





NyARGrayscaleRaster = ASKlass('NyARGrayscaleRaster', NyARRaster_BasicClass,
{
  _buf : null,
  /**
   * バッファオブジェクトがアタッチされていればtrue
   */
  _is_attached_buffer : null,
  NyARGrayscaleRaster : function()
  {
    NyARRaster_BasicClass.initialize.call(this, NyAS3Const_Inherited);
    switch(arguments.length) {
    case 1:
      if (arguments[0] == NyAS3Const_Inherited) {
        //blank
      }
      break;
    case 2:
      //(int,int)
      this.overload_NyARGrayscaleRaster2(toInt(arguments[0]), toInt(arguments[1]));
      break;
    case 3:
      //(int,int,boolean)
      this.overload_NyARGrayscaleRaster3(toInt(arguments[0]), toInt(arguments[1]),Boolean(arguments[2]));
      break;
    case 4:
      //(int,int,int,boolean)
      this.overload_NyARGrayscaleRaster4(toInt(arguments[0]), toInt(arguments[1]),toInt(arguments[2]),Boolean(arguments[3]));
      break;
    default:
      throw new NyARException();
    }
  }
  ,overload_NyARGrayscaleRaster2 : function(i_width,i_height)
  {
    NyARRaster_BasicClass.overload_NyARRaster_BasicClass.call(this,i_width,i_height,NyARBufferType.INT1D_GRAY_8);
    if(!this.initInstance(this._size,NyARBufferType.INT1D_GRAY_8,true)){
      throw new NyARException();
    }
  }
  ,overload_NyARGrayscaleRaster3 : function(i_width,i_height,i_is_alloc)
  {
    NyARRaster_BasicClass.overload_NyARRaster_BasicClass.call(this,i_width,i_height,NyARBufferType.INT1D_GRAY_8);
    if(!this.initInstance(this._size,NyARBufferType.INT1D_GRAY_8,i_is_alloc)){
      throw new NyARException();
    }
  }
  /**
   * @param i_width
   * @param i_height
   * @param i_raster_type
   * NyARBufferTypeに定義された定数値を指定してください。
   * @param i_is_alloc
   * @throws NyARException
   */
  ,overload_NyARGrayscaleRaster4 : function(i_width, i_height, i_raster_type, i_is_alloc)
  {
    NyARRaster_BasicClass.overload_NyARRaster_BasicClass.call(this,i_width,i_height,i_raster_type);
    if(!this.initInstance(this._size,i_raster_type,i_is_alloc)){
      throw new NyARException();
    }
  }
  ,initInstance : function(i_size,i_buf_type,i_is_alloc)
  {
    switch(i_buf_type)
    {
      case NyARBufferType.INT1D_GRAY_8:
        this._buf =i_is_alloc?new IntVector(i_size.w*i_size.h):null;
        break;
      default:
        return false;
    }
    this._is_attached_buffer=i_is_alloc;
    return true;
  }
  ,getBuffer : function()
  {
    return this._buf;
  }
  /**
   * インスタンスがバッファを所有するかを返します。
   * コンストラクタでi_is_allocをfalseにしてラスタを作成した場合、
   * バッファにアクセスするまえに、バッファの有無をこの関数でチェックしてください。
   * @return
   */
  ,hasBuffer : function()
  {
    return this._buf!=null;
  }
  ,wrapBuffer : function(i_ref_buf)
  {
    NyAS3Utils.assert(!this._is_attached_buffer);//バッファがアタッチされていたら機能しない。
    this._buf=i_ref_buf;
  }
})




/**このクラスは、単機能のNyARRasterです。
 *
 */
NyARRaster = ASKlass('NyARRaster', NyARRaster_BasicClass,
{
  _buf : null,
  _buf_type : 0,
  /**
   * バッファオブジェクトがアタッチされていればtrue
   */
  _is_attached_buffer : null,
  NyARRaster : function()
  {
    NyARRaster_BasicClass.initialize.call(this, NyAS3Const_Inherited);
    switch(arguments.length) {
    case 1:
      if (arguments[0] == NyAS3Const_Inherited) {
        //blank
      }
      break;
    case 3:
      this.overload_NyARRaster3(toInt(arguments[0]), toInt(arguments[1]),toInt(arguments[2]));
      break;
    case 4:
      this.overload_NyARRaster4(toInt(arguments[0]), toInt(arguments[1]),toInt(arguments[2]),Boolean(arguments[3]));
      break;
    default:
      throw new NyARException();
    }
  }
  /**
   * 指定したバッファタイプのラスタを作成します。
   * @param i_width
   * @param i_height
   * @param i_buffer_type
   * NyARBufferTypeに定義された定数値を指定してください。
   * @param i_is_alloc
   * @throws NyARException
   */
  ,overload_NyARRaster4 : function(i_width, i_height, i_buffer_type, i_is_alloc)
  {
    NyARRaster_BasicClass.overload_NyARRaster_BasicClass.call(this,i_width,i_height,i_buffer_type);
    if(!this.initInstance(this._size,i_buffer_type,i_is_alloc)){
      throw new NyARException();
    }
    return;
  }
  ,overload_NyARRaster3 : function(i_width, i_height, i_buffer_type)
  {
    NyARRaster_BasicClass.overload_NyARRaster_BasicClass.call(this,i_width,i_height,i_buffer_type);
    if(!this.initInstance(this._size,i_buffer_type,true)){
      throw new NyARException();
    }
    return;
  }
  ,initInstance : function(i_size,i_buf_type,i_is_alloc)
  {
    switch(i_buf_type)
    {
      case NyARBufferType.INT1D_X8R8G8B8_32:
        this._buf=i_is_alloc?new IntVector(i_size.w*i_size.h):null;
        break;
      default:
        return false;
    }
    this._is_attached_buffer=i_is_alloc;
    return true;
  }
  ,getBuffer : function()
  {
    return this._buf;
  }
  /**
   * インスタンスがバッファを所有するかを返します。
   * コンストラクタでi_is_allocをfalseにしてラスタを作成した場合、
   * バッファにアクセスするまえに、バッファの有無をこの関数でチェックしてください。
   * @return
   */
  ,hasBuffer : function()
  {
    return this._buf!=null;
  }
  ,wrapBuffer : function(i_ref_buf)
  {
    NyAS3Utils.assert(!this._is_attached_buffer);//バッファがアタッチされていたら機能しない。
    this._buf=i_ref_buf;
  }
})


/**
 * 8bitRGBを表現できるラスタ
 *
 */
INyARRgbRaster = ASKlass('INyARRgbRaster', INyARRaster, {
  getRgbPixelReader : function(){}
})
/**
 * NyARRasterインタフェイスの基本関数/メンバを実装したクラス
 *
 *
 */
NyARRgbRaster_BasicClass = ASKlass('NyARRgbRaster_BasicClass', INyARRgbRaster,
{
  _size : null,
  _buffer_type : 0,
  NyARRgbRaster_BasicClass : function()
  {
    switch(arguments.length) {
    case 1:
      if (arguments[0] == NyAS3Const_Inherited) {
        //blank
      }
      break;
    case 3:
      //(int,int,int)
      this.overload_NyARRgbRaster_BasicClass(toInt(arguments[0]),toInt(arguments[1]),toInt(arguments[2]));
      break;
    default:
      throw new NyARException();
    }
  }
  ,overload_NyARRgbRaster_BasicClass : function(i_width,i_height,i_buffer_type)
  {
    this._size= new NyARIntSize(i_width,i_height);
    this._buffer_type=i_buffer_type;
  }
  ,getWidth : function()
  {
    return this._size.w;
  }
  ,getHeight : function()
  {
    return this._size.h;
  }
  ,getSize : function()
  {
    return this._size;
  }
  ,getBufferType : function()
  {
    return this._buffer_type;
  }
  ,isEqualBufferType : function(i_type_value)
  {
    return this._buffer_type==i_type_value;
  }
  ,getRgbPixelReader : function()
  {
    throw new NyARException();
  }
  ,getBuffer : function()
  {
    throw new NyARException();
  }
  ,hasBuffer : function()
  {
    throw new NyARException();
  }
  ,wrapBuffer : function(i_ref_buf)
  {
    throw new NyARException();
  }
})

NyARRgbRaster = ASKlass('NyARRgbRaster', NyARRgbRaster_BasicClass,
{
  _buf : null,
  _reader : null,
  /**
   * バッファオブジェクトがアタッチされていればtrue
   */
  _is_attached_buffer : null,
  NyARRgbRaster : function()
  {
    NyARRgbRaster_BasicClass.initialize.call(this, NyAS3Const_Inherited);
    switch(arguments.length) {
    case 1:
      if (arguments[0] == NyAS3Const_Inherited) {
        //blank
      }
      break;
    case 3:
      this.overload_NyARRgbRaster3(toInt(arguments[0]), toInt(arguments[1]),toInt(arguments[2]));
      break;
    case 4:
      this.overload_NyARRgbRaster4(toInt(arguments[0]), toInt(arguments[1]),toInt(arguments[2]),Boolean(arguments[3]));
      break;
    default:
      throw new NyARException();
    }
  }
  /**
   *
   * @param i_width
   * @param i_height
   * @param i_raster_type
   * NyARBufferTypeに定義された定数値を指定してください。
   * @param i_is_alloc
   * @throws NyARException
   */
  ,overload_NyARRgbRaster4 : function(i_width,i_height,i_raster_type,i_is_alloc)
  {
    NyARRgbRaster_BasicClass.overload_NyARRgbRaster_BasicClass.call(this,i_width,i_height,i_raster_type);
    if(!this.initInstance(this._size,i_raster_type,i_is_alloc)){
      throw new NyARException();
    }
  }
  /**
   *
   * @param i_width
   * @param i_height
   * @param i_raster_type
   * NyARBufferTypeに定義された定数値を指定してください。
   * @throws NyARException
   */
  ,overload_NyARRgbRaster3 : function(i_width, i_height, i_raster_type)
  {
    NyARRgbRaster_BasicClass.overload_NyARRgbRaster_BasicClass.call(this,i_width,i_height,i_raster_type);
    if(!this.initInstance(this._size,i_raster_type,true)){
      throw new NyARException();
    }
  }
  ,initInstance : function(i_size,i_raster_type,i_is_alloc)
  {
    switch(i_raster_type)
    {
      case NyARBufferType.INT1D_X8R8G8B8_32:
        this._buf=i_is_alloc?new IntVector(i_size.w*i_size.h):null;
        this._reader=new NyARRgbPixelReader_INT1D_X8R8G8B8_32(this._buf||new IntVector(1),i_size);
        break;
      case NyARBufferType.BYTE1D_B8G8R8X8_32:
      case NyARBufferType.BYTE1D_R8G8B8_24:
      default:
        return false;
    }
    this._is_attached_buffer=i_is_alloc;
    return true;
  }
  ,getRgbPixelReader : function()
  {
    return this._reader;
  }
  ,getBuffer : function()
  {
    return this._buf;
  }
  ,hasBuffer : function()
  {
    return this._buf!=null;
  }
  ,wrapBuffer : function(i_ref_buf)
  {
    NyAS3Utils.assert(!this._is_attached_buffer);//バッファがアタッチされていたら機能しない。
    this._buf=i_ref_buf;
    //ピクセルリーダーの参照バッファを切り替える。
    this._reader.switchBuffer(i_ref_buf);
  }
})



NyARRgbRaster_Canvas2D = ASKlass("NyARRgbRaster_Canvas2D", NyARRgbRaster_BasicClass,
{
  _canvas : null,
  _rgb_reader: null,

  NyARRgbRaster_Canvas2D : function(canvas) {
    NyARRgbRaster_BasicClass.initialize.call(this, canvas.width, canvas.height, NyARBufferType.OBJECT_JS_Canvas);
    this._canvas = canvas;
    this._rgb_reader = new NyARRgbPixelReader_Canvas2D(this._canvas);
  },
  getRgbPixelReader : function()
  {
    return this._rgb_reader;
  },
  getBuffer:function()
  {
    return this._canvas;
  },
  hasBuffer:function()
  {
    return this._bitmapData != null;
  }
})

/*
 * PROJECT: FLARToolKit
 * --------------------------------------------------------------------------------
 * This work is based on the NyARToolKit developed by
 *   R.Iizuka (nyatla)
 * http://nyatla.jp/nyatoolkit/
 *
 * The FLARToolKit is ActionScript 3.0 version ARToolkit class library.
 * Copyright (C)2008 Saqoosha
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  http://www.libspark.org/wiki/saqoosha/FLARToolKit
 *  <saq(at)saqoosha.net>
 *
 */


FLARCanvas = function(w,h) {
  var c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}



FLARBinRaster = ASKlass('FLARBinRaster', NyARBinRaster,
{
  FLARBinRaster : function(i_width,i_height)
  {
    NyARBinRaster.initialize.call(this,i_width,i_height,NyARBufferType.OBJECT_AS3_BitmapData,true);
    this._gray_reader = new FLARGrayPixelReader_BitmapData(this._buf);
  }
  ,initInstance : function(i_size,i_buf_type,i_is_alloc)
  {
    this._buf = i_is_alloc?new BitmapData(i_size.w,i_size.h,0x00):null;
    return true;
  }
  ,getGrayPixelReader : function() {
    return this._gray_reader;
  }
})


FLARRgbRaster_BitmapData = ASKlass('FLARRgbRaster_BitmapData', NyARRgbRaster_BasicClass,
{
  _bitmapData : null
  ,_rgb_reader : null
  /**
   *
   * @deprecated 次バージョンで次のように変更されます。 FLARRgbRaster_BitmapData(i_width,i_height)
   */
  ,FLARRgbRaster_BitmapData : function(bitmapData) {
    NyARRgbRaster_BasicClass.initialize.call(this,bitmapData.width, bitmapData.height,NyARBufferType.OBJECT_AS3_BitmapData);
    this._bitmapData = bitmapData;
    this._rgb_reader = new FLARRgbPixelReader_BitmapData(this._bitmapData);
  }
  ,getRgbPixelReader : function()
  {
    return this._rgb_reader;
  }
  ,getBuffer : function()
  {
    return this._bitmapData;
  }
  ,hasBuffer : function()
  {
    return this._bitmapData != null;
  }
})
/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */


NyARMatchPattDeviationBlackWhiteData = ASKlass('NyARMatchPattDeviationBlackWhiteData',
{
  _data : null,
  _pow : 0,
  //
  _number_of_pixels : 0,
  refData : function()
  {
    return this._data;
  }
  ,getPow : function()
  {
    return this._pow;
  }
  ,NyARMatchPattDeviationBlackWhiteData : function(i_width,i_height)
  {
    this._number_of_pixels=i_height*i_width;
    this._data=new IntVector(this._number_of_pixels);
    return;
  }
  /**
   * XRGB[width*height]の配列から、パターンデータを構築。
   * @param i_buffer
   */
  ,setRaster : function(i_raster)
  {
    //i_buffer[XRGB]→差分[BW]変換
    var i;
    var ave;//<PV/>
    var rgb;//<PV/>
    var linput=this._data;//<PV/>
    var buf=(i_raster.getBuffer());
    // input配列のサイズとwhも更新// input=new int[height][width][3];
    var number_of_pixels=this._number_of_pixels;
    //<平均値計算(FORの1/8展開)/>
    ave = 0;
    for(i=number_of_pixels-1;i>=0;i--){
      rgb = buf[i];
      ave += ((rgb >> 16) & 0xff) + ((rgb >> 8) & 0xff) + (rgb & 0xff);
    }
    ave=(number_of_pixels*255*3-ave)/(3*number_of_pixels);
    //
    var sum = 0,w_sum;
    //<差分値計算/>
    for (i = number_of_pixels-1; i >= 0;i--) {
      rgb = buf[i];
      w_sum =((255*3-(rgb & 0xff)-((rgb >> 8) & 0xff)-((rgb >> 16) & 0xff))/3)-ave;
      linput[i] = w_sum;
      sum += w_sum * w_sum;
    }
    var p=Math.sqrt(sum);
    this._pow=p!=0.0?p:0.0000001;
    return;
  }
})
NyARMatchPattDeviationColorData = ASKlass('NyARMatchPattDeviationColorData',
{
  _data : null,
  _pow : 0,
  //
  _number_of_pixels : 0,
  _optimize_for_mod : 0,
  refData : function()
  {
    return this._data;
  }
  ,getPow : function()
  {
    return this._pow;
  }
  ,NyARMatchPattDeviationColorData : function(i_width,i_height)
  {
    this._number_of_pixels=i_height*i_width;
    this._data=new IntVector(this._number_of_pixels*3);
    this._optimize_for_mod=this._number_of_pixels-(this._number_of_pixels%8);
    return;
  }
  /**
   * NyARRasterからパターンデータをセットします。
   * この関数は、データを元に所有するデータ領域を更新します。
   * @param i_buffer
   */
  ,setRaster : function(i_raster)
  {
    //画素フォーマット、サイズ制限
    NyAS3Utils.assert(i_raster.isEqualBufferType(NyARBufferType.INT1D_X8R8G8B8_32));
    NyAS3Utils.assert(i_raster.getSize().isEqualSize_NyARIntSize(i_raster.getSize()));
    var buf=(i_raster.getBuffer());
    //i_buffer[XRGB]→差分[R,G,B]変換
    var i;
    var ave;//<PV/>
    var rgb;//<PV/>
    var linput=this._data;//<PV/>
    // input配列のサイズとwhも更新// input=new int[height][width][3];
    var number_of_pixels=this._number_of_pixels;
    var for_mod=this._optimize_for_mod;
    //<平均値計算(FORの1/8展開)>
    ave = 0;
    for(i=number_of_pixels-1;i>=for_mod;i--){
      rgb = buf[i];ave += ((rgb >> 16) & 0xff) + ((rgb >> 8) & 0xff) + (rgb & 0xff);
    }
    for (;i>=0;) {
      rgb = buf[i];ave += ((rgb >> 16) & 0xff) + ((rgb >> 8) & 0xff) + (rgb & 0xff);i--;
      rgb = buf[i];ave += ((rgb >> 16) & 0xff) + ((rgb >> 8) & 0xff) + (rgb & 0xff);i--;
      rgb = buf[i];ave += ((rgb >> 16) & 0xff) + ((rgb >> 8) & 0xff) + (rgb & 0xff);i--;
      rgb = buf[i];ave += ((rgb >> 16) & 0xff) + ((rgb >> 8) & 0xff) + (rgb & 0xff);i--;
      rgb = buf[i];ave += ((rgb >> 16) & 0xff) + ((rgb >> 8) & 0xff) + (rgb & 0xff);i--;
      rgb = buf[i];ave += ((rgb >> 16) & 0xff) + ((rgb >> 8) & 0xff) + (rgb & 0xff);i--;
      rgb = buf[i];ave += ((rgb >> 16) & 0xff) + ((rgb >> 8) & 0xff) + (rgb & 0xff);i--;
      rgb = buf[i];ave += ((rgb >> 16) & 0xff) + ((rgb >> 8) & 0xff) + (rgb & 0xff);i--;
    }
    //<平均値計算(FORの1/8展開)/>
    ave=number_of_pixels*255*3-ave;
    ave =255-(ave/ (number_of_pixels * 3));//(255-R)-ave を分解するための事前計算
    var sum = 0,w_sum;
    var input_ptr=number_of_pixels*3-1;
    //<差分値計算(FORの1/8展開)>
    for (i = number_of_pixels-1; i >= for_mod;i--) {
      rgb = buf[i];
      w_sum = (ave - (rgb & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//B
      w_sum = (ave - ((rgb >> 8) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//G
      w_sum = (ave - ((rgb >> 16) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//R
    }
    for (; i >=0;) {
      rgb = buf[i];i--;
      w_sum = (ave - (rgb & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//B
      w_sum = (ave - ((rgb >> 8) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//G
      w_sum = (ave - ((rgb >> 16) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//R
      rgb = buf[i];i--;
      w_sum = (ave - (rgb & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//B
      w_sum = (ave - ((rgb >> 8) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//G
      w_sum = (ave - ((rgb >> 16) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//R
      rgb = buf[i];i--;
      w_sum = (ave - (rgb & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//B
      w_sum = (ave - ((rgb >> 8) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//G
      w_sum = (ave - ((rgb >> 16) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//R
      rgb = buf[i];i--;
      w_sum = (ave - (rgb & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//B
      w_sum = (ave - ((rgb >> 8) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//G
      w_sum = (ave - ((rgb >> 16) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//R
      rgb = buf[i];i--;
      w_sum = (ave - (rgb & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//B
      w_sum = (ave - ((rgb >> 8) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//G
      w_sum = (ave - ((rgb >> 16) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//R
      rgb = buf[i];i--;
      w_sum = (ave - (rgb & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//B
      w_sum = (ave - ((rgb >> 8) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//G
      w_sum = (ave - ((rgb >> 16) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//R
      rgb = buf[i];i--;
      w_sum = (ave - (rgb & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//B
      w_sum = (ave - ((rgb >> 8) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//G
      w_sum = (ave - ((rgb >> 16) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//R
      rgb = buf[i];i--;
      w_sum = (ave - (rgb & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//B
      w_sum = (ave - ((rgb >> 8) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//G
      w_sum = (ave - ((rgb >> 16) & 0xff)) ;linput[input_ptr--] = w_sum;sum += w_sum * w_sum;//R
    }
    //<差分値計算(FORの1/8展開)/>
    var p=Math.sqrt(sum);
    this._pow=p!=0.0?p:0.0000001;
    return;
  }
})
NyARMatchPattResult = ASKlass('NyARMatchPattResult',
{
  DIRECTION_UNKNOWN : -1,
  confidence : 0,
  direction : 0
})



/**
 * ARToolKitのマーカーコードを1個保持します。
 *
 */
NyARCode = ASKlass('NyARCode',
{
  _color_pat : new Array(4),
  _bw_pat : new Array(4),
  _width : 0,
  _height : 0,
  NyARCode : function(i_width, i_height)
  {
    this._width = i_width;
    this._height = i_height;
    //空のラスタを4個作成
    for(var i=0;i<4;i++){
      this._color_pat[i]=new NyARMatchPattDeviationColorData(i_width,i_height);
      this._bw_pat[i]=new NyARMatchPattDeviationBlackWhiteData(i_width,i_height);
    }
    return;
  }
  ,getColorData : function(i_index)
  {
    return this._color_pat[i_index];
  }
  ,getBlackWhiteData : function(i_index)
  {
    return this._bw_pat[i_index];
  }
  ,getWidth : function()
  {
    return this._width;
  }
  ,getHeight : function()
  {
    return this._height;
  }
  ,loadARPattFromFile : function(i_stream)
  {
    NyARCodeFileReader.loadFromARToolKitFormFile(i_stream,this);
    return;
  }
  ,setRaster : function(i_raster)
  {
    NyAS3Utils.assert(i_raster.length!=4);
    //ラスタにパターンをロードする。
    for(var i=0;i<4;i++){
      this._color_pat[i].setRaster(i_raster[i]);
    }
    return;
  }
})






NyARCodeFileReader = ASKlass('NyARCodeFileReader',
{

  /**
  * ARコードファイルからデータを読み込んでo_codeに格納します。
  * @param i_stream
  * @param o_code
  * @throws NyARException
  */
  loadFromARToolKitFormFile : function(i_stream,o_code)
  {
    var width=o_code.getWidth();
    var height=o_code.getHeight();
    var tmp_raster=new NyARRaster(width,height,NyARBufferType.INT1D_X8R8G8B8_32);
    //4個の要素をラスタにセットする。
    var token = i_stream.match(/\d+/g);
    var buf=(tmp_raster.getBuffer());
    //GBRAで一度読みだす。
    for (var h = 0; h < 4; h++){
      this.readBlock(token,width,height,buf);
      //ARCodeにセット(カラー)
      o_code.getColorData(h).setRaster(tmp_raster);
      o_code.getBlackWhiteData(h).setRaster(tmp_raster);
    }
    tmp_raster=null;//ポイ
    return;
  }
  /**
  * 1ブロック分のXRGBデータをi_stからo_bufへ読みだします。
  * @param i_st
  * @param o_buf
  */
  ,readBlock : function(i_st, i_width, i_height, o_buf)
  {
    var pixels = i_width * i_height;
    var i3;
    for (i3 = 0; i3 < 3; i3++) {
      for (var i2 = 0; i2 < pixels; i2++){
        // 数値のみ読み出す
        var val = parseInt(i_st.shift());
        if(isNaN(val)){
          throw new NyARException("syntax error in pattern file.");
        }
        o_buf[i2]=(o_buf[i2]<<8)|((0x000000ff&toInt(val)));
      }
    }
    //GBR→RGB
    for(i3=0;i3<pixels;i3++){
      o_buf[i3]=((o_buf[i3]<<16)&0xff0000)|(o_buf[i3]&0x00ff00)|((o_buf[i3]>>16)&0x0000ff);
    }
    return;
  }
})
/*
 * PROJECT: FLARToolKit
 * --------------------------------------------------------------------------------
 * This work is based on the NyARToolKit developed by
 *   R.Iizuka (nyatla)
 * http://nyatla.jp/nyatoolkit/
 *
 * The FLARToolKit is ActionScript 3.0 version ARToolkit class library.
 * Copyright (C)2008 Saqoosha
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  http://www.libspark.org/wiki/saqoosha/FLARToolKit
 *  <saq(at)saqoosha.net>
 *
 */
FLARCode = ASKlass('FLARCode', NyARCode,
{
  markerPercentWidth : 50
  ,markerPercentHeight : 50
  /**
   *
   * @param  i_width          幅方向の分割数
   * @param  i_height        高さ方向の分割数
   * @param  i_markerPercentWidth  マーカ全体(本体＋枠)における、マーカ本体部分の割合(幅)
   * @param  i_markerPercentHeight  マーカ全体(本体＋枠)における、マーカ本体部分の割合(高さ)
   */
  ,FLARCode : function(i_width, i_height,i_markerPercentWidth,  i_markerPercentHeight)
  {
    NyARCode.initialize.call(this, i_width, i_height);
    this.markerPercentWidth = i_markerPercentWidth == null ? 50 : i_markerPercentWidth;
    this.markerPercentHeight = i_markerPercentHeight == null ? 50 : i_markerPercentHeight;
  }
  ,loadARPatt : function(i_stream)
  {
    NyARCode.loadARPattFromFile.call(this, i_stream);
    return;
  }
})
/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */

/**
 * ARColorPattのマッチング計算をするインタフェイスです。 基準Patに対して、計算済みのARCodeデータとの間で比較演算をします。
 * pattern_match関数を分解した３種類のパターン検出クラスを定義します。
 *
 */
INyARMatchPatt = ASKlass('INyARMatchPatt',
{
  setARCode : function(i_code){}
})
NyARMatchPatt_Color_WITHOUT_PCA = ASKlass('NyARMatchPatt_Color_WITHOUT_PCA', INyARMatchPatt,
{
  _code_patt : null,
  _optimize_for_mod : 0,
  _rgbpixels : 0,
  NyARMatchPatt_Color_WITHOUT_PCA : function()
  {
    switch(arguments.length){
    case 1:
      {  //,NyARMatchPatt_Color_WITHOUT_PCA : function(i_code_ref)
        var i_code_ref=arguments[0];
        var w=i_code_ref.getWidth();
        var h=i_code_ref.getHeight();
        //最適化定数の計算
        this._rgbpixels=w*h*3;
        this._optimize_for_mod=this._rgbpixels-(this._rgbpixels%16);
        this.setARCode(i_code_ref);
        return;
      }
      break;
    case 2:
      {  //,NyARMatchPatt_Color_WITHOUT_PCA : function(i_width,i_height)
        var i_width = toInt(arguments[0]), i_height = toInt(arguments[1]);
        //最適化定数の計算
        this._rgbpixels=i_height*i_width*3;
        this._optimize_for_mod=this._rgbpixels-(this._rgbpixels%16);
        return;
      }
      break;
    default:
      break;
    }
    throw new NyARException();
  }
  /**
   * 比較対象のARCodeをセットします。
   * @throws NyARException
   */
  ,setARCode : function(i_code_ref)
  {
    this._code_patt=i_code_ref;
    return;
  }
  /**
   * 現在セットされているARコードとi_pattを比較します。
   */
  ,evaluate : function(i_patt,o_result)
  {
    NyAS3Utils.assert(this._code_patt!=null);
    //
    var linput = i_patt.refData();
    var sum;
    var max = Number.MIN_VALUE;
    var res = NyARMatchPattResult.DIRECTION_UNKNOWN;
    var for_mod=this._optimize_for_mod;
    for (var j = 0; j < 4; j++) {
      //合計値初期化
      sum=0;
      var code_patt=this._code_patt.getColorData(j);
      var pat_j = code_patt.refData();
      //<全画素について、比較(FORの1/16展開)>
      var i;
      for(i=this._rgbpixels-1;i>=for_mod;i--){
        sum += linput[i] * pat_j[i];
      }
      for (;i>=0;) {
        sum += linput[i] * pat_j[i];i--;
        sum += linput[i] * pat_j[i];i--;
        sum += linput[i] * pat_j[i];i--;
        sum += linput[i] * pat_j[i];i--;
        sum += linput[i] * pat_j[i];i--;
        sum += linput[i] * pat_j[i];i--;
        sum += linput[i] * pat_j[i];i--;
        sum += linput[i] * pat_j[i];i--;
        sum += linput[i] * pat_j[i];i--;
        sum += linput[i] * pat_j[i];i--;
        sum += linput[i] * pat_j[i];i--;
        sum += linput[i] * pat_j[i];i--;
        sum += linput[i] * pat_j[i];i--;
        sum += linput[i] * pat_j[i];i--;
        sum += linput[i] * pat_j[i];i--;
        sum += linput[i] * pat_j[i];i--;
      }
      //<全画素について、比較(FORの1/16展開)/>
      var sum2 = sum / code_patt.getPow();// sum2 = sum / patpow[k][j]/ datapow;
      if (sum2 > max) {
        max = sum2;
        res = j;
      }
    }
    o_result.direction = res;
    o_result.confidence= max/i_patt.getPow();
    return true;
  }
})
/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */
NyARRasterAnalyzer_Histogram = ASKlass('NyARRasterAnalyzer_Histogram',
{
  _histImpl : null,
  /**
   * ヒストグラム解析の縦方向スキップ数。継承クラスはこのライン数づつ
   * スキップしながらヒストグラム計算を行うこと。
   */
  _vertical_skip : 0,
  NyARRasterAnalyzer_Histogram : function(i_raster_format, i_vertical_interval)
  {
    if(!this.initInstance(i_raster_format,i_vertical_interval)){
      throw new NyARException();
    }
  }
  ,initInstance : function(i_raster_format,i_vertical_interval)
  {
    switch (i_raster_format) {
    case NyARBufferType.INT1D_GRAY_8:
      this._histImpl = new NyARRasterThresholdAnalyzer_Histogram_INT1D_GRAY_8();
      break;
    case NyARBufferType.INT1D_X8R8G8B8_32:
      this._histImpl = new NyARRasterThresholdAnalyzer_Histogram_INT1D_X8R8G8B8_32();
      break;
    default:
      return false;
    }
    //初期化
    this._vertical_skip=i_vertical_interval;
    return true;
  }
  ,setVerticalInterval : function(i_step)
  {
    this._vertical_skip=i_step;
    return;
  }
  /**
   * o_histgramにヒストグラムを出力します。
   * @param i_input
   * @param o_histgram
   * @return
   * @throws NyARException
   */
  ,analyzeRaster : function(i_input,o_histgram)
  {
    var size=i_input.getSize();
    //最大画像サイズの制限
    NyAS3Utils.assert(size.w*size.h<0x40000000);
    NyAS3Utils.assert(o_histgram.length == 256);//現在は固定
    var  h=o_histgram.data;
    //ヒストグラム初期化
    for (var i = o_histgram.length-1; i >=0; i--){
      h[i] = 0;
    }
    o_histgram.total_of_data=size.w*size.h/this._vertical_skip;
    return this._histImpl.createHistogram(i_input, size,h,this._vertical_skip);
  }
})
ICreateHistogramImpl = ASKlass('ICreateHistogramImpl',
{
  createHistogram : function(i_reader,i_size,o_histgram,i_skip){}
})

NyARRasterThresholdAnalyzer_Histogram_INT1D_GRAY_8 = ASKlass('NyARRasterThresholdAnalyzer_Histogram_INT1D_GRAY_8', ICreateHistogramImpl,
{
  createHistogram : function(i_reader,i_size,o_histgram,i_skip)
  {
    NyAS3Utils.assert (i_reader.isEqualBufferType(NyARBufferType.INT1D_GRAY_8));
    var input=(IntVector)(i_reader.getBuffer());
    for (var y = i_size.h-1; y >=0 ; y-=i_skip){
      var pt=y*i_size.w;
      for (var x = i_size.w-1; x >=0; x--) {
        o_histgram[input[pt]]++;
        pt++;
      }
    }
    return i_size.w*i_size.h;
  }
})
NyARRasterThresholdAnalyzer_Histogram_INT1D_X8R8G8B8_32 = ASKlass('NyARRasterThresholdAnalyzer_Histogram_INT1D_X8R8G8B8_32', ICreateHistogramImpl,
{
  createHistogram : function(i_reader,i_size,o_histgram,i_skip)
  {
    NyAS3Utils.assert (i_reader.isEqualBufferType(NyARBufferType.INT1D_X8R8G8B8_32));
    var input =(i_reader.getBuffer());
    for (var y = i_size.h-1; y >=0 ; y-=i_skip){
      var pt=y*i_size.w;
      for (var x = i_size.w-1; x >=0; x--) {
        var p=input[pt];
        o_histgram[((p& 0xff)+(p& 0xff)+(p& 0xff))/3]++;
        pt++;
      }
    }
    return i_size.w*i_size.h;
  }
})
INyARRasterThresholdAnalyzer = ASKlass('INyARRasterThresholdAnalyzer',
{
  analyzeRaster : function(i_input){}
})
NyARRasterThresholdAnalyzer_SlidePTile = ASKlass('NyARRasterThresholdAnalyzer_SlidePTile', INyARRasterThresholdAnalyzer,
{
  _raster_analyzer : null,
  _sptile : null,
  _histgram : null,
  NyARRasterThresholdAnalyzer_SlidePTile : function(i_persentage, i_raster_format, i_vertical_interval)
  {
    NyAS3Utils.assert (0 <= i_persentage && i_persentage <= 50);
    //初期化
    if(!this.initInstance(i_raster_format,i_vertical_interval)){
      throw new NyARException();
    }
    this._sptile=new NyARHistogramAnalyzer_SlidePTile(i_persentage);
    this._histgram=new NyARHistogram(256);
  }
  ,initInstance : function(i_raster_format,i_vertical_interval)
  {
    this._raster_analyzer=new NyARRasterAnalyzer_Histogram(i_raster_format,i_vertical_interval);
    return true;
  }
  ,setVerticalInterval : function(i_step)
  {
    this._raster_analyzer.setVerticalInterval(i_step);
    return;
  }
  ,analyzeRaster : function(i_input)
  {
    this._raster_analyzer.analyzeRaster(i_input, this._histgram);
    return this._sptile.getThreshold(this._histgram);
  }
})
/*
 * PROJECT: FLARToolKit
 * --------------------------------------------------------------------------------
 * This work is based on the NyARToolKit developed by
 *   R.Iizuka (nyatla)
 * http://nyatla.jp/nyatoolkit/
 *
 * The FLARToolKit is ActionScript 3.0 version ARToolkit class library.
 * Copyright (C)2008 Saqoosha
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  http://www.libspark.org/wiki/saqoosha/FLARToolKit
 *  <saq(at)saqoosha.net>
 *
 */
FLARRasterAnalyzer_Histogram = ASKlass('FLARRasterAnalyzer_Histogram', NyARRasterAnalyzer_Histogram,
{
  FLARRasterAnalyzer_Histogram : function(i_vertical_interval)
  {
    NyARRasterAnalyzer_Histogram.initialize.call(this,NyARBufferType.OBJECT_AS3_BitmapData,i_vertical_interval);
  }
  ,initInstance : function(i_raster_format,i_vertical_interval)
  {
    if (i_raster_format != NyARBufferType.OBJECT_AS3_BitmapData) {
      return false;
    }else {
      this._vertical_skip = i_vertical_interval;
    }
    return true;
  }
  /**
   * o_histgramにヒストグラムを出力します。
   * @param i_input
   * @param o_histgram
   * @return
   * @throws NyARException
   */
  ,analyzeRaster : function(i_input,o_histgram)
  {
    var size=i_input.getSize();
    //最大画像サイズの制限
    NyAS3Utils.assert(size.w*size.h<0x40000000);
    NyAS3Utils.assert(o_histgram.length == 256);//現在は固定
    var  h=o_histgram.data;
    //ヒストグラム初期化
    for (var i = o_histgram.length-1; i >=0; i--){
      h[i] = 0;
    }
    o_histgram.total_of_data=size.w*size.h/this._vertical_skip;
    return this.createHistgram_AS3_BitmapData(i_input, size,h,this._vertical_skip);
  }
  ,createHistgram_AS3_BitmapData : function(i_reader,i_size,o_histgram,i_skip)
  {
    //[Todo:]この方法だとパフォーマンスでないから、Bitmapdataの
    NyAS3Utils.assert (i_reader.isEqualBufferType(NyARBufferType.OBJECT_AS3_BitmapData));
    var input=(i_reader.getBuffer());
    for (var y = i_size.h-1; y >=0 ; y-=i_skip){
      var pt=y*i_size.w;
      for (var x = i_size.w - 1; x >= 0; x--) {
        var p=input.getPixel(x,y);
        o_histgram[toInt((((p>>8)&0xff)+((p>>16)&0xff)+(p&0xff))/3)]++;
        pt++;
      }
    }
    return i_size.w*i_size.h;
  }
})

/*
 * PROJECT: FLARToolKit
 * --------------------------------------------------------------------------------
 * This work is based on the NyARToolKit developed by
 *   R.Iizuka (nyatla)
 * http://nyatla.jp/nyatoolkit/
 *
 * The FLARToolKit is ActionScript 3.0 version ARToolkit class library.
 * Copyright (C)2008 Saqoosha
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  http://www.libspark.org/wiki/saqoosha/FLARToolKit
 *  <saq(at)saqoosha.net>
 *
 */
FLARRasterThresholdAnalyzer_SlidePTile = ASKlass('FLARRasterThresholdAnalyzer_SlidePTile', NyARRasterThresholdAnalyzer_SlidePTile,
{
  FLARRasterThresholdAnalyzer_SlidePTile : function(i_persentage, i_vertical_interval)
  {
    NyARRasterThresholdAnalyzer_SlidePTile.initialize.call(this,i_persentage, NyARBufferType.OBJECT_AS3_BitmapData,i_vertical_interval);
  }
  ,initInstance : function(i_raster_format,i_vertical_interval)
  {
    if (i_raster_format != NyARBufferType.OBJECT_AS3_BitmapData) {
      return false;
    }
    this._raster_analyzer=new FLARRasterAnalyzer_Histogram(i_vertical_interval);
    return true;
  }
})
/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */
INyARRasterFilter = ASKlass('INyARRasterFilter',
{
  doFilter : function(i_input,i_output){}
})
INyARRasterFilter_Gs2Bin = ASKlass('INyARRasterFilter_Gs2Bin',
{
  doFilter : function(i_input, i_output){}
})
INyARRasterFilter_Rgb2Gs = ASKlass('INyARRasterFilter_Rgb2Gs',
{
  doFilter : function(i_input,i_output){}
})
INyARRasterFilter_Rgb2Bin = ASKlass('INyARRasterFilter_Rgb2Bin',
{
  doFilter : function(i_input, i_output){}
})






/**
 * 定数閾値による2値化をする。
 *
 */
NyARRasterFilter_ARToolkitThreshold = ASKlass('NyARRasterFilter_ARToolkitThreshold', INyARRasterFilter_Rgb2Bin,
{
  _threshold : 0,
  _do_threshold_impl : null,
  NyARRasterFilter_ARToolkitThreshold : function(i_threshold, i_input_raster_type)
  {
    this._threshold = i_threshold;
    switch (i_input_raster_type) {
    case NyARBufferType.INT1D_X8R8G8B8_32:
      this._do_threshold_impl=new doThFilterImpl_BUFFERFORMAT_INT1D_X8R8G8B8_32();
      break;
    default:
      throw new NyARException();
    }
  }
  /**
   * 画像を２値化するための閾値。暗点&lt;=th&lt;明点となります。
   * @param i_threshold
   */
  ,setThreshold : function(i_threshold )
  {
    this._threshold = i_threshold;
  }
  ,doFilter : function(i_input,i_output)
  {
    NyAS3Utils.assert (i_output.isEqualBufferType(NyARBufferType.INT1D_BIN_8));
    NyAS3Utils.assert (i_input.getSize().isEqualSize_NyARIntSize(i_output.getSize()) == true);
    this._do_threshold_impl.doThFilter(i_input,i_output,i_output.getSize(), this._threshold);
    return;
  }
})





/*
 * ここから各ラスタ用のフィルタ実装
 */
IdoThFilterImpl = ASKlass('IdoThFilterImpl',
{
  doThFilter : function(i_input,i_output,i_size,i_threshold){},
})

doThFilterImpl_BUFFERFORMAT_INT1D_X8R8G8B8_32 = ASKlass('doThFilterImpl_BUFFERFORMAT_INT1D_X8R8G8B8_32', IdoThFilterImpl,
{
  doThFilter : function(i_input,i_output,i_size,i_threshold)
  {
    NyAS3Utils.assert (i_output.isEqualBufferType(NyARBufferType.INT1D_BIN_8));
    var out_buf = (IntVector)(i_output.getBuffer());
    var in_buf = (IntVector)(i_input.getBuffer());
    var th=i_threshold*3;
    var w;
    var xy;
    var pix_count=i_size.h*i_size.w;
    var pix_mod_part=pix_count-(pix_count%8);
    for(xy=pix_count-1;xy>=pix_mod_part;xy--){
      w=in_buf[xy];
      out_buf[xy]=(((w>>16)&0xff)+((w>>8)&0xff)+(w&0xff))<=th?0:1;
    }
    //タイリング
    for (;xy>=0;) {
      w=in_buf[xy];
      out_buf[xy]=(((w>>16)&0xff)+((w>>8)&0xff)+(w&0xff))<=th?0:1;
      xy--;
      w=in_buf[xy];
      out_buf[xy]=(((w>>16)&0xff)+((w>>8)&0xff)+(w&0xff))<=th?0:1;
      xy--;
      w=in_buf[xy];
      out_buf[xy]=(((w>>16)&0xff)+((w>>8)&0xff)+(w&0xff))<=th?0:1;
      xy--;
      w=in_buf[xy];
      out_buf[xy]=(((w>>16)&0xff)+((w>>8)&0xff)+(w&0xff))<=th?0:1;
      xy--;
      w=in_buf[xy];
      out_buf[xy]=(((w>>16)&0xff)+((w>>8)&0xff)+(w&0xff))<=th?0:1;
      xy--;
      w=in_buf[xy];
      out_buf[xy]=(((w>>16)&0xff)+((w>>8)&0xff)+(w&0xff))<=th?0:1;
      xy--;
      w=in_buf[xy];
      out_buf[xy]=(((w>>16)&0xff)+((w>>8)&0xff)+(w&0xff))<=th?0:1;
      xy--;
      w=in_buf[xy];
      out_buf[xy]=(((w>>16)&0xff)+((w>>8)&0xff)+(w&0xff))<=th?0:1;
      xy--;
    }
  }
})
/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */
NyARContourPickup = ASKlass('NyARContourPickup',
{
  //巡回参照できるように、テーブルを二重化
  //                                           0  1  2  3  4  5  6  7   0  1  2  3  4  5  6
  _getContour_xdir : new IntVector([0, 1, 1, 1, 0, -1, -1, -1 , 0, 1, 1, 1, 0, -1, -1]),
  _getContour_ydir : new IntVector([-1,-1, 0, 1, 1, 1, 0,-1 ,-1,-1, 0, 1, 1, 1, 0]),
  getContour_NyARBinRaster : function(i_raster,i_entry_x,i_entry_y,i_array_size,o_coord_x,o_coord_y)
  {
    return this.impl_getContour(i_raster,0,i_entry_x,i_entry_y,i_array_size,o_coord_x,o_coord_y);
  }
  /**
   *
   * @param i_raster
   * @param i_th
   * 画像を２値化するための閾値。暗点&lt;=i_th&lt;明点となります。
   * @param i_entry_x
   * 輪郭の追跡開始点を指定します。
   * @param i_entry_y
   * @param i_array_size
   * @param o_coord_x
   * @param o_coord_y
   * @return
   * @throws NyARException
   */
  ,getContour_NyARGrayscaleRaster : function(i_raster,i_th,i_entry_x,i_entry_y,i_array_size,o_coord_x,o_coord_y)
  {
    return this.impl_getContour(i_raster,i_th,i_entry_x,i_entry_y,i_array_size,o_coord_x,o_coord_y);
  }
  /**
   * ラスタのエントリポイントから辿れる輪郭線を配列に返します。
   * @param i_raster
   * @param i_th
   * 暗点<=th<明点
   * @param i_entry_x
   * @param i_entry_y
   * @param i_array_size
   * @param o_coord_x
   * @param o_coord_y
   * @return
   * 輪郭線の長さを返します。
   * @throws NyARException
   */
  ,impl_getContour : function(i_raster,i_th,i_entry_x,i_entry_y,i_array_size,o_coord_x,o_coord_y)
  {
    var xdir = this._getContour_xdir;// static int xdir[8] = { 0, 1, 1, 1, 0,-1,-1,-1};
    var ydir = this._getContour_ydir;// static int ydir[8] = {-1,-1, 0, 1, 1, 1, 0,-1};
    var i_buf=i_raster.getBuffer();
    var width=i_raster.getWidth();
    var height=i_raster.getHeight();
    //クリップ領域の上端に接しているポイントを得る。
    var coord_num = 1;
    o_coord_x[0] = i_entry_x;
    o_coord_y[0] = i_entry_y;
    var dir = 5;
    var c = i_entry_x;
    var r = i_entry_y;
    for (;;) {
      dir = (dir + 5) % 8;//dirの正規化
      //ここは頑張ればもっと最適化できると思うよ。
      //4隅以外の境界接地の場合に、境界チェックを省略するとかね。
      if(c>=1 && c<width-1 && r>=1 && r<height-1){
        for(;;){//gotoのエミュレート用のfor文
          //境界に接していないとき(暗点判定)
          if (i_buf[(r + ydir[dir])*width+(c + xdir[dir])] <= i_th) {
            break;
          }
          dir++;
          if (i_buf[(r + ydir[dir])*width+(c + xdir[dir])] <= i_th) {
            break;
          }
          dir++;
          if (i_buf[(r + ydir[dir])*width+(c + xdir[dir])] <= i_th) {
            break;
          }
          dir++;
          if (i_buf[(r + ydir[dir])*width+(c + xdir[dir])] <= i_th) {
            break;
          }
          dir++;
          if (i_buf[(r + ydir[dir])*width+(c + xdir[dir])] <= i_th) {
            break;
          }
          dir++;
          if (i_buf[(r + ydir[dir])*width+(c + xdir[dir])] <= i_th) {
            break;
          }
          dir++;
          if (i_buf[(r + ydir[dir])*width+(c + xdir[dir])] <= i_th) {
            break;
          }
          dir++;
          if (i_buf[(r + ydir[dir])*width+(c + xdir[dir])] <= i_th) {
            break;
          }
/*
          try{
            BufferedImage b=new BufferedImage(width,height,ColorSpace.TYPE_RGB);
            NyARRasterImageIO.copy(i_raster, b);
          ImageIO.write(b,"png",new File("bug.png"));
          }catch(Exception e){
          }*/
          //8方向全て調べたけどラベルが無いよ？
          throw new NyARException();
        }
      }else{
        //境界に接しているとき
        var i;
        for (i = 0; i < 8; i++){
          var x=c + xdir[dir];
          var y=r + ydir[dir];
          //境界チェック
          if(x>=0 && x<width && y>=0 && y<height){
            if (i_buf[(y)*width+(x)] <= i_th) {
              break;
            }
          }
          dir++;//倍長テーブルを参照するので問題なし
        }
        if (i == 8) {
          //8方向全て調べたけどラベルが無いよ？
          throw new NyARException();// return(-1);
        }
      }
      dir=dir% 8;//dirの正規化
      // xcoordとycoordをc,rにも保存
      c = c + xdir[dir];
      r = r + ydir[dir];
      o_coord_x[coord_num] = c;
      o_coord_y[coord_num] = r;
      // 終了条件判定
      if (c == i_entry_x && r == i_entry_y){
        coord_num++;
        break;
      }
      coord_num++;
      if (coord_num == i_array_size) {
        //輪郭が末端に達した
        return coord_num;
      }
    }
    return coord_num;
  }
})
NyARCoord2Linear = ASKlass('NyARCoord2Linear',
{
  _xpos : null,
  _ypos : null,
  _pca : null,
  __getSquareLine_evec : new NyARDoubleMatrix22(),
  __getSquareLine_mean : new FloatVector(2),
  __getSquareLine_ev : new FloatVector(2),
  _dist_factor : null,
  NyARCoord2Linear : function(i_size,i_distfactor_ref)
  {
    //歪み計算テーブルを作ると、8*width/height*2の領域を消費します。
    //領域を取りたくない場合は、i_dist_factor_refの値をそのまま使ってください。
    this._dist_factor = new NyARObserv2IdealMap(i_distfactor_ref,i_size);
    // 輪郭バッファ
    this._pca=new NyARPca2d_MatrixPCA_O2();
    this._xpos=new FloatVector(i_size.w+i_size.h);//最大辺長はthis._width+this._height
    this._ypos=new FloatVector(i_size.w+i_size.h);//最大辺長はthis._width+this._height
    return;
  }
  /**
   * 輪郭点集合からay+bx+c=0の直線式を計算します。
   * @param i_st
   * @param i_ed
   * @param i_xcoord
   * @param i_ycoord
   * @param i_cood_num
   * @param o_line
   * @return
   * @throws NyARException
   */
  ,coord2Line : function(i_st,i_ed,i_xcoord,i_ycoord,i_cood_num,o_line)
  {
    //頂点を取得
    var n,st,ed;
    var w1;
    //探索区間の決定
    if(i_ed>=i_st){
      //頂点[i]から頂点[i+1]までの輪郭が、1区間にあるとき
      w1 = (i_ed - i_st + 1) * 0.05 + 0.5;
      //探索区間の決定
      st = Math.floor(i_st+w1);
      ed = Math.floor(i_ed - w1);
    }else{
      //頂点[i]から頂点[i+1]までの輪郭が、2区間に分かれているとき
      w1 = ((i_ed+i_cood_num-i_st+1)%i_cood_num) * 0.05 + 0.5;
      //探索区間の決定
      st = (Math.floor(i_st+w1))%i_cood_num;
      ed = (Math.floor(i_ed+i_cood_num-w1))%i_cood_num;
    }
    //探索区間数を確認
    if(st<=ed){
      //探索区間は1区間
      n = ed - st + 1;
      this._dist_factor.observ2IdealBatch(i_xcoord, i_ycoord, st, n,this._xpos,this._ypos,0);
    }else{
      //探索区間は2区間
      n=ed+1+i_cood_num-st;
      this._dist_factor.observ2IdealBatch(i_xcoord, i_ycoord, st,i_cood_num-st,this._xpos,this._ypos,0);
      this._dist_factor.observ2IdealBatch(i_xcoord, i_ycoord, 0,ed+1,this._xpos,this._ypos,i_cood_num-st);
    }
    //要素数の確認
    if (n < 2) {
      // nが2以下でmatrix.PCAを計算することはできないので、エラー
      return false;
    }
    //主成分分析する。
    var evec=this.__getSquareLine_evec;
    var mean=this.__getSquareLine_mean;
    this._pca.pca(this._xpos,this._ypos,n,evec, this.__getSquareLine_ev,mean);
    o_line.dy = evec.m01;// line[i][0] = evec->m[1];
    o_line.dx = -evec.m00;// line[i][1] = -evec->m[0];
    o_line.c = -(o_line.dy * mean[0] + o_line.dx * mean[1]);// line[i][2] = -(line[i][0]*mean->v[0] + line[i][1]*mean->v[1]);
    return true;
  }
})

/**
 * get_vertex関数を切り離すためのクラス
 *
 */
NyARVertexCounter = ASKlass('NyARVertexCounter',
{
  vertex : new IntVector(10),// 6まで削れる
  number_of_vertex : 0,
  thresh : 0,
  x_coord : null,
  y_coord : null,
  getVertex : function(i_x_coord, i_y_coord,i_coord_len,st,ed,i_thresh)
  {
    this.number_of_vertex = 0;
    this.thresh = i_thresh;
    this.x_coord = i_x_coord;
    this.y_coord = i_y_coord;
    return this.get_vertex(st, ed,i_coord_len);
  }
  /**
  * static int get_vertex( int x_coord[], int y_coord[], int st, int ed,double thresh, int vertex[], int *vnum) 関数の代替関数
  *
  * @param x_coord
  * @param y_coord
  * @param st
  * @param ed
  * @param thresh
  * @return
  */
  ,get_vertex : function(st,ed,i_coord_len)
  {
    var i;
    var d;
    //メモ:座標値は65536を超えなければint32で扱って大丈夫なので変更。
    //dmaxは4乗なのでやるとしてもint64じゃないとマズイ
    var v1 = 0;
    var lx_coord = this.x_coord;
    var ly_coord = this.y_coord;
    var a = ly_coord[ed] - ly_coord[st];
    var b = lx_coord[st] - lx_coord[ed];
    var c = lx_coord[ed] * ly_coord[st] - ly_coord[ed] * lx_coord[st];
    var dmax = 0;
    if(st<ed){
      //stとedが1区間
      for (i = st + 1; i < ed; i++) {
        d = a * lx_coord[i] + b * ly_coord[i] + c;
        if (d * d > dmax) {
          dmax = d * d;
          v1 = i;
        }
      }
    }else{
      //stとedが2区間
      for (i = st + 1; i < i_coord_len; i++) {
        d = a * lx_coord[i] + b * ly_coord[i] + c;
        if (d * d > dmax) {
          dmax = d * d;
          v1 = i;
        }
      }
      for (i = 0; i < ed; i++) {
        d = a * lx_coord[i] + b * ly_coord[i] + c;
        if (d * d > dmax) {
          dmax = d * d;
          v1 = i;
        }
      }
    }
    if (dmax / (a * a + b * b) > this.thresh) {
      if (!this.get_vertex(st, v1,i_coord_len)) {
        return false;
      }
      if (this.number_of_vertex > 5) {
        return false;
      }
      this.vertex[this.number_of_vertex] = v1;// vertex[(*vnum)] = v1;
      this.number_of_vertex++;// (*vnum)++;
      if (!this.get_vertex(v1, ed,i_coord_len)) {
        return false;
      }
    }
    return true;
  }
})

NyARCoord2SquareVertexIndexes = ASKlass('NyARCoord2SquareVertexIndexes',
{
  VERTEX_FACTOR : 1.0,// 線検出のファクタ
  __getSquareVertex_wv1 : new NyARVertexCounter(),
  __getSquareVertex_wv2 : new NyARVertexCounter(),
  NyARCoord2SquareVertexIndexes : function()
  {
    return;
  }
  /**
   * 座標集合から、頂点候補になりそうな場所を４箇所探して、そのインデクス番号を返します。
   * @param i_x_coord
   * @param i_y_coord
   * @param i_coord_num
   * @param i_area
   * @param o_vertex
   * @return
   */
  ,getVertexIndexes : function(i_x_coord ,i_y_coord,i_coord_num, i_area,o_vertex)
  {
    var wv1 = this.__getSquareVertex_wv1;
    var wv2 = this.__getSquareVertex_wv2;
    var vertex1_index=this.getFarPoint(i_x_coord,i_y_coord,i_coord_num,0);
    var prev_vertex_index=(vertex1_index+i_coord_num)%i_coord_num;
    var v1=this.getFarPoint(i_x_coord,i_y_coord,i_coord_num,vertex1_index);
    var thresh = (i_area / 0.75) * 0.01 * this.VERTEX_FACTOR;
    o_vertex[0] = vertex1_index;
    if (!wv1.getVertex(i_x_coord, i_y_coord,i_coord_num, vertex1_index, v1, thresh)) {
      return false;
    }
    if (!wv2.getVertex(i_x_coord, i_y_coord,i_coord_num, v1,prev_vertex_index, thresh)) {
      return false;
    }
    var v2;
    if (wv1.number_of_vertex == 1 && wv2.number_of_vertex == 1) {
      o_vertex[1] = wv1.vertex[0];
      o_vertex[2] = v1;
      o_vertex[3] = wv2.vertex[0];
    } else if (wv1.number_of_vertex > 1 && wv2.number_of_vertex == 0) {
      //頂点位置を、起点から対角点の間の1/2にあると予想して、検索する。
      if(v1>=vertex1_index){
        v2 = (v1-vertex1_index)/2+vertex1_index;
      }else{
        v2 = ((v1+i_coord_num-vertex1_index)/2+vertex1_index)%i_coord_num;
      }
      if (!wv1.getVertex(i_x_coord, i_y_coord,i_coord_num, vertex1_index, v2, thresh)) {
        return false;
      }
      if (!wv2.getVertex(i_x_coord, i_y_coord,i_coord_num, v2, v1, thresh)) {
        return false;
      }
      if (wv1.number_of_vertex == 1 && wv2.number_of_vertex == 1) {
        o_vertex[1] = wv1.vertex[0];
        o_vertex[2] = wv2.vertex[0];
        o_vertex[3] = v1;
      } else {
        return false;
      }
    } else if (wv1.number_of_vertex == 0 && wv2.number_of_vertex > 1) {
      //v2 = (v1+ end_of_coord)/2;
      if(v1<=prev_vertex_index){
        v2 = (v1+prev_vertex_index)/2;
      }else{
        v2 = ((v1+i_coord_num+prev_vertex_index)/2)%i_coord_num;
      }
      if (!wv1.getVertex(i_x_coord, i_y_coord,i_coord_num, v1, v2, thresh)) {
        return false;
      }
      if (!wv2.getVertex(i_x_coord, i_y_coord,i_coord_num, v2, prev_vertex_index, thresh)) {
        return false;
      }
      if (wv1.number_of_vertex == 1 && wv2.number_of_vertex == 1) {
        o_vertex[1] = v1;
        o_vertex[2] = wv1.vertex[0];
        o_vertex[3] = wv2.vertex[0];
      } else {
        return false;
      }
    } else {
      return false;
    }
    return true;
  }
  /**
   * i_pointの輪郭座標から、最も遠方にある輪郭座標のインデクスを探します。
   * @param i_xcoord
   * @param i_ycoord
   * @param i_coord_num
   * @return
   */
  ,getFarPoint : function(i_coord_x,i_coord_y,i_coord_num,i_point)
  {
    //
    var sx = i_coord_x[i_point];
    var sy = i_coord_y[i_point];
    var d = 0;
    var w, x, y;
    var ret = 0;
    var i;
    for (i = i_point+1; i < i_coord_num; i++) {
      x = i_coord_x[i] - sx;
      y = i_coord_y[i] - sy;
      w = x * x + y * y;
      if (w > d) {
        d = w;
        ret = i;
      }
    }
    for (i= 0; i < i_point; i++) {
      x = i_coord_x[i] - sx;
      y = i_coord_y[i] - sy;
      w = x * x + y * y;
      if (w > d) {
        d = w;
        ret = i;
      }
    }
    return ret;
  }
})


/**
 * ARMarkerInfoに相当するクラス。 矩形情報を保持します。
 *
 */
NyARSquare = ASKlass('NyARSquare',
{
  line : NyARLinear.createArray(4),
  sqvertex : NyARDoublePoint2d.createArray(4),
  getCenter2d : function(o_out)
  {
    o_out.x=(this.sqvertex[0].x+this.sqvertex[1].x+this.sqvertex[2].x+this.sqvertex[3].x)/4;
    o_out.y=(this.sqvertex[0].y+this.sqvertex[1].y+this.sqvertex[2].y+this.sqvertex[3].y)/4;
    return;
  }
})
NyARSquareContourDetector = ASKlass('NyARSquareContourDetector',
{
  /**
   *
   * @param i_raster
   * @param i_callback
   * @throws NyARException
   */
  detectMarkerCB : function(i_raster, i_callback)
  {
    NyARException.trap("getRgbPixelReader not implemented.");
  }
})
NyARSquareContourDetector_IDetectMarkerCallback = ASKlass('NyARSquareContourDetector_IDetectMarkerCallback',
{
  onSquareDetect : function(i_sender,i_coordx,i_coordy,i_coor_num,i_vertex_index){}
})
RleLabelOverlapChecker = ASKlass('RleLabelOverlapChecker', NyARLabelOverlapChecker,
{
  RleLabelOverlapChecker : function(i_max_label)
  {
    NyARLabelOverlapChecker.initialize.call(this,i_max_label);
  }
  ,createArray : function(i_length)
  {
    return new Array(i_length);
  }
})
NyARSquareContourDetector_Rle = ASKlass('NyARSquareContourDetector_Rle', NyARSquareContourDetector,
{
  AR_AREA_MAX : 100000,// #define AR_AREA_MAX 100000
  AR_AREA_MIN : 70,// #define AR_AREA_MIN 70
  _width : 0,
  _height : 0,
  _labeling : null,
  _overlap_checker : new RleLabelOverlapChecker(32),
  _cpickup : new NyARContourPickup(),
  _stack : null,
  _coord2vertex : new NyARCoord2SquareVertexIndexes(),
  _max_coord : 0,
  _xcoord : null,
  _ycoord : null,
  /**
   * 最大i_squre_max個のマーカーを検出するクラスを作成する。
   *
   * @param i_param
   */
  NyARSquareContourDetector_Rle : function(i_size)
  {
    this._width = i_size.w;
    this._height = i_size.h;
    //ラベリングのサイズを指定したいときはsetAreaRangeを使ってね。
    this._labeling = new NyARLabeling_Rle(this._width,this._height);
    this._labeling.setAreaRange(this.AR_AREA_MAX, this.AR_AREA_MIN);
    this._stack=new NyARRleLabelFragmentInfoStack(i_size.w*i_size.h*2048/(320*240)+32);//検出可能な最大ラベル数
    // 輪郭の最大長は画面に映りうる最大の長方形サイズ。
    var number_of_coord= (this._width + this._height) * 2;
    // 輪郭バッファ
    this._max_coord = number_of_coord;
    this._xcoord = new IntVector(number_of_coord);
    this._ycoord = new IntVector(number_of_coord);
    return;
  },
  __detectMarker_mkvertex : new IntVector(4)
  ,detectMarkerCB : function(i_raster ,i_callback)
  {
    var flagment=this._stack;
    var overlap = this._overlap_checker;
    // ラベル数が0ならここまで
    var label_num=this._labeling.labeling_NyARBinRaster(i_raster, 0, i_raster.getHeight(), flagment);
    if (label_num < 1) {
      return;
    }
    //ラベルをソートしておく
    flagment.sortByArea();
    //ラベルリストを取得
    var labels=(flagment.getArray());
    var xsize = this._width;
    var ysize = this._height;
    var xcoord = this._xcoord;
    var ycoord = this._ycoord;
    var coord_max = this._max_coord;
    var mkvertex =this.__detectMarker_mkvertex;
    //重なりチェッカの最大数を設定
    overlap.setMaxLabels(label_num);
    for (var i=0; i < label_num; i++) {
      var label_pt=labels[i];
      var label_area = label_pt.area;
      // クリップ領域が画面の枠に接していれば除外
      if (label_pt.clip_l == 0 || label_pt.clip_r == xsize-1){
        continue;
      }
      if (label_pt.clip_t == 0 || label_pt.clip_b == ysize-1){
        continue;
      }
      // 既に検出された矩形との重なりを確認
      if (!overlap.check(label_pt)) {
        // 重なっているようだ。
        continue;
      }
      //輪郭を取得
      var coord_num = _cpickup.getContour_NyARBinRaster(i_raster,label_pt.entry_x,label_pt.clip_t, coord_max, xcoord, ycoord);
      if (coord_num == coord_max) {
        // 輪郭が大きすぎる。
        continue;
      }
      //輪郭線をチェックして、矩形かどうかを判定。矩形ならばmkvertexに取得
      if (!this._coord2vertex.getVertexIndexes(xcoord, ycoord,coord_num,label_area, mkvertex)) {
        // 頂点の取得が出来なかった
        continue;
      }
      //矩形を発見したことをコールバック関数で通知
      i_callback.onSquareDetect(this,xcoord,ycoord,coord_num,mkvertex);
      // 検出済の矩形の属したラベルを重なりチェックに追加する。
      overlap.push(label_pt);
    }
    return;
  }
})
NyARSquareStack = ASKlass('NyARSquareStack', NyARObjectStack,
{
  NyARSquareStack : function(i_length)
  {
    NyARObjectStack.initialize.call(this,i_length);
  }
  ,createArray : function(i_length)
  {
    var ret= new Array(i_length);
    for (var i =0; i < i_length; i++){
      ret[i] = new NyARSquare();
    }
    return (ret);
  }
})
/*
 * PROJECT: FLARToolKit
 * --------------------------------------------------------------------------------
 * This work is based on the NyARToolKit developed by
 *   R.Iizuka (nyatla)
 * http://nyatla.jp/nyatoolkit/
 *
 * The FLARToolKit is ActionScript 3.0 version ARToolkit class library.
 * Copyright (C)2008 Saqoosha
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  http://www.libspark.org/wiki/saqoosha/FLARToolKit
 *  <saq(at)saqoosha.net>
 *
 */
FLARSquare = NyARSquare;
Cxdir = new IntVector([0,1,1,1,0,-1,-1,-1]);
Cydir = new IntVector([-1,-1,0,1,1,1,0,-1]);
FLContourPickup = ASKlass('FLContourPickup', NyARContourPickup,
{
  FLContourPickup : function()
  {
  }
  ,getContour_FLARBinRaster : function(i_raster,i_entry_x,i_entry_y,i_array_size,o_coord_x,o_coord_y)
  {
    var xdir = this._getContour_xdir;// static int xdir[8] = { 0, 1, 1, 1, 0,-1,-1,-1};
    var ydir = this._getContour_ydir;// static int ydir[8] = {-1,-1, 0, 1, 1, 1, 0,-1};
    var i_buf=i_raster.getBuffer();
    var width=i_raster.getWidth();
    var height=i_raster.getHeight();
    //クリップ領域の上端に接しているポイントを得る。
    var coord_num = 1;
    o_coord_x[0] = i_entry_x;
    o_coord_y[0] = i_entry_y;
    var dir = 5;
    var c = i_entry_x;
    var r = i_entry_y;
    for (;;) {
      dir = (dir + 5) % 8;//dirの正規化
      //ここは頑張ればもっと最適化できると思うよ。
      //4隅以外の境界接地の場合に、境界チェックを省略するとかね。
      if(c>=1 && c<width-1 && r>=1 && r<height-1){
        for(;;){//gotoのエミュレート用のfor文
          //境界に接していないとき(暗点判定)
          if (i_buf.getPixel(c + xdir[dir], r + ydir[dir]) >0) {
            break;
          }
          dir++;
          if (i_buf.getPixel(c + xdir[dir], r + ydir[dir]) >0) {
            break;
          }
          dir++;
          if (i_buf.getPixel(c + xdir[dir], r + ydir[dir]) >0) {
            break;
          }
          dir++;
          if (i_buf.getPixel(c + xdir[dir], r + ydir[dir]) >0) {
            break;
          }
          dir++;
          if (i_buf.getPixel(c + xdir[dir], r + ydir[dir]) >0) {
            break;
          }
          dir++;
          if (i_buf.getPixel(c + xdir[dir], r + ydir[dir]) >0) {
            break;
          }
          dir++;
          if (i_buf.getPixel(c + xdir[dir], r + ydir[dir]) >0) {
            break;
          }
          dir++;
          if (i_buf.getPixel(c + xdir[dir], r + ydir[dir]) >0) {
            break;
          }
          //8方向全て調べたけどラベルが無いよ？
          return -1;
        }
      }else{
        //境界に接しているとき
        var i;
        for (i = 0; i < 8; i++){
          var x=c + xdir[dir];
          var y=r + ydir[dir];
          //境界チェック
          if(x>=0 && x<width && y>=0 && y<height){
            if (i_buf.getPixel(y, x) >0) {
              break;
            }
          }
          dir++;//倍長テーブルを参照するので問題なし
        }
        if (i == 8) {
          //8方向全て調べたけどラベルが無いよ？
          return -1;
        }
      }
      dir=dir% 8;//dirの正規化
      // xcoordとycoordをc,rにも保存
      c = c + xdir[dir];
      r = r + ydir[dir];
      o_coord_x[coord_num] = c;
      o_coord_y[coord_num] = r;
      // 終了条件判定
      if (c == i_entry_x && r == i_entry_y){
        coord_num++;
        break;
      }
      coord_num++;
      if (coord_num == i_array_size) {
        //輪郭が末端に達した
        return coord_num;
      }
    }
    return coord_num;
  }
})

FLARSquareContourDetector = ASKlass('FLARSquareContourDetector', NyARSquareContourDetector,
{
  AR_AREA_MAX : 100000// #define AR_AREA_MAX 100000
  ,AR_AREA_MIN : 70// #define AR_AREA_MIN 70
  ,_width : 0
  ,_height : 0
  ,_labeling : null
  ,_overlap_checker : new NyARLabelOverlapChecker(32)
  ,_cpickup : new FLContourPickup()
  ,_stack : null
  ,_coord2vertex : new NyARCoord2SquareVertexIndexes()
  ,_max_coord : 0
  ,_xcoord : null
  ,_ycoord : null
  /**
   * 最大i_squre_max個のマーカーを検出するクラスを作成する。
   *
   * @param i_param
   */
  ,FLARSquareContourDetector : function(i_size)
  {
    this._width = i_size.w;
    this._height = i_size.h;
    //ラベリングのサイズを指定したいときはsetAreaRangeを使ってね。
    this._labeling = new NyARLabeling_Rle(this._width,this._height);
    this._stack=new NyARRleLabelFragmentInfoStack(i_size.w*i_size.h*2048/(320*240)+32);//検出可能な最大ラベル数
    // 輪郭の最大長は画面に映りうる最大の長方形サイズ。
    var number_of_coord= (this._width + this._height) * 2;
    // 輪郭バッファ
    this._max_coord = number_of_coord;
    this._xcoord = new IntVector(number_of_coord);
    this._ycoord = new IntVector(number_of_coord);
    return;
  }
  /**
   * 白領域の検査対象サイズ
   *  最大サイズは 一辺約320px、最小サイズは 一辺約 8px まで解析対象としている
   *  解析画像中で上記範囲内であれば解析対象となるが、最小サイズは小さすぎて意味をなさない。
   *
   * @param i_max 解析対象とする白領域の最大pixel数(一辺の二乗)
   * @param i_min 解析対象とする白領域の最小pixel数(一辺の二乗)
   */
  ,setAreaRange : function(i_max, i_min)
  {
    this._labeling.setAreaRange(i_max, i_min);
  }
  ,__detectMarker_mkvertex : new IntVector(4)
  ,detectMarkerCB : function(i_raster ,i_callback)
  {
    var flagment=this._stack;
    var overlap = this._overlap_checker;
    // ラベル数が0ならここまで
    var label_num=this._labeling.labeling(i_raster, flagment);
    if (label_num < 1) {
      return;
    }
    //ラベルをソートしておく
    flagment.sortByArea();
    //ラベルリストを取得
    var labels=flagment.getArray();
    var xsize = this._width;
    var ysize = this._height;
    var xcoord = this._xcoord;
    var ycoord = this._ycoord;
    var coord_max = this._max_coord;
    var mkvertex =this.__detectMarker_mkvertex;
    //重なりチェッカの最大数を設定
    overlap.setMaxLabels(label_num);
    for (var i=0; i < label_num; i++) {
      var label_pt=labels[i];
      var label_area = label_pt.area;
      // クリップ領域が画面の枠に接していれば除外
      if (label_pt.clip_l == 0 || label_pt.clip_r == xsize-1){
        continue;
      }
      if (label_pt.clip_t == 0 || label_pt.clip_b == ysize-1){
        continue;
      }
      // 既に検出された矩形との重なりを確認
      if (!overlap.check(label_pt)) {
        // 重なっているようだ。
        continue;
      }
      if (window.DEBUG) {
        var cv = document.getElementById('debugCanvas').getContext('2d');
        cv.strokeStyle = 'red';
        cv.strokeRect(label_pt.clip_l, label_pt.clip_t, label_pt.clip_r-label_pt.clip_l, label_pt.clip_b-label_pt.clip_t);
        cv.fillStyle = 'red';
        cv.fillRect(label_pt.entry_x-1, label_pt.clip_t-1, 3,3);
        cv.fillStyle = 'cyan';
        cv.fillRect(label_pt.pos_x-1, label_pt.pos_y-1, 3,3);
      }
      //輪郭を取得
      var coord_num = this._cpickup.getContour_FLARBinRaster(i_raster,label_pt.entry_x,label_pt.clip_t, coord_max, xcoord, ycoord);
      if (coord_num == -1) return -1;
      if (coord_num == coord_max) {
        // 輪郭が大きすぎる。
        continue;
      }
      //輪郭線をチェックして、矩形かどうかを判定。矩形ならばmkvertexに取得
      var v = this._coord2vertex.getVertexIndexes(xcoord, ycoord,coord_num,label_area, mkvertex);
      if (!v) {
        // 頂点の取得が出来なかった
        continue;
      }
      //矩形を発見したことをコールバック関数で通知
      i_callback.onSquareDetect(this,xcoord,ycoord,coord_num,mkvertex);
      // 検出済の矩形の属したラベルを重なりチェックに追加する。
      overlap.push(label_pt);
    }
    return;
  }
})

/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */


/**
 * This class calculates ARMatrix from square information. -- 変換行列を計算するクラス。
 *
 */
INyARTransMat = Klass( {
  transMat : function(i_square,i_offset, o_result ){},
  transMatContinue : function(i_square,i_offset ,io_result_conv){}
})

/**
 * 矩形の頂点情報を格納します。
 */
NyARRectOffset = ASKlass('NyARRectOffset', {

  vertex : NyARDoublePoint3d.createArray(4),
  createArray : function(i_number)
  {
    var ret=new Array(i_number);
    for(var i=0;i<i_number;i++)
    {
      ret[i]=new NyARRectOffset();
    }
    return ret;
  },

  /**
  * 中心位置と辺長から、オフセット情報を作成して設定する。
  * @param i_width
  */
  setSquare : function(i_width)
  {
    var w_2 = i_width / 2.0;
    var vertex3d_ptr;
    vertex3d_ptr= this.vertex[0];
    vertex3d_ptr.x = -w_2;
    vertex3d_ptr.y =  w_2;
    vertex3d_ptr.z = 0.0;
    vertex3d_ptr= this.vertex[1];
    vertex3d_ptr.x = w_2;
    vertex3d_ptr.y = w_2;
    vertex3d_ptr.z = 0.0;
    vertex3d_ptr= this.vertex[2];
    vertex3d_ptr.x =  w_2;
    vertex3d_ptr.y = -w_2;
    vertex3d_ptr.z = 0.0;
    vertex3d_ptr= this.vertex[3];
    vertex3d_ptr.x = -w_2;
    vertex3d_ptr.y = -w_2;
    vertex3d_ptr.z = 0.0;
    return;
  }
})







/**
 * This class calculates ARMatrix from square information and holds it. --
 * 変換行列を計算して、結果を保持するクラス。
 *
 */
NyARTransMat = ASKlass('NyARTransMat',INyARTransMat,
{
  _projection_mat_ref : null,
  _rotmatrix : null,
  _transsolver : null,
  _mat_optimize : null,
  _ref_dist_factor : null,
  NyARTransMat : function(i_param)
  {
    var dist=i_param.getDistortionFactor();
    var pmat=i_param.getPerspectiveProjectionMatrix();
    this._transsolver=new NyARTransportVectorSolver(pmat,4);
    //互換性が重要な時は、NyARRotMatrix_ARToolKitを使うこと。
    //理屈はNyARRotMatrix_NyARToolKitもNyARRotMatrix_ARToolKitも同じだけど、少しだけ値がずれる。
    this._rotmatrix = new NyARRotMatrix(pmat);
    this._mat_optimize=new NyARPartialDifferentiationOptimize(pmat);
    this._ref_dist_factor=dist;
    this._projection_mat_ref=pmat;
    this.__transMat_vertex_2d = NyARDoublePoint2d.createArray(4);
    this.__transMat_vertex_3d = NyARDoublePoint3d.createArray(4);
    this.__transMat_trans = new NyARDoublePoint3d();
    this.__rot=new NyARDoubleMatrix33();
  },
  /**
   * 頂点情報を元に、エラー閾値を計算します。
   * @param i_vertex
   */
  makeErrThreshold : function(i_vertex)
  {
    var a,b,l1,l2;
    a=i_vertex[0].x-i_vertex[2].x;
    b=i_vertex[0].y-i_vertex[2].y;
    l1=a*a+b*b;
    a=i_vertex[1].x-i_vertex[3].x;
    b=i_vertex[1].y-i_vertex[3].y;
    l2=a*a+b*b;
    return (Math.sqrt(l1>l2?l1:l2))/200;
  },
  /**
   * double arGetTransMat( ARMarkerInfo *marker_info,double center[2], double width, double conv[3][4] )
   *
   * @param i_square
   * 計算対象のNyARSquareオブジェクト
   * @param i_direction
   * @param i_width
   * @return
   * @throws NyARException
   */
  transMat : function(i_square,i_offset,o_result_conv)
  {
    var trans=this.__transMat_trans;
    var err_threshold=this.makeErrThreshold(i_square.sqvertex);
    //平行移動量計算機に、2D座標系をセット
    var vertex_2d=this.__transMat_vertex_2d;
    var vertex_3d=this.__transMat_vertex_3d;
    this._ref_dist_factor.ideal2ObservBatch(i_square.sqvertex, vertex_2d,4);
    this._transsolver.set2dVertex(vertex_2d,4);
    //回転行列を計算
    this._rotmatrix.initRotBySquare(i_square.line,i_square.sqvertex);
    //回転後の3D座標系から、平行移動量を計算
    this._rotmatrix.getPoint3dBatch(i_offset.vertex,vertex_3d,4);
    this._transsolver.solveTransportVector(vertex_3d,trans);
    //計算結果の最適化(平行移動量と回転行列の最適化)
    o_result_conv.error=this.optimize(this._rotmatrix, trans, this._transsolver,i_offset.vertex, vertex_2d,err_threshold);
    // マトリクスの保存
    this.updateMatrixValue(this._rotmatrix, trans,o_result_conv);
    return;
  },
  /*
   * (non-Javadoc)
   * @see jp.nyatla.nyartoolkit.core.transmat.INyARTransMat#transMatContinue(jp.nyatla.nyartoolkit.core.NyARSquare, int, double, jp.nyatla.nyartoolkit.core.transmat.NyARTransMatResult)
   */
  transMatContinue : function(i_square,i_offset,o_result_conv)
  {
    var trans=this.__transMat_trans;
    // io_result_convが初期値なら、transMatで計算する。
    if (!o_result_conv.has_value) {
      this.transMat(i_square,i_offset, o_result_conv);
      return;
    }
    //最適化計算の閾値を決定
    var err_threshold=this.makeErrThreshold(i_square.sqvertex);
    //平行移動量計算機に、2D座標系をセット
    var vertex_2d=this.__transMat_vertex_2d;
    var vertex_3d=this.__transMat_vertex_3d;
    this._ref_dist_factor.ideal2ObservBatch(i_square.sqvertex, vertex_2d,4);
    this._transsolver.set2dVertex(vertex_2d,4);
    //回転行列を計算
    this._rotmatrix.initRotByPrevResult(o_result_conv);
    //回転後の3D座標系から、平行移動量を計算
    this._rotmatrix.getPoint3dBatch(i_offset.vertex,vertex_3d,4);
    this._transsolver.solveTransportVector(vertex_3d,trans);
    //現在のエラーレートを計算しておく
    var min_err=this.errRate(this._rotmatrix,trans,i_offset.vertex, vertex_2d,4,vertex_3d);
    var rot=this.__rot;
    //エラーレートが前回のエラー値より閾値分大きかったらアゲイン
    if(min_err<o_result_conv.error+err_threshold){
      rot.setValue_NyARDoubleMatrix33(this._rotmatrix);
      //最適化してみる。
      for (var i = 0;i<5; i++) {
        //変換行列の最適化
        this._mat_optimize.modifyMatrix(rot, trans, i_offset.vertex, vertex_2d, 4);
        var err=this.errRate(rot,trans,i_offset.vertex, vertex_2d,4,vertex_3d);
        //System.out.println("E:"+err);
        if(min_err-err<err_threshold/2){
          //System.out.println("BREAK");
          break;
        }
        this._transsolver.solveTransportVector(vertex_3d, trans);
        this._rotmatrix.setValue_NyARDoubleMatrix33(rot);
        min_err=err;
      }
      this.updateMatrixValue(this._rotmatrix,  trans,o_result_conv);
    }else{
      //回転行列を計算
      this._rotmatrix.initRotBySquare(i_square.line,i_square.sqvertex);
      //回転後の3D座標系から、平行移動量を計算
      this._rotmatrix.getPoint3dBatch(i_offset.vertex,vertex_3d,4);
      this._transsolver.solveTransportVector(vertex_3d,trans);
      //計算結果の最適化(平行移動量と回転行列の最適化)
      min_err=this.optimize(this._rotmatrix, trans, this._transsolver,i_offset.vertex, vertex_2d,err_threshold);
      this.updateMatrixValue(this._rotmatrix, trans,o_result_conv);
    }
    o_result_conv.error=min_err;
    return;
  },

  optimize : function(io_rotmat,io_transvec,i_solver,i_offset_3d,i_2d_vertex,i_err_threshold)
  {
    //System.out.println("START");
    var vertex_3d=this.__transMat_vertex_3d;
    //初期のエラー値を計算
    var min_err=this.errRate(io_rotmat, io_transvec, i_offset_3d, i_2d_vertex,4,vertex_3d);
    var rot=this.__rot;
    rot.setValue_NyARDoubleMatrix33(io_rotmat);
    for (var i = 0;i<5; i++) {
      //変換行列の最適化
      this._mat_optimize.modifyMatrix(rot, io_transvec, i_offset_3d, i_2d_vertex, 4);
      var err=this.errRate(rot,io_transvec, i_offset_3d, i_2d_vertex,4,vertex_3d);
      //System.out.println("E:"+err);
      if(min_err-err<i_err_threshold){
        //System.out.println("BREAK");
        break;
      }
      i_solver.solveTransportVector(vertex_3d, io_transvec);
      io_rotmat.setValue_NyARDoubleMatrix33(rot);
      min_err=err;
    }
    //System.out.println("END");
    return min_err;
  },
  //エラーレート計算機
  errRate : function(io_rot,i_trans,i_vertex3d,i_vertex2d,i_number_of_vertex,o_rot_vertex)
  {
    var cp = this._projection_mat_ref;
    var cp00=cp.m00;
    var cp01=cp.m01;
    var cp02=cp.m02;
    var cp11=cp.m11;
    var cp12=cp.m12;
    var err=0;
    for(var i=0;i<i_number_of_vertex;i++){
      var x3d,y3d,z3d;
      o_rot_vertex[i].x=x3d=io_rot.m00*i_vertex3d[i].x+io_rot.m01*i_vertex3d[i].y+io_rot.m02*i_vertex3d[i].z;
      o_rot_vertex[i].y=y3d=io_rot.m10*i_vertex3d[i].x+io_rot.m11*i_vertex3d[i].y+io_rot.m12*i_vertex3d[i].z;
      o_rot_vertex[i].z=z3d=io_rot.m20*i_vertex3d[i].x+io_rot.m21*i_vertex3d[i].y+io_rot.m22*i_vertex3d[i].z;
      x3d+=i_trans.x;
      y3d+=i_trans.y;
      z3d+=i_trans.z;
      //射影変換
      var x2d=x3d*cp00+y3d*cp01+z3d*cp02;
      var y2d=y3d*cp11+z3d*cp12;
      var h2d=z3d;
      //エラーレート計算
      var t1=i_vertex2d[i].x-x2d/h2d;
      var t2=i_vertex2d[i].y-y2d/h2d;
      err+=t1*t1+t2*t2;
    }
    return err/i_number_of_vertex;
  },
  /**
   * パラメータで変換行列を更新します。
   *
   * @param i_rot
   * @param i_off
   * @param i_trans
   */
  updateMatrixValue : function(i_rot,i_trans,o_result)
  {
    o_result.m00=i_rot.m00;
    o_result.m01=i_rot.m01;
    o_result.m02=i_rot.m02;
    o_result.m03=i_trans.x;
    o_result.m10 =i_rot.m10;
    o_result.m11 =i_rot.m11;
    o_result.m12 =i_rot.m12;
    o_result.m13 =i_trans.y;
    o_result.m20 = i_rot.m20;
    o_result.m21 = i_rot.m21;
    o_result.m22 = i_rot.m22;
    o_result.m23 = i_trans.z;
    o_result.has_value = true;
    return;
  }
})


NyARTransMatResult = ASKlass('NyARTransMatResult', NyARDoubleMatrix34,
{
  /**
   * エラーレート。この値はINyARTransMatの派生クラスが使います。
   */
  error : 0,
  has_value : false,
  /**
   * この関数は、0-PIの間で値を返します。
   * @param o_out
   */
  getZXYAngle : function(o_out)
  {
    var sina = this.m21;
    if (sina >= 1.0) {
      o_out.x = Math.PI / 2;
      o_out.y = 0;
      o_out.z = Math.atan2(-this.m10, this.m00);
    } else if (sina <= -1.0) {
      o_out.x = -Math.PI / 2;
      o_out.y = 0;
      o_out.z = Math.atan2(-this.m10, this.m00);
    } else {
      o_out.x = Math.asin(sina);
      o_out.z = Math.atan2(-this.m01, this.m11);
      o_out.y = Math.atan2(-this.m20, this.m22);
    }
  },
  transformVertex_Number : function(i_x,i_y,i_z,o_out)
  {
    o_out.x=this.m00*i_x+this.m01*i_y+this.m02*i_z+this.m03;
    o_out.y=this.m10*i_x+this.m11*i_y+this.m12*i_z+this.m13;
    o_out.z=this.m20*i_x+this.m21*i_y+this.m22*i_z+this.m23;
    return;
  },
  transformVertex_NyARDoublePoint3d : function(i_in,o_out)
  {
    this.transformVertex_Number(i_in.x,i_in.y,i_in.z,o_out);
  }
})





/**
 * 基本姿勢と実画像を一致するように、角度を微調整→平行移動量を再計算 を繰り返して、変換行列を最適化する。
 *
 */
NyARPartialDifferentiationOptimize = ASKlass('NyARPartialDifferentiationOptimize',
{
  _projection_mat_ref : null,
  NyARPartialDifferentiationOptimize : function(i_projection_mat_ref)
  {
    this._projection_mat_ref = i_projection_mat_ref;
    this.__angles_in=TSinCosValue.createArray(3);
    this.__ang=new NyARDoublePoint3d();
    this.__sin_table = new FloatVector(4);
    return;
  },
  sincos2Rotation_ZXY : function(i_sincos,i_rot_matrix)
  {
    var sina = i_sincos[0].sin_val;
    var cosa = i_sincos[0].cos_val;
    var sinb = i_sincos[1].sin_val;
    var cosb = i_sincos[1].cos_val;
    var sinc = i_sincos[2].sin_val;
    var cosc = i_sincos[2].cos_val;
    i_rot_matrix.m00 = cosc * cosb - sinc * sina * sinb;
    i_rot_matrix.m01 = -sinc * cosa;
    i_rot_matrix.m02 = cosc * sinb + sinc * sina * cosb;
    i_rot_matrix.m10 = sinc * cosb + cosc * sina * sinb;
    i_rot_matrix.m11 = cosc * cosa;
    i_rot_matrix.m12 = sinc * sinb - cosc * sina * cosb;
    i_rot_matrix.m20 = -cosa * sinb;
    i_rot_matrix.m21 = sina;
    i_rot_matrix.m22 = cosb * cosa;
  },
  rotation2Sincos_ZXY : function(i_rot_matrix,o_out,o_ang)
  {
    var x, y, z;
    var sina = i_rot_matrix.m21;
    if (sina >= 1.0) {
      x = Math.PI / 2;
      y = 0;
      z = Math.atan2(-i_rot_matrix.m10, i_rot_matrix.m00);
    } else if (sina <= -1.0) {
      x = -Math.PI / 2;
      y = 0;
      z = Math.atan2(-i_rot_matrix.m10, i_rot_matrix.m00);
    } else {
      x = Math.asin(sina);
      y = Math.atan2(-i_rot_matrix.m20, i_rot_matrix.m22);
      z = Math.atan2(-i_rot_matrix.m01, i_rot_matrix.m11);
    }
    o_ang.x=x;
    o_ang.y=y;
    o_ang.z=z;
    o_out[0].sin_val = Math.sin(x);
    o_out[0].cos_val = Math.cos(x);
    o_out[1].sin_val = Math.sin(y);
    o_out[1].cos_val = Math.cos(y);
    o_out[2].sin_val = Math.sin(z);
    o_out[2].cos_val = Math.cos(z);
    return;
  },
  /*
   * 射影変換式 基本式 ox=(cosc * cosb - sinc * sina * sinb)*ix+(-sinc * cosa)*iy+(cosc * sinb + sinc * sina * cosb)*iz+i_trans.x; oy=(sinc * cosb + cosc * sina *
   * sinb)*ix+(cosc * cosa)*iy+(sinc * sinb - cosc * sina * cosb)*iz+i_trans.y; oz=(-cosa * sinb)*ix+(sina)*iy+(cosb * cosa)*iz+i_trans.z;
   *
   * double ox=(cosc * cosb)*ix+(-sinc * sina * sinb)*ix+(-sinc * cosa)*iy+(cosc * sinb)*iz + (sinc * sina * cosb)*iz+i_trans.x; double oy=(sinc * cosb)*ix
   * +(cosc * sina * sinb)*ix+(cosc * cosa)*iy+(sinc * sinb)*iz+(- cosc * sina * cosb)*iz+i_trans.y; double oz=(-cosa * sinb)*ix+(sina)*iy+(cosb *
   * cosa)*iz+i_trans.z;
   *
   * sina,cosaについて解く cx=(cp00*(-sinc*sinb*ix+sinc*cosb*iz)+cp01*(cosc*sinb*ix-cosc*cosb*iz)+cp02*(iy))*sina
   * +(cp00*(-sinc*iy)+cp01*((cosc*iy))+cp02*(-sinb*ix+cosb*iz))*cosa
   * +(cp00*(i_trans.x+cosc*cosb*ix+cosc*sinb*iz)+cp01*((i_trans.y+sinc*cosb*ix+sinc*sinb*iz))+cp02*(i_trans.z));
   * cy=(cp11*(cosc*sinb*ix-cosc*cosb*iz)+cp12*(iy))*sina +(cp11*((cosc*iy))+cp12*(-sinb*ix+cosb*iz))*cosa
   * +(cp11*((i_trans.y+sinc*cosb*ix+sinc*sinb*iz))+cp12*(i_trans.z)); ch=(iy)*sina +(-sinb*ix+cosb*iz)*cosa +i_trans.z; sinb,cosb hx=(cp00*(-sinc *
   * sina*ix+cosc*iz)+cp01*(cosc * sina*ix+sinc*iz)+cp02*(-cosa*ix))*sinb +(cp01*(sinc*ix-cosc * sina*iz)+cp00*(cosc*ix+sinc * sina*iz)+cp02*(cosa*iz))*cosb
   * +(cp00*(i_trans.x+(-sinc*cosa)*iy)+cp01*(i_trans.y+(cosc * cosa)*iy)+cp02*(i_trans.z+(sina)*iy)); double hy=(cp11*(cosc *
   * sina*ix+sinc*iz)+cp12*(-cosa*ix))*sinb +(cp11*(sinc*ix-cosc * sina*iz)+cp12*(cosa*iz))*cosb +(cp11*(i_trans.y+(cosc *
   * cosa)*iy)+cp12*(i_trans.z+(sina)*iy)); double h =((-cosa*ix)*sinb +(cosa*iz)*cosb +i_trans.z+(sina)*iy); パラメータ返還式 L=2*Σ(d[n]*e[n]+a[n]*b[n])
   * J=2*Σ(d[n]*f[n]+a[n]*c[n])/L K=2*Σ(-e[n]*f[n]+b[n]*c[n])/L M=Σ(-e[n]^2+d[n]^2-b[n]^2+a[n]^2)/L 偏微分式 +J*cos(x) +K*sin(x) -sin(x)^2 +cos(x)^2
   * +2*M*cos(x)*sin(x)
   */
  optimizeParamX : function(i_angle_y,i_angle_z,i_trans,i_vertex3d, i_vertex2d,i_number_of_vertex,i_hint_angle)
  {
    var cp = this._projection_mat_ref;
    var sinb = i_angle_y.sin_val;
    var cosb = i_angle_y.cos_val;
    var sinc = i_angle_z.sin_val;
    var cosc = i_angle_z.cos_val;
    var L, J, K, M, N, O;
    L = J = K = M = N = O = 0;
    for (var i = 0; i < i_number_of_vertex; i++) {
      var ix, iy, iz;
      ix = i_vertex3d[i].x;
      iy = i_vertex3d[i].y;
      iz = i_vertex3d[i].z;
      var cp00 = cp.m00;
      var cp01 = cp.m01;
      var cp02 = cp.m02;
      var cp11 = cp.m11;
      var cp12 = cp.m12;
      var X0 = (cp00 * (-sinc * sinb * ix + sinc * cosb * iz) + cp01 * (cosc * sinb * ix - cosc * cosb * iz) + cp02 * (iy));
      var X1 = (cp00 * (-sinc * iy) + cp01 * ((cosc * iy)) + cp02 * (-sinb * ix + cosb * iz));
      var X2 = (cp00 * (i_trans.x + cosc * cosb * ix + cosc * sinb * iz) + cp01 * ((i_trans.y + sinc * cosb * ix + sinc * sinb * iz)) + cp02 * (i_trans.z));
      var Y0 = (cp11 * (cosc * sinb * ix - cosc * cosb * iz) + cp12 * (iy));
      var Y1 = (cp11 * ((cosc * iy)) + cp12 * (-sinb * ix + cosb * iz));
      var Y2 = (cp11 * ((i_trans.y + sinc * cosb * ix + sinc * sinb * iz)) + cp12 * (i_trans.z));
      var H0 = (iy);
      var H1 = (-sinb * ix + cosb * iz);
      var H2 = i_trans.z;
      var VX = i_vertex2d[i].x;
      var VY = i_vertex2d[i].y;
      var a, b, c, d, e, f;
      a = (VX * H0 - X0);
      b = (VX * H1 - X1);
      c = (VX * H2 - X2);
      d = (VY * H0 - Y0);
      e = (VY * H1 - Y1);
      f = (VY * H2 - Y2);
      L += d * e + a * b;
      N += d * d + a * a;
      J += d * f + a * c;
      M += e * e + b * b;
      K += e * f + b * c;
      O += f * f + c * c;
    }
    L *=2;
    J *=2;
    K *=2;
    return this.getMinimumErrorAngleFromParam(L,J, K, M, N, O, i_hint_angle);
  },
  optimizeParamY : function(i_angle_x,i_angle_z,i_trans,i_vertex3d,i_vertex2d,i_number_of_vertex,i_hint_angle)
  {
    var cp = this._projection_mat_ref;
    var sina = i_angle_x.sin_val;
    var cosa = i_angle_x.cos_val;
    var sinc = i_angle_z.sin_val;
    var cosc = i_angle_z.cos_val;
    var L, J, K, M, N, O;
    L = J = K = M = N = O = 0;
    for (var i = 0; i < i_number_of_vertex; i++) {
      var ix, iy, iz;
      ix = i_vertex3d[i].x;
      iy = i_vertex3d[i].y;
      iz = i_vertex3d[i].z;
      var cp00 = cp.m00;
      var cp01 = cp.m01;
      var cp02 = cp.m02;
      var cp11 = cp.m11;
      var cp12 = cp.m12;
      var X0 = (cp00 * (-sinc * sina * ix + cosc * iz) + cp01 * (cosc * sina * ix + sinc * iz) + cp02 * (-cosa * ix));
      var X1 = (cp01 * (sinc * ix - cosc * sina * iz) + cp00 * (cosc * ix + sinc * sina * iz) + cp02 * (cosa * iz));
      var X2 = (cp00 * (i_trans.x + (-sinc * cosa) * iy) + cp01 * (i_trans.y + (cosc * cosa) * iy) + cp02 * (i_trans.z + (sina) * iy));
      var Y0 = (cp11 * (cosc * sina * ix + sinc * iz) + cp12 * (-cosa * ix));
      var Y1 = (cp11 * (sinc * ix - cosc * sina * iz) + cp12 * (cosa * iz));
      var Y2 = (cp11 * (i_trans.y + (cosc * cosa) * iy) + cp12 * (i_trans.z + (sina) * iy));
      var H0 = (-cosa * ix);
      var H1 = (cosa * iz);
      var H2 = i_trans.z + (sina) * iy;
      var VX = i_vertex2d[i].x;
      var VY = i_vertex2d[i].y;
      var a, b, c, d, e, f;
      a = (VX * H0 - X0);
      b = (VX * H1 - X1);
      c = (VX * H2 - X2);
      d = (VY * H0 - Y0);
      e = (VY * H1 - Y1);
      f = (VY * H2 - Y2);
      L += d * e + a * b;
      N += d * d + a * a;
      J += d * f + a * c;
      M += e * e + b * b;
      K += e * f + b * c;
      O += f * f + c * c;
    }
    L *= 2;
    J *= 2;
    K *= 2;
    return this.getMinimumErrorAngleFromParam(L,J, K, M, N, O, i_hint_angle);
  },
  optimizeParamZ : function(i_angle_x,i_angle_y,i_trans,i_vertex3d,i_vertex2d,i_number_of_vertex,i_hint_angle)
  {
    var cp = this._projection_mat_ref;
    var sina = i_angle_x.sin_val;
    var cosa = i_angle_x.cos_val;
    var sinb = i_angle_y.sin_val;
    var cosb = i_angle_y.cos_val;
    var L, J, K, M, N, O;
    L = J = K = M = N = O = 0;
    for (var i = 0; i < i_number_of_vertex; i++) {
      var ix, iy, iz;
      ix = i_vertex3d[i].x;
      iy = i_vertex3d[i].y;
      iz = i_vertex3d[i].z;
      var cp00 = cp.m00;
      var cp01 = cp.m01;
      var cp02 = cp.m02;
      var cp11 = cp.m11;
      var cp12 = cp.m12;
      var X0 = (cp00 * (-sina * sinb * ix - cosa * iy + sina * cosb * iz) + cp01 * (ix * cosb + sinb * iz));
      var X1 = (cp01 * (sina * ix * sinb + cosa * iy - sina * iz * cosb) + cp00 * (cosb * ix + sinb * iz));
      var X2 = cp00 * i_trans.x + cp01 * (i_trans.y) + cp02 * (-cosa * sinb) * ix + cp02 * (sina) * iy + cp02 * ((cosb * cosa) * iz + i_trans.z);
      var Y0 = cp11 * (ix * cosb + sinb * iz);
      var Y1 = cp11 * (sina * ix * sinb + cosa * iy - sina * iz * cosb);
      var Y2 = (cp11 * i_trans.y + cp12 * (-cosa * sinb) * ix + cp12 * ((sina) * iy + (cosb * cosa) * iz + i_trans.z));
      var H0 = 0;
      var H1 = 0;
      var H2 = ((-cosa * sinb) * ix + (sina) * iy + (cosb * cosa) * iz + i_trans.z);
      var VX = i_vertex2d[i].x;
      var VY = i_vertex2d[i].y;
      var a, b, c, d, e, f;
      a = (VX * H0 - X0);
      b = (VX * H1 - X1);
      c = (VX * H2 - X2);
      d = (VY * H0 - Y0);
      e = (VY * H1 - Y1);
      f = (VY * H2 - Y2);
      L += d * e + a * b;
      N += d * d + a * a;
      J += d * f + a * c;
      M += e * e + b * b;
      K += e * f + b * c;
      O += f * f + c * c;
    }
    L *=2;
    J *=2;
    K *=2;
    return this.getMinimumErrorAngleFromParam(L,J, K, M, N, O, i_hint_angle);
  },
  modifyMatrix : function(io_rot,i_trans,i_vertex3d,i_vertex2d,i_number_of_vertex)
  {
    var angles_in = this.__angles_in;// x,y,z
    var ang = this.__ang;
    // ZXY系のsin/cos値を抽出
    this.rotation2Sincos_ZXY(io_rot, angles_in,ang);
    ang.x += this.optimizeParamX(angles_in[1], angles_in[2], i_trans, i_vertex3d, i_vertex2d, i_number_of_vertex, ang.x);
    ang.y += this.optimizeParamY(angles_in[0], angles_in[2], i_trans, i_vertex3d, i_vertex2d, i_number_of_vertex, ang.y);
    ang.z += this.optimizeParamZ(angles_in[0], angles_in[1], i_trans, i_vertex3d, i_vertex2d, i_number_of_vertex, ang.z);
    io_rot.setZXYAngle_Number(ang.x, ang.y, ang.z);
    return;
  },
  /**
   * エラーレートが最小になる点を得る。
   */
  getMinimumErrorAngleFromParam : function(iL,iJ,iK,iM,iN,iO,i_hint_angle)
  {
    var sin_table = this.__sin_table;
    var M = (iN - iM)/iL;
    var J = iJ/iL;
    var K = -iK/iL;
    // パラメータからsinテーブルを作成
    // (- 4*M^2-4)*x^4 + (4*K- 4*J*M)*x^3 + (4*M^2 -(K^2- 4)- J^2)*x^2 +(4*J*M- 2*K)*x + J^2-1 = 0
    var number_of_sin = NyAREquationSolver.solve4Equation(-4 * M * M - 4, 4 * K - 4 * J * M, 4 * M * M - (K * K - 4) - J * J, 4 * J * M - 2 * K, J * J - 1, sin_table);
    // 最小値２個を得ておく。
    var min_ang_0 = Number.MAX_VALUE;
    var min_ang_1 = Number.MAX_VALUE;
    var min_err_0 = Number.MAX_VALUE;
    var min_err_1 = Number.MAX_VALUE;
    for (var i = 0; i < number_of_sin; i++) {
      // +-cos_v[i]が頂点候補
      var sin_rt = sin_table[i];
      var cos_rt = Math.sqrt(1 - (sin_rt * sin_rt));
      // cosを修復。微分式で0に近い方が正解
      // 0 = 2*cos(x)*sin(x)*M - sin(x)^2 + cos(x)^2 + sin(x)*K + cos(x)*J
      var a1 = 2 * cos_rt * sin_rt * M + sin_rt * (K - sin_rt) + cos_rt * (cos_rt + J);
      var a2 = 2 * (-cos_rt) * sin_rt * M + sin_rt * (K - sin_rt) + (-cos_rt) * ((-cos_rt) + J);
      // 絶対値になおして、真のcos値を得ておく。
      a1 = a1 < 0 ? -a1 : a1;
      a2 = a2 < 0 ? -a2 : a2;
      cos_rt = (a1 < a2) ? cos_rt : -cos_rt;
      var ang = Math.atan2(sin_rt, cos_rt);
      // エラー値を計算
      var err = iN * sin_rt * sin_rt + (iL*cos_rt + iJ) * sin_rt + iM * cos_rt * cos_rt + iK * cos_rt + iO;
      // 最小の２個を獲得する。
      if (min_err_0 > err) {
        min_err_1 = min_err_0;
        min_ang_1 = min_ang_0;
        min_err_0 = err;
        min_ang_0 = ang;
      } else if (min_err_1 > err) {
        min_err_1 = err;
        min_ang_1 = ang;
      }
    }
    // [0]をテスト
    var gap_0;
    gap_0 = min_ang_0 - i_hint_angle;
    if (gap_0 > Math.PI) {
      gap_0 = (min_ang_0 - Math.PI * 2) - i_hint_angle;
    } else if (gap_0 < -Math.PI) {
      gap_0 = (min_ang_0 + Math.PI * 2) - i_hint_angle;
    }
    // [1]をテスト
    var gap_1;
    gap_1 = min_ang_1 - i_hint_angle;
    if (gap_1 > Math.PI) {
      gap_1 = (min_ang_1 - Math.PI * 2) - i_hint_angle;
    } else if (gap_1 < -Math.PI) {
      gap_1 = (min_ang_1 + Math.PI * 2) - i_hint_angle;
    }
    return Math.abs(gap_1) < Math.abs(gap_0) ? gap_1 : gap_0;
  }
})

TSinCosValue = ASKlass('TSinCosValue',{
  cos_val : 0,
  sin_val : 0,
  createArray : function(i_size)
  {
    var result=new Array(i_size);
    for(var i=0;i<i_size;i++){
      result[i]=new TSinCosValue();
    }
    return result;
  }
})




/**
 * 回転行列計算用の、3x3行列
 *
 */
NyARRotMatrix = ASKlass('NyARRotMatrix',NyARDoubleMatrix33,
{
  /**
   * インスタンスを準備します。
   *
   * @param i_param
   */
  NyARRotMatrix : function(i_matrix)
  {
    this.__initRot_vec1=new NyARRotVector(i_matrix);
    this.__initRot_vec2=new NyARRotVector(i_matrix);
    return;
  },
  __initRot_vec1 : null,
  __initRot_vec2 : null,
  /**
   * NyARTransMatResultの内容からNyARRotMatrixを復元します。
   * @param i_prev_result
   */
  initRotByPrevResult : function(i_prev_result)
  {
    this.m00=i_prev_result.m00;
    this.m01=i_prev_result.m01;
    this.m02=i_prev_result.m02;
    this.m10=i_prev_result.m10;
    this.m11=i_prev_result.m11;
    this.m12=i_prev_result.m12;
    this.m20=i_prev_result.m20;
    this.m21=i_prev_result.m21;
    this.m22=i_prev_result.m22;
    return;
  },
  /**
   *
   * @param i_linear
   * @param i_sqvertex
   * @throws NyARException
   */
  initRotBySquare : function(i_linear, i_sqvertex)
  {
    var vec1=this.__initRot_vec1;
    var vec2=this.__initRot_vec2;
    //向かい合った辺から、２本のベクトルを計算
    //軸１
    vec1.exteriorProductFromLinear(i_linear[0], i_linear[2]);
    vec1.checkVectorByVertex(i_sqvertex[0], i_sqvertex[1]);
    //軸２
    vec2.exteriorProductFromLinear(i_linear[1], i_linear[3]);
    vec2.checkVectorByVertex(i_sqvertex[3], i_sqvertex[0]);
    //回転の最適化？
    NyARRotVector.checkRotation(vec1,vec2);
    this.m00 =vec1.v1;
    this.m10 =vec1.v2;
    this.m20 =vec1.v3;
    this.m01 =vec2.v1;
    this.m11 =vec2.v2;
    this.m21 =vec2.v3;
    //最後の軸を計算
    var w02 = vec1.v2 * vec2.v3 - vec1.v3 * vec2.v2;
    var w12 = vec1.v3 * vec2.v1 - vec1.v1 * vec2.v3;
    var w22 = vec1.v1 * vec2.v2 - vec1.v2 * vec2.v1;
    var w = Math.sqrt(w02 * w02 + w12 * w12 + w22 * w22);
    this.m02 = w02/w;
    this.m12 = w12/w;
    this.m22 = w22/w;
    return;
  },
  /**
   * i_in_pointを変換行列で座標変換する。
   * @param i_in_point
   * @param i_out_point
   */
  getPoint3d : function(i_in_point,i_out_point)
  {
    var x=i_in_point.x;
    var y=i_in_point.y;
    var z=i_in_point.z;
    i_out_point.x=this.m00 * x + this.m01 * y + this.m02 * z;
    i_out_point.y=this.m10 * x + this.m11 * y + this.m12 * z;
    i_out_point.z=this.m20 * x + this.m21 * y + this.m22 * z;
    return;
  },
  /**
   * 複数の頂点を一括して変換する
   * @param i_in_point
   * @param i_out_point
   * @param i_number_of_vertex
   */
  getPoint3dBatch : function(i_in_point,i_out_point,i_number_of_vertex)
  {
    for(var i=i_number_of_vertex-1;i>=0;i--){
      var out_ptr =i_out_point[i];
      var in_ptr=i_in_point[i];
      var x=in_ptr.x;
      var y=in_ptr.y;
      var z=in_ptr.z;
      out_ptr.x=this.m00 * x + this.m01 * y + this.m02 * z;
      out_ptr.y=this.m10 * x + this.m11 * y + this.m12 * z;
      out_ptr.z=this.m20 * x + this.m21 * y + this.m22 * z;
    }
    return;
  }
})




NyARRotVector = ASKlass('NyARRotVector',
{
  //publicメンバ達
  v1 : 0,
  v2 : 0,
  v3 : 0,
  //privateメンバ達
  _projection_mat_ref : null,
  _inv_cpara_array_ref : null,
  NyARRotVector : function(i_cmat)
  {
    var mat_a = new NyARMat(3, 3);
    var a_array = mat_a.getArray();
    a_array[0][0] =i_cmat.m00;
    a_array[0][1] =i_cmat.m01;
    a_array[0][2] =i_cmat.m02;
    a_array[1][0] =i_cmat.m10;
    a_array[1][1] =i_cmat.m11;
    a_array[1][2] =i_cmat.m12;
    a_array[2][0] =i_cmat.m20;
    a_array[2][1] =i_cmat.m21;
    a_array[2][2] =i_cmat.m22;
    mat_a.matrixSelfInv();
    this._projection_mat_ref = i_cmat;
    this._inv_cpara_array_ref = mat_a.getArray();
    //GCない言語のときは、ここで配列の所有権委譲してね！
  },
  /**
   * ２直線に直交するベクトルを計算する・・・だと思う。
   * @param i_linear1
   * @param i_linear2
   */
  exteriorProductFromLinear : function(i_linear1,i_linear2)
  {
    //1行目
    var cmat= this._projection_mat_ref;
    var w1 = i_linear1.dy * i_linear2.dx - i_linear2.dy * i_linear1.dx;
    var w2 = i_linear1.dx * i_linear2.c - i_linear2.dx * i_linear1.c;
    var w3 = i_linear1.c * i_linear2.dy - i_linear2.c * i_linear1.dy;
    var m0 = w1 * (cmat.m01 * cmat.m12 - cmat.m02 * cmat.m11) + w2 * cmat.m11 - w3 * cmat.m01;//w1 * (cpara[0 * 4 + 1] * cpara[1 * 4 + 2] - cpara[0 * 4 + 2] * cpara[1 * 4 + 1]) + w2 * cpara[1 * 4 + 1] - w3 * cpara[0 * 4 + 1];
    var m1 = -w1 * cmat.m00 * cmat.m12 + w3 * cmat.m00;//-w1 * cpara[0 * 4 + 0] * cpara[1 * 4 + 2] + w3 * cpara[0 * 4 + 0];
    var m2 = w1 * cmat.m00 * cmat.m11;//w1 * cpara[0 * 4 + 0] * cpara[1 * 4 + 1];
    var w = Math.sqrt(m0 * m0 + m1 * m1 + m2 * m2);
    this.v1 = m0 / w;
    this.v2 = m1 / w;
    this.v3 = m2 / w;
    return;
  },
  /**
   * static int check_dir( double dir[3], double st[2], double ed[2],double cpara[3][4] ) Optimize[526->468]
   * ベクトルの開始/終了座標を指定して、ベクトルの方向を調整する。
   * @param i_start_vertex
   * @param i_end_vertex
   * @param cpara
   */
  checkVectorByVertex : function(i_start_vertex, i_end_vertex)
  {
    var h;
    var inv_cpara = this._inv_cpara_array_ref;
    //final double[] world = __checkVectorByVertex_world;// [2][3];
    var world0 = inv_cpara[0][0] * i_start_vertex.x * 10.0 + inv_cpara[0][1] * i_start_vertex.y * 10.0 + inv_cpara[0][2] * 10.0;// mat_a->m[0]*st[0]*10.0+
    var world1 = inv_cpara[1][0] * i_start_vertex.x * 10.0 + inv_cpara[1][1] * i_start_vertex.y * 10.0 + inv_cpara[1][2] * 10.0;// mat_a->m[3]*st[0]*10.0+
    var world2 = inv_cpara[2][0] * i_start_vertex.x * 10.0 + inv_cpara[2][1] * i_start_vertex.y * 10.0 + inv_cpara[2][2] * 10.0;// mat_a->m[6]*st[0]*10.0+
    var world3 = world0 + this.v1;
    var world4 = world1 + this.v2;
    var world5 = world2 + this.v3;
    // </Optimize>
    //final double[] camera = __checkVectorByVertex_camera;// [2][2];
    var cmat= this._projection_mat_ref;
    //h = cpara[2 * 4 + 0] * world0 + cpara[2 * 4 + 1] * world1 + cpara[2 * 4 + 2] * world2;
    h = cmat.m20 * world0 + cmat.m21 * world1 + cmat.m22 * world2;
    if (h == 0.0) {
      throw new NyARException();
    }
    //final double camera0 = (cpara[0 * 4 + 0] * world0 + cpara[0 * 4 + 1] * world1 + cpara[0 * 4 + 2] * world2) / h;
    //final double camera1 = (cpara[1 * 4 + 0] * world0 + cpara[1 * 4 + 1] * world1 + cpara[1 * 4 + 2] * world2) / h;
    var camera0 = (cmat.m00 * world0 + cmat.m01 * world1 + cmat.m02 * world2) / h;
    var camera1 = (cmat.m10 * world0 + cmat.m11 * world1 + cmat.m12 * world2) / h;
    //h = cpara[2 * 4 + 0] * world3 + cpara[2 * 4 + 1] * world4 + cpara[2 * 4 + 2] * world5;
    h = cmat.m20 * world3 + cmat.m21 * world4 + cmat.m22 * world5;
    if (h == 0.0) {
      throw new NyARException();
    }
    //final double camera2 = (cpara[0 * 4 + 0] * world3 + cpara[0 * 4 + 1] * world4 + cpara[0 * 4 + 2] * world5) / h;
    //final double camera3 = (cpara[1 * 4 + 0] * world3 + cpara[1 * 4 + 1] * world4 + cpara[1 * 4 + 2] * world5) / h;
    var camera2 = (cmat.m00 * world3 + cmat.m01 * world4 + cmat.m02 * world5) / h;
    var camera3 = (cmat.m10 * world3 + cmat.m11 * world4 + cmat.m12 * world5) / h;
    var v = (i_end_vertex.x - i_start_vertex.x) * (camera2 - camera0) + (i_end_vertex.y - i_start_vertex.y) * (camera3 - camera1);
    if (v < 0) {
      this.v1 = -this.v1;
      this.v2 = -this.v2;
      this.v3 = -this.v3;
    }
  },
  /**
   * int check_rotation( double rot[2][3] )
   * 2つのベクトル引数の調整をする？
   * @param i_r
   * @throws NyARException
   */
  checkRotation : function(io_vec1,io_vec2)
  {
    var w;
    var f;
    var vec10 = io_vec1.v1;
    var vec11 = io_vec1.v2;
    var vec12 = io_vec1.v3;
    var vec20 = io_vec2.v1;
    var vec21 = io_vec2.v2;
    var vec22 = io_vec2.v3;
    var vec30 = vec11 * vec22 - vec12 * vec21;
    var vec31 = vec12 * vec20 - vec10 * vec22;
    var vec32 = vec10 * vec21 - vec11 * vec20;
    w = Math.sqrt(vec30 * vec30 + vec31 * vec31 + vec32 * vec32);
    if (w == 0.0) {
      throw new NyARException();
    }
    vec30 /= w;
    vec31 /= w;
    vec32 /= w;
    var cb = vec10 * vec20 + vec11 * vec21 + vec12 * vec22;
    if (cb < 0){
      cb=-cb;//cb *= -1.0;
    }
    var ca = (Math.sqrt(cb + 1.0) + Math.sqrt(1.0 - cb)) * 0.5;
    if (vec31 * vec10 - vec11 * vec30 != 0.0) {
      f = 0;
    } else {
      if (vec32 * vec10 - vec12 * vec30 != 0.0) {
        w = vec11;vec11 = vec12;vec12 = w;
        w = vec31;vec31 = vec32;vec32 = w;
        f = 1;
      } else {
        w = vec10;vec10 = vec12;vec12 = w;
        w = vec30;vec30 = vec32;vec32 = w;
        f = 2;
      }
    }
    if (vec31 * vec10 - vec11 * vec30 == 0.0) {
      throw new NyARException();
    }
    var k1,k2,k3,k4;
    var a, b, c, d;
    var p1, q1, r1;
    var p2, q2, r2;
    var p3, q3, r3;
    var p4, q4, r4;
    k1 = (vec11 * vec32 - vec31 * vec12) / (vec31 * vec10 - vec11 * vec30);
    k2 = (vec31 * ca) / (vec31 * vec10 - vec11 * vec30);
    k3 = (vec10 * vec32 - vec30 * vec12) / (vec30 * vec11 - vec10 * vec31);
    k4 = (vec30 * ca) / (vec30 * vec11 - vec10 * vec31);
    a = k1 * k1 + k3 * k3 + 1;
    b = k1 * k2 + k3 * k4;
    c = k2 * k2 + k4 * k4 - 1;
    d = b * b - a * c;
    if (d < 0) {
      throw new NyARException();
    }
    r1 = (-b + Math.sqrt(d)) / a;
    p1 = k1 * r1 + k2;
    q1 = k3 * r1 + k4;
    r2 = (-b - Math.sqrt(d)) / a;
    p2 = k1 * r2 + k2;
    q2 = k3 * r2 + k4;
    if (f == 1) {
      w = q1;q1 = r1;r1 = w;
      w = q2;q2 = r2;r2 = w;
      w = vec11;vec11 = vec12;vec12 = w;
      w = vec31;vec31 = vec32;vec32 = w;
      f = 0;
    }
    if (f == 2) {
      w = p1;p1 = r1;r1 = w;
      w = p2;p2 = r2;r2 = w;
      w = vec10;vec10 = vec12;vec12 = w;
      w = vec30;vec30 = vec32;vec32 = w;
      f = 0;
    }
    if (vec31 * vec20 - vec21 * vec30 != 0.0) {
      f = 0;
    } else {
      if (vec32 * vec20 - vec22 * vec30 != 0.0) {
        w = vec21;vec21 = vec22;vec22 = w;
        w = vec31;vec31 = vec32;vec32 = w;
        f = 1;
      } else {
        w = vec20;vec20 = vec22;vec22 = w;
        w = vec30;vec30 = vec32;vec32 = w;
        f = 2;
      }
    }
    if (vec31 * vec20 - vec21 * vec30 == 0.0) {
      throw new NyARException();
    }
    k1 = (vec21 * vec32 - vec31 * vec22) / (vec31 * vec20 - vec21 * vec30);
    k2 = (vec31 * ca) / (vec31 * vec20 - vec21 * vec30);
    k3 = (vec20 * vec32 - vec30 * vec22) / (vec30 * vec21 - vec20 * vec31);
    k4 = (vec30 * ca) / (vec30 * vec21 - vec20 * vec31);
    a = k1 * k1 + k3 * k3 + 1;
    b = k1 * k2 + k3 * k4;
    c = k2 * k2 + k4 * k4 - 1;
    d = b * b - a * c;
    if (d < 0) {
      throw new NyARException();
    }
    r3 = (-b + Math.sqrt(d)) / a;
    p3 = k1 * r3 + k2;
    q3 = k3 * r3 + k4;
    r4 = (-b - Math.sqrt(d)) / a;
    p4 = k1 * r4 + k2;
    q4 = k3 * r4 + k4;
    if (f == 1) {
      w = q3;q3 = r3;r3 = w;
      w = q4;q4 = r4;r4 = w;
      w = vec21;vec21 = vec22;vec22 = w;
      w = vec31;vec31 = vec32;vec32 = w;
      f = 0;
    }
    if (f == 2) {
      w = p3;p3 = r3;r3 = w;
      w = p4;p4 = r4;r4 = w;
      w = vec20;vec20 = vec22;vec22 = w;
      w = vec30;vec30 = vec32;vec32 = w;
      f = 0;
    }
    var e1 = p1 * p3 + q1 * q3 + r1 * r3;
    if (e1 < 0) {
      e1 = -e1;
    }
    var e2 = p1 * p4 + q1 * q4 + r1 * r4;
    if (e2 < 0) {
      e2 = -e2;
    }
    var e3 = p2 * p3 + q2 * q3 + r2 * r3;
    if (e3 < 0) {
      e3 = -e3;
    }
    var e4 = p2 * p4 + q2 * q4 + r2 * r4;
    if (e4 < 0) {
      e4 = -e4;
    }
    if (e1 < e2) {
      if (e1 < e3) {
        if (e1 < e4) {
          io_vec1.v1 = p1;
          io_vec1.v2 = q1;
          io_vec1.v3 = r1;
          io_vec2.v1 = p3;
          io_vec2.v2 = q3;
          io_vec2.v3 = r3;
        } else {
          io_vec1.v1 = p2;
          io_vec1.v2 = q2;
          io_vec1.v3 = r2;
          io_vec2.v1 = p4;
          io_vec2.v2 = q4;
          io_vec2.v3 = r4;
        }
      } else {
        if (e3 < e4) {
          io_vec1.v1 = p2;
          io_vec1.v2 = q2;
          io_vec1.v3 = r2;
          io_vec2.v1 = p3;
          io_vec2.v2 = q3;
          io_vec2.v3 = r3;
        } else {
          io_vec1.v1 = p2;
          io_vec1.v2 = q2;
          io_vec1.v3 = r2;
          io_vec2.v1 = p4;
          io_vec2.v2 = q4;
          io_vec2.v3 = r4;
        }
      }
    } else {
      if (e2 < e3) {
        if (e2 < e4) {
          io_vec1.v1 = p1;
          io_vec1.v2 = q1;
          io_vec1.v3 = r1;
          io_vec2.v1 = p4;
          io_vec2.v2 = q4;
          io_vec2.v3 = r4;
        } else {
          io_vec1.v1 = p2;
          io_vec1.v2 = q2;
          io_vec1.v3 = r2;
          io_vec2.v1 = p4;
          io_vec2.v2 = q4;
          io_vec2.v3 = r4;
        }
      } else {
        if (e3 < e4) {
          io_vec1.v1 = p2;
          io_vec1.v2 = q2;
          io_vec1.v3 = r2;
          io_vec2.v1 = p3;
          io_vec2.v2 = q3;
          io_vec2.v3 = r3;
        } else {
          io_vec1.v1 = p2;
          io_vec1.v2 = q2;
          io_vec1.v3 = r2;
          io_vec2.v1 = p4;
          io_vec2.v2 = q4;
          io_vec2.v3 = r4;
        }
      }
    }
    return;
  }
})

INyARTransportVectorSolver = ASKlass('INyARTransportVectorSolver',
{
  set2dVertex : function(i_ref_vertex_2d,i_number_of_vertex){},
  /**
   * 画面座標群と3次元座標群から、平行移動量を計算します。
   * 2d座標系は、直前に実行したset2dVertexのものを使用します。
   * @param i_vertex_2d
   * 直前のset2dVertexコールで指定したものと同じものを指定してください。
   * @param i_vertex3d
   * 3次元空間の座標群を設定します。頂点の順番は、画面座標群と同じ順序で格納してください。
   * @param o_transfer
   * @throws NyARException
   */
  solveTransportVector : function(i_vertex3d, o_transfer){}
})


/**
 * 並進ベクトル[T]を３次元座標[b]と基点の回転済行列[M]から計算します。
 *
 * アルゴリズムは、ARToolKit 拡張現実プログラミング入門 の、P207のものです。
 *
 * 計算手順
 * [A]*[T]=bを、[A]T*[A]*[T]=[A]T*[b]にする。
 * set2dVertexで[A]T*[A]=[M]を計算して、Aの3列目の情報だけ保存しておく。
 * getTransportVectorで[M]*[T]=[A]T*[b]を連立方程式で解いて、[T]を得る。
 */
NyARTransportVectorSolver = ASKlass('NyARTransportVectorSolver', INyARTransportVectorSolver,
{
  _cx : null,
  _cy : null,
  _projection_mat : null,
  _nmber_of_vertex : 0,
  NyARTransportVectorSolver : function(i_projection_mat_ref,i_max_vertex)
  {
    this._projection_mat=i_projection_mat_ref;
    this._cx=new FloatVector(i_max_vertex);
    this._cy=new FloatVector(i_max_vertex);
    return;
  },
  _a00:0,_a01_10:0,_a02_20:0,_a11:0,_a12_21:0,_a22 : 0,
  /**
   * 画面上の座標群を指定します。
   * @param i_ref_vertex_2d
   * 歪み矯正済の画面上の頂点座標群への参照値を指定します。
   * @throws NyARException
   *
   */
  set2dVertex : function(i_ref_vertex_2d,i_number_of_vertex)
  {
    //3x2nと2n*3の行列から、最小二乗法計算するために3x3マトリクスを作る。
    //行列[A]の3列目のキャッシュ
    var cx=this._cx;
    var cy=this._cy;
    var m22;
    var p00=this._projection_mat.m00;
    var p01=this._projection_mat.m01;
    var p11=this._projection_mat.m11;
    var p12=this._projection_mat.m12;
    var p02=this._projection_mat.m02;
    var w1,w2,w3,w4;
    this._a00=i_number_of_vertex*p00*p00;
    this._a01_10=i_number_of_vertex*p00*p01;
    this._a11=i_number_of_vertex*(p01*p01+p11*p11);
    //[A]T*[A]の計算
    m22=0;
    w1=w2=0;
    for(var i=0;i<i_number_of_vertex;i++){
      //座標を保存しておく。
      w3=p02-(cx[i]=i_ref_vertex_2d[i].x);
      w4=p12-(cy[i]=i_ref_vertex_2d[i].y);
      w1+=w3;
      w2+=w4;
      m22+=w3*w3+w4*w4;
    }
    this._a02_20=w1*p00;
    this._a12_21=p01*w1+p11*w2;
    this._a22=m22;
    this._nmber_of_vertex=i_number_of_vertex;
    return;
  },
  /**
   * 画面座標群と3次元座標群から、平行移動量を計算します。
   * 2d座標系は、直前に実行したset2dVertexのものを使用します。
   * @param i_vertex_2d
   * 直前のset2dVertexコールで指定したものと同じものを指定してください。
   * @param i_vertex3d
   * 3次元空間の座標群を設定します。頂点の順番は、画面座標群と同じ順序で格納してください。
   * @param o_transfer
   * @throws NyARException
   */
  solveTransportVector : function(i_vertex3d,o_transfer)
  {
    var number_of_vertex=this._nmber_of_vertex;
    var p00=this._projection_mat.m00;
    var p01=this._projection_mat.m01;
    var p02=this._projection_mat.m02;
    var p11=this._projection_mat.m11;
    var p12=this._projection_mat.m12;
    //行列[A]の3列目のキャッシュ
    var cx=this._cx;
    var cy=this._cy;
    //回転行列を元座標の頂点群に適応
    //[A]T*[b]を計算
    var b1, b2, b3;
    b1 = b2 = b3 = 0;
    for(var i=0;i<number_of_vertex;i++)
    {
      var w1=i_vertex3d[i].z*cx[i]-p00*i_vertex3d[i].x-p01*i_vertex3d[i].y-p02*i_vertex3d[i].z;
      var w2=i_vertex3d[i].z*cy[i]-p11*i_vertex3d[i].y-p12*i_vertex3d[i].z;
      b1+=w1;
      b2+=w2;
      b3+=cx[i]*w1+cy[i]*w2;
    }
    //[A]T*[b]を計算
    b3=p02*b1+p12*b2-b3;//順番変えたらダメよ
    b2=p01*b1+p11*b2;
    b1=p00*b1;
    //([A]T*[A])*[T]=[A]T*[b]を方程式で解く。
    //a01とa10を0と仮定しても良いんじゃないかな？
    var a00=this._a00;
    var a01=this._a01_10;
    var a02=this._a02_20;
    var a11=this._a11;
    var a12=this._a12_21;
    var a22=this._a22;
    var t1=a22*b2-a12*b3;
    var t2=a12*b2-a11*b3;
    var t3=a01*b3-a02*b2;
    var t4=a12*a12-a11*a22;
    var t5=a02*a12-a01*a22;
    var t6=a02*a11-a01*a12;
    var det=a00*t4-a01*t5 + a02*t6;
    o_transfer.x= (a01*t1 - a02*t2 +b1*t4)/det;
    o_transfer.y=-(a00*t1 + a02*t3 +b1*t5)/det;
    o_transfer.z= (a00*t2 + a01*t3 +b1*t6)/det;
    return;
  }
})
/*
 * PROJECT: FLARToolKit
 * --------------------------------------------------------------------------------
 * This work is based on the NyARToolKit developed by
 *   R.Iizuka (nyatla)
 * http://nyatla.jp/nyatoolkit/
 *
 * The FLARToolKit is ActionScript 3.0 version ARToolkit class library.
 * Copyright (C)2008 Saqoosha
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  http://www.libspark.org/wiki/saqoosha/FLARToolKit
 *  <saq(at)saqoosha.net>
 *
 */
FLARTransMatResult = NyARTransMatResult;
/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */


NyARMath = Klass(
{
  /**
   * p2-p1ベクトルのsquare normを計算する。
   * @param i_p1
   * @param i_p2
   * @return
   */
  sqNorm_NyARDoublePoint2d : function(i_p1,i_p2 )
  {
    var x,y;
    x=i_p2.x-i_p1.x;
    y=i_p2.y-i_p1.y;
    return x*x+y*y;
  },
  sqNorm_Number : function(i_p1x,i_p1y,i_p2x,i_p2y)
  {
    var x,y;
    x=i_p2x-i_p1x;
    y=i_p2y-i_p1y;
    return x*x+y*y;
  },
  /**
   * p2-p1ベクトルのsquare normを計算する。
   * @param i_p1
   * @param i_p2
   * @return
   */
  sqNorm_NyARDoublePoint3d : function(i_p1,i_p2)
  {
    var x, y, z;
    x=i_p2.x-i_p1.x;
    y=i_p2.y-i_p1.y;
    z=i_p2.z-i_p1.z;
    return x*x+y*y+z*z;
  },
  /**
   * 3乗根を求められないシステムで、３乗根を求めます。
   * http://aoki2.si.gunma-u.ac.jp/JavaScript/src/3jisiki.html
   * @param i_in
   * @return
   */
  cubeRoot : function(i_in)
  {
    var res = Math.pow(Math.abs(i_in), 1.0 / 3.0);
    return (i_in >= 0) ? res : -res;
  }
})


NyAREquationSolver = Klass(
{
  solve2Equation_3 : function(i_a, i_b,i_c,o_result)
  {
    NyAS3Utils.assert(i_a!=0);
    return this.solve2Equation_2b(i_b/i_a,i_c/i_a,o_result,0);
  },
  solve2Equation_2a : function(i_b, i_c,o_result)
  {
    return this.solve2Equation_2b(i_b,i_c,o_result,0);
  },
  solve2Equation_2b : function(i_b, i_c,o_result,i_result_st)
  {
    var t=i_b*i_b-4*i_c;
    if(t<0){
      //虚数根
      return 0;
    }
    if(t==0){
      //重根
      o_result[i_result_st+0]=-i_b/(2);
      return 1;
    }
    //実根２個
    t=Math.sqrt(t);
    o_result[i_result_st+0]=(-i_b+t)/(2);
    o_result[i_result_st+1]=(-i_b-t)/(2);
    return 2;
  },
  /**
   * ３次方程式 a*x^3+b*x^2+c*x+d=0の実根を求める。
   * http://aoki2.si.gunma-u.ac.jp/JavaScript/src/3jisiki.html
   * のコードを基にしてます。
   * @param i_a
   * X^3の係数
   * @param i_b
   * X^2の係数
   * @param i_c
   * X^1の係数
   * @param i_d
   * X^0の係数
   * @param o_result
   * 実根。double[3]を指定すること。
   * @return
   */
  solve3Equation_4 : function(i_a, i_b, i_c, i_d,o_result)
  {
    NyAS3Utils.assert (i_a != 0);
    return this.solve3Equation_3(i_b/i_a,i_c/i_a,i_d/i_a,o_result);
  },
  /**
   * ３次方程式 x^3+b*x^2+c*x+d=0の実根を求める。
   * だけを求める。
   * http://aoki2.si.gunma-u.ac.jp/JavaScript/src/3jisiki.html
   * のコードを基にしてます。
   * @param i_b
   * X^2の係数
   * @param i_c
   * X^1の係数
   * @param i_d
   * X^0の係数
   * @param o_result
   * 実根。double[1]以上を指定すること。
   * @return
   */
  solve3Equation_3 : function(i_b,i_c,i_d,o_result)
  {
    var tmp,b,   p, q;
    b = i_b/(3);
    p = b * b - i_c / 3;
    q = (b * (i_c - 2 * b * b) - i_d) / 2;
    if ((tmp = q * q - p * p * p) == 0) {
      // 重根
      q = NyARMath.cubeRoot(q);
      o_result[0] = 2 * q - b;
      o_result[1] = -q - b;
      return 2;
    } else if (tmp > 0) {
      // 実根1,虚根2
      var a3 = NyARMath.cubeRoot(q + ((q > 0) ? 1 : -1) * Math.sqrt(tmp));
      var b3 = p / a3;
      o_result[0] = a3 + b3 - b;
      // 虚根:-0.5*(a3+b3)-b,Math.abs(a3-b3)*Math.sqrt(3.0)/2
      return 1;
    } else {
      // 実根3
      tmp = 2 * Math.sqrt(p);
      var t = Math.acos(q / (p * tmp / 2));
      o_result[0] = tmp * Math.cos(t / 3) - b;
      o_result[1] = tmp * Math.cos((t + 2 * Math.PI) / 3) - b;
      o_result[2] = tmp * Math.cos((t + 4 * Math.PI) / 3) - b;
      return 3;
    }
  },
  /**
   * ４次方程式の実根だけを求める。
   * @param i_a
   * X^3の係数
   * @param i_b
   * X^2の係数
   * @param i_c
   * X^1の係数
   * @param i_d
   * X^0の係数
   * @param o_result
   * 実根。double[3]を指定すること。
   * @return
   */
  solve4Equation : function(i_a, i_b, i_c, i_d,i_e,o_result)
  {
    NyAS3Utils.assert (i_a != 0);
    var A3,A2,A1,A0,B3;
    A3=i_b/i_a;
    A2=i_c/i_a;
    A1=i_d/i_a;
    A0=i_e/i_a;
    B3=A3/4;
    var p,q,r;
    var B3_2=B3*B3;
    p=A2-6*B3_2;//A2-6*B3*B3;
    q=A1+B3*(-2*A2+8*B3_2);//A1-2*A2*B3+8*B3*B3*B3;
    r=A0+B3*(-A1+A2*B3)-3*B3_2*B3_2;//A0-A1*B3+A2*B3*B3-3*B3*B3*B3*B3;
    if(q==0){
      var result_0,result_1;
      //複二次式
      var res=this.solve2Equation_2b(p,r,o_result,0);
      switch(res){
      case 0:
        //全て虚数解
        return 0;
      case 1:
        //重根
        //解は0,1,2の何れか。
        result_0=o_result[0];
        if(result_0<0){
          //全て虚数解
          return 0;
        }
        //実根1個
        if(result_0==0){
          //NC
          o_result[0]=0-B3;
          return 1;
        }
        //実根2個
        result_0=Math.sqrt(result_0);
        o_result[0]=result_0-B3;
        o_result[1]=-result_0-B3;
        return 2;
      case 2:
        //実根２個だからt==t2==0はありえない。(case1)
        //解は、0,2,4の何れか。
        result_0=o_result[0];
        result_1=o_result[1];
        var number_of_result=0;
        if(result_0>0){
          //NC
          result_0=Math.sqrt(result_0);
          o_result[0]= result_0-B3;
          o_result[1]=-result_0-B3;
          number_of_result+=2;
        }
        if(result_1>0)
        {
          //NC
          result_1=Math.sqrt(result_1);
          o_result[number_of_result+0]= result_1-B3;
          o_result[number_of_result+1]=-result_1-B3;
          number_of_result+=2;
        }
        return number_of_result;
      default:
        throw new NyARException();
      }
    }else{
      //それ以外
      //最適化ポイント:
      //u^3  + (2*p)*u^2  +((- 4*r)+(p^2))*u -q^2= 0
      var u=this.solve3Equation_1((2*p),(- 4*r)+(p*p),-q*q);
      if(u<0){
        //全て虚数解
        return 0;
      }
      var ru=Math.sqrt(u);
      //2次方程式を解いてyを計算(最適化ポイント)
      var result_1st,result_2nd;
      result_1st=this.solve2Equation_2b(-ru,(p+u)/2+ru*q/(2*u),o_result,0);
      //配列使い回しのために、変数に退避
      switch(result_1st){
      case 0:
        break;
      case 1:
        o_result[0]=o_result[0]-B3;
        break;
      case 2:
        o_result[0]=o_result[0]-B3;
        o_result[1]=o_result[1]-B3;
        break;
      default:
        throw new NyARException();
      }
      result_2nd=this.solve2Equation_2b(ru,(p+u)/2-ru*q/(2*u),o_result,result_1st);
      //0,1番目に格納
      switch(result_2nd){
      case 0:
        break;
      case 1:
        o_result[result_1st+0]=o_result[result_1st+0]-B3;
        break;
      case 2:
        o_result[result_1st+0]=o_result[result_1st+0]-B3;
        o_result[result_1st+1]=o_result[result_1st+1]-B3;
        break;
      default:
        throw new NyARException();
      }
      return result_1st+result_2nd;
    }
  },
  /**
   * 3次方程式の実根を１個だけ求める。
   * 4字方程式で使う。
   * @param i_b
   * @param i_c
   * @param i_d
   * @param o_result
   * @return
   */
  solve3Equation_1 : function(i_b,i_c, i_d)
  {
    var tmp,b,   p, q;
    b = i_b/(3);
    p = b * b - i_c / 3;
    q = (b * (i_c - 2 * b * b) - i_d) / 2;
    if ((tmp = q * q - p * p * p) == 0) {
      // 重根
      q = NyARMath.cubeRoot(q);
      return 2 * q - b;
    } else if (tmp > 0) {
      // 実根1,虚根2
      var a3 = NyARMath.cubeRoot(q + ((q > 0) ? 1 : -1) * Math.sqrt(tmp));
      var b3 = p / a3;
      return a3 + b3 - b;
    } else {
      // 実根3
      tmp = 2 * Math.sqrt(p);
      var t = Math.acos(q / (p * tmp / 2));
      return tmp * Math.cos(t / 3) - b;
    }
  }
})

NyARPerspectiveParamGenerator_O1 = Klass(
{
  _local_x : 0,
  _local_y : 0,
  _width : 0,
  _height : 0,
  initialize : function(i_local_x,i_local_y,i_width,i_height)
  {
    this._height=i_height;
    this._width=i_width;
    this._local_x=i_local_x;
    this._local_y=i_local_y;
    return;
  },
  getParam : function(i_vertex,o_param)
  {
    var ltx = this._local_x;
    var lty = this._local_y;
    var rbx = ltx + this._width;
    var rby = lty + this._height;
    var det_1;
    var a13, a14, a23, a24, a33, a34, a43, a44;
    var b11, b12, b13, b14, b21, b22, b23, b24, b31, b32, b33, b34, b41, b42, b43, b44;
    var t1, t2, t3, t4, t5, t6;
    var v1, v2, v3, v4;
    var kx0, kx1, kx2, kx3, kx4, kx5, kx6, kx7;
    var ky0, ky1, ky2, ky3, ky4, ky5, ky6, ky7;
    {
      v1 = i_vertex[0].x;
      v2 = i_vertex[1].x;
      v3 = i_vertex[2].x;
      v4 = i_vertex[3].x;
      a13 = -ltx * v1;
      a14 = -lty * v1;
      a23 = -rbx * v2;
      a24 = -lty * v2;
      a33 = -rbx * v3;
      a34 = -rby * v3;
      a43 = -ltx * v4;
      a44 = -rby * v4;
      t1 = a33 * a44 - a34 * a43;
      t4 = a34 * ltx - rbx * a44;
      t5 = rbx * a43 - a33 * ltx;
      t2 = rby * (a34 - a44);
      t3 = rby * (a43 - a33);
      t6 = rby * (rbx - ltx);
      b21 = -a23 * t4 - a24 * t5 - rbx * t1;
      b11 = (a23 * t2 + a24 * t3) + lty * t1;
      b31 = (a24 * t6 - rbx * t2) + lty * t4;
      b41 = (-rbx * t3 - a23 * t6) + lty * t5;
      t1 = a43 * a14 - a44 * a13;
      t2 = a44 * lty - rby * a14;
      t3 = rby * a13 - a43 * lty;
      t4 = ltx * (a44 - a14);
      t5 = ltx * (a13 - a43);
      t6 = ltx * (lty - rby);
      b12 = -rby * t1 - a33 * t2 - a34 * t3;
      b22 = (a33 * t4 + a34 * t5) + rbx * t1;
      b32 = (-a34 * t6 - rby * t4) + rbx * t2;
      b42 = (-rby * t5 + a33 * t6) + rbx * t3;
      t1 = a13 * a24 - a14 * a23;
      t4 = a14 * rbx - ltx * a24;
      t5 = ltx * a23 - a13 * rbx;
      t2 = lty * (a14 - a24);
      t3 = lty * (a23 - a13);
      t6 = lty * (ltx - rbx);
      b23 = -a43 * t4 - a44 * t5 - ltx * t1;
      b13 = (a43 * t2 + a44 * t3) + rby * t1;
      b33 = (a44 * t6 - ltx * t2) + rby * t4;
      b43 = (-ltx * t3 - a43 * t6) + rby * t5;
      t1 = a23 * a34 - a24 * a33;
      t2 = a24 * rby - lty * a34;
      t3 = lty * a33 - a23 * rby;
      t4 = rbx * (a24 - a34);
      t5 = rbx * (a33 - a23);
      t6 = rbx * (rby - lty);
      b14 = -lty * t1 - a13 * t2 - a14 * t3;
      b24 = a13 * t4 + a14 * t5 + ltx * t1;
      b34 = -a14 * t6 - lty * t4 + ltx * t2;
      b44 = -lty * t5 + a13 * t6 + ltx * t3;
      det_1 = (ltx * (b11 + b14) + rbx * (b12 + b13));
      if (det_1 == 0) {
        det_1=0.0001;
        //System.out.println("Could not get inverse matrix(1).");
        //return false;
      }
      det_1 = 1 / det_1;
      kx0 = (b11 * v1 + b12 * v2 + b13 * v3 + b14 * v4) * det_1;
      kx1 = (b11 + b12 + b13 + b14) * det_1;
      kx2 = (b21 * v1 + b22 * v2 + b23 * v3 + b24 * v4) * det_1;
      kx3 = (b21 + b22 + b23 + b24) * det_1;
      kx4 = (b31 * v1 + b32 * v2 + b33 * v3 + b34 * v4) * det_1;
      kx5 = (b31 + b32 + b33 + b34) * det_1;
      kx6 = (b41 * v1 + b42 * v2 + b43 * v3 + b44 * v4) * det_1;
      kx7 = (b41 + b42 + b43 + b44) * det_1;
    }
    {
      v1 = i_vertex[0].y;
      v2 = i_vertex[1].y;
      v3 = i_vertex[2].y;
      v4 = i_vertex[3].y;
      a13 = -ltx * v1;
      a14 = -lty * v1;
      a23 = -rbx * v2;
      a24 = -lty * v2;
      a33 = -rbx * v3;
      a34 = -rby * v3;
      a43 = -ltx * v4;
      a44 = -rby * v4;
      t1 = a33 * a44 - a34 * a43;
      t4 = a34 * ltx - rbx * a44;
      t5 = rbx * a43 - a33 * ltx;
      t2 = rby * (a34 - a44);
      t3 = rby * (a43 - a33);
      t6 = rby * (rbx - ltx);
      b21 = -a23 * t4 - a24 * t5 - rbx * t1;
      b11 = (a23 * t2 + a24 * t3) + lty * t1;
      b31 = (a24 * t6 - rbx * t2) + lty * t4;
      b41 = (-rbx * t3 - a23 * t6) + lty * t5;
      t1 = a43 * a14 - a44 * a13;
      t2 = a44 * lty - rby * a14;
      t3 = rby * a13 - a43 * lty;
      t4 = ltx * (a44 - a14);
      t5 = ltx * (a13 - a43);
      t6 = ltx * (lty - rby);
      b12 = -rby * t1 - a33 * t2 - a34 * t3;
      b22 = (a33 * t4 + a34 * t5) + rbx * t1;
      b32 = (-a34 * t6 - rby * t4) + rbx * t2;
      b42 = (-rby * t5 + a33 * t6) + rbx * t3;
      t1 = a13 * a24 - a14 * a23;
      t4 = a14 * rbx - ltx * a24;
      t5 = ltx * a23 - a13 * rbx;
      t2 = lty * (a14 - a24);
      t3 = lty * (a23 - a13);
      t6 = lty * (ltx - rbx);
      b23 = -a43 * t4 - a44 * t5 - ltx * t1;
      b13 = (a43 * t2 + a44 * t3) + rby * t1;
      b33 = (a44 * t6 - ltx * t2) + rby * t4;
      b43 = (-ltx * t3 - a43 * t6) + rby * t5;
      t1 = a23 * a34 - a24 * a33;
      t2 = a24 * rby - lty * a34;
      t3 = lty * a33 - a23 * rby;
      t4 = rbx * (a24 - a34);
      t5 = rbx * (a33 - a23);
      t6 = rbx * (rby - lty);
      b14 = -lty * t1 - a13 * t2 - a14 * t3;
      b24 = a13 * t4 + a14 * t5 + ltx * t1;
      b34 = -a14 * t6 - lty * t4 + ltx * t2;
      b44 = -lty * t5 + a13 * t6 + ltx * t3;
      det_1 = (ltx * (b11 + b14) + rbx * (b12 + b13));
      if (det_1 == 0) {
        det_1=0.0001;
        //System.out.println("Could not get inverse matrix(2).");
        //return false;
      }
      det_1 = 1 / det_1;
      ky0 = (b11 * v1 + b12 * v2 + b13 * v3 + b14 * v4) * det_1;
      ky1 = (b11 + b12 + b13 + b14) * det_1;
      ky2 = (b21 * v1 + b22 * v2 + b23 * v3 + b24 * v4) * det_1;
      ky3 = (b21 + b22 + b23 + b24) * det_1;
      ky4 = (b31 * v1 + b32 * v2 + b33 * v3 + b34 * v4) * det_1;
      ky5 = (b31 + b32 + b33 + b34) * det_1;
      ky6 = (b41 * v1 + b42 * v2 + b43 * v3 + b44 * v4) * det_1;
      ky7 = (b41 + b42 + b43 + b44) * det_1;
    }
    det_1 = kx5 * (-ky7) - (-ky5) * kx7;
    if (det_1 == 0) {
      det_1=0.0001;
      //System.out.println("Could not get inverse matrix(3).");
      //return false;
    }
    det_1 = 1 / det_1;
    var C, F;
    o_param[2] = C = (-ky7 * det_1) * (kx4 - ky4) + (ky5 * det_1) * (kx6 - ky6); // C
    o_param[5] = F = (-kx7 * det_1) * (kx4 - ky4) + (kx5 * det_1) * (kx6 - ky6); // F
    o_param[6] = kx4 - C * kx5;
    o_param[7] = kx6 - C * kx7;
    o_param[0] = kx0 - C * kx1;
    o_param[1] = kx2 - C * kx3;
    o_param[3] = ky0 - F * ky1;
    o_param[4] = ky2 - F * ky3;
    return true;
  }
})
/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */
NyIdMarkerParam = ASKlass('NyIdMarkerParam',
{
  /**
   * マーカの方位値です。
   */
  direction : 0,
  /**
   * マーカ周辺のパターン閾値です。
   */
  threshold : 0
})
NyIdMarkerPattern = ASKlass('NyIdMarkerPattern',
{
  model : 0,
  ctrl_domain : 0,
  ctrl_mask : 0,
  check : 0,
  data : new IntVector(32)
})




TThreshold = ASKlass('TThreshold',
{
  th_h : 0,
  th_l : 0,
  th : 0,
  lt_x : 0,
  lt_y : 0,
  rb_x : 0,
  rb_y : 0
})
THighAndLow = ASKlass('THighAndLow',
{
  h : 0,
  l : 0
})
/**
 * Marker pattern encoder。
 *
 */
_bit_table_3 = new IntVector([
  25,  26,  27,  28,  29,  30,  31,
  48,  9,  10,  11,  12,  13,  32,
  47,  24,  1,  2,  3,  14,  33,
  46,  23,  8,  0,  4,  15,  34,
  45,  22,  7,  6,  5,  16,  35,
  44,  21,  20,  19,  18,  17,  36,
  43,  42,  41,  40,  39,  38,  37
  ])
_bit_table_2 = new IntVector([
  9,  10,  11,  12,  13,
  24,  1,  2,  3,  14,
  23,  8,  0,  4,  15,
  22,  7,  6,  5,  16,
  21,  20,  19,  18,  17])
MarkerPattEncoder = ASKlass('MarkerPattEncoder',
{
  _bit_table_2 : _bit_table_2,
  _bit_table_3 : _bit_table_3,
  _bit_tables : [
    _bit_table_2,_bit_table_3,null,null,null,null,null],
  /**
  * RECT(0):[0]=(0)
  * RECT(1):[1]=(1-8)
  * RECT(2):[2]=(9-16),[3]=(17-24)
  * RECT(3):[4]=(25-32),[5]=(33-40),[6]=(41-48)
  */
  _bit_table : null,
  _bits : new IntVector(16),
  _work : new IntVector(16),
  _model : 0,
  setBitByBitIndex : function(i_index_no,i_value)
  {
    NyAS3Utils.assert(i_value==0 || i_value==1);
    var bit_no=this._bit_table[i_index_no];
    if(bit_no==0){
      this._bits[0]=i_value;
    }else{
      var bidx=toInt((bit_no-1)/8)+1;
      var sidx=(bit_no-1)%8;
      this._bits[bidx]=(this._bits[bidx]&(~(0x01<<sidx)))|(i_value<<sidx);
    }
    return;
  }
  ,setBit : function(i_bit_no,i_value)
  {
    NyAS3Utils.assert(i_value==0 || i_value==1);
    if(i_bit_no==0){
      this._bits[0]=i_value;
    }else{
      var bidx=toInt((i_bit_no-1)/8)+1;
      var sidx=(i_bit_no-1)%8;
      this._bits[bidx]=(this._bits[bidx]&(~(0x01<<sidx)))|(i_value<<sidx);
    }
    return;
  }
  ,getBit : function(i_bit_no)
  {
    if(i_bit_no==0){
      return this._bits[0];
    }else{
      var bidx=toInt((i_bit_no-1)/8)+1;
      var sidx=(i_bit_no-1)%8;
      return (this._bits[bidx]>>(sidx))&(0x01);
    }
  }
  ,getModel : function()
  {
    return this._model;
  }
  ,getControlValue : function(i_model,i_data)
  {
    var v;
    switch(i_model){
    case 2:
      v=(i_data[2] & 0x0e)>>1;
      return v>=5?v-1:v;
    case 3:
      v=(i_data[4] & 0x3e)>>1;
      return v>=21?v-1:v;
    case 4:
    case 5:
    case 6:
        case 7:
        default:
            break;
    }
    return -1;
  }
  ,getCheckValue : function(i_model,i_data)
  {
    var v;
    switch(i_model){
    case 2:
      v=(i_data[2] & 0xe0)>>5;
      return v>5?v-1:v;
    case 3:
      v=((i_data[4] & 0x80)>>7) |((i_data[5] & 0x0f)<<1);
      return v>21?v-1:v;
    case 4:
    case 5:
    case 6:
        case 7:
        default:
            break;
    }
    return -1;
  }
  ,initEncoder : function(i_model)
  {
    if(i_model>3 || i_model<2){
      //Lv4以降に対応する時は、この制限を変える。
      // Change this when Lv4 is supported.
      return false;
    }
    this._bit_table=this._bit_tables[i_model-2];
    this._model=i_model;
    return true;
  }
  ,getDirection : function()
  {
    var l,t,r,b;
    var timing_pat;
    switch(this._model){
    case 2:
      //トラッキングセルを得る
      // get tracking cel
      t=this._bits[2] & 0x1f;
      r=((this._bits[2] & 0xf0)>>4)|((this._bits[3]&0x01)<<4);
      b=this._bits[3] & 0x1f;
      l=((this._bits[3] & 0xf0)>>4)|((this._bits[2]&0x01)<<4);
      timing_pat=0x0a;
      break;
    case 3:
      t=this._bits[4] & 0x7f;
      r=((this._bits[4] & 0xc0)>>6)|((this._bits[5] & 0x1f)<<2);
      b=((this._bits[5] & 0xf0)>>4)|((this._bits[6] & 0x07)<<4);
      l=((this._bits[6] & 0xfc)>>2)|((this._bits[4] & 0x01)<<6);
      timing_pat=0x2a;
      break;
    default:
      return -3;
    }
    //タイミングパターンの比較
    // timing pattern comparison
    if(t==timing_pat){
      if(r==timing_pat){
        return (b!=timing_pat && l!=timing_pat)?2:-2;
      }else if(l==timing_pat){
        return (b!=timing_pat && r!=timing_pat)?3:-2;
      }
    }else if(b==timing_pat){
      if(r==timing_pat){
        return (t!=timing_pat && l!=timing_pat)?1:-2;
      }else if(l==timing_pat){
        return (t!=timing_pat && r!=timing_pat)?0:-2;
      }
    }
    return -1;
  }
  /**
  * 格納しているマーカパターンをエンコードして、マーカデータを返します。
  * Encodes the stored marker pattern, writes marker data to o_out.
  * @param o_out
  * @return
  * 成功すればマーカの方位を返却します。失敗すると-1を返します。
  * On success, returns the marker direction. On failure, returns -1.
  */
  ,encode : function(o_out)
  {
    var d=this.getDirection();
    if(d<0){
      return -1;
    }
    //回転ビットの取得
    // Acquire the rotation bit
    this.getRotatedBits(d,o_out.data);
    var model=this._model;
    //周辺ビットの取得
    // Acquire border bits
    o_out.model=model;
    var control_bits=this.getControlValue(model,o_out.data);
    o_out.check=this.getCheckValue(model,o_out.data);
    o_out.ctrl_mask=control_bits%5;
    o_out.ctrl_domain=toInt(control_bits/5);
    if(o_out.ctrl_domain!=0 || o_out.ctrl_mask!=0){
      // failed to find a proper mask and domain, return -1
      return -1;//ドメイン、マスクは現在0のみなので、それ以外の場合-1（失敗）を返す
    }
    //マスク解除処理を実装すること
    // implement mask release
    return d;
  }
  ,getRotatedBits : function(i_direction,o_out)
  {
    var sl=i_direction*2;
    var sr=8-sl;
    var w1;
    o_out[0]=this._bits[0];
    //RECT1
    w1=this._bits[1];
    o_out[1]=((w1<<sl)|(w1>>sr))& 0xff;
    //RECT2
    sl=i_direction*4;
    sr=16-sl;
    w1=this._bits[2]|(this._bits[3]<<8);
    w1=(w1<<sl)|(w1>>sr);
    o_out[2]=w1 & 0xff;
    o_out[3]=(w1>>8) & 0xff;
    if(this._model<2){
      return;
    }
    //RECT3
    sl=i_direction*6;
    sr=24-sl;
    w1=this._bits[4]|(this._bits[5]<<8)|(this._bits[6]<<16);
    w1=(w1<<sl)|(w1>>sr);
    o_out[4]=w1 & 0xff;
    o_out[5]=(w1>>8) & 0xff;
    o_out[6]=(w1>>16) & 0xff;
    if(this._model<3){
      return;
    }
    //RECT4(Lv4以降はここの制限を変える) uncomment when Lv4 supported
  //    shiftLeft(this._bits,7,3,i_direction*8);
  //    if(this._model<4){
  //      return;
  //    }
    return;
  }
  ,shiftLeft : function(i_pack,i_start,i_length,i_ls)
  {
    var i;
    var work=this._work;
    //端数シフト
    var mod_shift=i_ls%8;
    for(i=i_length-1;i>=1;i--){
      work[i]=(i_pack[i+i_start]<<mod_shift)|(0xff&(i_pack[i+i_start-1]>>(8-mod_shift)));
    }
    work[0]=(i_pack[i_start]<<mod_shift)|(0xff&(i_pack[i_start+i_length-1]>>(8-mod_shift)));
    //バイトシフト
    var byte_shift=toInt(i_ls/8)%i_length;
    for(i=i_length-1;i>=0;i--){
      i_pack[(byte_shift+i)%i_length+i_start]=0xff & work[i];
    }
    return;
  }
})
INyIdMarkerData = ASKlass('INyIdMarkerData',
{
  /**
   * i_targetのマーカデータと自身のデータが等しいかを返します。
   * @param i_target
   * 比較するマーカオブジェクト
   * @return
   * 等しいかの真偽値
   */
  isEqual : function(i_target){},
  /**
   * i_sourceからマーカデータをコピーします。
   * @param i_source
   */
  copyFrom : function(i_source){}
})


/**
 * ラスタ画像の任意矩形から、NyARIdMarkerDataを抽出します。
 *
 */
NyIdMarkerPickup = ASKlass('NyIdMarkerPickup',
{
  _perspective_reader : null,
  __pickFromRaster_th : new TThreshold(),
  __pickFromRaster_encoder : new MarkerPattEncoder(),
  NyIdMarkerPickup : function()
  {
    this._perspective_reader=new PerspectivePixelReader();
    return;
  }
  /**
   * Initialize the marker pickup for a new frame.
   * Clears out old values from perspective reader motion cache.
   */
  ,init : function()
  {
    this._perspective_reader.newFrame();
  }
  /**
   * i_imageから、idマーカを読みだします。
   * o_dataにはマーカデータ、o_paramにはまーかのパラメータを返却します。
   * @param image
   * @param i_square
   * @param o_data
   * @param o_param
   * @return
   * @throws NyARException
   */
  ,pickFromRaster : function(image,i_vertex,o_data,o_param)
  {
    //遠近法のパラメータを計算
    if(!this._perspective_reader.setSourceSquare(i_vertex)){
      if (window.DEBUG)
        console.log('NyIdMarkerPickup.pickFromRaster: could not setSourceSquare')
      return false;
    };
    var reader=image.getGrayPixelReader();
    var raster_size=image.getSize();
    var th=this.__pickFromRaster_th;
    var encoder=this.__pickFromRaster_encoder;
    //マーカパラメータを取得
    this._perspective_reader.detectThresholdValue(reader,raster_size,th);
    if(!this._perspective_reader.readDataBits(reader,raster_size,th, encoder)){
      if (window.DEBUG)
        console.log('NyIdMarkerPickup.pickFromRaster: could not readDataBits')
      return false;
    }
    var d=encoder.encode(o_data);
    if(d<0){
      if (window.DEBUG)
        console.log('NyIdMarkerPickup.pickFromRaster: could not encode')
      return false;
    }
    o_param.direction=d;
    o_param.threshold=th.th;
    return true;
  }
})






/**
 * NyARColorPatt_NyIdMarkerがラスタからPerspective変換して読みだすためのクラス
 *
 */
PerspectivePixelReader = ASKlass('PerspectivePixelReader',
{
  _param_gen : new NyARPerspectiveParamGenerator_O1(1,1,100,100),
  _cparam : new FloatVector(8),
  PerspectivePixelReader : function()
  {
    return;
  }
  ,maxPreviousFrameAge : 1
  ,newFrame : function()
  {
    for (var i in this.previousFrames) {
      var pf = this.previousFrames[i];
      pf.age++;
      if (pf.age > this.maxPreviousFrameAge) {
        delete this.previousFrames[i];
      }
    }
  }
  ,setSourceSquare : function(i_vertex)
  {
    var cx = 0, cy = 0;
    for (var i=0; i<4; i++) {
      cx += i_vertex[i].x;
      cy += i_vertex[i].y;
    }
    cx /= 4;
    cy /= 4;
    var qx = toInt(cx / 10);
    var qy = toInt(cy / 10);
    this.centerPoint[0] = qx;
    this.centerPoint[1] = qy;
    return this._param_gen.getParam(i_vertex, this._cparam);
  }
  /**
  * 矩形からピクセルを切り出します
  * @param i_lt_x
  * @param i_lt_y
  * @param i_step_x
  * @param i_step_y
  * @param i_width
  * @param i_height
  * @param i_out_st
  * o_pixelへの格納場所の先頭インデクス
  * @param o_pixel
  * @throws NyARException
  */
  ,rectPixels : function(i_reader,i_raster_size,i_lt_x,i_lt_y,i_step_x,i_step_y,i_width,i_height,i_out_st,o_pixel)
  {
    var cpara=this._cparam;
    var ref_x=this._ref_x;
    var ref_y=this._ref_y;
    var pixcel_temp=this._pixcel_temp;
    var raster_width=i_raster_size.w;
    var raster_height=i_raster_size.h;
    var out_index=i_out_st;
    var cpara_6=cpara[6];
    var cpara_0=cpara[0];
    var cpara_3=cpara[3];
    for(var i=0;i<i_height;i++){
      //1列分のピクセルのインデックス値を計算する。
      var cy0=1+i*i_step_y+i_lt_y;
      var cpy0_12=cpara[1]*cy0+cpara[2];
      var cpy0_45=cpara[4]*cy0+cpara[5];
      var cpy0_7=cpara[7]*cy0+1.0;
      var pt = 0;
      var i2;
      for(i2=0;i2<i_width;i2++)
      {
        var cx0=1+i2*i_step_x+i_lt_x;
        var d=cpara_6*cx0+cpy0_7;
        var x=toInt((cpara_0*cx0+cpy0_12)/d);
        var y=toInt((cpara_3*cx0+cpy0_45)/d);
        if(x<0||y<0||x>=raster_width||y>=raster_height)
        {
          return false;
        }
        ref_x[pt]=x;
        ref_y[pt]=y;
        pt++;
      }
      //1行分のピクセルを取得(場合によっては専用アクセサを書いた方がいい)
      i_reader.getPixelSet(ref_x,ref_y,i_width,pixcel_temp);
      //グレースケールにしながら、line→mapへの転写
      for(i2=0;i2<i_width;i2++){
        var index=i2;
        o_pixel[out_index]=pixcel_temp[index];
        out_index++;
      }
    }
    return true;
  }
  /**
  * i_freqにあるゼロクロス点の周期が、等間隔か調べます。
  * 次段半周期が、前段の80%より大きく、120%未満であるものを、等間隔周期であるとみなします。
  * @param i_freq
  * @param i_width
  */
  ,checkFreqWidth : function(i_freq,i_width)
  {
    var c=i_freq[1]-i_freq[0];
    var count=i_width*2-1;
    for (var i= 1; i < count; i++) {
      var n=i_freq[i+1]-i_freq[i];
      var v=n*100/c;
      if(v>150 || v<50){
        return false;
      }
      c=n;
    }
    return true;
  }
  /**
  * i_freq_count_tableとi_freq_tableの内容を調査し、最も大きな周波数成分を返します。
  * @param i_freq_count_table
  * @param i_freq_table
  * @param o_freq_table
  * @return
  * 見つかれば0以上、密辛ければ0未満
  */
  ,getMaxFreq : function(i_freq_count_table,i_freq_table,o_freq_table)
  {
    //一番成分の大きいものを得る
    var index=-1;
    var max = 0;
    var i;
    for(i=0;i<this.MAX_FREQ;i++){
      if(max<i_freq_count_table[i]){
        index=i;
        max=i_freq_count_table[i];
      }
    }
    if(index==-1){
      return -1;
    }
    /*周波数インデクスを計算*/
    var st=(index-1)*index;
    for(i=0;i<index*2;i++)
    {
      o_freq_table[i]=i_freq_table[st+i]*this.FRQ_STEP/max;
    }
    return index;
  },
  //タイミングパターン用のパラメタ(this.FRQ_POINTS*this.FRQ_STEPが100を超えないようにすること)
  FRQ_EDGE : 10,
  FRQ_STEP : 2,
  FRQ_POINTS : (100-(5/*FRQ_EDGE*/*2))/2/*FRQ_STEP*/,
  MIN_FREQ : 3,
  MAX_FREQ : 10,
  FREQ_SAMPLE_NUM : 4,
  MAX_DATA_BITS : 10+10/*MAX_FREQ+MAX_FREQ*/-1,
  _ref_x : new IntVector(108),
  _ref_y : new IntVector(108),
  //(model+1)*4*3とthis.THRESHOLD_PIXEL*3のどちらか大きい方
  _pixcel_temp : new IntVector(108),
  _freq_count_table : new IntVector(10/*MAX_FREQ*/),
  _freq_table : new IntVector((10/*MAX_FREQ*/*2-1)*10/*MAX_FREQ*/*2/2),
  /**
  * i_y1行目とi_y2行目を平均して、タイミングパターンの周波数を得ます。
  * LHLを1周期として、たとえばLHLHLの場合は2を返します。LHLHやHLHL等の始端と終端のレベルが異なるパターンを
  * 検出した場合、関数は失敗します。
  *
  * @param i_y1
  * @param i_y2
  * @param i_th_h
  * @param i_th_l
  * @param o_edge_index
  * 検出したエッジ位置(H->L,L->H)のインデクスを受け取る配列です。
  * [this.FRQ_POINTS]以上の配列を指定してください。
  * @return
  * @throws NyARException
  */
  getRowFrequency : function(i_reader,i_raster_size,i_y1,i_th_h,i_th_l,o_edge_index)
  {
    var i;
    //3,4,5,6,7,8,9,10
    var freq_count_table=this._freq_count_table;
    //0,2,4,6,8,10,12,14,16,18,20の要素を持つ配列
    var freq_table=this._freq_table;
    //初期化
    var cpara=this._cparam;
    var ref_x=this._ref_x;
    var ref_y=this._ref_y;
    var pixcel_temp=this._pixcel_temp;
    for(i=0;i<10;i++){
      freq_count_table[i]=0;
    }
    for(i=0;i<110;i++){
      freq_table[i]=0;
    }
    var raster_width=i_raster_size.w;
    var raster_height=i_raster_size.h;
    var cpara_0=cpara[0];
    var cpara_3=cpara[3];
    var cpara_6=cpara[6];
    var cv;
    if (window.DEBUG) {
      cv = document.getElementById('debugCanvas').getContext('2d');
      cv.fillStyle = 'orange';
    }
    //10-20ピクセル目からタイミングパターンを検出
    for (i = 0; i < this.FREQ_SAMPLE_NUM; i++) {
      var i2;
      //2行分のピクセルインデックスを計算
      var cy0=1+i_y1+i/**this.FRQ_STEP*5+this.FRQ_EDGE*/;
      var cpy0_12=cpara[1]*cy0+cpara[2];
      var cpy0_45=cpara[4]*cy0+cpara[5];
      var cpy0_7=cpara[7]*cy0+1.0;
      var pt=0;
      for(i2=0;i2<this.FRQ_POINTS;i2++)
      {
        var cx0=1+i2*this.FRQ_STEP+this.FRQ_EDGE;
        var d=(cpara_6*cx0)+cpy0_7;
        var x=toInt((cpara_0*cx0+cpy0_12)/d);
        var y=toInt((cpara_3*cx0+cpy0_45)/d);
        if(x<0||y<0||x>=raster_width||y>=raster_height)
        {
          return -1;
        }
        ref_x[pt]=x;
        ref_y[pt]=y;
        pt++;
      }
      //ピクセルを取得(入力画像を多様化するならここから先を調整すること)
      i_reader.getPixelSet(ref_x,ref_y,this.FRQ_POINTS,pixcel_temp);
      if (window.DEBUG) {
        for (var j=0; j<this.FRQ_POINTS; j++) {
          cv.fillRect(ref_x[j], ref_y[j], 1,1);
        }
      }
      //o_edge_indexを一時的に破壊して調査する
      var freq_t=this.getFreqInfo(pixcel_temp,i_th_h,i_th_l,o_edge_index);
      //周期は3-10であること
      if(freq_t<this.MIN_FREQ || freq_t>this.MAX_FREQ){
        continue;
      }
      //周期は等間隔であること
      if(!this.checkFreqWidth(o_edge_index,freq_t)){
        continue;
      }
      //検出カウンタを追加
      freq_count_table[freq_t]++;
      var table_st=(freq_t-1)*freq_t;
      for(i2=0;i2<freq_t*2;i2++){
        freq_table[table_st+i2]+=o_edge_index[i2];
      }
    }
    return this.getMaxFreq(freq_count_table,freq_table,o_edge_index);
  }
  ,getColFrequency : function(i_reader,i_raster_size,i_x1,i_th_h,i_th_l,o_edge_index)
  {
    var i;
    var cpara=this._cparam;
    var ref_x=this._ref_x;
    var ref_y=this._ref_y;
    var pixcel_temp=this._pixcel_temp;
    //0,2,4,6,8,10,12,14,16,18,20=(11*20)/2=110
    //初期化
    var freq_count_table=this._freq_count_table;
    for(i=0;i<10;i++){
      freq_count_table[i]=0;
    }
    var freq_table = this._freq_table;
    for(i=0;i<110;i++){
      freq_table[i]=0;
    }
    var raster_width=i_raster_size.w;
    var raster_height=i_raster_size.h;
    var cpara7=cpara[7];
    var cpara4=cpara[4];
    var cpara1=cpara[1];
    var cv;
    if (window.DEBUG) {
      cv = document.getElementById('debugCanvas').getContext('2d');
      cv.fillStyle = 'green';
    }
    //基準点から4ピクセルを参照パターンとして抽出
    for (i = 0; i < this.FREQ_SAMPLE_NUM; i++) {
      var i2;
      var cx0=1+i/**this.FRQ_STEP*5+this.FRQ_EDGE*/+i_x1;
      var cp6_0=cpara[6]*cx0;
      var cpx0_0=cpara[0]*cx0+cpara[2];
      var cpx3_0=cpara[3]*cx0+cpara[5];
      var pt=0;
      for(i2=0;i2<this.FRQ_POINTS;i2++)
      {
        var cy=1+i2*this.FRQ_STEP+this.FRQ_EDGE;
        var d=cp6_0+cpara7*cy+1.0;
        var x=toInt((cpx0_0+cpara1*cy)/d);
        var y=toInt((cpx3_0+cpara4*cy)/d);
        if(x<0||y<0||x>=raster_width||y>=raster_height)
        {
          return -1;
        }
        ref_x[pt]=x;
        ref_y[pt]=y;
        pt++;
      }
      //ピクセルを取得(入力画像を多様化するならここを調整すること)
      i_reader.getPixelSet(ref_x,ref_y,this.FRQ_POINTS,pixcel_temp);
      if (window.DEBUG) {
        for (var j=0; j<this.FRQ_POINTS; j++) {
          cv.fillRect(ref_x[j], ref_y[j], 1,1);
        }
      }
      var freq_t=this.getFreqInfo(pixcel_temp,i_th_h,i_th_l,o_edge_index);
      //周期は3-10であること
      if(freq_t<this.MIN_FREQ || freq_t>this.MAX_FREQ){
        continue;
      }
      //周期は等間隔であること
      if(!this.checkFreqWidth(o_edge_index,freq_t)){
        continue;
      }
      //検出カウンタを追加
      freq_count_table[freq_t]++;
      var table_st=(freq_t-1)*freq_t;
      for(i2=0;i2<freq_t*2;i2++){
        freq_table[table_st+i2]+=o_edge_index[i2];
      }
    }
    return this.getMaxFreq(freq_count_table,freq_table,o_edge_index);
  }
  /**
  * デバックすんだらstaticにしておｋ
  * @param i_pixcels
  * @param i_th_h
  * @param i_th_l
  * @param o_edge_index
  * @return
  */
  ,getFreqInfo : function(i_pixcels,i_th_h,i_th_l,o_edge_index)
  {
    //トークンを解析して、周波数を計算
    var i=0;
    var frq_l2h=0;
    var frq_h2l = 0;
    var index,pix;
    while(i<this.FRQ_POINTS){
      //L->Hトークンを検出する
      while(i<this.FRQ_POINTS){
        index=i;
        pix=i_pixcels[index];
        if(pix>i_th_h){
          //トークン発見
          o_edge_index[frq_l2h+frq_h2l]=i;
          frq_l2h++;
          break;
        }
        i++;
      }
      i++;
      //L->Hトークンを検出する
      while(i<this.FRQ_POINTS){
        index=i;
        pix=i_pixcels[index];
        if(pix<=i_th_l){
          //トークン発見
          o_edge_index[frq_l2h+frq_h2l]=i;
          frq_h2l++;
          break;
        }
        i++;
      }
      i++;
    }
    return frq_l2h==frq_h2l?frq_l2h:-1;
  },
  THRESHOLD_EDGE : 10,
  THRESHOLD_STEP : 2,
  THRESHOLD_WIDTH : 10,
  THRESHOLD_PIXEL : 10/2/*this.THRESHOLD_WIDTH/this.THRESHOLD_STEP*/,
  THRESHOLD_SAMPLE : 5*5/*this.THRESHOLD_PIXEL*this.THRESHOLD_PIXEL*/,
  THRESHOLD_SAMPLE_LT : 10/*this.THRESHOLD_EDGE*/,
  THRESHOLD_SAMPLE_RB : 100-10-10/*this.THRESHOLD_WIDTH-this.THRESHOLD_EDGE*/,
  /**
  * ピクセル配列の上位、下位の4ピクセルのピクセル値平均を求めます。
  * この関数は、(4/i_pixcel.length)の領域を占有するPtail法で双方向の閾値を求めることになります。
  * @param i_pixcel
  * @param i_initial
  * @param i_out
  */
  getPtailHighAndLow : function(i_pixcel,i_out )
  {
    var h3,h2,h1,h0,l3,l2,l1,l0;
    h3=h2=h1=h0=l3=l2=l1=l0=i_pixcel[0];
    for(var i=i_pixcel.length-1;i>=1;i--){
      var pix=i_pixcel[i];
      if(h0<pix){
        if(h1<pix){
          if(h2<pix){
            if(h3<pix){
              h0=h1;
              h1=h2;
              h2=h3;
              h3=pix;
            }else{
              h0=h1;
              h1=h2;
              h2=pix;
            }
          }else{
            h0=h1;
            h1=pix;
          }
        }else{
          h0=pix;
        }
      }
      if(l0>pix){
        if(l1>pix){
          if(l2>pix){
            if(l3>pix){
              l0=l1;
              l1=l2;
              l2=l3;
              l3=pix;
            }else{
              l0=l1;
              l1=l2;
              l2=pix;
            }
          }else{
            l0=l1;
            l1=pix;
          }
        }else{
          l0=pix;
        }
      }
    }
    i_out.l=(l0+l1+l2+l3)/4;
    i_out.h=(h0+h1+h2+h3)/4;
    return;
  },
  __detectThresholdValue_hl : new THighAndLow(),
  __detectThresholdValue_tpt : new NyARIntPoint2d(),
  _th_pixels : new IntVector(5*5/*this.THRESHOLD_SAMPLE*/*4),
  /**
  * 指定した場所のピクセル値を調査して、閾値を計算して返します。
  * @param i_reader
  * @param i_x
  * @param i_y
  * @return
  * @throws NyARException
  */
  detectThresholdValue : function(i_reader,i_raster_size,o_threshold)
  {
    var th_pixels=this._th_pixels;
    //左上のピックアップ領域からピクセルを得る(00-24)
    this.rectPixels(i_reader,i_raster_size,this.THRESHOLD_SAMPLE_LT,this.THRESHOLD_SAMPLE_LT,this.THRESHOLD_STEP,this.THRESHOLD_STEP,this.THRESHOLD_PIXEL,this.THRESHOLD_PIXEL,0,th_pixels);
    //左下のピックアップ領域からピクセルを得る(25-49)
    this.rectPixels(i_reader,i_raster_size,this.THRESHOLD_SAMPLE_LT,this.THRESHOLD_SAMPLE_RB,this.THRESHOLD_STEP,this.THRESHOLD_STEP,this.THRESHOLD_PIXEL,this.THRESHOLD_PIXEL,this.THRESHOLD_SAMPLE,th_pixels);
    //右上のピックアップ領域からピクセルを得る(50-74)
    this.rectPixels(i_reader,i_raster_size,this.THRESHOLD_SAMPLE_RB,this.THRESHOLD_SAMPLE_LT,this.THRESHOLD_STEP,this.THRESHOLD_STEP,this.THRESHOLD_PIXEL,this.THRESHOLD_PIXEL,this.THRESHOLD_SAMPLE*2,th_pixels);
    //右下のピックアップ領域からピクセルを得る(75-99)
    this.rectPixels(i_reader,i_raster_size,this.THRESHOLD_SAMPLE_RB,this.THRESHOLD_SAMPLE_RB,this.THRESHOLD_STEP,this.THRESHOLD_STEP,this.THRESHOLD_PIXEL,this.THRESHOLD_PIXEL,this.THRESHOLD_SAMPLE*3,th_pixels);
    var hl=this.__detectThresholdValue_hl;
    //Ptailで求めたピクセル平均
    this.getPtailHighAndLow(th_pixels,hl);
    //閾値中心
    var th=(hl.h+hl.l)/2;
    //ヒステリシス(差分の20%)
    var th_sub=(hl.h-hl.l)/5;
    o_threshold.th=th;
    o_threshold.th_h=th+th_sub;//ヒステリシス付き閾値
    o_threshold.th_l=th-th_sub;//ヒステリシス付き閾値
    //エッジを計算(明点重心)
    var lt_x,lt_y,lb_x,lb_y,rt_x,rt_y,rb_x,rb_y;
    var tpt=this.__detectThresholdValue_tpt;
    //LT
    if(this.getHighPixelCenter(0,th_pixels,this.THRESHOLD_PIXEL,this.THRESHOLD_PIXEL,th,tpt)){
      lt_x=tpt.x*this.THRESHOLD_STEP;
      lt_y=tpt.y*this.THRESHOLD_STEP;
    }else{
      lt_x=11;
      lt_y=11;
    }
    //LB
    if(this.getHighPixelCenter(this.THRESHOLD_SAMPLE*1,th_pixels,this.THRESHOLD_PIXEL,this.THRESHOLD_PIXEL,th,tpt)){
      lb_x=tpt.x*this.THRESHOLD_STEP;
      lb_y=tpt.y*this.THRESHOLD_STEP;
    }else{
      lb_x=11;
      lb_y=-1;
    }
    //RT
    if(this.getHighPixelCenter(this.THRESHOLD_SAMPLE*2,th_pixels,this.THRESHOLD_PIXEL,this.THRESHOLD_PIXEL,th,tpt)){
      rt_x=tpt.x*this.THRESHOLD_STEP;
      rt_y=tpt.y*this.THRESHOLD_STEP;
    }else{
      rt_x=-1;
      rt_y=11;
    }
    //RB
    if(this.getHighPixelCenter(this.THRESHOLD_SAMPLE*3,th_pixels,this.THRESHOLD_PIXEL,this.THRESHOLD_PIXEL,th,tpt)){
      rb_x=tpt.x*this.THRESHOLD_STEP;
      rb_y=tpt.y*this.THRESHOLD_STEP;
    }else{
      rb_x=-1;
      rb_y=-1;
    }
    //トラッキング開始位置の決定
    o_threshold.lt_x=(lt_x+lb_x)/2+this.THRESHOLD_SAMPLE_LT-1;
    o_threshold.rb_x=(rt_x+rb_x)/2+this.THRESHOLD_SAMPLE_RB+1;
    o_threshold.lt_y=(lt_y+rt_y)/2+this.THRESHOLD_SAMPLE_LT-1;
    o_threshold.rb_y=(lb_y+rb_y)/2+this.THRESHOLD_SAMPLE_RB+1;
    return;
  }
  ,getHighPixelCenter : function(i_st,i_pixels,i_width,i_height,i_th,o_point)
  {
    var rp=i_st;
    var pos_x=0;
    var pos_y=0;
    var number_of_pos=0;
    for(var i=0;i<i_height;i++){
      for(var i2=0;i2<i_width;i2++){
        if(i_pixels[rp++]>i_th){
          pos_x+=i2;
          pos_y+=i;
          number_of_pos++;
        }
      }
    }
    if(number_of_pos>0){
      pos_x/=number_of_pos;
      pos_y/=number_of_pos;
    }else{
      return false;
    }
    o_point.x=pos_x;
    o_point.y=pos_y;
    return true;
  },
  __detectDataBitsIndex_freq_index1 : new IntVector((100-(5*2))/2/*this.FRQ_POINTS*/),
  __detectDataBitsIndex_freq_index2 : new IntVector((100-(5*2))/2/*this.FRQ_POINTS*/),
  detectDataBitsIndex : function(i_reader,i_raster_size,i_th,o_index_row,o_index_col)
  {
    var i;
    //周波数を測定
    var freq_index1=this.__detectDataBitsIndex_freq_index1;
    var freq_index2=this.__detectDataBitsIndex_freq_index2;
    var lydiff = i_th.rb_y-i_th.lt_y;
    var frq_t=this.getRowFrequency(i_reader,i_raster_size,i_th.lt_y/*-0.25*this.FRQ_EDGE*/,i_th.th_h,i_th.th_l,freq_index1);
    var frq_b=this.getRowFrequency(i_reader,i_raster_size,i_th.rb_y/*-0.5*lydiff*/,i_th.th_h,i_th.th_l,freq_index2);
    //周波数はまとも？
    if((frq_t<0 && frq_b<0) || frq_t==frq_b){
      if (window.DEBUG)
        console.log('bad row frq', frq_t, frq_b)
      return -1;
    }
    //タイミングパターンからインデクスを作成
    var freq_h,freq_v;
    var index;
    if(frq_t>frq_b){
      freq_h=frq_t;
      index=freq_index1;
    }else{
      freq_h=frq_b;
      index=freq_index2;
    }
    for(i=0;i<freq_h+freq_h-1;i++){
      o_index_row[i*2]=((index[i+1]-index[i])*2/5+index[i])+this.FRQ_EDGE;
      o_index_row[i*2+1]=((index[i+1]-index[i])*3/5+index[i])+this.FRQ_EDGE;
    }
    var lxdiff = i_th.rb_x-i_th.lt_x;
    var frq_l=this.getColFrequency(i_reader,i_raster_size,i_th.lt_x/*-0.25*this.FRQ_EDGE*/,i_th.th_h,i_th.th_l,freq_index1);
    var frq_r=this.getColFrequency(i_reader,i_raster_size,i_th.rb_x/*-0.5*lxdiff*/,i_th.th_h,i_th.th_l,freq_index2);
    //周波数はまとも？
    if((frq_l<0 && frq_r<0) || frq_l==frq_r){
      if (window.DEBUG)
        console.log('bad col frq', frq_l, frq_r);
      return -1;
    }
    //タイミングパターンからインデクスを作成
    if(frq_l>frq_r){
      freq_v=frq_l;
      index=freq_index1;
    }else{
      freq_v=frq_r;
      index=freq_index2;
    }
    //同じ周期？
    if(freq_v!=freq_h){
      if (window.DEBUG)
        console.log('freq mismatch', freq_v, freq_h)
      return -1;
    }
    for(i=0;i<freq_v+freq_v-1;i++){
      var w=index[i];
      var w2= index[i + 1] - w;
      o_index_col[i*2]=((w2)*2/5+w)+this.FRQ_EDGE;
      o_index_col[i*2+1]=((w2)*3/5+w)+this.FRQ_EDGE;
    }
    //Lv4以上は無理
    if(freq_v>this.MAX_FREQ){
      if (window.DEBUG)
        console.log('too high freq', freq_v)
      return -1;
    }
    return freq_v;
  },
  __readDataBits_index_bit_x : new FloatVector(19/*MAX_DATA_BITS*/*2),
  __readDataBits_index_bit_y : new FloatVector(19/*MAX_DATA_BITS*/*2),
  previousFrames : {},
  centerPoint : new IntVector(2),
  getPreviousFrameSize : function(index_x, index_y) {
    var cx = this.centerPoint[0], cy = this.centerPoint[1];
    var pfs = this.previousFrames;
    var pf = (
      pfs[cx+":"+cy] || pfs[(cx-1)+":"+cy] || pfs[(cx+1)+":"+cy] ||
      pfs[cx+":"+(cy-1)] || pfs[(cx-1)+":"+(cy-1)] || pfs[(cx+1)+":"+(cy-1)] ||
      pfs[cx+":"+(cy+1)] || pfs[(cx-1)+":"+(cy+1)] || pfs[(cx+1)+":"+(cy+1)]
    );
    if (!pf)
      return -1;
    index_x.set(pf.index_x);
    index_y.set(pf.index_y);
    return pf.size;
  },
  setPreviousFrameSize : function(size, index_x, index_y) {
    var pf = this.previousFrames[this.centerPoint[0]+":"+this.centerPoint[1]];
    if (!pf) {
      pf = {age: 0, size: size, index_x: new FloatVector(index_x), index_y: new FloatVector(index_y)};
      this.previousFrames[this.centerPoint[0]+":"+this.centerPoint[1]] = pf;
      return;
    }
    pf.age = 0;
    pf.size = size;
    pf.index_x.set(index_x);
    pf.index_y.set(index_y);
  },
  readDataBits : function(i_reader, i_raster_size, i_th, o_bitbuffer)
  {
    var index_x=this.__readDataBits_index_bit_x;
    var index_y=this.__readDataBits_index_bit_y;
    //読み出し位置を取得
    var size=this.detectDataBitsIndex(i_reader,i_raster_size,i_th,index_x,index_y);
    if (size<0) {
      size = this.getPreviousFrameSize(index_x, index_y);
    }
    var resolution=size+size-1;
    if(size<0){
      if (window.DEBUG)
        console.log('readDataBits: size < 0');
      return false;
    }
    if(!o_bitbuffer.initEncoder(size-1)){
      if (window.DEBUG)
        console.log('readDataBits: initEncoder');
      return false;
    }
    var cpara=this._cparam;
    var ref_x=this._ref_x;
    var ref_y=this._ref_y;
    var pixcel_temp=this._pixcel_temp;
    var cpara_0=cpara[0];
    var cpara_1=cpara[1];
    var cpara_3=cpara[3];
    var cpara_6=cpara[6];
    var th=i_th.th;
    var p=0;
    for (var i = 0; i < resolution; i++) {
      var i2;
      //1列分のピクセルのインデックス値を計算する。
      var cy0=1+index_y[i*2+0];
      var cy1=1+index_y[i*2+1];
      var cpy0_12=cpara_1*cy0+cpara[2];
      var cpy0_45=cpara[4]*cy0+cpara[5];
      var cpy0_7=cpara[7]*cy0+1.0;
      var cpy1_12=cpara_1*cy1+cpara[2];
      var cpy1_45=cpara[4]*cy1+cpara[5];
      var cpy1_7=cpara[7]*cy1+1.0;
      var pt=0;
      for(i2=0;i2<resolution;i2++)
      {
        var d;
        var cx0=1+index_x[i2*2+0];
        var cx1=1+index_x[i2*2+1];
        var cp6_0=cpara_6*cx0;
        var cpx0_0=cpara_0*cx0;
        var cpx3_0=cpara_3*cx0;
        var cp6_1=cpara_6*cx1;
        var cpx0_1=cpara_0*cx1;
        var cpx3_1=cpara_3*cx1;
        d=cp6_0+cpy0_7;
        ref_x[pt]=toInt((cpx0_0+cpy0_12)/d);
        ref_y[pt]=toInt((cpx3_0+cpy0_45)/d);
        pt++;
        d=cp6_0+cpy1_7;
        ref_x[pt]=toInt((cpx0_0+cpy1_12)/d);
        ref_y[pt]=toInt((cpx3_0+cpy1_45)/d);
        pt++;
        d=cp6_1+cpy0_7;
        ref_x[pt]=toInt((cpx0_1+cpy0_12)/d);
        ref_y[pt]=toInt((cpx3_1+cpy0_45)/d);
        pt++;
        d=cp6_1+cpy1_7;
        ref_x[pt]=toInt((cpx0_1+cpy1_12)/d);
        ref_y[pt]=toInt((cpx3_1+cpy1_45)/d);
        pt++;
      }
      //1行分のピクセルを取得(場合によっては専用アクセサを書いた方がいい)
      i_reader.getPixelSet(ref_x,ref_y,resolution*4,pixcel_temp);
      //グレースケールにしながら、line→mapへの転写
      for(i2=0;i2<resolution;i2++){
        var index=i2*4;
        var pixel=(pixcel_temp[index+0]+pixcel_temp[index+1]+pixcel_temp[index+2]+pixcel_temp[index+3])/(4);
        //暗点を1、明点を0で表現します。
        o_bitbuffer.setBitByBitIndex(p,pixel>th?0:1);
        p++;
      }
    }
    this.setPreviousFrameSize(size, index_x, index_y);
    return true;
  }
  ,setSquare : function(i_vertex)
  {
    if (!this._param_gen.getParam(i_vertex,this._cparam)) {
      return false;
    }
    return true;
  }
})
MarkerPattDecoder = ASKlass('MarkerPattDecoder',
{
  decode : function(model,domain,mask)
  {
  }
})

INyIdMarkerDataEncoder = ASKlass('INyIdMarkerDataEncoder',
{
  encode : function(i_data,o_dest){},
  createDataInstance : function(){}
})
NyIdMarkerDataEncoder_RawBit = ASKlass('NyIdMarkerDataEncoder_RawBit', INyIdMarkerDataEncoder,
{
  _DOMAIN_ID : 0,
  _mod_data : new IntVector([7,31,127,511,2047,4095]),
  encode : function(i_data,o_dest)
  {
    var dest=(o_dest);
    if(i_data.ctrl_domain!=this._DOMAIN_ID){
      return false;
    }
    // calculate marker resolution (amount of data dots per side)
    var resolution_len = (i_data.model * 2 - 1); //trace("resolution", resolution_len);
    // there are (2*model-1)^2 data dots in a marker
    // and the amount of packets in a marker is
    // floor(dataDotCount / 8) + 1  (the +1 is packet 0)
    var packet_length = (((resolution_len * resolution_len)) / 8) + 1; //trace("packet", packet_length);
    var sum = 0;
    for(var i=0;i<packet_length;i++){
      dest.packet[i] = i_data.data[i]; //trace("i_data[",i,"]",i_data.data[i]);
      sum += i_data.data[i];
    }
    // data point check sum calculation
    sum = sum % this._mod_data[i_data.model - 2]; //trace("check dot", i_data.check, sum);
    // compare data point check sum with expected
    if(i_data.check!=sum){
      return false;
    }
    dest.length=packet_length;
    return true;
  }
  ,createDataInstance : function()
  {
    return new NyIdMarkerData_RawBit();
  }
})
NyIdMarkerData_RawBit = ASKlass('NyIdMarkerData_RawBit', INyIdMarkerData,
{
  packet : new IntVector(22),
  length : 0,
  isEqual : function(i_target)
  {
    var s=(i_target);
    if(s.length!=this.length){
      return false;
    }
    for(var i=s.length-1;i>=0;i--){
      if(s.packet[i]!=this.packet[i]){
        return false;
      }
    }
    return true;
  }
  ,copyFrom : function(i_source)
  {
    var s=(i_source);
    ArrayUtils.copyInt(s.packet,0,this.packet,0,s.length);
    this.length=s.length;
    return;
  }
})
/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */
INyARColorPatt = ASKlass('INyARColorPatt', INyARRgbRaster,
{
  /**
   * ラスタイメージからi_square部分のカラーパターンを抽出して、thisメンバに格納します。
   *
   * @param image
   * Source raster object.
   * ----
   * 抽出元のラスタオブジェクト
   * @param i_vertexs
   * Vertexes of the square. Number of element must be 4.
   * ----
   * 射影変換元の４角形を構成する頂点群頂群。要素数は4であること。
   * @return
   * True if sucessfull; otherwise false.
   * ----
   * ラスターの取得に成功するとTRUE/失敗するとFALSE
   * @throws NyARException
   */
//  public boolean pickFromRaster(INyARRgbRaster image, NyARSquare i_square) throws NyARException;
  pickFromRaster : function(image,i_vertexs){}
})
NyARColorPatt_Perspective = ASKlass('NyARColorPatt_Perspective', INyARColorPatt,
{
  _patdata : null,
  _pickup_lt : new NyARIntPoint2d(),
  _resolution : 0,
  _size : null,
  _perspective_gen : null,
  _pixelreader : null,
  LOCAL_LT : 1,
  BUFFER_FORMAT : NyARBufferType.INT1D_X8R8G8B8_32,
  initializeInstance : function(i_width,i_height,i_point_per_pix)
  {
    NyAS3Utils.assert(i_width>2 && i_height>2);
    this._resolution=i_point_per_pix;
    this._size=new NyARIntSize(i_width,i_height);
    this._patdata = new IntVector(i_height*i_width);
    this._pixelreader=new NyARRgbPixelReader_INT1D_X8R8G8B8_32(this._patdata,this._size);
    return;
  }
  /**
   * 例えば、64
   * @param i_width
   * 取得画像の解像度幅
   * @param i_height
   * 取得画像の解像度高さ
   */
  /**
   * 例えば、64
   * @param i_width
   * 取得画像の解像度幅
   * @param i_height
   * 取得画像の解像度高さ
   * @param i_point_per_pix
   * 1ピクセルあたりの縦横サンプリング数。2なら2x2=4ポイントをサンプリングする。
   * @param i_edge_percentage
   * エッジ幅の割合(ARToolKit標準と同じなら、25)
   */
  ,NyARColorPatt_Perspective : function(i_width,i_height,i_point_per_pix,i_edge_percentage)
  {
    if (i_edge_percentage == null) i_edge_percentage = -1;
    if (i_edge_percentage == -1) {
      this.initializeInstance(i_width,i_height,i_point_per_pix);
      this.setEdgeSize(0,0,i_point_per_pix);
    }else{
      //入力制限
      this.initializeInstance(i_width,i_height,i_point_per_pix);
      this.setEdgeSizeByPercent(i_edge_percentage, i_edge_percentage, i_point_per_pix);
    }
    return;
  }
  /**
   * 矩形領域のエッジサイズを指定します。
   * エッジの計算方法は以下の通りです。
   * 1.マーカ全体を(i_x_edge*2+width)x(i_y_edge*2+height)の解像度でパラメタを計算します。
   * 2.ピクセルの取得開始位置を(i_x_edge/2,i_y_edge/2)へ移動します。
   * 3.開始位置から、width x height個のピクセルを取得します。
   *
   * ARToolKit標準マーカの場合は、width/2,height/2を指定してください。
   * @param i_x_edge
   * @param i_y_edge
   */
  ,setEdgeSize : function(i_x_edge,i_y_edge,i_resolution)
  {
    NyAS3Utils.assert(i_x_edge>=0);
    NyAS3Utils.assert(i_y_edge>=0);
    //Perspectiveパラメタ計算器を作成
    this._perspective_gen=new NyARPerspectiveParamGenerator_O1(
      this.LOCAL_LT,this.LOCAL_LT,
      (i_x_edge*2+this._size.w)*i_resolution,
      (i_y_edge*2+this._size.h)*i_resolution);
    //ピックアップ開始位置を計算
    this._pickup_lt.x=i_x_edge*i_resolution+this.LOCAL_LT;
    this._pickup_lt.y=i_y_edge*i_resolution+this.LOCAL_LT;
    return;
  }
  ,setEdgeSizeByPercent : function(i_x_percent,i_y_percent,i_resolution)
  {
    NyAS3Utils.assert(i_x_percent>=0);
    NyAS3Utils.assert(i_y_percent>=0);
    this.setEdgeSize(this._size.w*i_x_percent/50,this._size.h*i_y_percent/50,i_resolution);
    return;
  }
  ,getWidth : function()
  {
    return this._size.w;
  }
  ,getHeight : function()
  {
    return this._size.h;
  }
  ,getSize : function()
  {
    return   this._size;
  }
  ,getRgbPixelReader : function()
  {
    return this._pixelreader;
  }
  ,getBuffer : function()
  {
    return this._patdata;
  }
  ,hasBuffer : function()
  {
    return this._patdata!=null;
  }
  ,wrapBuffer : function(i_ref_buf)
  {
    NyARException.notImplement();
  }
  ,getBufferType : function()
  {
    return BUFFER_FORMAT;
  }
  ,isEqualBufferType : function(i_type_value)
  {
    return BUFFER_FORMAT==i_type_value;
  },
  __pickFromRaster_rgb_tmp : new IntVector(3),
  __pickFromRaster_cpara : new FloatVector(8),
  /**
   * @see INyARColorPatt#pickFromRaster
   */
  pickFromRaster : function(image,i_vertexs)
  {
    //遠近法のパラメータを計算
    var cpara = this.__pickFromRaster_cpara;
    if (!this._perspective_gen.getParam(i_vertexs, cpara)) {
      return false;
    }
    var resolution=this._resolution;
    var img_x = image.getWidth();
    var img_y = image.getHeight();
    var res_pix=resolution*resolution;
    var rgb_tmp = this.__pickFromRaster_rgb_tmp;
    //ピクセルリーダーを取得
    var reader =image.getRgbPixelReader();
    var p=0;
    for(var iy=0;iy<this._size.h*resolution;iy+=resolution){
      //解像度分の点を取る。
      for(var ix=0;ix<this._size.w*resolution;ix+=resolution){
        var r,g,b;
        r=g=b=0;
        for(var i2y=iy;i2y<iy+resolution;i2y++){
          var cy=this._pickup_lt.y+i2y;
          for(var i2x=ix;i2x<ix+resolution;i2x++){
            //1ピクセルを作成
            var cx=this._pickup_lt.x+i2x;
            var d=cpara[6]*cx+cpara[7]*cy+1.0;
            var x=toInt((cpara[0]*cx+cpara[1]*cy+cpara[2])/d);
            var y=toInt((cpara[3]*cx+cpara[4]*cy+cpara[5])/d);
            if(x<0){x=0;}
            if(x>=img_x){x=img_x-1;}
            if(y<0){y=0;}
            if(y>=img_y){y=img_y-1;}
            reader.getPixel(x, y, rgb_tmp);
            r+=rgb_tmp[0];
            g+=rgb_tmp[1];
            b+=rgb_tmp[2];
          }
        }
        r/=res_pix;
        g/=res_pix;
        b/=res_pix;
        this._patdata[p]=((r&0xff)<<16)|((g&0xff)<<8)|((b&0xff));
        p++;
      }
    }
      //ピクセル問い合わせ
      //ピクセルセット
    return true;
  }
})
NyARColorPatt_Perspective_O2 = ASKlass('NyARColorPatt_Perspective_O2', NyARColorPatt_Perspective,
{
  _pickup : null,
  NyARColorPatt_Perspective_O2 : function(i_width,i_height,i_resolution,i_edge_percentage)
  {
    NyARColorPatt_Perspective.initialize.call(this,i_width,i_height,i_resolution,i_edge_percentage);
    switch(i_resolution){
    case 1:
      this._pickup=new NyARPickFromRaster_1(this._pickup_lt,this._size);
      break;
    case 2:
      this._pickup=new NyARPickFromRaster_2x(this._pickup_lt,this._size);
      break;
    case 4:
      this._pickup=new NyARPickFromRaster_4x(this._pickup_lt,this._size);
      break;
    default:
      this._pickup=new NyARPickFromRaster_N(this._pickup_lt,i_resolution,this._size);
    }
    return;
  }
  /**
   * @see INyARColorPatt#pickFromRaster
   */
  ,pickFromRaster : function(image ,i_vertexs)
  {
    //遠近法のパラメータを計算
    var cpara = this.__pickFromRaster_cpara;
    if (!this._perspective_gen.getParam(i_vertexs, cpara)) {
      return false;
    }
    this._pickup.pickFromRaster(cpara, image,this._patdata);
    return true;
  }
})

IpickFromRaster_Impl = ASKlass('IpickFromRaster_Impl',
{
  pickFromRaster : function(i_cpara,image,o_patt){}
})



/**
 * チェックデジット:4127936236942444153655776299710081208144715171590159116971715177917901890204024192573274828522936312731813388371037714083
 *
 */
NyARPickFromRaster_1 = ASKlass('NyARPickFromRaster_1', IpickFromRaster_Impl,
{
  _size_ref : null,
  _lt_ref : null,
  NyARPickFromRaster_1 : function(i_lt,i_source_size)
  {
    this._lt_ref=i_lt;
    this._size_ref=i_source_size;
    this._rgb_temp=new IntVector(i_source_size.w*3);
    this._rgb_px=new IntVector(i_source_size.w);
    this._rgb_py=new IntVector(i_source_size.w);
    return;
  },
  _rgb_temp : null,
  _rgb_px : null,
  _rgb_py : null,
  pickFromRaster : function(i_cpara, image, o_patt)
  {
    var d0,m0;
    var x,y;
    var img_x = image.getWidth();
    var img_y = image.getHeight();
    var patt_w=this._size_ref.w;
    var rgb_tmp = this._rgb_temp;
    var rgb_px=this._rgb_px;
    var rgb_py=this._rgb_py;
    var cp0=i_cpara[0];
    var cp3=i_cpara[3];
    var cp6=i_cpara[6];
    var cp1=i_cpara[1];
    var cp4=i_cpara[4];
    var cp7=i_cpara[7];
    var pick_y=this._lt_ref.y;
    var pick_x=this._lt_ref.x;
    //ピクセルリーダーを取得
    var reader=image.getRgbPixelReader();
    var p=0;
    var cp0cx0,cp3cx0;
    var cp1cy_cp20=cp1*pick_y+i_cpara[2]+cp0*pick_x;
    var cp4cy_cp50=cp4*pick_y+i_cpara[5]+cp3*pick_x;
    var cp7cy_10=cp7*pick_y+1.0+cp6*pick_x;
    for(var iy=this._size_ref.h-1;iy>=0;iy--){
      m0=1/(cp7cy_10);
      d0=-cp6/(cp7cy_10*(cp7cy_10+cp6));
      cp0cx0=cp1cy_cp20;
      cp3cx0=cp4cy_cp50;
      //ピックアップシーケンス
      //0番目のピクセル(検査対象)をピックアップ
      var ix;
      for(ix=patt_w-1;ix>=0;ix--){
        //1ピクセルを作成
        x=rgb_px[ix]=toInt(cp0cx0*m0);
        y=rgb_py[ix]=toInt(cp3cx0*m0);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[ix]=0;}else if(x>=img_x){rgb_px[ix]=img_x-1;}
          if(y<0){rgb_py[ix]=0;}else if(y>=img_y){rgb_py[ix]=img_y-1;}
        }
        cp0cx0+=cp0;
        cp3cx0+=cp3;
        m0+=d0;
      }
      cp1cy_cp20+=cp1;
      cp4cy_cp50+=cp4;
      cp7cy_10+=cp7;
      reader.getPixelSet(rgb_px, rgb_py,patt_w, rgb_tmp);
      for(ix=patt_w-1;ix>=0;ix--){
        var idx=ix*3;
        o_patt[p]=(rgb_tmp[idx]<<16)|(rgb_tmp[idx+1]<<8)|((rgb_tmp[idx+2]&0xff));
        p++;
      }
    }
    return;
  }
})
/*
* PROJECT: NyARToolkitAS3
* --------------------------------------------------------------------------------
* This work is based on the original ARToolKit developed by
*   Hirokazu Kato
*   Mark Billinghurst
*   HITLab, University of Washington, Seattle
* http://www.hitl.washington.edu/artoolkit/
*
* The NyARToolkitAS3 is AS3 edition ARToolKit class library.
* Copyright (C)2010 Ryo Iizuka
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <http://www.gnu.org/licenses/>.
*
* For further information please contact.
*  http://nyatla.jp/nyatoolkit/
*  <airmail(at)ebony.plala.or.jp> or <nyatla(at)nyatla.jp>
*
*/




/**
 * 2x2
 * チェックデジット:207585881161241401501892422483163713744114324414474655086016467027227327958629279571017
 *
 */
NyARPickFromRaster_2x = ASKlass('NyARPickFromRaster_2x', IpickFromRaster_Impl,
{
  _size_ref : null,
  _lt_ref : null,
  NyARPickFromRaster_2x : function(i_lt,i_source_size)
  {
    this._lt_ref=i_lt;
    this._size_ref=i_source_size;
    this._rgb_temp=new IntVector(i_source_size.w*4*3);
    this._rgb_px=new IntVector(i_source_size.w*4);
    this._rgb_py=new IntVector(i_source_size.w*4);
    return;
  },
  _rgb_temp : null,
  _rgb_px : null,
  _rgb_py : null,
  pickFromRaster : function(i_cpara,image,o_patt)
  {
    var d0,m0,d1,m1;
    var x,y;
    var img_x = image.getWidth();
    var img_y = image.getHeight();
    var patt_w=this._size_ref.w;
    var rgb_tmp = this._rgb_temp;
    var rgb_px=this._rgb_px;
    var rgb_py=this._rgb_py;
    var cp0=i_cpara[0];
    var cp3=i_cpara[3];
    var cp6=i_cpara[6];
    var cp1=i_cpara[1];
    var cp4=i_cpara[4];
    var cp7=i_cpara[7];
    var pick_y=this._lt_ref.y;
    var pick_x=this._lt_ref.x;
    //ピクセルリーダーを取得
    var reader=image.getRgbPixelReader();
    var p=0;
    var cp0cx0,cp3cx0;
    var cp1cy_cp20=cp1*pick_y+i_cpara[2]+cp0*pick_x;
    var cp4cy_cp50=cp4*pick_y+i_cpara[5]+cp3*pick_x;
    var cp7cy_10=cp7*pick_y+1.0+cp6*pick_x;
    var cp0cx1,cp3cx1;
    var cp1cy_cp21=cp1cy_cp20+cp1;
    var cp4cy_cp51=cp4cy_cp50+cp4;
    var cp7cy_11=cp7cy_10+cp7;
    var cw0=cp1+cp1;
    var cw7=cp7+cp7;
    var cw4=cp4+cp4;
    for(var iy=this._size_ref.h-1;iy>=0;iy--){
      cp0cx0=cp1cy_cp20;
      cp3cx0=cp4cy_cp50;
      cp0cx1=cp1cy_cp21;
      cp3cx1=cp4cy_cp51;
      m0=1.0/(cp7cy_10);
      d0=-cp6/(cp7cy_10*(cp7cy_10+cp6));
      m1=1.0/(cp7cy_11);
      d1=-cp6/(cp7cy_11*(cp7cy_11+cp6));
      var n=patt_w*2*2-1;
      var ix;
      for(ix=patt_w*2-1;ix>=0;ix--){
        //[n,0]
        x=rgb_px[n]=toInt(cp0cx0*m0);
        y=rgb_py[n]=toInt(cp3cx0*m0);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[n]=0;}else if(x>=img_x){rgb_px[n]=img_x-1;}
          if(y<0){rgb_py[n]=0;}else if(y>=img_y){rgb_py[n]=img_y-1;}
        }
        cp0cx0+=cp0;
        cp3cx0+=cp3;
        m0+=d0;
        n--;
        //[n,1]
        x=rgb_px[n]=toInt(cp0cx1*m1);
        y=rgb_py[n]=toInt(cp3cx1*m1);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[n]=0;}else if(x>=img_x){rgb_px[n]=img_x-1;}
          if(y<0){rgb_py[n]=0;}else if(y>=img_y){rgb_py[n]=img_y-1;}
        }
        cp0cx1+=cp0;
        cp3cx1+=cp3;
        m1+=d1;
        n--;
      }
      cp7cy_10+=cw7;
      cp7cy_11+=cw7;
      cp1cy_cp20+=cw0;
      cp4cy_cp50+=cw4;
      cp1cy_cp21+=cw0;
      cp4cy_cp51+=cw4;
      reader.getPixelSet(rgb_px, rgb_py,patt_w*4, rgb_tmp);
      for(ix=patt_w-1;ix>=0;ix--){
        var idx=ix*12;//3*2*2
        var r=(rgb_tmp[idx+0]+rgb_tmp[idx+3]+rgb_tmp[idx+6]+rgb_tmp[idx+ 9])/4;
        var g=(rgb_tmp[idx+1]+rgb_tmp[idx+4]+rgb_tmp[idx+7]+rgb_tmp[idx+10])/4;
        var b=(rgb_tmp[idx+2]+rgb_tmp[idx+5]+rgb_tmp[idx+8]+rgb_tmp[idx+11])/4;
        o_patt[p]=(r<<16)|(g<<8)|((b&0xff));
        p++;
      }
    }
    return;
  }
})
/*
* PROJECT: NyARToolkitAS3
* --------------------------------------------------------------------------------
* This work is based on the original ARToolKit developed by
*   Hirokazu Kato
*   Mark Billinghurst
*   HITLab, University of Washington, Seattle
* http://www.hitl.washington.edu/artoolkit/
*
* The NyARToolkitAS3 is AS3 edition ARToolKit class library.
* Copyright (C)2010 Ryo Iizuka
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <http://www.gnu.org/licenses/>.
*
* For further information please contact.
*  http://nyatla.jp/nyatoolkit/
*  <airmail(at)ebony.plala.or.jp> or <nyatla(at)nyatla.jp>
*
*/




/**
 * 4x4
 *
 */
NyARPickFromRaster_4x = ASKlass('NyARPickFromRaster_4x', IpickFromRaster_Impl,
{
  _size_ref : null,
  _lt_ref : null,
  NyARPickFromRaster_4x : function(i_lt,i_source_size)
  {
    this._lt_ref=i_lt;
    this._size_ref=i_source_size;
    this._rgb_temp=new IntVector(4*4*3);
    this._rgb_px=new IntVector(4*4);
    this._rgb_py=new IntVector(4*4);
    return;
  },
  _rgb_temp : null,
  _rgb_px : null,
  _rgb_py : null,
  pickFromRaster : function(i_cpara, image, o_patt)
  {
    var x,y;
    var d,m;
    var cp6cx,cp0cx,cp3cx;
    var rgb_px=this._rgb_px;
    var rgb_py=this._rgb_py;
    var r,g,b;
    //遠近法のパラメータを計算
    var img_x = image.getWidth();
    var img_y = image.getHeight();
    var rgb_tmp = this._rgb_temp;
    var cp0=i_cpara[0];
    var cp3=i_cpara[3];
    var cp6=i_cpara[6];
    var cp1=i_cpara[1];
    var cp2=i_cpara[2];
    var cp4=i_cpara[4];
    var cp5=i_cpara[5];
    var cp7=i_cpara[7];
    var pick_lt_x=this._lt_ref.x;
    //ピクセルリーダーを取得
    var reader=image.getRgbPixelReader();
    var p=0;
    var py=this._lt_ref.y;
    for(var iy=this._size_ref.h-1;iy>=0;iy--,py+=4){
      var cp1cy_cp2_0=cp1*py+cp2;
      var cp4cy_cp5_0=cp4*py+cp5;
      var cp7cy_1_0  =cp7*py+1.0;
      var cp1cy_cp2_1=cp1cy_cp2_0+cp1;
      var cp1cy_cp2_2=cp1cy_cp2_1+cp1;
      var cp1cy_cp2_3=cp1cy_cp2_2+cp1;
      var cp4cy_cp5_1=cp4cy_cp5_0+cp4;
      var cp4cy_cp5_2=cp4cy_cp5_1+cp4;
      var cp4cy_cp5_3=cp4cy_cp5_2+cp4;
      var px=pick_lt_x;
      //解像度分の点を取る。
      for(var ix=this._size_ref.w-1;ix>=0;ix--,px+=4){
        cp6cx=cp6*px;
        cp0cx=cp0*px;
        cp3cx=cp3*px;
        cp6cx+=cp7cy_1_0;
        m=1/cp6cx;
        d=-cp7/((cp6cx+cp7)*cp6cx);
        //1ピクセルを作成[0,0]
        x=rgb_px[0]=toInt((cp0cx+cp1cy_cp2_0)*m);
        y=rgb_py[0]=toInt((cp3cx+cp4cy_cp5_0)*m);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[0]=0;} else if(x>=img_x){rgb_px[0]=img_x-1;}
          if(y<0){rgb_py[0]=0;} else if(y>=img_y){rgb_py[0]=img_y-1;}
        }
        //1ピクセルを作成[0,1]
        m+=d;
        x=rgb_px[4]=toInt((cp0cx+cp1cy_cp2_1)*m);
        y=rgb_py[4]=toInt((cp3cx+cp4cy_cp5_1)*m);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[4]=0;}else if(x>=img_x){rgb_px[4]=img_x-1;}
          if(y<0){rgb_py[4]=0;}else if(y>=img_y){rgb_py[4]=img_y-1;}
        }
        //1ピクセルを作成[0,2]
        m+=d;
        x=rgb_px[8]=toInt((cp0cx+cp1cy_cp2_2)*m);
        y=rgb_py[8]=toInt((cp3cx+cp4cy_cp5_2)*m);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[8]=0;}else if(x>=img_x){rgb_px[8]=img_x-1;}
          if(y<0){rgb_py[8]=0;}else if(y>=img_y){rgb_py[8]=img_y-1;}
        }
        //1ピクセルを作成[0,3]
        m+=d;
        x=rgb_px[12]=toInt((cp0cx+cp1cy_cp2_3)*m);
        y=rgb_py[12]=toInt((cp3cx+cp4cy_cp5_3)*m);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[12]=0;}else if(x>=img_x){rgb_px[12]=img_x-1;}
          if(y<0){rgb_py[12]=0;}else if(y>=img_y){rgb_py[12]=img_y-1;}
        }
        cp6cx+=cp6;
        cp0cx+=cp0;
        cp3cx+=cp3;
        m=1/cp6cx;
        d=-cp7/((cp6cx+cp7)*cp6cx);
        //1ピクセルを作成[1,0]
        x=rgb_px[1]=toInt((cp0cx+cp1cy_cp2_0)*m);
        y=rgb_py[1]=toInt((cp3cx+cp4cy_cp5_0)*m);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[1]=0;}else if(x>=img_x){rgb_px[1]=img_x-1;}
          if(y<0){rgb_py[1]=0;}else if(y>=img_y){rgb_py[1]=img_y-1;}
        }
        //1ピクセルを作成[1,1]
        m+=d;
        x=rgb_px[5]=toInt((cp0cx+cp1cy_cp2_1)*m);
        y=rgb_py[5]=toInt((cp3cx+cp4cy_cp5_1)*m);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[5]=0;}else if(x>=img_x){rgb_px[5]=img_x-1;}
          if(y<0){rgb_py[5]=0;}else if(y>=img_y){rgb_py[5]=img_y-1;}
        }
        //1ピクセルを作成[1,2]
        m+=d;
        x=rgb_px[9]=toInt((cp0cx+cp1cy_cp2_2)*m);
        y=rgb_py[9]=toInt((cp3cx+cp4cy_cp5_2)*m);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[9]=0;}else if(x>=img_x){rgb_px[9]=img_x-1;}
          if(y<0){rgb_py[9]=0;}else if(y>=img_y){rgb_py[9]=img_y-1;}
        }
        //1ピクセルを作成[1,3]
        m+=d;
        x=rgb_px[13]=toInt((cp0cx+cp1cy_cp2_3)*m);
        y=rgb_py[13]=toInt((cp3cx+cp4cy_cp5_3)*m);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[13]=0;}else if(x>=img_x){rgb_px[13]=img_x-1;}
          if(y<0){rgb_py[13]=0;}else if(y>=img_y){rgb_py[13]=img_y-1;}
        }
        cp6cx+=cp6;
        cp0cx+=cp0;
        cp3cx+=cp3;
        m=1/cp6cx;
        d=-cp7/((cp6cx+cp7)*cp6cx);
        //1ピクセルを作成[2,0]
        x=rgb_px[2]=toInt((cp0cx+cp1cy_cp2_0)*m);
        y=rgb_py[2]=toInt((cp3cx+cp4cy_cp5_0)*m);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[2]=0;}else if(x>=img_x){rgb_px[2]=img_x-1;}
          if(y<0){rgb_py[2]=0;}else if(y>=img_y){rgb_py[2]=img_y-1;}
        }
        //1ピクセルを作成[2,1]
        m+=d;
        x=rgb_px[6]=toInt((cp0cx+cp1cy_cp2_1)*m);
        y=rgb_py[6]=toInt((cp3cx+cp4cy_cp5_1)*m);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[6]=0;}else if(x>=img_x){rgb_px[6]=img_x-1;}
          if(y<0){rgb_py[6]=0;}else if(y>=img_y){rgb_py[6]=img_y-1;}
        }
        //1ピクセルを作成[2,2]
        m+=d;
        x=rgb_px[10]=toInt((cp0cx+cp1cy_cp2_2)*m);
        y=rgb_py[10]=toInt((cp3cx+cp4cy_cp5_2)*m);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[10]=0;}else if(x>=img_x){rgb_px[10]=img_x-1;}
          if(y<0){rgb_py[10]=0;}else if(y>=img_y){rgb_py[10]=img_y-1;}
        }
        //1ピクセルを作成[2,3](ここ計算ずれします。)
        m+=d;
        x=rgb_px[14]=toInt((cp0cx+cp1cy_cp2_3)*m);
        y=rgb_py[14]=toInt((cp3cx+cp4cy_cp5_3)*m);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[14]=0;}else if(x>=img_x){rgb_px[14]=img_x-1;}
          if(y<0){rgb_py[14]=0;}else if(y>=img_y){rgb_py[14]=img_y-1;}
        }
        cp6cx+=cp6;
        cp0cx+=cp0;
        cp3cx+=cp3;
        m=1/cp6cx;
        d=-cp7/((cp6cx+cp7)*cp6cx);
        //1ピクセルを作成[3,0]
        x=rgb_px[3]=toInt((cp0cx+cp1cy_cp2_0)*m);
        y=rgb_py[3]=toInt((cp3cx+cp4cy_cp5_0)*m);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[3]=0;}else if(x>=img_x){rgb_px[3]=img_x-1;}
          if(y<0){rgb_py[3]=0;}else if(y>=img_y){rgb_py[3]=img_y-1;}
        }
        //1ピクセルを作成[3,1]
        m+=d;
        x=rgb_px[7]=toInt((cp0cx+cp1cy_cp2_1)*m);
        y=rgb_py[7]=toInt((cp3cx+cp4cy_cp5_1)*m);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[7]=0;}else if(x>=img_x){rgb_px[7]=img_x-1;}
          if(y<0){rgb_py[7]=0;}else if(y>=img_y){rgb_py[7]=img_y-1;}
        }
        //1ピクセルを作成[3,2]
        m+=d;
        x=rgb_px[11]=toInt((cp0cx+cp1cy_cp2_2)*m);
        y=rgb_py[11]=toInt((cp3cx+cp4cy_cp5_2)*m);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[11]=0;}else if(x>=img_x){rgb_px[11]=img_x-1;}
          if(y<0){rgb_py[11]=0;}else if(y>=img_y){rgb_py[11]=img_y-1;}
        }
        //1ピクセルを作成[3,3]
        m+=d;
        x=rgb_px[15]=toInt((cp0cx+cp1cy_cp2_3)*m);
        y=rgb_py[15]=toInt((cp3cx+cp4cy_cp5_3)*m);
        if(x<0||x>=img_x||y<0||y>=img_y){
          if(x<0){rgb_px[15]=0;}else if(x>=img_x){rgb_px[15]=img_x-1;}
          if(y<0){rgb_py[15]=0;}else if(y>=img_y){rgb_py[15]=img_y-1;}
        }
        reader.getPixelSet(rgb_px, rgb_py,4*4, rgb_tmp);
        r=(rgb_tmp[ 0]+rgb_tmp[ 3]+rgb_tmp[ 6]+rgb_tmp[ 9]+rgb_tmp[12]+rgb_tmp[15]+rgb_tmp[18]+rgb_tmp[21]+rgb_tmp[24]+rgb_tmp[27]+rgb_tmp[30]+rgb_tmp[33]+rgb_tmp[36]+rgb_tmp[39]+rgb_tmp[42]+rgb_tmp[45])/16;
        g=(rgb_tmp[ 1]+rgb_tmp[ 4]+rgb_tmp[ 7]+rgb_tmp[10]+rgb_tmp[13]+rgb_tmp[16]+rgb_tmp[19]+rgb_tmp[22]+rgb_tmp[25]+rgb_tmp[28]+rgb_tmp[31]+rgb_tmp[34]+rgb_tmp[37]+rgb_tmp[40]+rgb_tmp[43]+rgb_tmp[46])/16;
        b=(rgb_tmp[ 2]+rgb_tmp[ 5]+rgb_tmp[ 8]+rgb_tmp[11]+rgb_tmp[14]+rgb_tmp[17]+rgb_tmp[20]+rgb_tmp[23]+rgb_tmp[26]+rgb_tmp[29]+rgb_tmp[32]+rgb_tmp[35]+rgb_tmp[38]+rgb_tmp[41]+rgb_tmp[44]+rgb_tmp[47])/16;
        o_patt[p]=((r&0xff)<<16)|((g&0xff)<<8)|((b&0xff));
        p++;
      }
    }
    return;
  }
})
/*
* PROJECT: NyARToolkitAS3
* --------------------------------------------------------------------------------
* This work is based on the original ARToolKit developed by
*   Hirokazu Kato
*   Mark Billinghurst
*   HITLab, University of Washington, Seattle
* http://www.hitl.washington.edu/artoolkit/
*
* The NyARToolkitAS3 is AS3 edition ARToolKit class library.
* Copyright (C)2010 Ryo Iizuka
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <http://www.gnu.org/licenses/>.
*
* For further information please contact.
*  http://nyatla.jp/nyatoolkit/
*  <airmail(at)ebony.plala.or.jp> or <nyatla(at)nyatla.jp>
*
*/




/**
 * 汎用ピックアップ関数
 *
 */
NyARPickFromRaster_N = ASKlass('NyARPickFromRaster_N', IpickFromRaster_Impl,
{
  _resolution : 0,
  _size_ref : null,
  _lt_ref : null,
  NyARPickFromRaster_N : function(i_lt,i_resolution,i_source_size)
  {
    this._lt_ref=i_lt;
    this._resolution=i_resolution;
    this._size_ref=i_source_size;
    this._rgb_temp=new IntVector(i_resolution*i_resolution*3);
    this._rgb_px=new IntVector(i_resolution*i_resolution);
    this._rgb_py=new IntVector(i_resolution*i_resolution);
    this._cp1cy_cp2=new FloatVector(i_resolution);
    this._cp4cy_cp5=new FloatVector(i_resolution);
    this._cp7cy_1=new FloatVector(i_resolution);
    return;
  },
  _rgb_temp : null,
  _rgb_px : null,
  _rgb_py : null,
  _cp1cy_cp2 : null,
  _cp4cy_cp5 : null,
  _cp7cy_1 : null,
  pickFromRaster : function(i_cpara,image,o_patt)
  {
    var i2x,i2y;//プライム変数
    var x,y;
    var w;
    var r,g,b;
    var resolution=this._resolution;
    var res_pix=resolution*resolution;
    var img_x = image.getWidth();
    var img_y = image.getHeight();
    var rgb_tmp = this._rgb_temp;
    var rgb_px=this._rgb_px;
    var rgb_py=this._rgb_py;
    var cp1cy_cp2=this._cp1cy_cp2;
    var cp4cy_cp5=this._cp4cy_cp5;
    var cp7cy_1=this._cp7cy_1;
    var cp0=i_cpara[0];
    var cp3=i_cpara[3];
    var cp6=i_cpara[6];
    var cp1=i_cpara[1];
    var cp2=i_cpara[2];
    var cp4=i_cpara[4];
    var cp5=i_cpara[5];
    var cp7=i_cpara[7];
    var pick_y=this._lt_ref.y;
    var pick_x=this._lt_ref.x;
    //ピクセルリーダーを取得
    var reader=image.getRgbPixelReader();
    var p=0;
    for(var iy=0;iy<this._size_ref.h*resolution;iy+=resolution){
      w=pick_y+iy;
      cp1cy_cp2[0]=cp1*w+cp2;
      cp4cy_cp5[0]=cp4*w+cp5;
      cp7cy_1[0]=cp7*w+1.0;
      for(i2y=1;i2y<resolution;i2y++){
        cp1cy_cp2[i2y]=cp1cy_cp2[i2y-1]+cp1;
        cp4cy_cp5[i2y]=cp4cy_cp5[i2y-1]+cp4;
        cp7cy_1[i2y]=cp7cy_1[i2y-1]+cp7;
      }
      //解像度分の点を取る。
      for(var ix=0;ix<this._size_ref.w*resolution;ix+=resolution){
        var n=0;
        w=pick_x+ix;
        for(i2y=resolution-1;i2y>=0;i2y--){
          var cp0cx=cp0*w+cp1cy_cp2[i2y];
          var cp6cx=cp6*w+cp7cy_1[i2y];
          var cp3cx=cp3*w+cp4cy_cp5[i2y];
          var m=1/(cp6cx);
          var d=-cp6/(cp6cx*(cp6cx+cp6));
          var m2=cp0cx*m;
          var m3=cp3cx*m;
          var d2=cp0cx*d+cp0*(m+d);
          var d3=cp3cx*d+cp3*(m+d);
          for(i2x=resolution-1;i2x>=0;i2x--){
            //1ピクセルを作成
            x=rgb_px[n]=toInt(m2);
            y=rgb_py[n]=toInt(m3);
            if(x<0||x>=img_x||y<0||y>=img_y){
              if(x<0){rgb_px[n]=0;}else if(x>=img_x){rgb_px[n]=img_x-1;}
              if(y<0){rgb_py[n]=0;}else if(y>=img_y){rgb_py[n]=img_y-1;}
            }
            n++;
            m2+=d2;
            m3+=d3;
          }
        }
        reader.getPixelSet(rgb_px, rgb_py,res_pix, rgb_tmp);
        r=g=b=0;
        for(var i=res_pix*3-1;i>0;){
          b+=rgb_tmp[i--];
          g+=rgb_tmp[i--];
          r+=rgb_tmp[i--];
        }
        r/=res_pix;
        g/=res_pix;
        b/=res_pix;
        o_patt[p]=((r&0xff)<<16)|((g&0xff)<<8)|((b&0xff));
        p++;
      }
    }
    return;
  }
})
/*
 * PROJECT: FLARToolKit
 * --------------------------------------------------------------------------------
 * This work is based on the NyARToolKit developed by
 *   R.Iizuka (nyatla)
 * http://nyatla.jp/nyatoolkit/
 *
 * The FLARToolKit is ActionScript 3.0 version ARToolkit class library.
 * Copyright (C)2008 Saqoosha
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  http://www.libspark.org/wiki/saqoosha/FLARToolKit
 *  <saq(at)saqoosha.net>
 *
 */

/**
 * このクラスは、同時に１個のマーカを処理することのできる、アプリケーションプロセッサです。
 * マーカの出現・移動・消滅を、イベントで通知することができます。
 * クラスには複数のマーカを登録できます。一つのマーカが見つかると、プロセッサは継続して同じマーカを
 * １つだけ認識し続け、見失うまでの間は他のマーカを認識しません。
 *
 * イベントは、 OnEnter→OnUpdate[n]→OnLeaveの順で発生します。
 * マーカが見つかるとまずOnEnterが１度発生して、何番のマーカが発見されたかがわかります。
 * 次にOnUpdateにより、現在の変換行列が連続して渡されます。最後にマーカを見失うと、OnLeave
 * イベントが発生します。
 *
 */
FLSingleARMarkerProcesser = ASKlass('FLSingleARMarkerProcesser',
{
  /**オーナーが自由に使えるタグ変数です。
   */
  tag : null
  ,_lost_delay_count : 0
  ,_lost_delay : 5
  ,_square_detect : null
  ,_transmat : null
  ,_offset : null
  ,_threshold : 110
  // [AR]検出結果の保存用
  ,_bin_raster : null
  ,_tobin_filter : null
  ,_current_arcode_index : -1
  ,_threshold_detect : null
  ,FLSingleARMarkerProcesser : function()
  {
    return;
  }
  ,_initialized : false
  ,initInstance : function(i_param)
  {
    //初期化済？
    NyAS3Utils.assert(this._initialized==false);
    var scr_size = i_param.getScreenSize();
    // 解析オブジェクトを作る
    this._square_detect = new FLARSquareContourDetector(scr_size);
    this._transmat = new NyARTransMat(i_param);
    this._tobin_filter=new FLARRasterFilter_Threshold(110);
    // ２値画像バッファを作る
    this._bin_raster = new FLARBinRaster(scr_size.w, scr_size.h);
    this._threshold_detect=new FLARRasterThresholdAnalyzer_SlidePTile(15,4);
    this._initialized=true;
    //コールバックハンドラ
    this._detectmarker_cb=new FLARDetectSquareCB_1(i_param);
    this._offset=new NyARRectOffset();
    return;
  }
  /*自動・手動の設定が出来ないので、コメントアウト
  public void setThreshold(int i_threshold)
  {
    this._threshold = i_threshold;
    return;
  }*/
  /**検出するマーカコードの配列を指定します。 検出状態でこの関数を実行すると、
   * オブジェクト状態に強制リセットがかかります。
   */
  ,setARCodeTable : function(i_ref_code_table,i_code_resolution,i_marker_width)
  {
    if (this._current_arcode_index != -1) {
      // 強制リセット
      this.reset(true);
    }
    //検出するマーカセット、情報、検出器を作り直す。(1ピクセル4ポイントサンプリング,マーカのパターン領域は50%)
    this._detectmarker_cb.setNyARCodeTable(i_ref_code_table,i_code_resolution);
    this._offset.setSquare(i_marker_width);
    return;
  }
  ,reset : function(i_is_force)
  {
    if (this._current_arcode_index != -1 && i_is_force == false) {
      // 強制書き換えでなければイベントコール
      this.onLeaveHandler();
    }
    // カレントマーカをリセット
    this._current_arcode_index = -1;
    return;
  }
  ,_detectmarker_cb : null
  ,detectMarker : function(i_raster)
  {
    // サイズチェック
    NyAS3Utils.assert(this._bin_raster.getSize().isEqualSize_int(i_raster.getSize().w, i_raster.getSize().h));
    //BINイメージへの変換
    this._tobin_filter.setThreshold(this._threshold);
    this._tobin_filter.doFilter(i_raster, this._bin_raster);
    // スクエアコードを探す
    this._detectmarker_cb.init(i_raster,this._current_arcode_index);
    this._square_detect.detectMarkerCB(this._bin_raster,this._detectmarker_cb);
    // 認識状態を更新
    var is_id_found=updateStatus(this._detectmarker_cb.square,this._detectmarker_cb.code_index);
    //閾値フィードバック(detectExistMarkerにもあるよ)
    if(!is_id_found){
      //マーカがなければ、探索+DualPTailで基準輝度検索
      var th=this._threshold_detect.analyzeRaster(i_raster);
      this._threshold=(this._threshold+th)/2;
    }
    return;
  }
  /**
   *
   * @param i_new_detect_cf
   * @param i_exist_detect_cf
   */
  ,setConfidenceThreshold : function(i_new_cf,i_exist_cf)
  {
    this._detectmarker_cb.cf_threshold_exist=i_exist_cf;
    this._detectmarker_cb.cf_threshold_new=i_new_cf;
  }
  ,__NyARSquare_result : new FLARTransMatResult()
  /**  オブジェクトのステータスを更新し、必要に応じてハンドル関数を駆動します。
   *   戻り値は、「実際にマーカを発見する事ができたか」です。クラスの状態とは異なります。
   */
  ,updateStatus : function(i_square,i_code_index)
  {
    var result = this.__NyARSquare_result;
    if (this._current_arcode_index < 0) {// 未認識中
      if (i_code_index < 0) {// 未認識から未認識の遷移
        // なにもしないよーん。
        return false;
      } else {// 未認識から認識の遷移
        this._current_arcode_index = i_code_index;
        // イベント生成
        // OnEnter
        this.onEnterHandler(i_code_index);
        // 変換行列を作成
        this._transmat.transMat(i_square, this._offset, result);
        // OnUpdate
        this.onUpdateHandler(i_square, result);
        this._lost_delay_count = 0;
        return true;
      }
    } else {// 認識中
      if (i_code_index < 0) {// 認識から未認識の遷移
        this._lost_delay_count++;
        if (this._lost_delay < this._lost_delay_count) {
          // OnLeave
          this._current_arcode_index = -1;
          this.onLeaveHandler();
        }
        return false;
      } else if (i_code_index == this._current_arcode_index) {// 同じARCodeの再認識
        // イベント生成
        // 変換行列を作成
        this._transmat.transMat(i_square, this._offset, result);
        // OnUpdate
        this.onUpdateHandler(i_square, result);
        this._lost_delay_count = 0;
        return true;
      } else {// 異なるコードの認識→今はサポートしない。
        throw new  NyARException();
      }
    }
  }
  ,onEnterHandler : function(i_code)
  {
    throw new NyARException("onEnterHandler not implemented.");
  }
  ,onLeaveHandler : function()
  {
    throw new NyARException("onLeaveHandler not implemented.");
  }
  ,onUpdateHandler : function(i_square, result)
  {
    throw new NyARException("onUpdateHandler not implemented.");
  }
})

/**
 * detectMarkerのコールバック関数
 */
FLARDetectSquareCB_1 = ASKlass('DetectSquareCB',
{
  //公開プロパティ
  square : new FLARSquare()
  ,confidence : 0.0
  ,code_index : -1
  ,cf_threshold_new : 0.50
  ,cf_threshold_exist : 0.30
  //参照
  ,_ref_raster : null
  //所有インスタンス
  ,_inst_patt : null
  ,_deviation_data : null
  ,_match_patt : null
  ,__detectMarkerLite_mr : new NyARMatchPattResult()
  ,_coordline : null
  ,DetectSquareCB : function(i_param)
  {
    this._match_patt=null;
    this._coordline=new NyARCoord2Linear(i_param.getScreenSize(),i_param.getDistortionFactor());
    return;
  }
  ,setNyARCodeTable : function(i_ref_code,i_code_resolution)
  {
    /*unmanagedで実装するときは、ここでリソース解放をすること。*/
    this._deviation_data=new NyARMatchPattDeviationColorData(i_code_resolution,i_code_resolution);
    this._inst_patt=new NyARColorPatt_Perspective_O2(i_code_resolution,i_code_resolution,4,25);
    this._match_patt = new Array(i_ref_code.length);
    for(var i=0;i<i_ref_code.length;i++){
      this._match_patt[i]=new NyARMatchPatt_Color_WITHOUT_PCA(i_ref_code[i]);
    }
  }
  ,__tmp_vertex : NyARIntPoint2d.createArray(4)
  ,_target_id : 0
  /**
  * Initialize call back handler.
  */
  ,init : function(i_raster,i_target_id)
  {
    this._ref_raster=i_raster;
    this._target_id=i_target_id;
    this.code_index=-1;
    this.confidence = Number.MIN_VALUE;
  }
  /**
  * 矩形が見付かるたびに呼び出されます。
  * 発見した矩形のパターンを検査して、方位を考慮した頂点データを確保します。
  */
  ,onSquareDetect : function(i_sender,i_coordx,i_coordy,i_coor_num,i_vertex_index)
  {
    if (this._match_patt==null) {
      return;
    }
    //輪郭座標から頂点リストに変換
    var vertex=this.__tmp_vertex;
    vertex[0].x=i_coordx[i_vertex_index[0]];
    vertex[0].y=i_coordy[i_vertex_index[0]];
    vertex[1].x=i_coordx[i_vertex_index[1]];
    vertex[1].y=i_coordy[i_vertex_index[1]];
    vertex[2].x=i_coordx[i_vertex_index[2]];
    vertex[2].y=i_coordy[i_vertex_index[2]];
    vertex[3].x=i_coordx[i_vertex_index[3]];
    vertex[3].y=i_coordy[i_vertex_index[3]];
    //画像を取得
    if (!this._inst_patt.pickFromRaster(this._ref_raster,vertex)){
      return;//取得失敗
    }
    //取得パターンをカラー差分データに変換して評価する。
    this._deviation_data.setRaster(this._inst_patt);
    //code_index,dir,c1にデータを得る。
    var mr=this.__detectMarkerLite_mr;
    var lcode_index = 0;
    var dir = 0;
    var c1 = 0;
    var i;
    for (i = 0; i < this._match_patt.length; i++) {
      this._match_patt[i].evaluate(this._deviation_data,mr);
      var c2 = mr.confidence;
      if (c1 < c2) {
        lcode_index = i;
        c1 = c2;
        dir = mr.direction;
      }
    }
    //認識処理
    if (this._target_id == -1) { // マーカ未認識
      //現在は未認識
      if (c1 < this.cf_threshold_new) {
        return;
      }
      if (this.confidence > c1) {
        // 一致度が低い。
        return;
      }
      //認識しているマーカIDを保存
      this.code_index=lcode_index;
    }else{
      //現在はマーカ認識中
      // 現在のマーカを認識したか？
      if (lcode_index != this._target_id) {
        // 認識中のマーカではないので無視
        return;
      }
      //認識中の閾値より大きいか？
      if (c1 < this.cf_threshold_exist) {
        return;
      }
      //現在の候補よりも一致度は大きいか？
      if (this.confidence>c1) {
        return;
      }
      this.code_index=this._target_id;
    }
    //新しく認識、または継続認識中に更新があったときだけ、Square情報を更新する。
    //ココから先はこの条件でしか実行されない。
    //一致率の高い矩形があれば、方位を考慮して頂点情報を作成
    this.confidence=c1;
    var sq=this.square;
    //directionを考慮して、squareを更新する。
    for(i=0;i<4;i++){
      var idx=(i+4 - dir) % 4;
      this._coordline.coord2Line(i_vertex_index[idx],i_vertex_index[(idx+1)%4],i_coordx,i_coordy,i_coor_num,sq.line[i]);
    }
    for (i = 0; i < 4; i++) {
      //直線同士の交点計算
      if(!NyARLinear.crossPos(sq.line[i],sq.line[(i + 3) % 4],sq.sqvertex[i])){
        throw new NyARException();//ここのエラー復帰するならダブルバッファにすればOK
      }
    }
  }
})

FLSingleNyIdMarkerProcesser = ASKlass('FLSingleNyIdMarkerProcesser',
{
  /**
   * オーナーが自由に使えるタグ変数です。
   */
  tag : null
  /**
   * ロスト遅延の管理
   */
  ,_lost_delay_count : 0
  ,_lost_delay : 5
  ,_square_detect : null
  ,_transmat : null
  ,_offset : null
  ,_is_active : null
  ,_current_threshold : 110
  // [AR]検出結果の保存用
  ,_bin_raster : null
  ,_tobin_filter : null
  ,_callback : null
  ,_data_current : null
  ,FLSingleNyIdMarkerProcesser : function()
  {
    return;
  }
  ,_initialized : false
  ,initInstance : function(i_param, i_encoder ,i_marker_width)
  {
    //初期化済？
    NyAS3Utils.assert(this._initialized==false);
    var scr_size = i_param.getScreenSize();
    // 解析オブジェクトを作る
    this._square_detect = new FLARSquareContourDetector(scr_size);
    this._transmat = new NyARTransMat(i_param);
    this._callback=new FLARDetectSquareCB_2(i_param,i_encoder);
    // ２値画像バッファを作る
    this._bin_raster = new FLARBinRaster(scr_size.w, scr_size.h);
    //ワーク用のデータオブジェクトを２個作る
    this._data_current=i_encoder.createDataInstance();
    this._tobin_filter =new FLARRasterFilter_Threshold(110);
    this._threshold_detect=new FLARRasterThresholdAnalyzer_SlidePTile(15,4);
    this._initialized=true;
    this._is_active=false;
    this._offset = new NyARRectOffset();
    this._offset.setSquare(i_marker_width);
    return;
  }
  ,setMarkerWidth : function(i_width)
  {
    this._offset.setSquare(i_width);
    return;
  }
  ,reset : function(i_is_force)
  {
    if (i_is_force == false && this._is_active){
      // 強制書き換えでなければイベントコール
      this.onLeaveHandler();
    }
    //マーカ無効
    this._is_active=false;
    return;
  }
  ,detectMarker : function(i_raster)
  {
    // サイズチェック
    if (!this._bin_raster.getSize().isEqualSize_int(i_raster.getSize().w, i_raster.getSize().h)) {
      throw new NyARException();
    }
    // ラスタを２値イメージに変換する.
    this._tobin_filter.setThreshold(this._current_threshold);
    this._tobin_filter.doFilter(i_raster, this._bin_raster);
    // スクエアコードを探す(第二引数に指定したマーカ、もしくは新しいマーカを探す。)
    this._callback.init(i_raster,this._is_active?this._data_current:null);
    this._square_detect.detectMarkerCB(this._bin_raster, this._callback);
    // 認識状態を更新(マーカを発見したなら、current_dataを渡すかんじ)
    var is_id_found=updateStatus(this._callback.square,this._callback.marker_data);
    //閾値フィードバック(detectExistMarkerにもあるよ)
    if(is_id_found){
      //マーカがあれば、マーカの周辺閾値を反映
      this._current_threshold=(this._current_threshold+this._callback.threshold)/2;
    }else{
      //マーカがなければ、探索+DualPTailで基準輝度検索
      var th=this._threshold_detect.analyzeRaster(i_raster);
      this._current_threshold=(this._current_threshold+th)/2;
    }
    return;
  }
  ,_threshold_detect : null
  ,__NyARSquare_result : new FLARTransMatResult()
  /**オブジェクトのステータスを更新し、必要に応じてハンドル関数を駆動します。
   */
  ,updateStatus : function(i_square,i_marker_data)
  {
    var is_id_found=false;
    var result = this.__NyARSquare_result;
    if (!this._is_active) {// 未認識中
      if (i_marker_data==null) {// 未認識から未認識の遷移
        // なにもしないよーん。
        this._is_active=false;
      } else {// 未認識から認識の遷移
        this._data_current.copyFrom(i_marker_data);
        // イベント生成
        // OnEnter
        this.onEnterHandler(this._data_current);
        // 変換行列を作成
        this._transmat.transMat(i_square, this._offset, result);
        // OnUpdate
        this.onUpdateHandler(i_square, result);
        this._lost_delay_count = 0;
        this._is_active=true;
        is_id_found=true;
      }
    } else {// 認識中
      if (i_marker_data==null) {
        // 認識から未認識の遷移
        this._lost_delay_count++;
        if (this._lost_delay < this._lost_delay_count) {
          // OnLeave
          this.onLeaveHandler();
          this._is_active=false;
        }
      } else if(this._data_current.isEqual(i_marker_data)) {
        //同じidの再認識
        this._transmat.transMatContinue(i_square, this._offset, result);
        // OnUpdate
        this.onUpdateHandler(i_square, result);
        this._lost_delay_count = 0;
        is_id_found=true;
      } else {// 異なるコードの認識→今はサポートしない。
        throw new  NyARException();
      }
    }
    return is_id_found;
  }
  //通知ハンドラ
  ,onEnterHandler : function(i_code)
  {
    throw new NyARException("onEnterHandler not implemented.");
  }
  ,onLeaveHandler : function()
  {
    throw new NyARException("onLeaveHandler not implemented.");
  }
  ,onUpdateHandler : function(i_square, result)
  {
    throw new NyARException("onUpdateHandler not implemented.");
  }
})














/**
 * detectMarkerのコールバック関数
 */
FLARDetectSquareCB_2 = ASKlass('DetectSquareCB',
{
  //公開プロパティ
  square : new FLARSquare()
  ,marker_data : null
  ,threshold : 0
  //参照
  ,_ref_raster : null
  //所有インスタンス
  ,_current_data : null
  ,_id_pickup : new NyIdMarkerPickup()
  ,_coordline : null
  ,_encoder : null
  ,_data_temp : null
  ,_prev_data : null
  ,DetectSquareCB : function(i_param,i_encoder)
  {
    this._coordline=new NyARCoord2Linear(i_param.getScreenSize(),i_param.getDistortionFactor());
    this._data_temp=i_encoder.createDataInstance();
    this._current_data=i_encoder.createDataInstance();
    this._encoder=i_encoder;
    return;
  }
  ,__tmp_vertex : NyARIntPoint2d.createArray(4)
  /**
  * Initialize call back handler.
  */
  ,init : function(i_raster,i_prev_data)
  {
    this.marker_data=null;
    this._prev_data=i_prev_data;
    this._ref_raster=i_raster;
  }
  ,_marker_param : new NyIdMarkerParam()
  ,_marker_data : new NyIdMarkerPattern()
  /**
  * 矩形が見付かるたびに呼び出されます。
  * 発見した矩形のパターンを検査して、方位を考慮した頂点データを確保します。
  */
  ,onSquareDetect : function(i_sender,i_coordx,i_coordy,i_coor_num,i_vertex_index)
  {
    //既に発見済なら終了
    if(this.marker_data!=null){
      return;
    }
    //輪郭座標から頂点リストに変換
    var vertex=this.__tmp_vertex;
    vertex[0].x=i_coordx[i_vertex_index[0]];
    vertex[0].y=i_coordy[i_vertex_index[0]];
    vertex[1].x=i_coordx[i_vertex_index[1]];
    vertex[1].y=i_coordy[i_vertex_index[1]];
    vertex[2].x=i_coordx[i_vertex_index[2]];
    vertex[2].y=i_coordy[i_vertex_index[2]];
    vertex[3].x=i_coordx[i_vertex_index[3]];
    vertex[3].y=i_coordy[i_vertex_index[3]];
    var param=this._marker_param;
    var patt_data=this._marker_data;
    // 評価基準になるパターンをイメージから切り出す
    if (!this._id_pickup.pickFromRaster(this._ref_raster,vertex, patt_data, param)){
      return;
    }
    //エンコード
    if(!this._encoder.encode(patt_data,this._data_temp)){
      return;
    }
    //継続認識要求されている？
    if (this._prev_data==null){
      //継続認識要求なし
      this._current_data.copyFrom(this._data_temp);
    }else{
      //継続認識要求あり
      if(!this._prev_data.isEqual((this._data_temp))){
        return;//認識請求のあったIDと違う。
      }
    }
    //新しく認識、または継続認識中に更新があったときだけ、Square情報を更新する。
    //ココから先はこの条件でしか実行されない。
    var sq=this.square;
    //directionを考慮して、squareを更新する。
    var i;
    for(i=0;i<4;i++){
      var idx=(i+4 - param.direction) % 4;
      this._coordline.coord2Line(i_vertex_index[idx],i_vertex_index[(idx+1)%4],i_coordx,i_coordy,i_coor_num,sq.line[i]);
    }
    for (i= 0; i < 4; i++) {
      //直線同士の交点計算
      if(!NyARLinear.crossPos(sq.line[i],sq.line[(i + 3) % 4],sq.sqvertex[i])){
        throw new NyARException();//ここのエラー復帰するならダブルバッファにすればOK
      }
    }
    this.threshold=param.threshold;
    this.marker_data=this._current_data;//みつかった。
  }
})
/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */
NyARCustomSingleDetectMarker = ASKlass('NyARCustomSingleDetectMarker',
{
  _is_continue : false,
  _square_detect : null,
  _transmat : null,
  //画処理用
  _bin_raster : null,
  _tobin_filter : null,
  _detect_cb : null,
  _offset : null,
  NyARCustomSingleDetectMarker : function()
  {
    return;
  }
  ,initInstance : function(
    i_patt_inst,
    i_sqdetect_inst,
    i_transmat_inst,
    i_filter,
    i_ref_param,
    i_ref_code,
    i_marker_width)
  {
    var scr_size=i_ref_param.getScreenSize();
    // 解析オブジェクトを作る
    this._square_detect = i_sqdetect_inst;
    this._transmat = i_transmat_inst;
    this._tobin_filter=i_filter;
    //２値画像バッファを作る
    this._bin_raster=new NyARBinRaster(scr_size.w,scr_size.h);
    //_detect_cb
    this._detect_cb=new DetectSquareCB_3(i_patt_inst,i_ref_code,i_ref_param);
    //オフセットを作成
    this._offset=new NyARRectOffset();
    this._offset.setSquare(i_marker_width);
    return;
  }
  /**
   * i_imageにマーカー検出処理を実行し、結果を記録します。
   *
   * @param i_raster
   * マーカーを検出するイメージを指定します。イメージサイズは、カメラパラメータ
   * と一致していなければなりません。
   * @return マーカーが検出できたかを真偽値で返します。
   * @throws NyARException
   */
  ,detectMarkerLiteB : function(i_raster)    {
    //サイズチェック
    if(!this._bin_raster.getSize().isEqualSize_NyARIntSize(i_raster.getSize())){
      throw new NyARException();
    }
    //ラスタを２値イメージに変換する.
    this._tobin_filter.doFilter(i_raster,this._bin_raster);
    //コールバックハンドラの準備
    this._detect_cb.init(i_raster);
    //矩形を探す(戻り値はコールバック関数で受け取る。)
    this._square_detect.detectMarkerCB(this._bin_raster,_detect_cb);
    if(this._detect_cb.confidence==0){
      return false;
    }
    return true;
  }
  /**
   * 検出したマーカーの変換行列を計算して、o_resultへ値を返します。
   * 直前に実行したdetectMarkerLiteが成功していないと使えません。
   *
   * @param o_result
   * 変換行列を受け取るオブジェクトを指定します。
   * @throws NyARException
   */
  ,getTransmationMatrix : function(o_result)
  {
    // 一番一致したマーカーの位置とかその辺を計算
    if (this._is_continue) {
      this._transmat.transMatContinue(this._detect_cb.square,this._offset, o_result);
    } else {
      this._transmat.transMat(this._detect_cb.square,this._offset, o_result);
    }
    return;
  }
  /**
   * 現在の矩形を返します。
   * @return
   */
  ,refSquare : function()
  {
    return this._detect_cb.square;
  }
  /**
   * 検出したマーカーの一致度を返します。
   *
   * @return マーカーの一致度を返します。0～1までの値をとります。 一致度が低い場合には、誤認識の可能性が高くなります。
   * @throws NyARException
   */
  ,getConfidence : function()
  {
    return this._detect_cb.confidence;
  }
  /**
   * getTransmationMatrixの計算モードを設定します。 初期値はTRUEです。
   *
   * @param i_is_continue
   * TRUEなら、transMatCont互換の計算をします。 FALSEなら、transMat互換の計算をします。
   */
  ,setContinueMode : function(i_is_continue)
  {
    this._is_continue = i_is_continue;
  }
})










/**
 * detectMarkerのコールバック関数
 */
DetectSquareCB_3 = ASKlass('DetectSquareCB', NyARSquareContourDetector_IDetectMarkerCallback,
{
  //公開プロパティ
  confidence : 0,
  square : new NyARSquare(),
  //参照インスタンス
  _ref_raster : null,
  //所有インスタンス
  _inst_patt : null,
  _deviation_data : null,
  _match_patt : null,
  __detectMarkerLite_mr : new NyARMatchPattResult(),
  _coordline : null,
  DetectSquareCB : function(i_inst_patt,i_ref_code,i_param)
  {
    this._inst_patt=i_inst_patt;
    this._deviation_data=new NyARMatchPattDeviationColorData(i_ref_code.getWidth(),i_ref_code.getHeight());
    this._coordline=new NyARCoord2Linear(i_param.getScreenSize(),i_param.getDistortionFactor());
    this._match_patt=new NyARMatchPatt_Color_WITHOUT_PCA(i_ref_code);
    return;
  },
  __tmp_vertex : NyARIntPoint2d.createArray(4),
  /**
  * 矩形が見付かるたびに呼び出されます。
  * 発見した矩形のパターンを検査して、方位を考慮した頂点データを確保します。
  */
  onSquareDetect : function(i_sender,i_coordx,i_coordy,i_coor_num,i_vertex_index)
  {
    var i;
    var mr=this.__detectMarkerLite_mr;
    //輪郭座標から頂点リストに変換
    var vertex=this.__tmp_vertex;
    vertex[0].x=i_coordx[i_vertex_index[0]];
    vertex[0].y=i_coordy[i_vertex_index[0]];
    vertex[1].x=i_coordx[i_vertex_index[1]];
    vertex[1].y=i_coordy[i_vertex_index[1]];
    vertex[2].x=i_coordx[i_vertex_index[2]];
    vertex[2].y=i_coordy[i_vertex_index[2]];
    vertex[3].x=i_coordx[i_vertex_index[3]];
    vertex[3].y=i_coordy[i_vertex_index[3]];
    //画像を取得
    if (!this._inst_patt.pickFromRaster(this._ref_raster,vertex)){
      return;
    }
    //取得パターンをカラー差分データに変換して評価する。
    this._deviation_data.setRaster(this._inst_patt);
    if(!this._match_patt.evaluate(this._deviation_data,mr)){
      return;
    }
    //現在の一致率より低ければ終了
    if (this.confidence > mr.confidence){
      return;
    }
    //一致率の高い矩形があれば、方位を考慮して頂点情報を作成
    var sq=this.square;
    this.confidence = mr.confidence;
    //directionを考慮して、squareを更新する。
    for(i=0;i<4;i++){
      var idx=(i+4 - mr.direction) % 4;
      this._coordline.coord2Line(i_vertex_index[idx],i_vertex_index[(idx+1)%4],i_coordx,i_coordy,i_coor_num,sq.line[i]);
    }
    for (i = 0; i < 4; i++) {
      //直線同士の交点計算
      if(!NyARLinear.crossPos(sq.line[i],sq.line[(i + 3) % 4],sq.sqvertex[i])){
        throw new NyARException();//ここのエラー復帰するならダブルバッファにすればOK
      }
    }
  }
  ,init : function(i_raster)
  {
    this.confidence=0;
    this._ref_raster=i_raster;
  }
})










/**
 * 複数のマーカーを検出し、それぞれに最も一致するARコードを、コンストラクタで登録したARコードから 探すクラスです。最大300個を認識しますが、ゴミラベルを認識したりするので100個程度が限界です。
 *
 */
NyARDetectMarker = ASKlass('NyARDetectMarker',
{
  _detect_cb : null,
  AR_SQUARE_MAX : 300,
  _is_continue : false,
  _square_detect : null,
  _transmat : null,
  _offset : null,
  /**
   * 複数のマーカーを検出し、最も一致するARCodeをi_codeから検索するオブジェクトを作ります。
   *
   * @param i_param
   * カメラパラメータを指定します。
   * @param i_code
   * 検出するマーカーのARCode配列を指定します。
   * 配列要素のインデックス番号が、そのままgetARCodeIndex関数で得られるARCodeインデックスになります。
   * 例えば、要素[1]のARCodeに一致したマーカーである場合は、getARCodeIndexは1を返します。
   * @param i_marker_width
   * i_codeのマーカーサイズをミリメートルで指定した配列を指定します。 先頭からi_number_of_code個の要素には、有効な値を指定する必要があります。
   * @param i_number_of_code
   * i_codeに含まれる、ARCodeの数を指定します。
   * @param i_input_raster_type
   * 入力ラスタのピクセルタイプを指定します。この値は、INyARBufferReaderインタフェイスのgetBufferTypeの戻り値を指定します。
   * @throws NyARException
   */
  NyARDetectMarker : function(i_param, i_code, i_marker_width, i_number_of_code, i_input_raster_type)
  {
    this.initInstance(i_param,i_code,i_marker_width,i_number_of_code,i_input_raster_type);
    return;
  }
  ,initInstance : function(
    i_ref_param,
    i_ref_code,
    i_marker_width,
    i_number_of_code,
    i_input_raster_type)
  {
    var scr_size=i_ref_param.getScreenSize();
    // 解析オブジェクトを作る
    var cw = i_ref_code[0].getWidth();
    var ch = i_ref_code[0].getHeight();
    //detectMarkerのコールバック関数
    this._detect_cb=new NyARDetectSquareCB(
      new NyARColorPatt_Perspective_O2(cw, ch,4,25),
      i_ref_code,i_number_of_code,i_ref_param);
    this._transmat = new NyARTransMat(i_ref_param);
    //NyARToolkitプロファイル
    this._square_detect =new NyARSquareContourDetector_Rle(i_ref_param.getScreenSize());
    this._tobin_filter=new NyARRasterFilter_ARToolkitThreshold(100,i_input_raster_type);
    //実サイズ保存
    this._offset = NyARRectOffset.createArray(i_number_of_code);
    for(var i=0;i<i_number_of_code;i++){
      this._offset[i].setSquare(i_marker_width[i]);
    }
    //２値画像バッファを作る
    this._bin_raster=new NyARBinRaster(scr_size.w,scr_size.h);
    return;
  },
  _bin_raster : null,
  _tobin_filter : null,
  /**
   * i_imageにマーカー検出処理を実行し、結果を記録します。
   *
   * @param i_raster
   * マーカーを検出するイメージを指定します。
   * @param i_thresh
   * 検出閾値を指定します。0～255の範囲で指定してください。 通常は100～130くらいを指定します。
   * @return 見つかったマーカーの数を返します。 マーカーが見つからない場合は0を返します。
   * @throws NyARException
   */
  detectMarkerLite : function(i_raster,i_threshold)
  {
    // サイズチェック
    if (!this._bin_raster.getSize().isEqualSize_NyARIntSize(i_raster.getSize())) {
      throw new NyARException();
    }
    // ラスタを２値イメージに変換する.
    (NyARRasterFilter_ARToolkitThreshold(this._tobin_filter)).setThreshold(i_threshold);
    this._tobin_filter.doFilter(i_raster, this._bin_raster);
    //detect
    this._detect_cb.init(i_raster);
    this._square_detect.detectMarkerCB(this._bin_raster,this._detect_cb);
    //見付かった数を返す。
    return this._detect_cb.result_stack.getLength();
  }
  /**
   * i_indexのマーカーに対する変換行列を計算し、結果値をo_resultへ格納します。 直前に実行したdetectMarkerLiteが成功していないと使えません。
   *
   * @param i_index
   * マーカーのインデックス番号を指定します。 直前に実行したdetectMarkerLiteの戻り値未満かつ0以上である必要があります。
   * @param o_result
   * 結果値を受け取るオブジェクトを指定してください。
   * @throws NyARException
   */
  ,getTransmationMatrix : function(i_index, o_result)
  {
    var result = this._detect_cb.result_stack.getItem(i_index);
    // 一番一致したマーカーの位置とかその辺を計算
    if (_is_continue) {
      _transmat.transMatContinue(result.square, this._offset[result.arcode_id], o_result);
    } else {
      _transmat.transMat(result.square, this._offset[result.arcode_id], o_result);
    }
    return;
  }
  /**
   * i_indexのマーカーの一致度を返します。
   *
   * @param i_index
   * マーカーのインデックス番号を指定します。 直前に実行したdetectMarkerLiteの戻り値未満かつ0以上である必要があります。
   * @return マーカーの一致度を返します。0～1までの値をとります。 一致度が低い場合には、誤認識の可能性が高くなります。
   * @throws NyARException
   */
  ,getConfidence : function(i_index)
  {
    return this._detect_cb.result_stack.getItem(i_index).confidence;
  }
  /**
   * i_indexのマーカーのARCodeインデックスを返します。
   *
   * @param i_index
   * マーカーのインデックス番号を指定します。 直前に実行したdetectMarkerLiteの戻り値未満かつ0以上である必要があります。
   * @return
   */
  ,getARCodeIndex : function(i_index)
  {
    return this._detect_cb.result_stack.getItem(i_index).arcode_id;
  }
  /**
   * getTransmationMatrixの計算モードを設定します。
   *
   * @param i_is_continue
   * TRUEなら、transMatContinueを使用します。 FALSEなら、transMatを使用します。
   */
  ,setContinueMode : function(i_is_continue)
  {
    this._is_continue = i_is_continue;
  }
})

NyARDetectMarkerResult = ASKlass('NyARDetectMarkerResult',
{
  arcode_id : 0,
  confidence : 0,
  square : new NyARSquare()
})

NyARDetectMarkerResultStack = ASKlass('NyARDetectMarkerResultStack ', NyARObjectStack,
{
  NyARDetectMarkerResultStack : function(i_length)
  {
    NyARObjectStack.initialize.call(this, i_length);
  }
  ,createArray : function(i_length)
  {
    var ret= new Array(i_length);
    for (var i =0; i < i_length; i++){
      ret[i] = new NyARDetectMarkerResult();
    }
    return (ret);
  }
})














NyARDetectSquareCB = ASKlass('NyARDetectSquareCB ', NyARSquareContourDetector_IDetectMarkerCallback,
{
  //公開プロパティ
  result_stack : new NyARDetectMarkerResultStack(NyARDetectMarker.AR_SQUARE_MAX),
  //参照インスタンス
  _ref_raster : null,
  //所有インスタンス
  _inst_patt : null,
  _deviation_data : null,
  _match_patt : null,
  __detectMarkerLite_mr : new NyARMatchPattResult(),
  _coordline : null,
  NyARDetectSquareCB : function(i_inst_patt, i_ref_code, i_num_of_code, i_param)
  {
    var cw = i_ref_code[0].getWidth();
    var ch = i_ref_code[0].getHeight();
    this._inst_patt=i_inst_patt;
    this._coordline=new NyARCoord2Linear(i_param.getScreenSize(),i_param.getDistortionFactor());
    this._deviation_data=new NyARMatchPattDeviationColorData(cw,ch);
    //NyARMatchPatt_Color_WITHOUT_PCA[]の作成
    this._match_patt=new Array(i_num_of_code);
    this._match_patt[0]=new NyARMatchPatt_Color_WITHOUT_PCA(i_ref_code[0]);
    for (var i = 1; i < i_num_of_code; i++){
      //解像度チェック
      if (cw != i_ref_code[i].getWidth() || ch != i_ref_code[i].getHeight()) {
        throw new NyARException();
      }
      this._match_patt[i]=new NyARMatchPatt_Color_WITHOUT_PCA(i_ref_code[i]);
    }
    return;
  },
  __tmp_vertex : NyARIntPoint2d.createArray(4),
  /**
   * 矩形が見付かるたびに呼び出されます。
   * 発見した矩形のパターンを検査して、方位を考慮した頂点データを確保します。
   */
  onSquareDetect : function(i_sender,i_coordx,i_coordy,i_coor_num ,i_vertex_index)
  {
    var mr=this.__detectMarkerLite_mr;
    //輪郭座標から頂点リストに変換
    var vertex=this.__tmp_vertex;
    vertex[0].x=i_coordx[i_vertex_index[0]];
    vertex[0].y=i_coordy[i_vertex_index[0]];
    vertex[1].x=i_coordx[i_vertex_index[1]];
    vertex[1].y=i_coordy[i_vertex_index[1]];
    vertex[2].x=i_coordx[i_vertex_index[2]];
    vertex[2].y=i_coordy[i_vertex_index[2]];
    vertex[3].x=i_coordx[i_vertex_index[3]];
    vertex[3].y=i_coordy[i_vertex_index[3]];
    //画像を取得
    if (!this._inst_patt.pickFromRaster(this._ref_raster,vertex)){
      return;
    }
    //取得パターンをカラー差分データに変換して評価する。
    this._deviation_data.setRaster(this._inst_patt);
    //最も一致するパターンを割り当てる。
    var square_index,direction;
    var confidence;
    this._match_patt[0].evaluate(this._deviation_data,mr);
    square_index=0;
    direction=mr.direction;
    confidence=mr.confidence;
    //2番目以降
    var i;
    for(i=1;i<this._match_patt.length;i++){
      this._match_patt[i].evaluate(this._deviation_data,mr);
      if (confidence > mr.confidence) {
        continue;
      }
      // もっと一致するマーカーがあったぽい
      square_index = i;
      direction = mr.direction;
      confidence = mr.confidence;
    }
    //最も一致したマーカ情報を、この矩形の情報として記録する。
    var result = this.result_stack.prePush();
    result.arcode_id = square_index;
    result.confidence = confidence;
    var sq=result.square;
    //directionを考慮して、squareを更新する。
    for(i=0;i<4;i++){
      var idx=(i+4 - direction) % 4;
      this._coordline.coord2Line(i_vertex_index[idx],i_vertex_index[(idx+1)%4],i_coordx,i_coordy,i_coor_num,sq.line[i]);
    }
    for (i = 0; i < 4; i++) {
      //直線同士の交点計算
      if(!NyARLinear.crossPos(sq.line[i],sq.line[(i + 3) % 4],sq.sqvertex[i])){
        throw new NyARException();//ここのエラー復帰するならダブルバッファにすればOK
      }
    }
  }
  ,init : function(i_raster)
  {
    this._ref_raster=i_raster;
    this.result_stack.clear();
  }
})










/**
 * 画像からARCodeに最も一致するマーカーを1個検出し、その変換行列を計算するクラスです。
 *
 */
NyARSingleDetectMarker = ASKlass('NyARSingleDetectMarker', NyARCustomSingleDetectMarker,
{
  PF_ARTOOLKIT_COMPATIBLE : 1,
  PF_NYARTOOLKIT : 2,
  PF_NYARTOOLKIT_ARTOOLKIT_FITTING : 100,
  PF_TEST2 : 201,
  /**
  * 検出するARCodeとカメラパラメータから、1個のARCodeを検出するNyARSingleDetectMarkerインスタンスを作ります。
  *
  * @param i_param
  * カメラパラメータを指定します。
  * @param i_code
  * 検出するARCodeを指定します。
  * @param i_marker_width
  * ARコードの物理サイズを、ミリメートルで指定します。
  * @param i_input_raster_type
  * 入力ラスタのピクセルタイプを指定します。この値は、INyARBufferReaderインタフェイスのgetBufferTypeの戻り値を指定します。
  * @throws NyARException
  */
  NyARSingleDetectMarker : function(i_param,i_code,i_marker_width,i_input_raster_type,i_profile_id)
  {
    if (i_profile_id == null) i_profile_id = this.PF_NYARTOOLKIT;
    NyARCustomSingleDetectMarker.initialize.call(this);
    this.initInstance2(i_param,i_code,i_marker_width,i_input_raster_type,i_profile_id);
    return;
  }
  /**
  * コンストラクタから呼び出す関数です。
  * @param i_ref_param
  * @param i_ref_code
  * @param i_marker_width
  * @param i_input_raster_type
  * @param i_profile_id
  * @throws NyARException
  */
  ,initInstance2 : function(
    i_ref_param,
    i_ref_code,
    i_marker_width,
    i_input_raster_type,
    i_profile_id)
  {
    var th=new NyARRasterFilter_ARToolkitThreshold(100,i_input_raster_type);
    var patt_inst;
    var sqdetect_inst;
    var transmat_inst;
    switch(i_profile_id){
    case this.PF_NYARTOOLKIT://default
      patt_inst=new NyARColorPatt_Perspective_O2(i_ref_code.getWidth(), i_ref_code.getHeight(),4,25);
      sqdetect_inst=new NyARSquareContourDetector_Rle(i_ref_param.getScreenSize());
      transmat_inst=new NyARTransMat(i_ref_param);
      break;
    default:
      throw new NyARException();
    }
    NyARCustomSingleDetectMarker.initInstance.call(this,patt_inst,sqdetect_inst,transmat_inst,th,i_ref_param,i_ref_code,i_marker_width);
  }
  /**
  * i_imageにマーカー検出処理を実行し、結果を記録します。
  *
  * @param i_raster
  * マーカーを検出するイメージを指定します。イメージサイズは、コンストラクタで指定i_paramの
  * スクリーンサイズと一致し、かつi_input_raster_typeに指定した形式でなければいけません。
  * @return マーカーが検出できたかを真偽値で返します。
  * @throws NyARException
  */
  ,detectMarkerLite : function(i_raster,i_threshold)
  {
    (NyARRasterFilter_ARToolkitThreshold(this._tobin_filter)).setThreshold(i_threshold);
    return NyARCustomSingleDetectMarker.detectMarkerLiteB.call(this,i_raster);
  }
})

/*
 * PROJECT: FLARToolKit
 * --------------------------------------------------------------------------------
 * This work is based on the NyARToolKit developed by
 *   R.Iizuka (nyatla)
 * http://nyatla.jp/nyatoolkit/
 *
 * The FLARToolKit is ActionScript 3.0 version ARToolkit class library.
 * Copyright (C)2008 Saqoosha
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  http://www.libspark.org/wiki/saqoosha/FLARToolKit
 *  <saq(at)saqoosha.net>
 *
 */

FLARDetectMarkerResult = ASKlass('FLARDetectMarkerResult',
{
  arcode_id : 0
  ,confidence : 0
  ,direction : 0
  ,square : new NyARSquare()
})

FLARDetectMarkerResultStack = ASKlass('FLARDetectMarkerResultStack', NyARObjectStack,
{
  FLARDetectMarkerResultStack : function(i_length)
  {
    NyARObjectStack.initialize.call(this, i_length);
  },
  createArray : function(i_length)
  {
    var ret = new Array(i_length);
    for (var i=0; i < i_length; i++){
      ret[i] = new FLARDetectMarkerResult();
    }
    return (ret);
  }
})


/**
 * 複数のマーカーを検出し、それぞれに最も一致するARコードを、コンストラクタで登録したARコードから 探すクラスです。最大300個を認識しますが、ゴミラベルを認識したりするので100個程度が限界です。
 *
 */
FLARMultiMarkerDetector = ASKlass('FLARMultiMarkerDetector',
{
  _detect_cb : null
  ,AR_SQUARE_MAX : 300
  ,_is_continue : false
  ,_square_detect : null
  ,_transmat : null
  ,_offset : null
  // import が消える現象回避用
  ,_flarcode : null
  /**
   * 複数のマーカーを検出し、最も一致するARCodeをi_codeから検索するオブジェクトを作ります。
   *
   * @param i_param
   * カメラパラメータを指定します。
   * @param i_code
   * 検出するマーカーのARCode配列を指定します。
   * 配列要素のインデックス番号が、そのままgetARCodeIndex関数で得られるARCodeインデックスになります。
   * 例えば、要素[1]のARCodeに一致したマーカーである場合は、getARCodeIndexは1を返します。
   * @param i_marker_width
   * i_codeのマーカーサイズをミリメートルで指定した配列を指定します。 先頭からi_number_of_code個の要素には、有効な値を指定する必要があります。
   * @param i_number_of_code
   * i_codeに含まれる、ARCodeの数を指定します。
   * @throws NyARException
   */
  ,FLARMultiMarkerDetector : function(i_param, i_code, i_marker_width, i_number_of_code)
  {
    this.initInstance(i_param,i_code,i_marker_width,i_number_of_code);
    return;
  }
  ,initInstance : function(
    i_ref_param,
    i_ref_code,
    i_marker_width,
    i_number_of_code)
  {
    var scr_size=i_ref_param.getScreenSize();
    // @todo この部分にマーカーの幅や高さ、枠線の割合がすべて一致するかのチェックを入れる
    // もしくは、FLARCodeの生成時に強制的に同一の数値を入力する事
    // 解析オブジェクトを作る
    var cw = i_ref_code[0].getWidth();
    var ch = i_ref_code[0].getHeight();
    // 枠線の割合(ARToolKit標準と同じなら、25 -> 1.0系と数値の扱いが異なるので注意！)
    var markerWidthByDec = (100 - i_ref_code[0].markerPercentWidth) / 2;
    var markerHeightByDec = (100 - i_ref_code[0].markerPercentHeight) / 2;
    //評価パターンのホルダを作成
    // NyARColorPatt_Perspective_O2のパラメータ
    // 第1,2パラ…縦横の解像度(patデータ作ったときの分割数)
    // 第3パラ…1ピクセルあたりの縦横サンプリング数。2なら2x2=4ポイントをサンプリングする。
    //       1,2,4,任意の数値のいずれか。値が大きいほど一致率ＵＰ、フレームレート低下。
    //       解像度16、サンプリング数4がデフォルト。解像度が大きい場合は、サンプリング数を下げることでフレームレートの低下を回避できる。
    // 第4パラ…エッジ幅の割合(ARToolKit標準と同じなら、25)->1.0系と数値の扱いが異なるので注意！
    var patt = new NyARColorPatt_Perspective_O2(cw, ch, 4, markerWidthByDec);
    // 縦横のエッジの割合が異なる場合にも対応できます。
    patt.setEdgeSizeByPercent(markerWidthByDec, markerHeightByDec, 4);
//      trace('w:'+markerWidthByDec+'/h:'+markerHeightByDec);
    //detectMarkerのコールバック関数
    this._detect_cb=new MultiDetectSquareCB(patt,i_ref_code,i_number_of_code,i_ref_param);
    this._transmat = new NyARTransMat(i_ref_param);
    //NyARToolkitプロファイル
    this._square_detect =new FLARSquareContourDetector(i_ref_param.getScreenSize());
    this._tobin_filter=new FLARRasterFilter_Threshold(100);
    //実サイズ保存
    this._offset = NyARRectOffset.createArray(i_number_of_code);
    for(var i=0;i<i_number_of_code;i++){
      this._offset[i].setSquare(i_marker_width[i]);
    }
    //２値画像バッファを作る
    this._bin_raster=new FLARBinRaster(scr_size.w,scr_size.h);
    return;
  }
  ,_bin_raster : null
  ,_tobin_filter : null
  /**
   * i_imageにマーカー検出処理を実行し、結果を記録します。
   *
   * @param i_raster
   * マーカーを検出するイメージを指定します。
   * @param i_thresh
   * 検出閾値を指定します。0～255の範囲で指定してください。 通常は100～130くらいを指定します。
   * @return 見つかったマーカーの数を返します。 マーカーが見つからない場合は0を返します。
   * @throws NyARException
   */
  ,detectMarkerLite : function(i_raster,i_threshold)
  {
    // サイズチェック
    if (!this._bin_raster.getSize().isEqualSize_NyARIntSize(i_raster.getSize())) {
      throw new NyARException();
    }
    // ラスタを２値イメージに変換する.
    // SOC: threshold incoming image according to brightness.
    //    passing -1 for threshold allows developers to apply custom thresholding algorithms
    //    prior to passing source image to FLARToolkit.
    if (i_threshold != -1) {
      // apply FLARToolkit thresholding
      (FLARRasterFilter_Threshold(this._tobin_filter)).setThreshold(i_threshold);
      this._tobin_filter.doFilter(i_raster, this._bin_raster);
    } else {
      // copy source BitmapData as-is, without applying FLARToolkit thresholding
      var srcBitmapData = (i_raster.getBuffer());
      var dstBitmapData = ((this._bin_raster).getBuffer());
      dstBitmapData.copyPixels(srcBitmapData, srcBitmapData.rect, new Point());
    }
    //detect
    this._detect_cb.init(i_raster);
    this._square_detect.detectMarkerCB(this._bin_raster,this._detect_cb);
    //見付かった数を返す。
    return this._detect_cb.result_stack.getLength();
  }
  /**
   * i_indexのマーカーに対する変換行列を計算し、結果値をo_resultへ格納します。 直前に実行したdetectMarkerLiteが成功していないと使えません。
   *
   * @param i_index
   * マーカーのインデックス番号を指定します。 直前に実行したdetectMarkerLiteの戻り値未満かつ0以上である必要があります。
   * @param o_result
   * 結果値を受け取るオブジェクトを指定してください。
   * @throws NyARException
   */
  ,getTransformMatrix : function(i_index, o_result)
  {
    var result = this._detect_cb.result_stack.getItem(i_index);
    // 一番一致したマーカーの位置とかその辺を計算
    if (_is_continue) {
      _transmat.transMatContinue(result.square, this._offset[result.arcode_id], o_result);
    } else {
      _transmat.transMat(result.square, this._offset[result.arcode_id], o_result);
    }
    return;
  }
  /**
   * i_indexのマーカーの一致度を返します。
   *
   * @param i_index
   * マーカーのインデックス番号を指定します。 直前に実行したdetectMarkerLiteの戻り値未満かつ0以上である必要があります。
   * @return マーカーの一致度を返します。0～1までの値をとります。 一致度が低い場合には、誤認識の可能性が高くなります。
   * @throws NyARException
   */
  ,getConfidence : function(i_index)
  {
    return this._detect_cb.result_stack.getItem(i_index).confidence;
  }
  /**
   * i_indexのマーカーのARCodeインデックスを返します。
   *
   * @param i_index
   * マーカーのインデックス番号を指定します。 直前に実行したdetectMarkerLiteの戻り値未満かつ0以上である必要があります。
   * @return
   */
  ,getARCodeIndex : function(i_index)
  {
    return this._detect_cb.result_stack.getItem(i_index).arcode_id;
  }
  /**
   * 検出したマーカーの方位を返します。
   * 0,1,2,3の何れかを返します。
   *
   * @return Returns whether any of 0,1,2,3.
   */
  ,getDirection : function(i_index)
  {
    return this._detect_cb.result_stack.getItem(i_index).direction;
  }
  /**
   * 検出した FLARSquare 1 個返す。検出できなかったら null。
   * @return Total return detected FLARSquare 1. Detection Dekinakattara null.
   */
  ,getSquare : function(i_index)
  {
    return this._detect_cb.result_stack.getItem(i_index).square;
  }
  /**
   * getTransmationMatrixの計算モードを設定します。
   *
   * @param i_is_continue
   * TRUEなら、transMatContinueを使用します。 FALSEなら、transMatを使用します。
   */
  ,setContinueMode : function(i_is_continue)
  {
    this._is_continue = i_is_continue;
  }
  /**
   * 白領域の検査対象サイズ
   *  最大サイズは 一辺約320px、最小サイズは 一辺約 8px まで解析対象としている
   *  解析画像中で上記範囲内であれば解析対象となるが、最小サイズは小さすぎて意味をなさない。
   *  マーカー内部の判別には一辺30px～230pxとするのが妥当。
   *  640x480で取り込む場合は、i_maxを縦サイズの二乗を設定する。
   *  なお、0 を指定した場合は FLARLabeling.AR_AREA_MAX、FLARLabeling.AR_AREA_MINが適応されます。
   *
   * @param i_max 解析対象とする白領域の最大pixel数(一辺の二乗) default: 100000
   * @param i_min 解析対象とする白領域の最小pixel数(一辺の二乗) default: 70
   */
  ,setAreaRange : function(i_max, i_min)
  {
    if (i_max == null)
      i_max = 100000;
    if (i_min == null)
      i_min = 70;
    if ( i_max<0 ) { i_max = FLARLabeling.AR_AREA_MAX; }
    if ( i_min<0 ) { i_min = FLARLabeling.AR_AREA_MIN; }
    if (i_max < i_min) {
      var tmp = i_max;
      i_max = i_min;
      i_min = tmp;
    }
    this._square_detect.setAreaRange( i_max, i_min);
  }
  /**
   * 2値化した画像を返却します。
   *
   * @return 画像情報を返却します
   */
  ,thresholdedBitmapData : function()
  {
    try {
      return ((this._bin_raster).getBuffer());
    } catch (e) {
      return null;
    }
    return null;
  }
})

FLARSingleMarkerDetector = ASKlass('FLARSingleMarkerDetector',
{
  _is_continue : false
  ,_square_detect : null
  ,_transmat : null
  //画処理用
  ,_bin_raster : null
  ,_tobin_filter : null
  ,_detect_cb : null
  ,_offset : null
  ,FLARSingleMarkerDetector : function(i_ref_param,i_ref_code,i_marker_width)
  {
    var th=new FLARRasterFilter_Threshold(100);
    var patt_inst;
    var sqdetect_inst;
    var transmat_inst;
    // 枠線の割合(ARToolKit標準と同じなら、25 -> 1.0系と数値の扱いが異なるので注意！)
    var markerWidthByDec = (100 - i_ref_code.markerPercentWidth) / 2;
    var markerHeightByDec = (100 - i_ref_code.markerPercentHeight) / 2;
    //評価パターンのホルダを作成
    // NyARColorPatt_Perspective_O2のパラメータ
    // 第1,2パラ…縦横の解像度(patデータ作ったときの分割数)
    // 第3パラ…1ピクセルあたりの縦横サンプリング数。2なら2x2=4ポイントをサンプリングする。
    //       1,2,4,任意の数値のいずれか。値が大きいほど一致率ＵＰ、フレームレート低下。
    //       解像度16、サンプリング数4がデフォルト。解像度が大きい場合は、サンプリング数を下げることでフレームレートの低下を回避できる。
    // 第4パラ…エッジ幅の割合(ARToolKit標準と同じなら、25)->1.0系と数値の扱いが異なるので注意！
    patt_inst = new NyARColorPatt_Perspective_O2(i_ref_code.getWidth(), i_ref_code.getHeight(), 4, markerWidthByDec);
    // 縦横のエッジの割合が異なる場合にも対応できます。
    patt_inst.setEdgeSizeByPercent(markerWidthByDec, markerHeightByDec, 4);
//      trace('w:'+markerWidthByDec+'/h:'+markerHeightByDec);
    sqdetect_inst=new FLARSquareContourDetector(i_ref_param.getScreenSize());
    transmat_inst=new NyARTransMat(i_ref_param);
    this.initInstance(patt_inst,sqdetect_inst,transmat_inst,th,i_ref_param,i_ref_code,i_marker_width);
    return;
  }
  ,initInstance : function(
    i_patt_inst,
    i_sqdetect_inst,
    i_transmat_inst,
    i_filter,
    i_ref_param,
    i_ref_code,
    i_marker_width)
  {
    var scr_size=i_ref_param.getScreenSize();
    // 解析オブジェクトを作る
    this._square_detect = i_sqdetect_inst;
    this._transmat = i_transmat_inst;
    this._tobin_filter=i_filter;
    //２値画像バッファを作る
    this._bin_raster=new FLARBinRaster(scr_size.w,scr_size.h);
    //_detect_cb
    this._detect_cb=new SingleDetectSquareCB(i_patt_inst,i_ref_code,i_ref_param);
    //オフセットを作成
    this._offset=new NyARRectOffset();
    this._offset.setSquare(i_marker_width);
    return;
  }
  /**
   * i_imageにマーカー検出処理を実行し、結果を記録します。
   *
   * @param i_raster
   * マーカーを検出するイメージを指定します。イメージサイズは、カメラパラメータ
   * と一致していなければなりません。
   * @return マーカーが検出できたかを真偽値で返します。
   * @throws NyARException
   */
  ,detectMarkerLite : function(i_raster,i_threshold)
  {
    FLARRasterFilter_Threshold(this._tobin_filter).setThreshold(i_threshold);
    //サイズチェック
    if(!this._bin_raster.getSize().isEqualSize_NyARIntSize(i_raster.getSize())){
      throw new FLARException();
    }
    //ラスタを２値イメージに変換する.
    this._tobin_filter.doFilter(i_raster,this._bin_raster);
    //コールバックハンドラの準備
    this._detect_cb.init(i_raster);
    //矩形を探す(戻り値はコールバック関数で受け取る。)
    this._square_detect.detectMarkerCB(this._bin_raster,this._detect_cb);
    if(this._detect_cb.confidence==0){
      return false;
    }
    return true;
  }
  /**
   * 検出したマーカーの変換行列を計算して、o_resultへ値を返します。
   * 直前に実行したdetectMarkerLiteが成功していないと使えません。
   *
   * @param o_result
   * 変換行列を受け取るオブジェクトを指定します。
   * @throws NyARException
   */
  ,getTransformMatrix : function(o_result)
  {
    // 一番一致したマーカーの位置とかその辺を計算
    if (this._is_continue) {
      this._transmat.transMatContinue(this._detect_cb.square,this._offset, o_result);
    } else {
      this._transmat.transMat(this._detect_cb.square,this._offset, o_result);
    }
    return;
  }
  /**
   * 検出したマーカーの一致度を返します。
   *
   * @return マーカーの一致度を返します。0～1までの値をとります。 一致度が低い場合には、誤認識の可能性が高くなります。
   * @throws NyARException
   */
  ,getConfidence : function()
  {
    return this._detect_cb.confidence;
  }
  /**
   * 検出したマーカーの方位を返します。
   * 0,1,2,3の何れかを返します。
   *
   * @return Returns whether any of 0,1,2,3.
   */
  ,getDirection : function()
  {
    return this._detect_cb.direction;
  }
  /**
   * 検出した FLARSquare 1 個返す。検出できなかったら null。
   * @return Total return detected FLARSquare 1. Detection Dekinakattara null.
   */
  ,getSquare : function()
  {
    return this._detect_cb.square;
  }
  /**
   * getTransmationMatrixの計算モードを設定します。 初期値はTRUEです。
   *
   * @param i_is_continue
   * TRUEなら、transMatCont互換の計算をします。 FALSEなら、transMat互換の計算をします。
   */
  ,setContinueMode : function(i_is_continue)
  {
    this._is_continue = i_is_continue;
  }
  /**
   * 白領域の検査対象サイズ
   *  最大サイズは 一辺約320px、最小サイズは 一辺約 8px まで解析対象としている
   *  解析画像中で上記範囲内であれば解析対象となるが、最小サイズは小さすぎて意味をなさない。
   *  マーカー内部の判別には一辺30px～230pxとするのが妥当。
   *  640x480で取り込む場合は、i_maxを縦サイズの二乗を設定する。
   *  なお、0 を指定した場合は FLARLabeling.AR_AREA_MAX、FLARLabeling.AR_AREA_MINが適応されます。
   *
   * @param i_max 解析対象とする白領域の最大pixel数(一辺の二乗) default: 100000
   * @param i_min 解析対象とする白領域の最小pixel数(一辺の二乗) default: 70
   */
  ,setAreaRange : function(i_max, i_min)
  {
    if (i_max == null)
      i_max = 100000;
    if (i_min == null)
      i_min = 70;
    if ( i_max<0 ) { i_max = FLARLabeling.AR_AREA_MAX; }
    if ( i_min<0 ) { i_min = FLARLabeling.AR_AREA_MIN; }
    if (i_max < i_min) {
      var tmp = i_max;
      i_max = i_min;
      i_min = tmp;
    }
    this._square_detect.setAreaRange( i_max, i_min);
  }
  /**
   * 2値化した画像を返却します。
   *
   * @return 画像情報を返却します
   */
  ,thresholdedBitmapData : function()
  {
    try {
      return ((this._bin_raster).getBuffer());
    } catch (e) {
      return null;
    }
    return null;
  }
})


/**
 * detectMarkerのコールバック関数
 */
MultiDetectSquareCB = ASKlass('MultiDetectSquareCB',
{
  //公開プロパティ
  result_stack : new FLARDetectMarkerResultStack(NyARDetectMarker.AR_SQUARE_MAX)
  //参照インスタンス
  ,_ref_raster : null
  //所有インスタンス
  ,_inst_patt : null
  ,_deviation_data : null
  ,_match_patt : null
  ,__detectMarkerLite_mr : new NyARMatchPattResult()
  ,_coordline : null
  ,MultiDetectSquareCB : function(i_inst_patt, i_ref_code, i_num_of_code, i_param)
  {
    var cw = i_ref_code[0].getWidth();
    var ch = i_ref_code[0].getHeight();
    this._inst_patt=i_inst_patt;
    this._coordline=new NyARCoord2Linear(i_param.getScreenSize(),i_param.getDistortionFactor());
    this._deviation_data=new NyARMatchPattDeviationColorData(cw,ch);
    //NyARMatchPatt_Color_WITHOUT_PCA[]の作成
    this._match_patt=new Array(i_num_of_code);
    this._match_patt[0]=new NyARMatchPatt_Color_WITHOUT_PCA(i_ref_code[0]);
    for (var i = 1; i < i_num_of_code; i++){
      //解像度チェック
      if (cw != i_ref_code[i].getWidth() || ch != i_ref_code[i].getHeight()) {
        throw new NyARException();
      }
      this._match_patt[i]=new NyARMatchPatt_Color_WITHOUT_PCA(i_ref_code[i]);
    }
    return;
  }
  ,__tmp_vertex : NyARIntPoint2d.createArray(4)
  /**
   * 矩形が見付かるたびに呼び出されます。
   * 発見した矩形のパターンを検査して、方位を考慮した頂点データを確保します。
   */
  ,onSquareDetect : function(i_sender,i_coordx,i_coordy,i_coor_num ,i_vertex_index)
  {
    var mr=this.__detectMarkerLite_mr;
    //輪郭座標から頂点リストに変換
    var vertex=this.__tmp_vertex;
    vertex[0].x=i_coordx[i_vertex_index[0]];
    vertex[0].y=i_coordy[i_vertex_index[0]];
    vertex[1].x=i_coordx[i_vertex_index[1]];
    vertex[1].y=i_coordy[i_vertex_index[1]];
    vertex[2].x=i_coordx[i_vertex_index[2]];
    vertex[2].y=i_coordy[i_vertex_index[2]];
    vertex[3].x=i_coordx[i_vertex_index[3]];
    vertex[3].y=i_coordy[i_vertex_index[3]];
    //画像を取得
    if (!this._inst_patt.pickFromRaster(this._ref_raster,vertex)){
      return;
    }
    //取得パターンをカラー差分データに変換して評価する。
    this._deviation_data.setRaster(this._inst_patt);
    //最も一致するパターンを割り当てる。
    var square_index,direction;
    var confidence;
    this._match_patt[0].evaluate(this._deviation_data,mr);
    square_index=0;
    direction=mr.direction;
    confidence=mr.confidence;
    //2番目以降
    var i;
    for(i=1;i<this._match_patt.length;i++){
      this._match_patt[i].evaluate(this._deviation_data,mr);
      if (confidence > mr.confidence) {
        continue;
      }
      // もっと一致するマーカーがあったぽい
      square_index = i;
      direction = mr.direction;
      confidence = mr.confidence;
    }
    //最も一致したマーカ情報を、この矩形の情報として記録する。
    var result = this.result_stack.prePush();
    result.arcode_id = square_index;
    result.confidence = confidence;
    result.direction = direction;
    var sq=result.square;
    //directionを考慮して、squareを更新する。
    for(i=0;i<4;i++){
      var idx=(i+4 - direction) % 4;
      this._coordline.coord2Line(i_vertex_index[idx],i_vertex_index[(idx+1)%4],i_coordx,i_coordy,i_coor_num,sq.line[i]);
    }
    for (i = 0; i < 4; i++) {
      //直線同士の交点計算
      if(!NyARLinear.crossPos(sq.line[i],sq.line[(i + 3) % 4],sq.sqvertex[i])){
        throw new NyARException();//ここのエラー復帰するならダブルバッファにすればOK
      }
    }
  }
  ,init : function(i_raster)
  {
    this._ref_raster=i_raster;
    this.result_stack.clear();
  }
})


/**
 * detectMarkerのコールバック関数
 */
SingleDetectSquareCB = ASKlass('SingleDetectSquareCB',
{
  //公開プロパティ
  confidence : 0
  ,square : new NyARSquare()
  ,direction : 0
  //参照インスタンス
  ,_ref_raster : null
  //所有インスタンス
  ,_inst_patt : null
  ,_deviation_data : null
  ,_match_patt : null
  ,__detectMarkerLite_mr : new NyARMatchPattResult()
  ,_coordline : null
  ,SingleDetectSquareCB : function(i_inst_patt,i_ref_code,i_param)
  {
    this._inst_patt=i_inst_patt;
    this._deviation_data=new NyARMatchPattDeviationColorData(i_ref_code.getWidth(),i_ref_code.getHeight());
    this._coordline=new NyARCoord2Linear(i_param.getScreenSize(),i_param.getDistortionFactor());
    this._match_patt=new NyARMatchPatt_Color_WITHOUT_PCA(i_ref_code);
    return;
  }
  ,__tmp_vertex : NyARIntPoint2d.createArray(4)
  /**
   * 矩形が見付かるたびに呼び出されます。
   * 発見した矩形のパターンを検査して、方位を考慮した頂点データを確保します。
   */
  ,onSquareDetect : function(i_sender,i_coordx,i_coordy,i_coor_num,i_vertex_index)
  {
    var i;
    var mr=this.__detectMarkerLite_mr;
    //輪郭座標から頂点リストに変換
    var vertex=this.__tmp_vertex;
    vertex[0].x=i_coordx[i_vertex_index[0]];
    vertex[0].y=i_coordy[i_vertex_index[0]];
    vertex[1].x=i_coordx[i_vertex_index[1]];
    vertex[1].y=i_coordy[i_vertex_index[1]];
    vertex[2].x=i_coordx[i_vertex_index[2]];
    vertex[2].y=i_coordy[i_vertex_index[2]];
    vertex[3].x=i_coordx[i_vertex_index[3]];
    vertex[3].y=i_coordy[i_vertex_index[3]];
    //画像を取得
    if (!this._inst_patt.pickFromRaster(this._ref_raster,vertex)){
      return;
    }
    //取得パターンをカラー差分データに変換して評価する。
    this._deviation_data.setRaster(this._inst_patt);
    if(!this._match_patt.evaluate(this._deviation_data,mr)){
      return;
    }
    //現在の一致率より低ければ終了
    if (this.confidence > mr.confidence){
      return;
    }
    //一致率の高い矩形があれば、方位を考慮して頂点情報を作成
    var sq=this.square;
    this.confidence = mr.confidence;
    this.direction = mr.direction;
    //directionを考慮して、squareを更新する。
    for(i=0;i<4;i++){
      var idx=(i+4 - mr.direction) % 4;
      this._coordline.coord2Line(i_vertex_index[idx],i_vertex_index[(idx+1)%4],i_coordx,i_coordy,i_coor_num,sq.line[i]);
    }
    for (i = 0; i < 4; i++) {
      //直線同士の交点計算
      if(!NyARLinear.crossPos(sq.line[i],sq.line[(i + 3) % 4],sq.sqvertex[i])){
        throw new NyARException();//ここのエラー復帰するならダブルバッファにすればOK
      }
    }
  }
  ,init : function(i_raster)
  {
    this.confidence=0;
    this._ref_raster=i_raster;
  }
})
/*
 * PROJECT: FLARToolKit
 * --------------------------------------------------------------------------------
 * This work is based on the NyARToolKit developed by
 *   R.Iizuka (nyatla)
 * http://nyatla.jp/nyatoolkit/
 *
 * The FLARToolKit is ActionScript 3.0 version ARToolkit class library.
 * Copyright (C)2008 Saqoosha
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 2
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this framework; if not, write to the Free Software
 * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
 *
 * For further information please contact.
 *  http://www.libspark.org/wiki/saqoosha/FLARToolKit
 *  <saq(at)saqoosha.net>
 *
 *  http://nyatla.jp/nyatoolkit/
 *  <airmail(at)ebony.plala.or.jp> or <nyatla(at)nyatla.jp>
 *
 * For further information of this class, please contact.
 * http://sixwish.jp
 * <rokubou(at)gmail.com>
 */

/**
 * ...
 * @author tarotarorg
 */
FLARIdMarkerData = ASKlass('FLARIdMarkerData',
{
  /**
   * パケットデータをVectorで表現。（最大パケット数がモデル7での21+(1)なので、22で初期化している）
   */
  _packet : new IntVector(22)
  ,_model : 0
  ,_controlDomain : 0
  ,_controlMask : 0
  ,_check : 0
  ,_dataDot : 0
  ,packetLength : 0
  ,FLARIdMarkerData : function()
  {
  }
  ,isEqual : function(i_target)
  {
    if (i_target == null || !(i_target instanceof FLARIdMarkerData)) {
      return false;
    }
    var s = i_target;
    if (s.packetLength != this.packetLength    ||
      s._check != this._check          ||
      s._controlDomain != this._controlDomain  ||
      s._controlMask != this._controlMask    ||
      s._dataDot != this._dataDot        ||
      s._model != this._model){
      return false;
    }
    for(var i = s.packetLength - 1; i>=0; i--){
      if(s._packet[i] != this._packet[i]){
        return false;
      }
    }
    return true;
  }
  ,copyFrom : function(i_source)
  {
    var s = i_source;
    if (s == null) return;
    this._check = s._check;
    this._controlDomain = s._controlDomain;
    this._controlMask = s._controlMask;
    this._dataDot = s._dataDot;
    this._model = s._model;
    this.packetLength = s.packetLength;
    for (var i = s.packetLength - 1; i >= 0; i--) {
      this._packet[i] = s._packet[i];
    }
    return;
  }
///////////////////////////////////////////////////////////////////////////////////
// setters
///////////////////////////////////////////////////////////////////////////////////
  ,setModel : function(value)
  {
    this._model = value;
  }
  ,setControlDomain : function(value)
  {
    this._controlDomain = value;
  }
  ,setControlMask : function(value)
  {
    this._controlMask = value;
  }
  ,setCheck : function(value)
  {
    this._check = value;
  }
  ,setPacketData : function(index, data)
  {
    if (index < this.packetLength) {
      this._packet[index] = data;
    } else {
      throw ("packet index over " + index + " >= " + this.packetLength);
    }
  }
  ,setDataDotLength : function(value)
  {
    this._dataDot = value;
  }
  ,setPacketLength : function(value)
  {
    this.packetLength = value;
  }
///////////////////////////////////////////////////////////////////////////////////
// getters
///////////////////////////////////////////////////////////////////////////////////
  ,dataDotLength : function() { return this._dataDot; }
  ,model : function() { return this._model; }
  ,controlDomain : function() { return this._controlDomain; }
  ,controlMask : function() { return this._controlMask; }
  ,check : function() { return this._check; }
  ,getPacketData : function(index)
  {
    if (this.packetLength <= index) throw new ArgumentError("packet index over");
    return this._packet[index];
  }
})


FLARDetectIdMarkerResult = ASKlass('FLARDetectIdMarkerResult',
{
  arcode_id : 0
  ,direction : 0
  ,markerdata : new FLARIdMarkerData()
  ,square : new NyARSquare()
})
FLARDetectIdMarkerResultStack = ASKlass('FLARDetectIdMarkerResultStack', NyARObjectStack,
{
  FLARDetectIdMarkerResultStack : function(i_length)
  {
    NyARObjectStack.initialize.call(this,i_length);
  }
  ,createArray : function(i_length)
  {
    var ret= new Array(i_length);
    for (var i =0; i < i_length; i++){
      ret[i] = new FLARDetectIdMarkerResult();
    }
    return (ret);
  }
})

/**
 * detectMarkerのコールバック関数
 */
FLARMultiIdMarkerDetectCB = ASKlass('FLARMultiIdMarkerDetectCB',
{
  //公開プロパティ
  result_stack : new FLARDetectIdMarkerResultStack(NyARDetectMarker.AR_SQUARE_MAX)
  ,square : new FLARSquare()
  ,marker_data : null
  ,threshold : 0
  ,direction : 0
  ,_ref_raster : null
  ,_current_data : null
  ,_data_temp : null
  ,_prev_data : null
  ,_id_pickup : new NyIdMarkerPickup()
  ,_coordline : null
  ,_encoder : null
  ,__tmp_vertex : NyARIntPoint2d.createArray(4)
  ,_marker_param : new NyIdMarkerParam()
  ,_maker_pattern : new NyIdMarkerPattern()
  ,FLARMultiIdMarkerDetectCB : function(i_param,i_encoder)
  {
    this._coordline=new NyARCoord2Linear(i_param.getScreenSize(),i_param.getDistortionFactor());
    this._data_temp=i_encoder.createDataInstance();
    this._current_data=i_encoder.createDataInstance();
    this._encoder=i_encoder;
    return;
  }
  /**
   * Initialize call back handler.
   */
  ,init : function(i_raster)
  {
    this.marker_data=null;
    this.result_stack.clear();
    this._id_pickup.init();
    this._ref_raster=i_raster;
  }
  ,_previous_verts : {}
  /**
   * 矩形が見付かるたびに呼び出されます。
   * 発見した矩形のパターンを検査して、方位を考慮した頂点データを確保します。
   */
  ,onSquareDetect : function(i_sender,i_coordx,i_coordy,i_coor_num,i_vertex_index)
  {
    //輪郭座標から頂点リストに変換
    var vertex=this.__tmp_vertex;
    vertex[0].x=i_coordx[i_vertex_index[0]];
    vertex[0].y=i_coordy[i_vertex_index[0]];
    vertex[1].x=i_coordx[i_vertex_index[1]];
    vertex[1].y=i_coordy[i_vertex_index[1]];
    vertex[2].x=i_coordx[i_vertex_index[2]];
    vertex[2].y=i_coordy[i_vertex_index[2]];
    vertex[3].x=i_coordx[i_vertex_index[3]];
    vertex[3].y=i_coordy[i_vertex_index[3]];
    var param=this._marker_param;
    var patt_data=this._maker_pattern;
    // 評価基準になるパターンをイメージから切り出す
    var cv;
    if (window.DEBUG) {
      cv = document.getElementById('debugCanvas').getContext('2d');
      cv.fillStyle = 'blue';
      for (var i=0; i<4; i++) {
        cv.fillRect(vertex[i].x-2, vertex[i].y-2, 5, 5);
      }
    }
    var cx=0,cy=0;
    for (var i=0; i<4; i++) {
      cx += vertex[i].x;
      cy += vertex[i].y;
    }
    cx /= 4;
    cy /= 4;
    var pick = this._id_pickup.pickFromRaster(this._ref_raster,vertex, patt_data, param);
    if (!pick) {
      if (window.DEBUG) {
        cv.fillStyle = '#ff0000';
        cv.fillText('No pick', cx+3, cy);
      }
      return;
    }
    //エンコード
    var enc = this._encoder.encode(patt_data,this._data_temp);
    if(!enc){
      return;
    }
    this._current_data.copyFrom(this._data_temp);
    this.marker_data = this._current_data;//みつかった。
    this.threshold = param.threshold;
    this.direction = param.direction;
    //マーカ情報を記録する。
    var result = this.result_stack.prePush();
    result.direction = this.direction;
    result.markerdata.copyFrom(this.marker_data);
    result.arcode_id = this.getId(result.markerdata);
    if (window.DEBUG) {
      cv.fillStyle = '#00ffff';
      cv.fillText(result.arcode_id, cx+3, cy);
    }
    //新しく認識、または継続認識中に更新があったときだけ、Square情報を更新する。
    //ココから先はこの条件でしか実行されない。
    var sq = result.square;
    //directionを考慮して、squareを更新する。
    var i;
    for(i=0;i<4;i++){
      var idx=(i+4 - param.direction) % 4;
      this._coordline.coord2Line(i_vertex_index[idx],i_vertex_index[(idx+1)%4],i_coordx,i_coordy,i_coor_num,sq.line[i]);
    }
    for (i= 0; i < 4; i++) {
      //直線同士の交点計算
      if(!NyARLinear.crossPos(sq.line[i],sq.line[(i + 3) % 4],sq.sqvertex[i])){
        throw new NyARException();//ここのエラー復帰するならダブルバッファにすればOK
      }
    }
  }
  ,getId : function(data)
  {
    var currId;
    if (data.packetLength > 4) {
      currId = -1;
    }else{
      currId=0;
      //最大4バイト繋げて１個のint値に変換
      for (var i = 0; i < data.packetLength; i++ ) {
        currId = (currId << 8) | data.getPacketData(i);
      }
    }
    return currId;
  }
})

FLARMultiIdMarkerDetector = ASKlass('FLARMultiIdMarkerDetector',
{
  _is_continue : false
  ,_square_detect : null
  ,_offset : null
  ,_current_threshold : 110
  // [AR]検出結果の保存用
  ,_bin_raster : null
  ,_tobin_filter : null
  ,_callback : null
  ,_data_current : null
  ,_threshold_detect : null
  ,_transmat : null
  ,FLARMultiIdMarkerDetector : function(i_param ,i_marker_width)
  {
    var scr_size = i_param.getScreenSize();
    var encoder = new FLARIdMarkerDataEncoder_RawBit();
    // 解析オブジェクトを作る
    this._square_detect = new FLARSquareContourDetector(scr_size);
    this._callback = new FLARMultiIdMarkerDetectCB(i_param, encoder);
    this._transmat = new NyARTransMat(i_param);
    // ２値画像バッファを作る
    this._bin_raster = new FLARBinRaster(scr_size.w, scr_size.h);
    //ワーク用のデータオブジェクトを２個作る
    this._data_current = encoder.createDataInstance();
    this._tobin_filter = new FLARRasterFilter_Threshold(110);
    this._threshold_detect = new FLARRasterThresholdAnalyzer_SlidePTile(15, 4);
    this._offset = new NyARRectOffset();
    this._offset.setSquare(i_marker_width);
    return;
  }
  ,detectMarkerLite : function(i_raster, i_threshold)
  {
    // サイズチェック
    if (!this._bin_raster.getSize().isEqualSize_int(i_raster.getSize().w, i_raster.getSize().h)) {
      throw new FLARException();
    }
    // ラスタを２値イメージに変換する.
    this._tobin_filter.setThreshold(i_threshold);
    this._tobin_filter.doFilter(i_raster, this._bin_raster);
    // スクエアコードを探す(第二引数に指定したマーカ、もしくは新しいマーカを探す。)
    this._callback.init(this._bin_raster);
    this._square_detect.detectMarkerCB(this._bin_raster, this._callback);
    //見付かった数を返す。
    return this._callback.result_stack.getLength();
  }
  /**
   * i_indexのマーカーに対する変換行列を計算し、結果値をo_resultへ格納します。 直前に実行したdetectMarkerLiteが成功していないと使えません。
   *
   * @param i_index
   * マーカーのインデックス番号を指定します。 直前に実行したdetectMarkerLiteの戻り値未満かつ0以上である必要があります。
   * @param o_result
   * 結果値を受け取るオブジェクトを指定してください。
   * @throws NyARException
   */
  ,getTransformMatrix : function(i_index, o_result)
  {
    var result = this._callback.result_stack.getItem(i_index);
    // 一番一致したマーカーの位置とかその辺を計算
    if (this._is_continue) {
      this._transmat.transMatContinue(result.square, this._offset, o_result);
    } else {
      this._transmat.transMat(result.square, this._offset, o_result);
    }
    return;
  }
  ,getIdMarkerData : function(i_index)
  {
    var result = new FLARIdMarkerData();
    result.copyFrom(this._callback.result_stack.getItem(i_index).markerdata);
    return result;
  }
  /**
   * i_indexのマーカーのARCodeインデックスを返します。
   *
   * @param i_index
   * マーカーのインデックス番号を指定します。 直前に実行したdetectMarkerLiteの戻り値未満かつ0以上である必要があります。
   * @return
   */
  ,getARCodeIndex : function(i_index)
  {
    return this._callback.result_stack.getItem(i_index).arcode_id;
  }
  /**
   * 検出したマーカーの方位を返します。
   * 0,1,2,3の何れかを返します。
   *
   * @return Returns whether any of 0,1,2,3.
   */
  ,getDirection : function(i_index)
  {
    return this._callback.result_stack.getItem(i_index).direction;
  }
  /**
   * 検出した FLARSquare 1 個返す。検出できなかったら null。
   * @return Total return detected FLARSquare 1. Detection Dekinakattara null.
   */
  ,getSquare : function(i_index)
  {
    return this._callback.result_stack.getItem(i_index).square;
  }
  /**
   * getTransmationMatrixの計算モードを設定します。
   *
   * @param i_is_continue
   * TRUEなら、transMatContinueを使用します。 FALSEなら、transMatを使用します。
   */
  ,setContinueMode : function(i_is_continue)
  {
    this._is_continue = i_is_continue;
  }
  /**
   * 2値化した画像を返却します。
   *
   * @return 画像情報を返却します
   */
  ,thresholdedBitmapData : function()
  {
    try {
      return ((this._bin_raster).getBuffer());
    } catch (e) {
      return null;
    }
    return null;
  }
})
/**
 * detectMarkerのコールバック関数
 */
FLARSingleIdMarkerDetectCB = ASKlass('FLARSingleIdMarkerDetectCB',
{
  //公開プロパティ
  square : new FLARSquare()
  ,marker_data : null
  ,threshold : 0
  ,direction : 0
  ,_ref_raster : null
  ,_current_data : null
  ,_data_temp : null
  ,_prev_data : null
  ,_id_pickup : new NyIdMarkerPickup()
  ,_coordline : null
  ,_encoder : null
  ,__tmp_vertex : NyARIntPoint2d.createArray(4)
  ,_marker_param : new NyIdMarkerParam()
  ,_maker_pattern : new NyIdMarkerPattern()
  ,FLARSingleIdMarkerDetectCB : function(i_param,i_encoder)
  {
    this._coordline=new NyARCoord2Linear(i_param.getScreenSize(),i_param.getDistortionFactor());
    this._data_temp=i_encoder.createDataInstance();
    this._current_data=i_encoder.createDataInstance();
    this._encoder=i_encoder;
    return;
  }
  /**
   * Initialize call back handler.
   */
  ,init : function(i_raster,i_prev_data)
  {
    this.marker_data=null;
    this._prev_data=i_prev_data;
    this._ref_raster=i_raster;
  }
  /**
   * 矩形が見付かるたびに呼び出されます。
   * 発見した矩形のパターンを検査して、方位を考慮した頂点データを確保します。
   */
  ,onSquareDetect : function(i_sender,i_coordx,i_coordy,i_coor_num,i_vertex_index)
  {
    //既に発見済なら終了
    if(this.marker_data!=null){
      return;
    }
    //輪郭座標から頂点リストに変換
    var vertex=this.__tmp_vertex;
    vertex[0].x=i_coordx[i_vertex_index[0]];
    vertex[0].y=i_coordy[i_vertex_index[0]];
    vertex[1].x=i_coordx[i_vertex_index[1]];
    vertex[1].y=i_coordy[i_vertex_index[1]];
    vertex[2].x=i_coordx[i_vertex_index[2]];
    vertex[2].y=i_coordy[i_vertex_index[2]];
    vertex[3].x=i_coordx[i_vertex_index[3]];
    vertex[3].y=i_coordy[i_vertex_index[3]];
    var param=this._marker_param;
    var patt_data=this._maker_pattern;
    // 評価基準になるパターンをイメージから切り出す
    var pick = this._id_pickup.pickFromRaster(this._ref_raster,vertex, patt_data, param)
    if (window.DEBUG) {
      var cv = document.getElementById('debugCanvas').getContext('2d');
      cv.fillStyle = 'blue';
      for (var i=0; i<4; i++) {
        cv.fillRect(vertex[i].x-2, vertex[i].y-2, 5, 5);
      }
    }
    if (!pick){
      return;
    }
    this.direction = param.direction;
    //エンコード
    if(!this._encoder.encode(patt_data,this._data_temp)){
      return;
    }
    //継続認識要求されている？
    if (this._prev_data==null){
      //継続認識要求なし
      this._current_data.copyFrom(this._data_temp);
    }else{
      //継続認識要求あり
      if(!this._prev_data.isEqual((this._data_temp))){
        return;//認識請求のあったIDと違う。
      }
    }
    //新しく認識、または継続認識中に更新があったときだけ、Square情報を更新する。
    //ココから先はこの条件でしか実行されない。
    var sq=this.square;
    //directionを考慮して、squareを更新する。
    var i;
    for(i=0;i<4;i++){
      var idx=(i+4 - param.direction) % 4;
      this._coordline.coord2Line(i_vertex_index[idx],i_vertex_index[(idx+1)%4],i_coordx,i_coordy,i_coor_num,sq.line[i]);
    }
    for (i= 0; i < 4; i++) {
      //直線同士の交点計算
      if(!NyARLinear.crossPos(sq.line[i],sq.line[(i + 3) % 4],sq.sqvertex[i])){
        throw new NyARException();//ここのエラー復帰するならダブルバッファにすればOK
      }
    }
    this.threshold=param.threshold;
    this.marker_data=this._current_data;//みつかった。
  }
})
FLARSingleIdMarkerDetector = ASKlass('FLARSingleIdMarkerDetector', {
  _is_continue : false
  ,_square_detect : null
  ,_offset : null
  ,_is_active : null
  ,_current_threshold : 110
  // [AR]検出結果の保存用
  ,_bin_raster : null
  ,_tobin_filter : null
  ,_callback : null
  ,_data_current : null
  ,_threshold_detect : null
  ,_transmat : null
  ,FLARSingleIdMarkerDetector : function(i_param ,i_marker_width)
  {
    var scr_size = i_param.getScreenSize();
    var encoder = new FLARIdMarkerDataEncoder_RawBit();
    // 解析オブジェクトを作る
    this._square_detect = new FLARSquareContourDetector(scr_size);
    this._callback = new FLARSingleIdMarkerDetectCB(i_param, encoder);
    this._transmat = new NyARTransMat(i_param);
    // ２値画像バッファを作る
    this._bin_raster = new FLARBinRaster(scr_size.w, scr_size.h);
    //ワーク用のデータオブジェクトを２個作る
    this._data_current = encoder.createDataInstance();
    this._tobin_filter = new FLARRasterFilter_Threshold(110);
    this._threshold_detect = new FLARRasterThresholdAnalyzer_SlidePTile(15, 4);
    this._offset = new NyARRectOffset();
    this._offset.setSquare(i_marker_width);
    return;
  }
  ,detectMarkerLite : function(i_raster, i_threshold)
  {
    // サイズチェック
    if (!this._bin_raster.getSize().isEqualSize_int(i_raster.getSize().w, i_raster.getSize().h)) {
      throw new FLARException();
    }
    // ラスタを２値イメージに変換する.
    this._tobin_filter.setThreshold(i_threshold);
    this._tobin_filter.doFilter(i_raster, this._bin_raster);
    // スクエアコードを探す(第二引数に指定したマーカ、もしくは新しいマーカを探す。)
    this._callback.init(this._bin_raster, this._is_active?this._data_current:null);
    this._square_detect.detectMarkerCB(this._bin_raster, this._callback);
    // 見つからない場合はfalse
    if(this._callback.marker_data==null){
      this._is_active=false;
      return false;
    }
    this._is_active = true;
    this._data_current.copyFrom(this._callback.marker_data);
    return true;
  }
  ,getIdMarkerData : function()
  {
    var result = new FLARIdMarkerData();
    result.copyFrom(this._callback.marker_data);
    return result;
  }
  ,getDirection : function()
  {
    return this._callback.direction;
  }
  ,getTransformMatrix : function(o_result)
  {
    if (this._is_continue) this._transmat.transMatContinue(this._callback.square, this._offset, o_result);
    else this._transmat.transMat(this._callback.square, this._offset, o_result);
    return;
  }
  ,setContinueMode : function(i_is_continue)
  {
    this._is_continue = i_is_continue;
  }
})

FLARIdMarkerDataEncoder_RawBit = ASKlass('FLARIdMarkerDataEncoder_RawBit',
{
  _DOMAIN_ID : 0
  /**
   * 制御ドット作成時のmodに使う値
   */
  ,_mod_data : new IntVector([7, 31, 127, 511, 2047, 4095])
  ,encode : function(i_data,o_dest)
  {
    var dest = o_dest;
    if (dest == null) {
      throw new FLARException("type of o_dest must be \"FLARIdMarkerData\"");
    }
    if(i_data.ctrl_domain != this._DOMAIN_ID) {
      return false;
    }
    dest.setCheck(i_data.check);
    dest.setControlDomain(i_data.ctrl_domain);
    dest.setControlMask(i_data.ctrl_mask);
    dest.setModel(i_data.model);
    //データドット数計算
    var resolution_len = toInt(i_data.model * 2 - 1); //trace("resolution", resolution_len);
    dest.setDataDotLength(resolution_len);
    //データドット数が、「(2 * model値 - 1)^2」となり、この2乗の元となる値がresolution_lenで、
    //パケット数は「(int)(データドット数 / 8) + 1」（最後に足す1はパケット0）となる
    var packet_length = toInt((resolution_len * resolution_len) / 8) + 1;
    // trace("packet", packet_length);
    dest.setPacketLength(packet_length);
    var sum = 0;
    for(var i=0;i<packet_length;i++){
      dest.setPacketData(i, i_data.data[i]);
      // trace("i_data[",i,"]",i_data.data[i]);
      sum += i_data.data[i];
    }
    //チェックドット値計算
    sum = sum % this._mod_data[i_data.model - 2];
    // trace("check dot", i_data.check, sum);
    //チェックドット比較
    if(i_data.check!=sum){
      return false;
    }
    return true;
  }
  ,createDataInstance : function()
  {
    return new FLARIdMarkerData();
  }
})
/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */














/**
 * このクラスは、同時に１個のマーカを処理することのできる、アプリケーションプロセッサです。
 * マーカの出現・移動・消滅を、イベントで通知することができます。
 * クラスには複数のマーカを登録できます。一つのマーカが見つかると、プロセッサは継続して同じマーカを
 * １つだけ認識し続け、見失うまでの間は他のマーカを認識しません。
 *
 * イベントは、 OnEnter→OnUpdate[n]→OnLeaveの順で発生します。
 * マーカが見つかるとまずOnEnterが１度発生して、何番のマーカが発見されたかがわかります。
 * 次にOnUpdateにより、現在の変換行列が連続して渡されます。最後にマーカを見失うと、OnLeave
 * イベントが発生します。
 *
 */
SingleARMarkerProcesser = ASKlass('SingleARMarkerProcesser',
{
  /**オーナーが自由に使えるタグ変数です。
   */
  tag : null,
  _lost_delay_count : 0,
  _lost_delay : 5,
  _square_detect : null,
  _transmat : null,
  _offset : null,
  _threshold : 110,
  // [AR]検出結果の保存用
  _bin_raster : null,
  _tobin_filter : null,
  _current_arcode_index : -1,
  _threshold_detect : null,
  SingleARMarkerProcesser : function()
  {
    return;
  },
  _initialized : false,
  initInstance : function(i_param,i_raster_type)
  {
    //初期化済？
    NyAS3Utils.assert(this._initialized==false);
    var scr_size = i_param.getScreenSize();
    // 解析オブジェクトを作る
    this._square_detect = new NyARSquareContourDetector_Rle(scr_size);
    this._transmat = new NyARTransMat(i_param);
    this._tobin_filter=new NyARRasterFilter_ARToolkitThreshold(110,i_raster_type);
    // ２値画像バッファを作る
    this._bin_raster = new NyARBinRaster(scr_size.w, scr_size.h);
    this._threshold_detect=new NyARRasterThresholdAnalyzer_SlidePTile(15,i_raster_type,4);
    this._initialized=true;
    //コールバックハンドラ
    this._detectmarker_cb=new DetectSquareCB_1(i_param);
    this._offset=new NyARRectOffset();
    return;
  }
  /*自動・手動の設定が出来ないので、コメントアウト
  public void setThreshold(int i_threshold)
  {
    this._threshold = i_threshold;
    return;
  }*/
  /**検出するマーカコードの配列を指定します。 検出状態でこの関数を実行すると、
   * オブジェクト状態に強制リセットがかかります。
   */
  ,setARCodeTable : function(i_ref_code_table,i_code_resolution,i_marker_width)
  {
    if (this._current_arcode_index != -1) {
      // 強制リセット
      this.reset(true);
    }
    //検出するマーカセット、情報、検出器を作り直す。(1ピクセル4ポイントサンプリング,マーカのパターン領域は50%)
    this._detectmarker_cb.setNyARCodeTable(i_ref_code_table,i_code_resolution);
    this._offset.setSquare(i_marker_width);
    return;
  }
  ,reset : function(i_is_force)
  {
    if (this._current_arcode_index != -1 && i_is_force == false) {
      // 強制書き換えでなければイベントコール
      this.onLeaveHandler();
    }
    // カレントマーカをリセット
    this._current_arcode_index = -1;
    return;
  },
  _detectmarker_cb : null,
  detectMarker : function(i_raster)
  {
    // サイズチェック
    NyAS3Utils.assert(this._bin_raster.getSize().isEqualSize_int(i_raster.getSize().w, i_raster.getSize().h));
    //BINイメージへの変換
    this._tobin_filter.setThreshold(this._threshold);
    this._tobin_filter.doFilter(i_raster, this._bin_raster);
    // スクエアコードを探す
    this._detectmarker_cb.init(i_raster,this._current_arcode_index);
    this._square_detect.detectMarkerCB(this._bin_raster,this._detectmarker_cb);
    // 認識状態を更新
    var is_id_found=updateStatus(this._detectmarker_cb.square,this._detectmarker_cb.code_index);
    //閾値フィードバック(detectExistMarkerにもあるよ)
    if(!is_id_found){
      //マーカがなければ、探索+DualPTailで基準輝度検索
      var th=this._threshold_detect.analyzeRaster(i_raster);
      this._threshold=(this._threshold+th)/2;
    }
    return;
  }
  /**
   *
   * @param i_new_detect_cf
   * @param i_exist_detect_cf
   */
  ,setConfidenceThreshold : function(i_new_cf,i_exist_cf)
  {
    this._detectmarker_cb.cf_threshold_exist=i_exist_cf;
    this._detectmarker_cb.cf_threshold_new=i_new_cf;
  },
  __NyARSquare_result : new NyARTransMatResult(),
  /**  オブジェクトのステータスを更新し、必要に応じてハンドル関数を駆動します。
   *   戻り値は、「実際にマーカを発見する事ができたか」です。クラスの状態とは異なります。
   */
  updateStatus : function(i_square,i_code_index)
  {
    var result = this.__NyARSquare_result;
    if (this._current_arcode_index < 0) {// 未認識中
      if (i_code_index < 0) {// 未認識から未認識の遷移
        // なにもしないよーん。
        return false;
      } else {// 未認識から認識の遷移
        this._current_arcode_index = i_code_index;
        // イベント生成
        // OnEnter
        this.onEnterHandler(i_code_index);
        // 変換行列を作成
        this._transmat.transMat(i_square, this._offset, result);
        // OnUpdate
        this.onUpdateHandler(i_square, result);
        this._lost_delay_count = 0;
        return true;
      }
    } else {// 認識中
      if (i_code_index < 0) {// 認識から未認識の遷移
        this._lost_delay_count++;
        if (this._lost_delay < this._lost_delay_count) {
          // OnLeave
          this._current_arcode_index = -1;
          this.onLeaveHandler();
        }
        return false;
      } else if (i_code_index == this._current_arcode_index) {// 同じARCodeの再認識
        // イベント生成
        // 変換行列を作成
        this._transmat.transMatContinue(i_square, this._offset, result);
        // OnUpdate
        this.onUpdateHandler(i_square, result);
        this._lost_delay_count = 0;
        return true;
      } else {// 異なるコードの認識→今はサポートしない。
        throw new  NyARException();
      }
    }
  }
  ,onEnterHandler : function(i_code)
  {
    throw new NyARException("onEnterHandler not implemented.");
  }
  ,onLeaveHandler : function()
  {
    throw new NyARException("onLeaveHandler not implemented.");
  }
  ,onUpdateHandler : function(i_square, result)
  {
    throw new NyARException("onUpdateHandler not implemented.");
  }
})











/**
 * detectMarkerのコールバック関数
 */
DetectSquareCB_1 = ASKlass('DetectSquareCB', NyARSquareContourDetector_IDetectMarkerCallback,
{
  //公開プロパティ
  square : new NyARSquare(),
  confidence : 0.0,
  code_index : -1,
  cf_threshold_new : 0.50,
  cf_threshold_exist : 0.30,
  //参照
  _ref_raster : null,
  //所有インスタンス
  _inst_patt : null,
  _deviation_data : null,
  _match_patt : null,
  __detectMarkerLite_mr : new NyARMatchPattResult(),
  _coordline : null,
  DetectSquareCB : function(i_param)
  {
    this._match_patt=null;
    this._coordline=new NyARCoord2Linear(i_param.getScreenSize(),i_param.getDistortionFactor());
    return;
  }
  ,setNyARCodeTable : function(i_ref_code,i_code_resolution)
  {
    /*unmanagedで実装するときは、ここでリソース解放をすること。*/
    this._deviation_data=new NyARMatchPattDeviationColorData(i_code_resolution,i_code_resolution);
    this._inst_patt=new NyARColorPatt_Perspective_O2(i_code_resolution,i_code_resolution,4,25);
    this._match_patt = new Array(i_ref_code.length);
    for(var i=0;i<i_ref_code.length;i++){
      this._match_patt[i]=new NyARMatchPatt_Color_WITHOUT_PCA(i_ref_code[i]);
    }
  },
  __tmp_vertex : NyARIntPoint2d.createArray(4),
  _target_id : 0,
  /**
  * Initialize call back handler.
  */
  init : function(i_raster,i_target_id)
  {
    this._ref_raster = i_raster;
    this._target_id=i_target_id;
    this.code_index=-1;
    this.confidence = Number.MIN_VALUE;
  }
  /**
  * 矩形が見付かるたびに呼び出されます。
  * 発見した矩形のパターンを検査して、方位を考慮した頂点データを確保します。
  */
  ,onSquareDetect : function(i_sender,i_coordx,i_coordy,i_coor_num,i_vertex_index)
  {
    if (this._match_patt==null) {
      return;
    }
    //輪郭座標から頂点リストに変換
    var vertex=this.__tmp_vertex;
    vertex[0].x=i_coordx[i_vertex_index[0]];
    vertex[0].y=i_coordy[i_vertex_index[0]];
    vertex[1].x=i_coordx[i_vertex_index[1]];
    vertex[1].y=i_coordy[i_vertex_index[1]];
    vertex[2].x=i_coordx[i_vertex_index[2]];
    vertex[2].y=i_coordy[i_vertex_index[2]];
    vertex[3].x=i_coordx[i_vertex_index[3]];
    vertex[3].y=i_coordy[i_vertex_index[3]];
    //画像を取得
    if (!this._inst_patt.pickFromRaster(this._ref_raster,vertex)){
      return;//取得失敗
    }
    //取得パターンをカラー差分データに変換して評価する。
    this._deviation_data.setRaster(this._inst_patt);
    //code_index,dir,c1にデータを得る。
    var mr=this.__detectMarkerLite_mr;
    var lcode_index = 0;
    var dir = 0;
    var c1 = 0;
    var i;
    for (i = 0; i < this._match_patt.length; i++) {
      this._match_patt[i].evaluate(this._deviation_data,mr);
      var c2 = mr.confidence;
      if (c1 < c2) {
        lcode_index = i;
        c1 = c2;
        dir = mr.direction;
      }
    }
    //認識処理
    if (this._target_id == -1) { // マーカ未認識
      //現在は未認識
      if (c1 < this.cf_threshold_new) {
        return;
      }
      if (this.confidence > c1) {
        // 一致度が低い。
        return;
      }
      //認識しているマーカIDを保存
      this.code_index=lcode_index;
    }else{
      //現在はマーカ認識中
      // 現在のマーカを認識したか？
      if (lcode_index != this._target_id) {
        // 認識中のマーカではないので無視
        return;
      }
      //認識中の閾値より大きいか？
      if (c1 < this.cf_threshold_exist) {
        return;
      }
      //現在の候補よりも一致度は大きいか？
      if (this.confidence>c1) {
        return;
      }
      this.code_index=this._target_id;
    }
    //新しく認識、または継続認識中に更新があったときだけ、Square情報を更新する。
    //ココから先はこの条件でしか実行されない。
    //一致率の高い矩形があれば、方位を考慮して頂点情報を作成
    this.confidence=c1;
    var sq=this.square;
    //directionを考慮して、squareを更新する。
    for(i=0;i<4;i++){
      var idx=(i+4 - dir) % 4;
      this._coordline.coord2Line(i_vertex_index[idx],i_vertex_index[(idx+1)%4],i_coordx,i_coordy,i_coor_num,sq.line[i]);
    }
    for (i = 0; i < 4; i++) {
      //直線同士の交点計算
      if(!NyARLinear.crossPos(sq.line[i],sq.line[(i + 3) % 4],sq.sqvertex[i])){
        throw new NyARException();//ここのエラー復帰するならダブルバッファにすればOK
      }
    }
  }
})
SingleNyIdMarkerProcesser = ASKlass('SingleNyIdMarkerProcesser',
{
  /**
   * オーナーが自由に使えるタグ変数です。
   */
  tag : null,
  /**
   * ロスト遅延の管理
   */
  _lost_delay_count : 0,
  _lost_delay : 5,
  _square_detect : null,
  _transmat : null,
  _offset : null,
  _is_active : null,
  _current_threshold : 110,
  // [AR]検出結果の保存用
  _bin_raster : null,
  _tobin_filter : null,
  _callback : null,
  _data_current : null,
  SingleNyIdMarkerProcesser : function()
  {
    return;
  },
  _initialized : false,
  initInstance : function(i_param, i_encoder ,i_marker_width, i_raster_format)
  {
    //初期化済？
    NyAS3Utils.assert(this._initialized==false);
    var scr_size = i_param.getScreenSize();
    // 解析オブジェクトを作る
    this._square_detect = new NyARSquareContourDetector_Rle(scr_size);
    this._transmat = new NyARTransMat(i_param);
    this._callback=new DetectSquareCB_2(i_param,i_encoder);
    // ２値画像バッファを作る
    this._bin_raster = new NyARBinRaster(scr_size.w, scr_size.h);
    //ワーク用のデータオブジェクトを２個作る
    this._data_current=i_encoder.createDataInstance();
    this._tobin_filter =new NyARRasterFilter_ARToolkitThreshold(110,i_raster_format);
    this._threshold_detect=new NyARRasterThresholdAnalyzer_SlidePTile(15,i_raster_format,4);
    this._initialized=true;
    this._is_active=false;
    this._offset = new NyARRectOffset();
    this._offset.setSquare(i_marker_width);
    return;
  }
  ,setMarkerWidth : function(i_width)
  {
    this._offset.setSquare(i_width);
    return;
  }
  ,reset : function(i_is_force)
  {
    if (i_is_force == false && this._is_active){
      // 強制書き換えでなければイベントコール
      this.onLeaveHandler();
    }
    //マーカ無効
    this._is_active=false;
    return;
  }
  ,detectMarker : function(i_raster)
  {
    // サイズチェック
    if (!this._bin_raster.getSize().isEqualSize_int(i_raster.getSize().w, i_raster.getSize().h)) {
      throw new NyARException();
    }
    // ラスタを２値イメージに変換する.
    this._tobin_filter.setThreshold(this._current_threshold);
    this._tobin_filter.doFilter(i_raster, this._bin_raster);
    // スクエアコードを探す(第二引数に指定したマーカ、もしくは新しいマーカを探す。)
    this._callback.init(i_raster,this._is_active?this._data_current:null);
    this._square_detect.detectMarkerCB(this._bin_raster, this._callback);
    // 認識状態を更新(マーカを発見したなら、current_dataを渡すかんじ)
    var is_id_found=updateStatus(this._callback.square,this._callback.marker_data);
    //閾値フィードバック(detectExistMarkerにもあるよ)
    if(is_id_found){
      //マーカがあれば、マーカの周辺閾値を反映
      this._current_threshold=(this._current_threshold+this._callback.threshold)/2;
    }else{
      //マーカがなければ、探索+DualPTailで基準輝度検索
      var th=this._threshold_detect.analyzeRaster(i_raster);
      this._current_threshold=(this._current_threshold+th)/2;
    }
    return;
  },
  _threshold_detect : null,
  __NyARSquare_result : new NyARTransMatResult(),
  /**オブジェクトのステータスを更新し、必要に応じてハンドル関数を駆動します。
   */
  updateStatus : function(i_square,i_marker_data)
  {
    var is_id_found=false;
    var result = this.__NyARSquare_result;
    if (!this._is_active) {// 未認識中
      if (i_marker_data==null) {// 未認識から未認識の遷移
        // なにもしないよーん。
        this._is_active=false;
      } else {// 未認識から認識の遷移
        this._data_current.copyFrom(i_marker_data);
        // イベント生成
        // OnEnter
        this.onEnterHandler(this._data_current);
        // 変換行列を作成
        this._transmat.transMat(i_square, this._offset, result);
        // OnUpdate
        this.onUpdateHandler(i_square, result);
        this._lost_delay_count = 0;
        this._is_active=true;
        is_id_found=true;
      }
    } else {// 認識中
      if (i_marker_data==null) {
        // 認識から未認識の遷移
        this._lost_delay_count++;
        if (this._lost_delay < this._lost_delay_count) {
          // OnLeave
          this.onLeaveHandler();
          this._is_active=false;
        }
      } else if(this._data_current.isEqual(i_marker_data)) {
        //同じidの再認識
        this._transmat.transMatContinue(i_square, this._offset, result);
        // OnUpdate
        this.onUpdateHandler(i_square, result);
        this._lost_delay_count = 0;
        is_id_found=true;
      } else {// 異なるコードの認識→今はサポートしない。
        throw new  NyARException();
      }
    }
    return is_id_found;
  }
  //通知ハンドラ
  ,onEnterHandler : function(i_code)
  {
    throw new NyARException("onEnterHandler not implemented.");
  }
  ,onLeaveHandler : function()
  {
    throw new NyARException("onLeaveHandler not implemented.");
  }
  ,onUpdateHandler : function(i_square, result)
  {
    throw new NyARException("onUpdateHandler not implemented.");
  }
})













/**
 * detectMarkerのコールバック関数
 */
DetectSquareCB_2 = ASKlass('DetectSquareCB', NyARSquareContourDetector_IDetectMarkerCallback,
{
  //公開プロパティ
  square : new NyARSquare(),
  marker_data : null,
  threshold : 0,
  //参照
  _ref_raster : null,
  //所有インスタンス
  _current_data : null,
  _id_pickup : new NyIdMarkerPickup(),
  _coordline : null,
  _encoder : null,
  _data_temp : null,
  _prev_data : null,
  DetectSquareCB : function(i_param,i_encoder)
  {
    this._coordline=new NyARCoord2Linear(i_param.getScreenSize(),i_param.getDistortionFactor());
    this._data_temp=i_encoder.createDataInstance();
    this._current_data=i_encoder.createDataInstance();
    this._encoder=i_encoder;
    return;
  },
  __tmp_vertex : NyARIntPoint2d.createArray(4),
  /**
  * Initialize call back handler.
  */
  init : function(i_raster,i_prev_data)
  {
    this.marker_data=null;
    this._prev_data=i_prev_data;
    this._ref_raster=i_raster;
  },
  _marker_param : new NyIdMarkerParam(),
  _marker_data : new NyIdMarkerPattern(),
  /**
  * 矩形が見付かるたびに呼び出されます。
  * 発見した矩形のパターンを検査して、方位を考慮した頂点データを確保します。
  */
  onSquareDetect : function(i_sender,i_coordx,i_coordy,i_coor_num,i_vertex_index)
  {
    //既に発見済なら終了
    if(this.marker_data!=null){
      return;
    }
    //輪郭座標から頂点リストに変換
    var vertex=this.__tmp_vertex;
    vertex[0].x=i_coordx[i_vertex_index[0]];
    vertex[0].y=i_coordy[i_vertex_index[0]];
    vertex[1].x=i_coordx[i_vertex_index[1]];
    vertex[1].y=i_coordy[i_vertex_index[1]];
    vertex[2].x=i_coordx[i_vertex_index[2]];
    vertex[2].y=i_coordy[i_vertex_index[2]];
    vertex[3].x=i_coordx[i_vertex_index[3]];
    vertex[3].y=i_coordy[i_vertex_index[3]];
    var param=this._marker_param;
    var patt_data=this._marker_data;
    // 評価基準になるパターンをイメージから切り出す
    if (!this._id_pickup.pickFromRaster(this._ref_raster,vertex, patt_data, param)){
      return;
    }
    //エンコード
    if(!this._encoder.encode(patt_data,this._data_temp)){
      return;
    }
    //継続認識要求されている？
    if (this._prev_data==null){
      //継続認識要求なし
      this._current_data.copyFrom(this._data_temp);
    }else{
      //継続認識要求あり
      if(!this._prev_data.isEqual((this._data_temp))){
        return;//認識請求のあったIDと違う。
      }
    }
    //新しく認識、または継続認識中に更新があったときだけ、Square情報を更新する。
    //ココから先はこの条件でしか実行されない。
    var sq=this.square;
    //directionを考慮して、squareを更新する。
    var i;
    for(i=0;i<4;i++){
      var idx=(i+4 - param.direction) % 4;
      this._coordline.coord2Line(i_vertex_index[idx],i_vertex_index[(idx+1)%4],i_coordx,i_coordy,i_coor_num,sq.line[i]);
    }
    for (i= 0; i < 4; i++) {
      //直線同士の交点計算
      if(!NyARLinear.crossPos(sq.line[i],sq.line[(i + 3) % 4],sq.sqvertex[i])){
        throw new NyARException();//ここのエラー復帰するならダブルバッファにすればOK
      }
    }
    this.threshold=param.threshold;
    this.marker_data=this._current_data;//みつかった。
  }
})
/*
 * JSARToolkit
 * --------------------------------------------------------------------------------
 * This work is based on the original ARToolKit developed by
 *   Hirokazu Kato
 *   Mark Billinghurst
 *   HITLab, University of Washington, Seattle
 * http://www.hitl.washington.edu/artoolkit/
 *
 * And the NyARToolkitAS3 ARToolKit class library.
 *   Copyright (C)2010 Ryo Iizuka
 *
 * JSARToolkit is a JavaScript port of NyARToolkitAS3.
 *   Copyright (C)2010 Ilmari Heikkinen
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * For further information please contact.
 *  ilmari.heikkinen@gmail.com
 *
 */





/**
 * マーカの周辺領域からビットマップを取得する方法を提供します。
 * 比較的負荷が大きいので、連続してパターンを取得し続ける用途には向いていません。
 *
 */
TransformedBitmapPickup = ASKlass('TransformedBitmapPickup', NyARColorPatt_Perspective_O2,
{
  _work_points : NyARIntPoint2d.createArray(4),
  _ref_perspective : null,
  /**
   *
   * @param i_width
   * 取得するビットマップの幅
   * @param i_height
   * 取得するビットマップの解像度
   * @param i_resolution
   * resolution of reading pixel per point. ---- 取得時の解像度。高解像度のときは1を指定してください。低解像度のときは2以上を指定します。
   */
  TransformedBitmapPickup : function(i_ref_cparam,i_width,i_height,i_resolution)
  {
    NyARColorPatt_Perspective_O2.initialize.call(this,i_width, i_height, i_resolution, 0);
    this._ref_perspective = i_ref_cparam;
  }
  /**
   * This ,retrieves bitmap from the area defined by RECT : function(i_l,i_t,i_r,i_b) above transform matrix i_base_mat.
   * ----
   * この関数は、basementで示される平面のAで定義される領域から、ビットマップを読み出します。
   * 例えば、8cmマーカでRECT(i_l,i_t,i_r,i_b)に-40,0,0,-40.0を指定すると、マーカの左下部分の画像を抽出します。
   *
   * マーカから離れた場所になるほど、また、マーカの鉛直方向から外れるほど誤差が大きくなります。
   * @param i_src_imege
   * 詠み出し元の画像を指定します。
   * @param i_l
   * 基準点からの左上の相対座標（x）を指定します。
   * @param i_t
   * 基準点からの左上の相対座標（y）を指定します。
   * @param i_r
   * 基準点からの右下の相対座標（x）を指定します。
   * @param i_b
   * 基準点からの右下の相対座標（y）を指定します。
   * @param i_base_mat
   * @return 画像の取得の成否を返す。
   */
  ,pickupImage2d : function(i_src_imege,i_l,i_t,i_r,i_b,i_base_mat)
  {
    var cp00, cp01, cp02, cp11, cp12;
    cp00 = this._ref_perspective.m00;
    cp01 = this._ref_perspective.m01;
    cp02 = this._ref_perspective.m02;
    cp11 = this._ref_perspective.m11;
    cp12 = this._ref_perspective.m12;
    //マーカと同一平面上にある矩形の4個の頂点を座標変換して、射影変換して画面上の
    //頂点を計算する。
    //[hX,hY,h]=[P][RT][x,y,z]
    //出力先
    var poinsts = this._work_points;
    var yt0,yt1,yt2;
    var x3, y3, z3;
    var m00=i_base_mat.m00;
    var m10=i_base_mat.m10;
    var m20=i_base_mat.m20;
    //yとtの要素を先に計算
    yt0=i_base_mat.m01 * i_t+i_base_mat.m03;
    yt1=i_base_mat.m11 * i_t+i_base_mat.m13;
    yt2=i_base_mat.m21 * i_t+i_base_mat.m23;
    // l,t
    x3 = m00 * i_l + yt0;
    y3 = m10 * i_l + yt1;
    z3 = m20 * i_l + yt2;
    poinsts[0].x = toInt ((x3 * cp00 + y3 * cp01 + z3 * cp02) / z3);
    poinsts[0].y = toInt ((y3 * cp11 + z3 * cp12) / z3);
    // r,t
    x3 = m00 * i_r + yt0;
    y3 = m10 * i_r + yt1;
    z3 = m20 * i_r + yt2;
    poinsts[1].x = toInt ((x3 * cp00 + y3 * cp01 + z3 * cp02) / z3);
    poinsts[1].y = toInt ((y3 * cp11 + z3 * cp12) / z3);
    //yとtの要素を先に計算
    yt0=i_base_mat.m01 * i_b+i_base_mat.m03;
    yt1=i_base_mat.m11 * i_b+i_base_mat.m13;
    yt2=i_base_mat.m21 * i_b+i_base_mat.m23;
    // r,b
    x3 = m00 * i_r + yt0;
    y3 = m10 * i_r + yt1;
    z3 = m20 * i_r + yt2;
    poinsts[2].x = toInt ((x3 * cp00 + y3 * cp01 + z3 * cp02) / z3);
    poinsts[2].y = toInt ((y3 * cp11 + z3 * cp12) / z3);
    // l,b
    x3 = m00 * i_l + yt0;
    y3 = m10 * i_l + yt1;
    z3 = m20 * i_l + yt2;
    poinsts[3].x = toInt ((x3 * cp00 + y3 * cp01 + z3 * cp02) / z3);
    poinsts[3].y = toInt ((y3 * cp11 + z3 * cp12) / z3);
    return this.pickFromRaster(i_src_imege, poinsts);
  }
})
;
define("components/JSARToolKit/JSARToolKit", ["components/magi/src/magi"], function(){});

/* jshint undef: true */
define('main',[
  "jquery",
  "json!../media/photos.json",
  "components/JSARToolKit/JSARToolKit",
  "components/magi/src/magi"
], function ($, Photos) {

  threshold = 128;
  DEBUG = false;
  photos = Photos.paths.map(Image.load);

  var video = document.createElement('video');
  video.width = 640;
  video.height = 480;
  video.loop = true;
  video.volume = 0;
  video.autoplay = true;
  video.style.display = 'none';
  video.controls = true;

  var getUserMedia = function (t, onsuccess, onerror) {
    if (navigator.getUserMedia) {
      return navigator.getUserMedia(t, onsuccess, onerror);
    } else if (navigator.webkitGetUserMedia) {
      return navigator.webkitGetUserMedia(t, onsuccess, onerror);
    } else if (navigator.mozGetUserMedia) {
      return navigator.mozGetUserMedia(t, onsuccess, onerror);
    } else if (navigator.msGetUserMedia) {
      return navigator.msGetUserMedia(t, onsuccess, onerror);
    } else {
      onerror(new Error("No getUserMedia implementation found."));
    }
  };

  var URL = window.URL || window.webkitURL;
  var createObjectURL = URL.createObjectURL || webkitURL.createObjectURL;
  if (!createObjectURL) {
    throw new Error("URL.createObjectURL not found.");
  }

  getUserMedia({
      'video': true
    },
    function (stream) {
      var url = createObjectURL(stream);
      video.src = url;
    },
    function (error) {
      alert("Couldn't access webcam.");
    }
  );

  $(document).ready(function () {
    $('#ardemo').append(video);

    var canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    canvas.style.display = 'block';

    var videoCanvas = document.createElement('canvas');
    videoCanvas.width = video.width;
    videoCanvas.height = video.height;

    var raster = new NyARRgbRaster_Canvas2D(canvas);
    var param = new FLARParam(320, 240);

    var resultMat = new NyARTransMatResult();

    var detector = new FLARMultiIdMarkerDetector(param, 120);
    detector.setContinueMode(true);

    var ctx = canvas.getContext('2d');
    ctx.font = "24px URW Gothic L, Arial, Sans-serif";

    var glCanvas = document.createElement('canvas');
    glCanvas.style.webkitTransform = 'scale(-1.0, 1.0)';
    glCanvas.width = 960;
    glCanvas.height = 720;
    var s = glCanvas.style;
    $('#ardemo').append(glCanvas);
    display = new Magi.Scene(glCanvas);
    display.drawOnlyWhenChanged = true;
    param.copyCameraMatrix(display.camera.perspectiveMatrix, 10, 10000);
    display.camera.useProjectionMatrix = true;
    var videoTex = new Magi.FlipFilterQuad();
    videoTex.material.textures.Texture0 = new Magi.Texture();
    videoTex.material.textures.Texture0.image = videoCanvas;
    videoTex.material.textures.Texture0.generateMipmaps = false;
    display.scene.appendChild(videoTex);

    var times = [];
    var pastResults = {};
    var lastTime = 0;
    var cubes = {};
    var images = [];

    window.updateImage = function () {
      display.changed = true;
    }
    window.addEventListener('keydown', function (ev) {
      if (Key.match(ev, Key.LEFT)) {
        images.forEach(function (e) {
          e.setImage(photos.rotate(true));
        });
      } else if (Key.match(ev, Key.RIGHT)) {
        images.forEach(function (e) {
          e.setImage(photos.rotate(false));
        });
      }
    }, false);

    setInterval(function () {
      if (video.ended) video.play();
      if (video.paused) return;
      if (window.paused) return;
      if (video.currentTime == video.duration) {
        video.currentTime = 0;
      }
      if (video.currentTime == lastTime) return;
      lastTime = video.currentTime;
      videoCanvas.getContext('2d').drawImage(video, 0, 0);
      ctx.drawImage(videoCanvas, 0, 0, 320, 240);
      var dt = new Date().getTime();

      videoTex.material.textures.Texture0.changed = true;

      canvas.changed = true;
      display.changed = true;

      var t = new Date();
      var detected = detector.detectMarkerLite(raster, threshold);
      for (var idx = 0; idx < detected; idx++) {
        var id = detector.getIdMarkerData(idx);
        //read data from i_code via Marsial--MarshalçµŒç”±ã§èª­ã¿å‡ºã™
        var currId;
        if (id.packetLength > 4) {
          currId = -1;
        } else {
          currId = 0;
          //æœ€å¤§4ãƒã‚¤ãƒˆç¹‹ã’ã¦ï¼‘å€‹ã®intå€¤ã«å¤‰æ›
          for (var i = 0; i < id.packetLength; i++) {
            currId = (currId << 8) | id.getPacketData(i);
            //console.log("id[", i, "]=", id.getPacketData(i));
          }
        }
        //console.log("[add] : ID = " + currId);
        if (!pastResults[currId]) {
          pastResults[currId] = {};
        }
        detector.getTransformMatrix(idx, resultMat);
        pastResults[currId].age = 0;
        pastResults[currId].transform = Object.asCopy(resultMat);
      }
      for (var i in pastResults) {
        var r = pastResults[i];
        if (r.age > 1) {
          delete pastResults[i];
          cubes[i].image.setImage(photos.rotate());
        }
        r.age++;
      }
      for (var i in cubes) cubes[i].display = false;
      for (var i in pastResults) {
        if (!cubes[i]) {
          var pivot = new Magi.Node();
          pivot.transform = mat4.identity();
          pivot.setScale(80);
          var image = new Magi.Image();
          image
            .setAlign(image.centerAlign, image.centerAlign)
            .setPosition(0, 0, 0)
            .setAxis(0, 0, 1)
            .setAngle(Math.PI)
            .setSize(1.5);
          image.setImage = function (src) {
            var img = E.canvas(640, 640);
            Magi.Image.setImage.call(this, img);
            this.texture.generateMipmaps = false;
            var self = this;
            src.onload = function () {
              var w = this.width,
                h = this.height;
              var f = Math.min(640 / w, 640 / h);
              w = (w * f);
              h = (h * f);
              img.getContext('2d').drawImage(this, (640 - w) / 2, (640 - h) / 2, w, h);
              self.texture.changed = true;
              self.setSize(1.1 * Math.max(w / h, h / w));
            };
            if (Object.isImageLoaded(src)) {
              src.onload();
            }
          };
          image.setImage(photos.rotate());
          images.push(image);
          pivot.image = image;
          pivot.appendChild(image);
          /*var txt = new Magi.Text(i);
          txt.setColor('#f0f0d8');
          txt.setFont('URW Gothic L, Arial, Sans-serif');
          txt.setFontSize(32);
          txt.setAlign(txt.leftAlign, txt.bottomAlign)
            .setPosition(-0.45, -0.48, -0.51)
            .setScale(1/190);*/
          display.scene.appendChild(pivot);
          cubes[i] = pivot;
        }
        cubes[i].display = true;
        var mat = pastResults[i].transform;
        var cm = cubes[i].transform;
        cm[0] = mat.m00;
        cm[1] = -mat.m10;
        cm[2] = mat.m20;
        cm[3] = 0;
        cm[4] = mat.m01;
        cm[5] = -mat.m11;
        cm[6] = mat.m21;
        cm[7] = 0;
        cm[8] = -mat.m02;
        cm[9] = mat.m12;
        cm[10] = -mat.m22;
        cm[11] = 0;
        cm[12] = mat.m03;
        cm[13] = -mat.m13;
        cm[14] = mat.m23;
        cm[15] = 1;
      }
    }, 15);
  });

});