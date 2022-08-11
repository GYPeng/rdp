const dgram = require("dgram");
const EventEmitter = require("events");
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
  private connectMap: string[] = []; // 当前在线的所有连接
  private connectCache: any[] = [];
  private eventEmitter = new EventEmitter();
  constructor({ port }: rdpType) {
    this.port = port;
    this.dgram = dgram.createSocket("udp4");
    this.dgram.bind(port);
    this.bindMessage();
  }
  ping() {}
  send(address: string, port: number | string, data: any) {}
  // “客户端”方法，其实是发起端
  connect(address: string, port: string | number) {
    // 客户端 向目标服务器请求连接
    this.dgram.send(CODE.reqConnect, port, address);
  }
  bindMessage() {
    this.dgram.on("message", function (msg: string, rinfo) {
      const { port, address } = rinfo;
      try {
        // 服务端，收到客户端请求连接code
        const { code, data }: msgType = JSON.parse(msg);
        switch (code) {
          // 服务端接收到客户端请求连接
          case CODE.reqConnect: {
            // 回应客户端可以连入
            this.dgram.send(CODE.recConnect);
            break;
          }
          // 客户端接收到服务端回应
          case CODE.recConnect: {
            // 回应服务端收到回信 连接建立
            this.dgram.send(CODE.sucConnect);
            // 客户端触发连接事件
            this.eventEmitter.emit("connect");
            break;
          }
          // 服务端接收到客户端回应
          case CODE.sucConnect: {
            // 服务端出发连接事件
            this.eventEmitter.emit("connect");
            break;
          }
        }
      } catch (e) {}
    });
  }
  on(eventname, handler) {
    this.eventEmitter(eventname, handler);
  }
}
