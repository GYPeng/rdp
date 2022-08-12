const dgram = require("dgram");
const EventEmitter = require("events");
import connectClient from "./connectClient";
import { rdp as rdpType, code as CODE, msg as msgType } from "../types/index";

export default class RDP {
  readonly port: number | string;
  readonly dgram: any;
  private sourceQueue: any[]; // 原始队列 由send方法产生
  private sourceConcurrentQueue: any[]; // 原始并发队列 由原始队列计算得出 每个原始请求结束后，会检查原始队列中是否有数据，有则按队列移动一条到原始并发队列
  private packageConcurrentQueue: any[]; // 包并发队列 原始并发队列经过拥塞计算后得出  此队列中的包在上一个包发送成功，计算拥塞之后按序发送 因为并不会等待当前包组完全发送完毕才发送下一组，因此不能作为包组判断
  private packageGroupCache: any[]; // 包组缓存，存放未发送成功的数据包组信息 用来判断当前包组是否完全发送完毕，以决定下一步拥塞控制
  private packageConcurrentCache: any[]; // 包并发缓存 包并发队列中的包被发送后，移动到此  等发送成功后清除/或者发送失败后重发
  private coe: number = 1; // 拥塞控制 并发增加系数
  private concurrent: number = 1; // 拥塞控制 当前包并发上限
  private step: number = 1; // 所处阶段 1 慢启动快速增长阶段 2 快速传输微调阶段  当前设计只能由1 -> 2，不会回退
  private sourceConcurrent: number; // 当前原始请求并发上限
  private connectClientMap: any = {}; // 当前在线的所有客户端
  private connectClientCache: any = {}; // 已发起，但是尚未成功建立的客户端
  private connectServerMap: any = {}; // 当前在线的所有服务端
  private connectServerCache: any = {}; // 已发起，但是尚未成功建立的服务端
  private eventEmitter = new EventEmitter();
  constructor({ port }: rdpType) {
    this.port = port;
    this.dgram = dgram.createSocket("udp4");
    this.dgram.bind(port);
    this.bindMessage();
    // 绑定ping  ping只由客户端向服务端发起
    this.bindPing();
  }
  bindPing() {
    setInterval(() => {
      for (let key in this.connectServerMap) {
        const server = this.connectServerMap[key];
        // 如果服务端超时
        if (server.timeoutCount > 3) {
          console.log("服务端超时");
          // 触发该连接对象 error事件
          server.emit("err", {
            message: "The server failed to respond.",
            target: server,
          });
          // 触发rdp对象err事件
          this.emit("err", {
            message: "The server failed to respond.",
            target: server,
          });
          // 并将该连接对象移出已连接列表
          delete this.connectServerMap[key];
          continue;
        }
        server.timeoutCount++;
        server.ping();
      }
      for (let key in this.connectClientMap) {
        const client = this.connectClientMap[key];
        // 如果服务端超时
        if (client.timeoutCount > 3) {
          // 触发该连接对象 err事件
          client.emit("err", {
            message: "The client failed to respond.",
            target: client,
          });
          // 触发rdp对象err事件
          this.emit("err", {
            message: "The client failed to respond.",
            target: client,
          });
          // 并将该连接对象移出已连接列表
          delete this.connectClientMap[key];
          continue;
        }
        client.timeoutCount++;
      }
    }, 3000);
  }
  send(address: string, port: number | string, data: any) {
    this.dgram.send(JSON.stringify(data), port, address);
  }
  // “客户端”方法，其实是发起端
  connect(address: string, port: string | number) {
    // 客户端 向目标服务器请求连接
    this.send(address, port, {
      code: CODE.reqConnect,
    });

    // 如果客户端重复发起连接，之前已有的连接将会被移除
    if (this.connectServerMap[`${address}:${port}`]) {
      delete this.connectServerMap[`${address}:${port}`];
    }
    this.connectServerCache[`${address}:${port}`] = new connectClient(
      this,
      address,
      port
    );

    // 返回一个连接对象，调用此对象可以对该连接进行操作，而无需手动制定ip和端口
    return this.connectServerCache[`${address}:${port}`];
  }
  bindMessage() {
    this.dgram.on("message", (msg: string, rinfo) => {
      const { port, address } = rinfo;
      try {
        const { code, data }: msgType = JSON.parse(msg);
        // 连接尚未建立  此时接收到非建立连接请求的数据将会被忽略
        if (Number(code) > Number(CODE.sucConnect)) {
          if (
            !this.connectClientMap[`${address}:${port}`] &&
            !this.connectServerMap[`${address}:${port}`]
          ) {
            // 尚未建立连接，却收到高于连接建立的code，返回尚未建立连接code 拒绝连接
            this.send(address, port, {
              code: CODE.reject,
            });
            return;
          }
        }

        switch (code) {
          // 服务端接收到客户端请求连接
          case CODE.reqConnect: {
            // 回应客户端可以连入
            this.send(address, port, { code: CODE.recConnect });
            // 如果目标已在连接列表中，重新连入将会移除之前的连接
            if (this.connectClientMap[`${address}:${port}`]) {
              delete this.connectClientMap[`${address}:${port}`];
            }
            this.connectClientCache[`${address}:${port}`] = new connectClient(
              this,
              address,
              port
            );
            break;
          }
          // 客户端接收到服务端回应
          case CODE.recConnect: {
            // 将当前连接对象移动到已连接map，并从缓存中删除该对象
            this.connectServerMap[`${address}:${port}`] =
              this.connectServerCache[`${address}:${port}`];
            delete this.connectServerCache[`${address}:${port}`];
            // 触发客户端连接事件
            this.connectServerMap[`${address}:${port}`].emit(
              "connect",
              this.connectServerMap[`${address}:${port}`]
            );
            // 回应服务端收到回信 连接建立
            this.send(address, port, { code: CODE.sucConnect });
            break;
          }
          // 服务端接收到客户端回应
          case CODE.sucConnect: {
            // 将当前连接对象移动到已连接map，并从缓存中删除该对象
            this.connectClientMap[`${address}:${port}`] =
              this.connectClientCache[`${address}:${port}`];
            delete this.connectClientCache[`${address}:${port}`];
            // 服务端触发连接事件
            this.eventEmitter.emit(
              "connect",
              this.connectClientMap[`${address}:${port}`]
            );
            break;
          }
          // 服务端收到客户端ping 回应pong
          case CODE.ping: {
            const client = this.connectClientMap[`${address}:${port}`];
            client.pong();
            client.timeoutCount--;
            break;
          }
          // 客户端收到pong
          case CODE.pong: {
            const server = this.connectServerMap[`${address}:${port}`];
            server.timeoutCount--;
            break;
          }
        }
      } catch (e) {
        /**
         * 向已成功建立请求的连接对象抛出错误事件
         */
        for (let key in this.connectClientMap) {
          const client = this.connectClientMap[key];
          client.emit("error", e);
        }
        for (let key in this.connectServerMap) {
          const client = this.connectServerMap[key];
          client.emit("error", e);
        }
        /**
         * 向尚未成功建立请求的连接对象抛出错误事件
         */
        for (let key in this.connectClientCache) {
          const client = this.connectClientCache[key];
          client.emit("error", e);
        }
        for (let key in this.connectServerCache) {
          const client = this.connectServerCache[key];
          client.emit("error", e);
        }

        console.log("发生错误", e);
      }
    });
  }
  on(eventname, handler) {
    this.eventEmitter.on(eventname, handler);
  }
  emit(eventname, params) {
    this.eventEmitter.emit(eventname, params);
  }
}
