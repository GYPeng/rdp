'use strict';

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */

var __assign = function() {
    __assign = Object.assign || function __assign(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};

var connectClientEvent = Symbol("connect.client.event");
var code;
(function (code) {
    /**
     * 三次握手，建立连接
     */
    code["reqConnect"] = "00";
    code["repConnect"] = "01";
    code["sucConnect"] = "02";
    /**
     * ping pong
     */
    code["ping"] = "03";
    code["pong"] = "04";
    /**
     * 发送数据
     */
    code["sendData"] = "05";
    // 发送方 发送包组信息
    code["reqGroupInfo"] = "06";
    // 接收方回应允许发送
    code["recGroupInfo"] = "07";
    // 接收方回应当前阶段数据接收情况
    code["recReceiveInfo"] = "08";
    // 发送源包信息 （源包发送结束标识）
    code["reqSourceInfo"] = "09";
    /**
     * 尚未建立连接，拒绝处理
     */
    code["reject"] = "99";
})(code || (code = {}));

var _a;
var EventEmitter$1 = require("events");
var default_1 = /** @class */ (function () {
    function default_1(rdp, address, port) {
        this[_a] = new EventEmitter$1();
        this.timeoutCount = 0;
        this.isInteraction = false;
        this.rdp = rdp;
        this.address = address;
        this.port = port;
    }
    default_1.prototype.send = function (data) {
        this.rdp.send(this.address, this.port, {
            code: code.sendData,
            data: data,
        });
    };
    default_1.prototype.on = function (eventname, handler) {
        this[connectClientEvent].on(eventname, handler);
    };
    default_1.prototype.emit = function (eventname, params) {
        this[connectClientEvent].emit(eventname);
    };
    // 关闭此连接 会将未发送完的队列全部丢弃，然后关闭连接
    default_1.prototype.close = function () { };
    default_1.prototype.ping = function () {
        this.rdp.sendData(this.address, this.port, {
            code: code.ping,
        });
    };
    default_1.prototype.pong = function () {
        this.rdp.sendData(this.address, this.port, {
            code: code.pong,
        });
    };
    return default_1;
}());
_a = connectClientEvent;

var isBuffer = function (target) { return Buffer.isBuffer(target); };
var isString = function (target) {
    return Object.prototype.toString.call(target) === "[object String]";
};
var isArray = function (target) { return Array.isArray(target); };
var isObject = function (target) {
    return Object.prototype.toString.call(target) === "[object Object]";
};

var dgram = require("dgram");
var fs = require("fs");
var EventEmitter = require("events");
var RDP = /** @class */ (function () {
    function RDP(_a) {
        var port = _a.port;
        var _this = this;
        this.sourceQueue = []; // 原始队列 由send方法产生
        this.sourceConcurrentQueue = []; // 原始并发队列 由原始队列计算得出 每个原始请求结束后，会检查原始队列中是否有数据，有则按队列移动一条到原始并发队列
        this.packageConcurrentQueue = []; // 包并发队列 原始并发队列经过拥塞计算后得出  此队列中的包在上一个包发送成功，计算拥塞之后按序发送 因为并不会等待当前包组完全发送完毕才发送下一组，因此不能作为包组判断
        this.packageConcurrentCache = []; // 包并发缓存 包并发队列中的包被发送后，移动到此  等发送成功后清除/packageId
        this.packageFailed = []; // 发送失败的包 描述
        this.coe = 1; // 拥塞控制 并发增加系数
        this.concurrent = 1; // 拥塞控制 当前包并发上限
        this.step = 1; // 所处阶段 1 慢启动快速增长阶段 2 快速传输微调阶段  当前设计只能由1 -> 2，不会回退
        this.sourceConcurrent = 6; // 当前原始请求并发上限
        this.connectClientMap = {}; // 当前在线的所有客户端
        this.connectClientCache = {}; // 已发起，但是尚未成功建立的客户端
        this.connectServerMap = {}; // 当前在线的所有服务端
        this.connectServerCache = {}; // 已发起，但是尚未成功建立的服务端
        this.receivedPackageCache = {}; // 已收到的包缓存（暂未处理的包）
        this.receivedGroupCache = {}; // 已收到的包组缓存 用以判断包组是否接收完毕
        this.receivedGroupInfoCache = {}; // 当前的包组信息
        this.eventEmitter = new EventEmitter();
        this.sourceId = 0;
        this.groupId = 0;
        this.packageId = 0;
        this.ifSending = false;
        this.dataReceivedTimeout = {}; // 数据接收超时计时器
        this.reqGroupInfoTimeout = {}; // 数据发送超时计时器
        this.port = port;
        this.dgram = dgram.createSocket("udp4");
        this.dgram.bind(port);
        this.dgram.on("listening", function () {
            _this.dgram.setSendBufferSize(1024 * 100);
        });
        this.bindMessage();
        // 绑定ping  ping只由客户端向服务端发起
        this.bindPing();
    }
    RDP.prototype.bindPing = function () {
        var _this = this;
        setInterval(function () {
            for (var key in _this.connectServerMap) {
                var server = _this.connectServerMap[key];
                if (server.isInteraction) {
                    server.isInteraction = false;
                    continue;
                }
                // 如果服务端超时
                if (server.timeoutCount > 3) {
                    // 触发该连接对象 err事件
                    server.emit("err", {
                        message: "The server failed to respond.",
                        target: server,
                    });
                    // 触发rdp对象err事件
                    _this.emit("err", {
                        message: "The server failed to respond.",
                        target: server,
                    });
                    // 并将该连接对象移出已连接列表
                    delete _this.connectServerMap[key];
                    continue;
                }
                server.timeoutCount++;
                server.ping();
            }
            for (var key in _this.connectClientMap) {
                var client = _this.connectClientMap[key];
                if (client.isInteraction) {
                    client.isInteraction = false;
                    continue;
                }
                // 如果服务端超时
                if (client.timeoutCount > 3) {
                    // 触发该连接对象 err事件
                    client.emit("err", {
                        message: "The client failed to respond.",
                        target: client,
                    });
                    // 触发rdp对象err事件
                    _this.emit("err", {
                        message: "The client failed to respond.",
                        target: client,
                    });
                    // 并将该连接对象移出已连接列表
                    delete _this.connectClientMap[key];
                    continue;
                }
                client.timeoutCount++;
            }
        }, 1000);
    };
    RDP.prototype.sendData = function (address, port, data, callback) {
        callback = function (e) {
            // console.log(e);
        };
        // console.log(data.code, (packageCount += data.data?.length || 0));
        if (callback) {
            this.dgram.send(JSON.stringify(data), port, address, callback);
        }
        else {
            this.dgram.send(JSON.stringify(data), port, address, callback);
        }
    };
    RDP.prototype.send = function (address, port, data) {
        var sourceId = this.sourceId++;
        var realData = data.data;
        if (isBuffer(realData)) {
            this.sourceQueue.push({ address: address, port: port, data: data, type: "buffer", sourceId: sourceId });
        }
        else if (isString(realData)) {
            this.sourceQueue.push({ address: address, port: port, data: data, type: "string", sourceId: sourceId });
        }
        else if (isArray(realData)) {
            this.sourceQueue.push({ address: address, port: port, data: data, type: "array", sourceId: sourceId });
        }
        else if (isObject(realData)) {
            this.sourceQueue.push({ address: address, port: port, data: data, type: "object", sourceId: sourceId });
        }
        // 如果尚未开始发送 启动发送函数
        if (!this.ifSending) {
            this.sendPackageGroupInfo();
            // console.log("发送包组信息");
        }
    };
    // 发送单个数据包
    RDP.prototype.sendOnePackage = function (address, port, data, callback) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.sendData(address, port, data, resolve);
        });
    };
    // 计算得出当前原始并发队列
    RDP.prototype.computedSourceConcurrentQueue = function () {
        for (var i = 0; i <
            Math.min(Math.max(this.sourceConcurrent - this.sourceConcurrentQueue.length, 0), this.sourceQueue.length); i++) {
            var source = this.sourceQueue.shift();
            this.sourceConcurrentQueue.push(source);
        }
    };
    // 获取一个发送失败的数据包
    RDP.prototype.getFailedPackage = function () {
        var obj = this.packageFailed.shift();
        if (obj) {
            var packageId_1 = obj.packageId, sourceId_1 = obj.sourceId, groupId_1 = obj.groupId, address_1 = obj.address, port_1 = obj.port;
            return this.packageConcurrentCache.find(function (v) {
                // console.log(v, packageId, sourceId, groupId, address, port);
                return (packageId_1 === v.packageId &&
                    groupId_1 === v.groupId &&
                    sourceId_1 === v.sourceId &&
                    address_1 === v.address &&
                    v.port === port_1);
            });
        }
        else {
            return undefined;
        }
    };
    // 分包，并计算得出当前包组
    RDP.prototype.computedPackageGroup = function () {
        var _this = this;
        // 获取原始并发队列
        this.computedSourceConcurrentQueue();
        // 按照sliceBegin从小到大排序
        this.sourceConcurrentQueue.sort(function (_a, _b) {
            var _c = _a.sliceBegin, sliceBeginA = _c === void 0 ? 0 : _c;
            var _d = _b.sliceBegin, sliceBeginB = _d === void 0 ? 0 : _d;
            return sliceBeginA - sliceBeginB;
        });
        var delArr = [];
        // 发送失败的包数量
        var failedCount = this.packageFailed.length;
        this.concurrent += this.coe;
        var conPakCount = this.concurrent;
        // console.log("并发队列", conPakCount);
        // Math.min(
        //   this.concurrent,
        //   Math.max(this.sourceConcurrentQueue.length, failedCount)
        // );
        var groupId = this.groupId++;
        for (var ind = 0; ind < conPakCount; ind++) {
            var obj = void 0;
            var i = void 0;
            obj = this.getFailedPackage();
            if (!obj) {
                i = (ind - failedCount) % this.sourceConcurrentQueue.length;
                // 如果该条目已经到达文件尾，忽略该条目
                if (delArr.includes(i)) {
                    continue;
                }
                obj = this.sourceConcurrentQueue[i];
            }
            if (!obj) {
                continue;
            }
            var address = obj.address, port = obj.port, data = obj.data, type = obj.type, _a = obj.sliceBegin, sliceBegin = _a === void 0 ? 0 : _a, sourceId = obj.sourceId, packageId = obj.packageId;
            var realData = data.data;
            var buf = void 0;
            if (["buffer", "string"].includes(type)) {
                buf = Buffer.from(realData);
            }
            else if (["object", "array"].includes(type)) {
                buf = Buffer.from(JSON.stringify(realData));
            }
            else {
                // 暂不支持其它类型传输
                continue;
            }
            // 切片大小 8kb
            var sliceEnd = Math.min(buf.length, 1024 * 1 + sliceBegin);
            var sliceBuf = buf.subarray(sliceBegin, sliceEnd);
            // 如果已经到达buf尾
            if (sliceEnd === buf.length) {
                // 记录该条目index，以便删除
                delArr.push(i);
            }
            obj.sliceBegin = sliceEnd;
            // 将切片放入包并发队列
            var pid = packageId === undefined ? this.packageId++ : packageId;
            console.log("pid", pid);
            this.packageConcurrentQueue.push({
                address: address,
                port: port,
                type: type,
                data: __assign(__assign({}, data), { data: sliceBuf, type: type, sourceId: sourceId, packageId: pid, groupId: groupId }),
                sourceId: sourceId,
                packageId: pid,
                groupId: groupId,
            });
            // console.log(this.packageConcurrentQueue);
        }
        delArr.sort(function (a, b) { return b - a; });
        // console.log(delArr);
        delArr.forEach(function (i) {
            // 删除已分包完毕的数据
            _this.sourceConcurrentQueue.splice(i, 1);
        });
        // console.log(this.packageConcurrentQueue.length);
    };
    // 发送数据
    RDP.prototype.sendWithCon = function () {
        for (var i = 0; i < this.packageConcurrentQueue.length; i++) {
            var obj = this.packageConcurrentQueue[i];
            var address = obj.address, port = obj.port, data = obj.data;
            // console.log(data);
            this.sendOnePackage(address, port, data);
            // 将已发送的包添加到包并发缓存
            this.packageConcurrentCache.push(obj);
        }
    };
    RDP.prototype.getGroupInfo = function () {
        // 从第一个包中 获取接收方信息
        var infoList = {};
        this.packageConcurrentQueue.forEach(function (v) {
            var address = v.address, port = v.port, packageId = v.packageId, groupId = v.groupId, sourceId = v.sourceId;
            var key = "".concat(address, ":").concat(port);
            if (!infoList[key]) {
                infoList[key] = [];
            }
            infoList[key].push({
                address: address,
                port: port,
                packageId: packageId,
                groupId: groupId,
                sourceId: sourceId,
            });
        });
        return infoList;
    };
    // 发送并发包组信息
    RDP.prototype.sendPackageGroupInfo = function () {
        this.ifSending = true;
        // 获取并发包组
        this.computedPackageGroup();
        var groupInfo = this.getGroupInfo();
        for (var key in groupInfo) {
            var info = groupInfo[key];
            var _a = key.split(":"), address = _a[0], port = _a[1];
            this.sendOnePackage(address, port, {
                code: code.reqGroupInfo,
                data: {
                    groupId: info[0].groupId,
                    sourceId: info[0].sourceId,
                    packageIds: info.map(function (v) { return v.packageId; }),
                },
            });
            // console.log(info);
        }
    };
    // “客户端”方法，其实是发起端
    RDP.prototype.connect = function (address, port) {
        // 客户端 向目标服务器请求连接
        this.sendData(address, port, {
            code: code.reqConnect,
        });
        // 如果客户端重复发起连接，之前已有的连接将会被移除
        if (this.connectServerMap["".concat(address, ":").concat(port)]) {
            delete this.connectServerMap["".concat(address, ":").concat(port)];
        }
        this.connectServerCache["".concat(address, ":").concat(port)] = new default_1(this, address, port);
        // 返回一个连接对象，调用此对象可以对该连接进行操作，而无需手动制定ip和端口
        return this.connectServerCache["".concat(address, ":").concat(port)];
    };
    RDP.prototype.bindMessage = function () {
        var _this = this;
        var count = 0;
        this.dgram.on("message", function (msg, rinfo) {
            var _a;
            var port = rinfo.port, address = rinfo.address;
            // msg = msg.toString();
            var ipKey = "".concat(address, ":").concat(port);
            try {
                var _b = JSON.parse(msg), code$1 = _b.code, data_1 = _b.data, _c = _b.ind, ind = _c === void 0 ? 0 : _c, groupId = _b.groupId, packageId = _b.packageId, packageIds = _b.packageIds, sourceId = _b.sourceId;
                // 连接尚未建立  此时接收到非建立连接请求的数据将会被忽略
                if (Number(code$1) > Number(code.sucConnect)) {
                    if (!_this.connectClientMap[ipKey] && !_this.connectServerMap[ipKey]) {
                        // 尚未建立连接，却收到高于连接建立的code，返回尚未建立连接code 拒绝连接
                        _this.sendData(address, port, {
                            code: code.reject,
                        });
                        return;
                    }
                }
                var connectObj = _this.connectServerMap[ipKey] || _this.connectClientMap[ipKey];
                if (connectObj) {
                    connectObj.isInteraction = true;
                    connectObj.timeoutCount = 0;
                }
                switch (code$1) {
                    // 服务端接收到客户端请求连接
                    case code.reqConnect: {
                        // 回应客户端可以连入
                        _this.sendData(address, port, { code: code.repConnect });
                        // 如果目标已在连接列表中，重新连入将会移除之前的连接
                        if (_this.connectClientMap[ipKey]) {
                            delete _this.connectClientMap[ipKey];
                        }
                        _this.connectClientCache[ipKey] = new default_1(_this, address, port);
                        break;
                    }
                    // 客户端接收到服务端回应
                    case code.repConnect: {
                        // 将当前连接对象移动到已连接map，并从缓存中删除该对象
                        _this.connectServerMap[ipKey] = _this.connectServerCache[ipKey];
                        delete _this.connectServerCache[ipKey];
                        // 触发客户端连接事件
                        _this.connectServerMap[ipKey].emit("connect", _this.connectServerMap[ipKey]);
                        // 回应服务端收到回信 连接建立
                        _this.sendData(address, port, { code: code.sucConnect });
                        break;
                    }
                    // 服务端接收到客户端回应
                    case code.sucConnect: {
                        // 将当前连接对象移动到已连接map，并从缓存中删除该对象
                        _this.connectClientMap[ipKey] = _this.connectClientCache[ipKey];
                        delete _this.connectClientCache[ipKey];
                        // 服务端触发连接事件
                        _this.eventEmitter.emit("connect", _this.connectClientMap[ipKey]);
                        break;
                    }
                    // 服务端收到客户端ping 回应pong
                    case code.ping: {
                        var client = _this.connectClientMap[ipKey];
                        client.pong();
                        break;
                    }
                    // 客户端收到pong
                    case code.pong: {
                        // const server = this.connectServerMap[ipKey];
                        // server.timeoutCount = 0;
                        break;
                    }
                    // 服务端/客户端接收到数据
                    case code.sendData: {
                        if (!_this.receivedPackageCache[ipKey]) {
                            _this.receivedPackageCache[ipKey] = [];
                        }
                        if (!_this.receivedGroupCache[ipKey]) {
                            _this.receivedGroupCache[ipKey] = [];
                        }
                        _this.receivedPackageCache[ipKey].push({
                            packageId: packageId,
                            data: data_1,
                        });
                        // console.log("接收到的包", packageId);
                        // 接收到数据，清空超时计时器
                        clearTimeout(_this.dataReceivedTimeout[ipKey]);
                        var filePath = "/Users/fujiu/Desktop/rdt/test/bak.js";
                        if (count === 0 && fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }
                        if (!fs.existsSync(filePath) && packageId === 0) {
                            // console.log(data);
                            fs.writeFileSync(filePath, Buffer.from(data_1.data));
                            count++;
                        }
                        else {
                            _this.receivedPackageCache[ipKey].sort(function (a, b) { return a.packageId - b.packageId; });
                            for (var i = count; i < _this.receivedPackageCache[ipKey].length; i++) {
                                var _d = _this.receivedPackageCache[ipKey][i], packageId_2 = _d.packageId, data_2 = _d.data;
                                if (packageId_2 === count) {
                                    fs.appendFileSync(filePath, Buffer.from(data_2.data), function (e) {
                                        console.log(e);
                                    });
                                    count++;
                                }
                                else {
                                    break;
                                }
                            }
                        }
                        _this.receivedGroupCache[ipKey].push({
                            packageId: packageId,
                            sourceId: sourceId,
                            groupId: groupId,
                        });
                        // 判断包组是否接收完毕
                        if (_this.receivedGroupCache[ipKey].every(function (cache) {
                            return _this.receivedGroupInfoCache[ipKey].find(function (v) {
                                return v.packageId === cache.packageId &&
                                    v.groupId === cache.groupId &&
                                    v.sourceId === cache.sourceId;
                            });
                        })) {
                            // 如果接收完毕，立即回应发送方（没有参数表示全部接收成功）
                            _this.sendData(address, port, { code: code.recReceiveInfo });
                            // 清空包组信息
                            _this.receivedGroupCache[ipKey] = [];
                            // 清空已接收完的包组
                            _this.receivedGroupInfoCache[ipKey] = [];
                        }
                        else {
                            // 数据未接收完毕，设置超时计时器
                            _this.dataReceivedTimeout[ipKey] = setTimeout(function () {
                                // console.log(
                                //   this.receivedGroupCache[ipKey].map((v) => v.packageId).join(),
                                //   "|",
                                //   this.receivedGroupInfoCache[ipKey]
                                //     .map((v) => v.packageId)
                                //     .join()
                                // );
                                // 计算丢包信息
                                var lostInfo = _this.receivedGroupCache[ipKey]
                                    .filter(function (cache) {
                                    return !_this.receivedGroupInfoCache[ipKey].find(function (v) {
                                        // console.log(cache, "|", v);
                                        return (v.packageId === cache.packageId &&
                                            v.groupId === cache.groupId &&
                                            v.sourceId === cache.sourceId);
                                    });
                                })
                                    .map(function (v) { return ({
                                    packageId: v.packageId,
                                    sourceId: v.sourceId,
                                    groupId: v.groupId,
                                }); });
                                console.log(lostInfo);
                                // 500毫秒内，没有接收到发送方数据，视为数据接收超时（丢包）  回应发送方接收情况
                                _this.sendData(address, port, {
                                    code: code.recReceiveInfo,
                                    data: lostInfo,
                                });
                                // 清空包组信息
                                _this.receivedGroupCache[ipKey] = [];
                                // 清空已接收完的包组
                                _this.receivedGroupInfoCache[ipKey] = [];
                            }, 500);
                        }
                        // console.log(this.receivedPackageCache[ipKey].length);
                        break;
                    }
                    // 接收方收到包组信息
                    case code.reqGroupInfo: {
                        clearTimeout(_this.dataReceivedTimeout[ipKey]);
                        var obj = (data_1.packageIds || []).map(function (v) { return ({
                            packageId: v,
                            groupId: data_1.groupId,
                            sourceId: data_1.sourceId,
                        }); });
                        if (!((_a = _this.receivedGroupInfoCache[ipKey]) === null || _a === void 0 ? void 0 : _a.length)) {
                            _this.receivedGroupInfoCache[ipKey] = obj;
                            // 回应发送端
                            _this.sendData(address, port, {
                                code: code.recGroupInfo,
                                data: groupId,
                            });
                        }
                        return;
                    }
                    // 发送方收到包组回应
                    case code.recGroupInfo: {
                        clearTimeout(_this.reqGroupInfoTimeout[ipKey]);
                        // console.log("收到包组回应");
                        //  调用发送方法
                        setTimeout(function () {
                            _this.sendWithCon();
                            // console.log(
                            //   "并发数",
                            //   this.packageConcurrentQueue.length,
                            //   this.sourceQueue.length
                            // );
                            // console.log(this.sourceQueue.length);
                        }, 10);
                        return;
                    }
                    // 发送方收到接收方 接收回调
                    case code.recReceiveInfo: {
                        (data_1 === null || data_1 === void 0 ? void 0 : data_1.length)
                            ? data_1.forEach(function (v) {
                                _this.packageFailed.push(__assign({ address: address, port: port }, v));
                            })
                            : null;
                        // data?.length >>> 0
                        //   ? console.log("丢包信息", this.packageFailed)
                        //   : null;
                        var tmp_1 = _this.packageConcurrentQueue.filter(function (queue) {
                            return !(data_1 === null || data_1 === void 0 ? void 0 : data_1.find(function (v) {
                                return queue.packageId === v.packageId &&
                                    queue.sourceId === v.sourceId &&
                                    queue.groupId === v.groupId;
                            }));
                        });
                        _this.packageConcurrentCache = _this.packageConcurrentCache.filter(function (cache) {
                            return !(tmp_1 || []).find(function (v) {
                                return v.packageId === cache.packageId &&
                                    v.groupId === cache.groupId &&
                                    v.sourceId === cache.sourceId;
                            });
                        });
                        // console.log(
                        //   "接收到的丢包数据",
                        //   data,
                        //   "过滤之后的数据",
                        //   this.packageConcurrentCache.map((v) => v.packageId)
                        // );
                        // console.log(data?.length >>> 0, this.packageConcurrentQueue.length);
                        // console.log(
                        //   count++,
                        //   this.packageConcurrentCache.length,
                        //   this.concurrent
                        // );
                        // console.log("当前包组发送情", data);
                        if (!data_1) {
                            // 全部发送成功
                            _this.coe *= 2;
                            setTimeout(function () {
                                // 所有包全部发送完毕，退出
                                if (!_this.packageConcurrentQueue.length) {
                                    _this.ifSending = false;
                                }
                            }, 100);
                        }
                        else {
                            // 部分发送成功
                            // 当前并发数量 减去丢包数量
                            // this.concurrent = Math.max(
                            //   this.concurrent - Math.floor(data.length / 3),
                            //   1
                            // );
                            if (data_1.length > _this.packageConcurrentQueue.length / 2) {
                                // 丢包率大于三分之一 重置增量系数
                                _this.coe = 1;
                                _this.concurrent -= _this.packageConcurrentQueue.length / 20;
                            }
                        }
                        // 清空包并发队列
                        _this.packageConcurrentQueue = [];
                        _this.reqGroupInfoTimeout[ipKey] = setTimeout(function () {
                            _this.sendPackageGroupInfo();
                        }, 300);
                        // 调用计算并发送当前包组方法
                        _this.sendPackageGroupInfo();
                        return;
                    }
                }
            }
            catch (e) {
                /**
                 * 向已成功建立请求的连接对象抛出错误事件
                 */
                for (var key in _this.connectClientMap) {
                    var client = _this.connectClientMap[key];
                    client.emit("err", e);
                }
                for (var key in _this.connectServerMap) {
                    var client = _this.connectServerMap[key];
                    client.emit("err", e);
                }
                /**
                 * 向尚未成功建立请求的连接对象抛出错误事件
                 */
                for (var key in _this.connectClientCache) {
                    var client = _this.connectClientCache[key];
                    client.emit("err", e);
                }
                for (var key in _this.connectServerCache) {
                    var client = _this.connectServerCache[key];
                    client.emit("err", e);
                }
                console.log("发生错误", e);
            }
        });
    };
    RDP.prototype.on = function (eventname, handler) {
        this.eventEmitter.on(eventname, handler);
    };
    RDP.prototype.emit = function (eventname, params) {
        this.eventEmitter.emit(eventname, params);
    };
    RDP.prototype.close = function () {
        this.dgram.close();
    };
    return RDP;
}());

module.exports = RDP;
