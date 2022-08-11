define((function () { 'use strict';

  var code;
  (function (code) {
      /**
       * 三次握手，建立连接
       */
      code["reqConnect"] = "01";
      code["recConnect"] = "02";
      code["sucConnect"] = "03";
  })(code || (code = {}));

  var dgram = require("dgram");
  var EventEmitter = require("events");
  var RDP = /** @class */ (function () {
      function RDP(_a) {
          var port = _a.port;
          this.coe = 1; // 拥塞控制 并发增加系数
          this.concurrent = 1; // 拥塞控制 当前包并发上限
          this.step = 1; // 所处阶段 1 慢启动快速增长阶段 2 快速传输微调阶段  当前设计只能由1 -> 2，不会回退
          this.connectMap = []; // 当前在线的所有连接
          this.connectCache = [];
          this.eventEmitter = new EventEmitter();
          this.port = port;
          this.dgram = dgram.createSocket("udp4");
          this.dgram.bind(port);
          this.bindMessage();
      }
      RDP.prototype.ping = function () { };
      RDP.prototype.send = function (address, port, data) { };
      // “客户端”方法，其实是发起端
      RDP.prototype.connect = function (address, port) {
          // 客户端 向目标服务器请求连接
          this.dgram.send(code.reqConnect, port, address);
      };
      RDP.prototype.bindMessage = function () {
          this.dgram.on("message", function (msg, rinfo) {
              rinfo.port; rinfo.address;
              try {
                  // 服务端，收到客户端请求连接code
                  var _a = JSON.parse(msg), code$1 = _a.code, data = _a.data;
                  switch (code$1) {
                      // 服务端接收到客户端请求连接
                      case code.reqConnect: {
                          // 回应客户端可以连入
                          this.dgram.send(code.recConnect);
                          break;
                      }
                      // 客户端接收到服务端回应
                      case code.recConnect: {
                          // 回应服务端收到回信 连接建立
                          this.dgram.send(code.sucConnect);
                          // 客户端触发连接事件
                          this.eventEmitter.emit("connect");
                          break;
                      }
                      // 服务端接收到客户端回应
                      case code.sucConnect: {
                          // 服务端出发连接事件
                          this.eventEmitter.emit("connect");
                          break;
                      }
                  }
              }
              catch (e) { }
          });
      };
      RDP.prototype.on = function (eventname, handler) {
          this.eventEmitter(eventname, handler);
      };
      return RDP;
  }());

  return RDP;

}));
