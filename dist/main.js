'use strict';

var connectClientEvent = Symbol("connect.client.event");
var code;
(function (code) {
    /**
     * 三次握手，建立连接
     */
    code["reqConnect"] = "00";
    code["recConnect"] = "01";
    code["sucConnect"] = "02";
    /**
     * ping pong
     */
    code["ping"] = "03";
    code["pong"] = "04";
    /**
     * 发送数据
     */
    code["sendString"] = "05";
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
            code: code.sendString,
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
        this.rdp.send(this.address, this.port, {
            code: code.ping,
        });
    };
    default_1.prototype.pong = function () {
        this.rdp.send(this.address, this.port, {
            code: code.pong,
        });
    };
    return default_1;
}());
_a = connectClientEvent;

var dgram = require("dgram");
var EventEmitter = require("events");
var RDP = /** @class */ (function () {
    function RDP(_a) {
        var port = _a.port;
        this.coe = 1; // 拥塞控制 并发增加系数
        this.concurrent = 1; // 拥塞控制 当前包并发上限
        this.step = 1; // 所处阶段 1 慢启动快速增长阶段 2 快速传输微调阶段  当前设计只能由1 -> 2，不会回退
        this.connectClientMap = {}; // 当前在线的所有客户端
        this.connectClientCache = {}; // 已发起，但是尚未成功建立的客户端
        this.connectServerMap = {}; // 当前在线的所有服务端
        this.connectServerCache = {}; // 已发起，但是尚未成功建立的服务端
        this.eventEmitter = new EventEmitter();
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
                    console.log("服务端超时");
                    // 触发该连接对象 error事件
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
        }, 3000);
    };
    RDP.prototype.send = function (address, port, data) {
        this.dgram.send(JSON.stringify(data), port, address);
    };
    // “客户端”方法，其实是发起端
    RDP.prototype.connect = function (address, port) {
        // 客户端 向目标服务器请求连接
        this.send(address, port, {
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
            try {
                var _a = JSON.parse(msg), code$1 = _a.code, data = _a.data;
                // 连接尚未建立  此时接收到非建立连接请求的数据将会被忽略
                if (Number(code$1) > Number(code.sucConnect)) {
                    if (!_this.connectClientMap["".concat(address, ":").concat(port)] &&
                        !_this.connectServerMap["".concat(address, ":").concat(port)]) {
                        // 尚未建立连接，却收到高于连接建立的code，返回尚未建立连接code 拒绝连接
                        _this.send(address, port, {
                            code: code.reject,
                        });
                        return;
                    }
                }
                switch (code$1) {
                    // 服务端接收到客户端请求连接
                    case code.reqConnect: {
                        // 回应客户端可以连入
                        _this.send(address, port, { code: code.recConnect });
                        // 如果目标已在连接列表中，重新连入将会移除之前的连接
                        if (_this.connectClientMap["".concat(address, ":").concat(port)]) {
                            delete _this.connectClientMap["".concat(address, ":").concat(port)];
                        }
                        _this.connectClientCache["".concat(address, ":").concat(port)] = new default_1(_this, address, port);
                        break;
                    }
                    // 客户端接收到服务端回应
                    case code.recConnect: {
                        // 将当前连接对象移动到已连接map，并从缓存中删除该对象
                        _this.connectServerMap["".concat(address, ":").concat(port)] =
                            _this.connectServerCache["".concat(address, ":").concat(port)];
                        delete _this.connectServerCache["".concat(address, ":").concat(port)];
                        // 触发客户端连接事件
                        _this.connectServerMap["".concat(address, ":").concat(port)].emit("connect", _this.connectServerMap["".concat(address, ":").concat(port)]);
                        // 回应服务端收到回信 连接建立
                        _this.send(address, port, { code: code.sucConnect });
                        break;
                    }
                    // 服务端接收到客户端回应
                    case code.sucConnect: {
                        // 将当前连接对象移动到已连接map，并从缓存中删除该对象
                        _this.connectClientMap["".concat(address, ":").concat(port)] =
                            _this.connectClientCache["".concat(address, ":").concat(port)];
                        delete _this.connectClientCache["".concat(address, ":").concat(port)];
                        // 服务端触发连接事件
                        _this.eventEmitter.emit("connect", _this.connectClientMap["".concat(address, ":").concat(port)]);
                        break;
                    }
                    // 服务端收到客户端ping 回应pong
                    case code.ping: {
                        var client = _this.connectClientMap["".concat(address, ":").concat(port)];
                        client.pong();
                        client.timeoutCount--;
                        break;
                    }
                    // 客户端收到pong
                    case code.pong: {
                        var server = _this.connectServerMap["".concat(address, ":").concat(port)];
                        server.timeoutCount--;
                        break;
                    }
                }
            }
            catch (e) {
                /**
                 * 向已成功建立请求的连接对象抛出错误事件
                 */
                for (var key in _this.connectClientMap) {
                    var client = _this.connectClientMap[key];
                    client.emit("error", e);
                }
                for (var key in _this.connectServerMap) {
                    var client = _this.connectServerMap[key];
                    client.emit("error", e);
                }
                /**
                 * 向尚未成功建立请求的连接对象抛出错误事件
                 */
                for (var key in _this.connectClientCache) {
                    var client = _this.connectClientCache[key];
                    client.emit("error", e);
                }
                for (var key in _this.connectServerCache) {
                    var client = _this.connectServerCache[key];
                    client.emit("error", e);
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
    return RDP;
}());

module.exports = RDP;
