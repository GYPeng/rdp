const EventEmitter = require("events");
import { connectClientEvent } from "../types/index";

export default class {
  private rdp: any;
  private [connectClientEvent] = new EventEmitter();
  private address: string;
  private port: number | number;
  constructor(rdp, address, port) {
    this.rdp = rdp;
    this.address = address;
    this.port = port;
  }
  send(data: any) {
    this.rdp.send(this.address, this.port, {});
  }
  on(eventname: string, handler: Function) {
    this[connectClientEvent].on(eventname, handler);
  }
  emit(eventname, params) {
    this[connectClientEvent].emit(eventname);
  }
  // 关闭此连接 会将未发送完的队列全部丢弃，然后关闭连接
  close() {}
  ping() {}
}
