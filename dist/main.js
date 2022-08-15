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

function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

function __generator(thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
}

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
    code["repReceiveInfo"] = "08";
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
var EventEmitter = require("events");
var RDP = /** @class */ (function () {
    function RDP(_a) {
        var port = _a.port;
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
        this.port = port;
        this.dgram = dgram.createSocket("udp4");
        this.dgram.bind(port);
        this.bindMessage();
        // 绑定ping  ping只由客户端向服务端发起
        this.bindPing();
    }
    RDP.prototype.bindPing = function () {
        var _this = this;
        setInterval(function () {
            for (var key in _this.connectServerMap) {
                var server = _this.connectServerMap[key];
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
            console.log("发送包组信息");
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
            this.sourceConcurrentQueue.push(this.sourceQueue.shift());
        }
    };
    // 获取一个发送失败的数据包
    RDP.prototype.getFailedPackage = function () {
        var packageId = this.packageFailed.shift();
        return this.packageConcurrentCache.find(function (v) { return packageId === v.packageId; });
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
        var conPakCount = Math.min(this.concurrent, Math.max(this.sourceConcurrentQueue.length, failedCount));
        var groupId = this.groupId++;
        for (var ind = 0; ind < conPakCount; ind++) {
            var obj = void 0;
            var i = void 0;
            if (this.packageFailed.length) {
                obj = this.getFailedPackage();
            }
            else {
                i = (ind - failedCount) % this.sourceConcurrentQueue.length;
                // 如果该条目已经到达文件尾，忽略该条目
                if (delArr.includes(i)) {
                    continue;
                }
                obj = this.sourceConcurrentQueue[i];
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
            // 切片大小 5kb
            var sliceEnd = Math.min(buf.length, 100 + sliceBegin);
            var sliceBuf = buf.subarray(sliceBegin, sliceEnd);
            // 如果已经到达buf尾
            if (sliceEnd === buf.length) {
                // 记录该条目index，以便删除
                delArr.push(i);
            }
            obj.sliceBegin = sliceEnd;
            // 将切片放入包并发队列
            var pid = packageId || this.packageId++;
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
    };
    // 发送数据
    RDP.prototype.sendWithCon = function () {
        return __awaiter(this, void 0, void 0, function () {
            var i, obj, address, port, data;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        // 所有包全部发送完毕，退出
                        if (!this.packageConcurrentQueue.length) {
                            this.ifSending = false;
                            return [2 /*return*/];
                        }
                        i = 0;
                        _a.label = 1;
                    case 1:
                        if (!(i < this.packageConcurrentQueue.length)) return [3 /*break*/, 4];
                        obj = this.packageConcurrentQueue[i];
                        address = obj.address, port = obj.port, data = obj.data;
                        // console.log(data);
                        return [4 /*yield*/, this.sendOnePackage(address, port, data)];
                    case 2:
                        // console.log(data);
                        _a.sent();
                        // 将已发送的包添加到包并发缓存
                        this.packageConcurrentCache.push(obj);
                        _a.label = 3;
                    case 3:
                        i++;
                        return [3 /*break*/, 1];
                    case 4:
                        // 清空包并发队列
                        this.packageConcurrentQueue = [];
                        return [2 /*return*/];
                }
            });
        });
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
        return __awaiter(this, void 0, void 0, function () {
            var groupInfo, _a, _b, _i, key, info, _c, address, port;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        this.ifSending = true;
                        // 获取并发包组
                        this.computedPackageGroup();
                        groupInfo = this.getGroupInfo();
                        _a = [];
                        for (_b in groupInfo)
                            _a.push(_b);
                        _i = 0;
                        _d.label = 1;
                    case 1:
                        if (!(_i < _a.length)) return [3 /*break*/, 4];
                        key = _a[_i];
                        info = groupInfo[key];
                        _c = key.split(":"), address = _c[0], port = _c[1];
                        return [4 /*yield*/, this.sendOnePackage(address, port, {
                                code: code.reqGroupInfo,
                                data: info,
                            })];
                    case 2:
                        _d.sent();
                        _d.label = 3;
                    case 3:
                        _i++;
                        return [3 /*break*/, 1];
                    case 4: return [2 /*return*/];
                }
            });
        });
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
        this.dgram.on("message", function (msg, rinfo) {
            var port = rinfo.port, address = rinfo.address;
            // msg = msg.toString();
            var ipKey = "".concat(address, ":").concat(port);
            try {
                var _a = JSON.parse(msg), code$1 = _a.code, data = _a.data, _b = _a.ind, ind = _b === void 0 ? 0 : _b, groupId = _a.groupId, packageId = _a.packageId, sourceId = _a.sourceId;
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
                        client.timeoutCount--;
                        break;
                    }
                    // 客户端收到pong
                    case code.pong: {
                        var server = _this.connectServerMap[ipKey];
                        server.timeoutCount--;
                        break;
                    }
                    // 服务端/客户端接收到数据
                    case code.sendData: {
                        var connectObj = _this.connectServerMap[ipKey] || _this.connectClientMap[ipKey];
                        if (!_this.receivedPackageCache[ipKey]) {
                            _this.receivedPackageCache[ipKey] = [];
                        }
                        if (!_this.receivedGroupCache[ipKey]) {
                            _this.receivedGroupCache[ipKey] = [];
                        }
                        _this.receivedPackageCache[ipKey].push(data);
                        _this.receivedGroupInfoCache[ipKey].push({
                            packageId: packageId,
                            sourceId: sourceId,
                            groupId: groupId,
                        });
                        break;
                    }
                    // 接收方收到包组信息
                    case code.reqGroupInfo: {
                        console.log(data);
                        _this.receivedGroupInfoCache[ipKey] = __assign({}, data);
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
