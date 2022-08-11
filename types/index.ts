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
  reqConnect = "01", // 客户端： 请求连接
  recConnect = "02", // 服务端回应：收到请求
  sucConnect = "03", // 客户端回应：收到服务端回应 连接建立
  /**
   * ping pong
   */
  ping = "04",
  pong = "05",
  /**
   * 发送数据
   */
  sendString = "06", // 发送字符串数据
}
