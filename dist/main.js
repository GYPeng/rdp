'use strict';

var connectClientEvent = Symbol("connect.client.event");
var code;
(function (code) {
    /**
     * 三次握手，建立连接
     */
    code["reqConnect"] = "01";
    code["recConnect"] = "02";
    code["sucConnect"] = "03";
    /**
     * ping pong
     */
    code["ping"] = "04";
    code["pong"] = "05";
    /**
     * 发送数据
     */
    code["sendString"] = "06";
})(code || (code = {}));

var _a;
var EventEmitter$1 = require("events");
var default_1 = /** @class */ (function () {
    function default_1(rdp, address, port) {
        this[_a] = new EventEmitter$1();
        this.rdp = rdp;
        this.address = address;
        this.port = port;
    }
    default_1.prototype.send = function (data) {
        this.rdp.send(this.address, this.port, {});
    };
    default_1.prototype.on = function (eventname, handler) {
        this[connectClientEvent].on(eventname, handler);
    };
    default_1.prototype.emit = function (eventname, params) {
        this[connectClientEvent].emit(eventname);
    };
    // 关闭此连接 会将未发送完的队列全部丢弃，然后关闭连接
    default_1.prototype.close = function () { };
    default_1.prototype.ping = function () { };
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
        this.connectMap = {}; // 当前在线的所有连接
        this.connectCache = {}; // 已发起，但是尚未成功建立的连接
        this.eventEmitter = new EventEmitter();
        this.port = port;
        this.dgram = dgram.createSocket("udp4");
        this.dgram.bind(port);
        this.bindMessage();
    }
    RDP.prototype.ping = function () { };
    RDP.prototype.send = function (address, port, data) {
        this.dgram.send(JSON.stringify(data), port, address);
    };
    // “客户端”方法，其实是发起端
    RDP.prototype.connect = function (address, port) {
        // 客户端 向目标服务器请求连接
        this.send(address, port, {
            code: code.reqConnect,
        });
        this.connectCache["".concat(address, ":").concat(port)] = new default_1(this, address, port);
        // 返回一个连接对象，调用此对象可以对该连接进行操作，而无需手动制定ip和端口
        return this.connectCache["".concat(address, ":").concat(port)];
    };
    RDP.prototype.bindMessage = function () {
        var _this = this;
        this.dgram.on("message", function (msg, rinfo) {
            var port = rinfo.port, address = rinfo.address;
            try {
                // 服务端，收到客户端请求连接code
                var _a = JSON.parse(msg), code$1 = _a.code, data = _a.data;
                console.log(port, address, code$1);
                switch (code$1) {
                    // 服务端接收到客户端请求连接
                    case code.reqConnect: {
                        // 回应客户端可以连入
                        _this.send(address, port, { code: code.recConnect });
                        _this.connectCache["".concat(address, ":").concat(port)] = new default_1(_this, address, port);
                        break;
                    }
                    // 客户端接收到服务端回应
                    case code.recConnect: {
                        // 将当前连接对象移动到已连接map，并从缓存中删除该对象
                        _this.connectMap["".concat(address, ":").concat(port)] =
                            _this.connectCache["".concat(address, ":").concat(port)];
                        delete _this.connectCache["".concat(address, ":").concat(port)];
                        // 触发客户端连接事件
                        _this.connectMap["".concat(address, ":").concat(port)].emit("connect", _this.connectMap["".concat(address, ":").concat(port)]);
                        // 回应服务端收到回信 连接建立
                        _this.send(address, port, { code: code.sucConnect });
                        break;
                    }
                    // 服务端接收到客户端回应
                    case code.sucConnect: {
                        // 将当前连接对象移动到已连接map，并从缓存中删除该对象
                        _this.connectMap["".concat(address, ":").concat(port)] =
                            _this.connectCache["".concat(address, ":").concat(port)];
                        delete _this.connectCache["".concat(address, ":").concat(port)];
                        // 服务端触发连接事件
                        _this.eventEmitter.emit("connect", _this.connectMap["".concat(address, ":").concat(port)]);
                        break;
                    }
                }
            }
            catch (e) { }
        });
    };
    RDP.prototype.on = function (eventname, handler) {
        this.eventEmitter.on(eventname, handler);
    };
    return RDP;
}());

module.exports = RDP;
