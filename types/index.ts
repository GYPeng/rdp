export type rdp = {
  port: string | number;
  type: string;
  signal: string;
  concurrent?: number; // 原始包最大并发数
  pool?: number; // 并发连接数 通过ip和端口区分
};

export const connectClientEvent = Symbol("connect.client.event");

export type msg = {
  code: string;
  data: any;
};

export enum code {
  /**
   * 三次握手，建立连接
   */
  reqConnect = "00", // 客户端： 请求连接
  recConnect = "01", // 服务端回应：收到请求 服务端开始允许客户端向其发送数据
  sucConnect = "02", // 客户端回应：收到服务端回应 连接建立 客户端开始允许服务端向其发送数据，并触发connect，connect后可以向服务端发数据
  /**
   * ping pong
   */
  ping = "03",
  pong = "04",
  /**
   * 发送数据
   */
  sendString = "05", // 发送字符串数据

  /**
   * 尚未建立连接，拒绝处理
   */
  reject = "99",
}
