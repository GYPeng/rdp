const dgram = require("dgram");
const fs = require("fs");
const EventEmitter = require("events");
import connectClient from "./connectClient";
import { rdp as rdpType, code as CODE, msg as msgType } from "./types/index";
import { isBuffer, isString, isArray, isObject, sleep } from "./utils/index";

let packageCount = 0;
export default class RDP {
  readonly port: number | string;
  readonly dgram: any;
  private sourceQueue: any[] = []; // 原始队列 由send方法产生
  private sourceConcurrentQueue: any[] = []; // 原始并发队列 由原始队列计算得出 每个原始请求结束后，会检查原始队列中是否有数据，有则按队列移动一条到原始并发队列
  private packageConcurrentQueue: any[] = []; // 包并发队列 原始并发队列经过拥塞计算后得出  此队列中的包在上一个包发送成功，计算拥塞之后按序发送 因为并不会等待当前包组完全发送完毕才发送下一组，因此不能作为包组判断
  private packageConcurrentCache: any[] = []; // 包并发缓存 包并发队列中的包被发送后，移动到此  等发送成功后清除/packageId
  private packageFailed: any = []; // 发送失败的包 描述
  private coe: number = 1; // 拥塞控制 并发增加系数
  private concurrent: number = 1; // 拥塞控制 当前包并发上限
  private step: number = 1; // 所处阶段 1 慢启动快速增长阶段 2 快速传输微调阶段  当前设计只能由1 -> 2，不会回退
  private sourceConcurrent: number = 6; // 当前原始请求并发上限
  private connectClientMap: any = {}; // 当前在线的所有客户端
  private connectClientCache: any = {}; // 已发起，但是尚未成功建立的客户端
  private connectServerMap: any = {}; // 当前在线的所有服务端
  private connectServerCache: any = {}; // 已发起，但是尚未成功建立的服务端
  private receivedPackageCache: any = {}; // 已收到的包缓存（暂未处理的包）
  private receivedGroupCache: any = {}; // 已收到的包组缓存 用以判断包组是否接收完毕
  private receivedGroupInfoCache: any = {}; // 当前的包组信息
  private eventEmitter = new EventEmitter();
  private sourceId: number = 0;
  private groupId: number = 0;
  private packageId: number = 0;
  private ifSending = false;
  private dataReceivedTimeout: any = {}; // 数据接收超时计时器
  private reqGroupInfoTimeout: any = {}; // 数据发送超时计时器
  constructor({ port }: rdpType) {
    this.port = port;
    this.dgram = dgram.createSocket("udp4");
    this.dgram.bind(port);
    this.dgram.on("listening", () => {
      this.dgram.setSendBufferSize(1024 * 100);
    });
    this.bindMessage();
    // 绑定ping  ping只由客户端向服务端发起
    this.bindPing();
  }
  bindPing() {
    setInterval(() => {
      for (let key in this.connectServerMap) {
        const server = this.connectServerMap[key];
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
    }, 1000);
  }
  private sendData(
    address: string,
    port: number | string,
    data: any,
    callback?: Function
  ) {
    callback = function (e) {
      // console.log(e);
    };
    // console.log(data.code, (packageCount += data.data?.length || 0));
    if (callback) {
      this.dgram.send(JSON.stringify(data), port, address, callback);
    } else {
      this.dgram.send(JSON.stringify(data), port, address, callback);
    }
  }
  send(address: string, port: number | string, data: any) {
    let sourceId = this.sourceId++;
    const realData = data.data;
    if (isBuffer(realData)) {
      this.sourceQueue.push({ address, port, data, type: "buffer", sourceId });
    } else if (isString(realData)) {
      this.sourceQueue.push({ address, port, data, type: "string", sourceId });
    } else if (isArray(realData)) {
      this.sourceQueue.push({ address, port, data, type: "array", sourceId });
    } else if (isObject(realData)) {
      this.sourceQueue.push({ address, port, data, type: "object", sourceId });
    }
    // 如果尚未开始发送 启动发送函数
    if (!this.ifSending) {
      this.sendPackageGroupInfo();
      // console.log("发送包组信息");
    }
  }
  // 发送单个数据包
  sendOnePackage(
    address: string,
    port: number | string,
    data: any,
    callback?: Function
  ) {
    return new Promise((resolve, reject) => {
      this.sendData(address, port, data, resolve);
    });
  }
  // 计算得出当前原始并发队列
  computedSourceConcurrentQueue() {
    for (
      let i = 0;
      i <
      Math.min(
        Math.max(this.sourceConcurrent - this.sourceConcurrentQueue.length, 0),
        this.sourceQueue.length
      );
      i++
    ) {
      const source = this.sourceQueue.shift();
      this.sourceConcurrentQueue.push(source);
    }
  }
  // 获取一个发送失败的数据包
  getFailedPackage() {
    const obj = this.packageFailed.shift();
    if (obj) {
      const { packageId, sourceId, groupId, address, port } = obj;
      return this.packageConcurrentCache.find((v) => {
        // console.log(v, packageId, sourceId, groupId, address, port);
        return (
          packageId === v.packageId &&
          groupId === v.groupId &&
          sourceId === v.sourceId &&
          address === v.address &&
          v.port === port
        );
      });
    } else {
      return undefined;
    }
  }
  // 分包，并计算得出当前包组
  computedPackageGroup() {
    // 获取原始并发队列
    this.computedSourceConcurrentQueue();
    // 按照sliceBegin从小到大排序
    this.sourceConcurrentQueue.sort(
      ({ sliceBegin: sliceBeginA = 0 }, { sliceBegin: sliceBeginB = 0 }) =>
        sliceBeginA - sliceBeginB
    );
    const delArr = [];
    // 发送失败的包数量
    let failedCount = this.packageFailed.length;
    this.concurrent += this.coe;
    const conPakCount = this.concurrent;
    // console.log("并发队列", conPakCount);
    // Math.min(
    //   this.concurrent,
    //   Math.max(this.sourceConcurrentQueue.length, failedCount)
    // );
    let groupId = this.groupId++;
    for (let ind = 0; ind < conPakCount; ind++) {
      let obj;
      let i;
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
      const {
        address,
        port,
        data,
        type,
        sliceBegin = 0,
        sourceId,
        packageId,
      } = obj;
      const realData = data.data;

      let buf;
      if (["buffer", "string"].includes(type)) {
        buf = Buffer.from(realData);
      } else if (["object", "array"].includes(type)) {
        buf = Buffer.from(JSON.stringify(realData));
      } else {
        // 暂不支持其它类型传输
        continue;
      }
      // 切片大小 8kb
      const sliceEnd = Math.min(buf.length, 1024 * 1 + sliceBegin);
      const sliceBuf = buf.subarray(sliceBegin, sliceEnd);
      // 如果已经到达buf尾
      if (sliceEnd === buf.length) {
        // 记录该条目index，以便删除
        delArr.push(i);
      }
      obj.sliceBegin = sliceEnd;
      // 将切片放入包并发队列
      const pid = packageId === undefined ? this.packageId++ : packageId;
      console.log("pid", pid);
      this.packageConcurrentQueue.push({
        address,
        port,
        type,
        data: {
          ...data,
          data: sliceBuf,
          type,
          sourceId,
          packageId: pid,
          groupId,
        },
        sourceId,
        packageId: pid,
        groupId,
      });
      // console.log(this.packageConcurrentQueue);
    }
    delArr.sort((a, b) => b - a);
    // console.log(delArr);
    delArr.forEach((i) => {
      // 删除已分包完毕的数据
      this.sourceConcurrentQueue.splice(i, 1);
    });

    // console.log(this.packageConcurrentQueue.length);
  }
  // 发送数据
  sendWithCon() {
    for (let i = 0; i < this.packageConcurrentQueue.length; i++) {
      const obj = this.packageConcurrentQueue[i];
      const { address, port, data } = obj;
      // console.log(data);
      this.sendOnePackage(address, port, data);
      // 将已发送的包添加到包并发缓存
      this.packageConcurrentCache.push(obj);
    }
  }
  getGroupInfo() {
    // 从第一个包中 获取接收方信息
    const infoList = {};

    this.packageConcurrentQueue.forEach((v) => {
      const { address, port, packageId, groupId, sourceId } = v;
      const key = `${address}:${port}`;
      if (!infoList[key]) {
        infoList[key] = [];
      }
      infoList[key].push({
        address,
        port,
        packageId,
        groupId,
        sourceId,
      });
    });

    return infoList;
  }
  // 发送并发包组信息
  sendPackageGroupInfo() {
    this.ifSending = true;
    // 获取并发包组
    this.computedPackageGroup();
    const groupInfo = this.getGroupInfo();

    for (let key in groupInfo) {
      const info = groupInfo[key];
      const [address, port] = key.split(":");
      this.sendOnePackage(address, port, {
        code: CODE.reqGroupInfo,
        data: {
          groupId: info[0].groupId,
          sourceId: info[0].sourceId,
          packageIds: info.map((v) => v.packageId),
        },
      });
      // console.log(info);
    }
  }
  // “客户端”方法，其实是发起端
  connect(address: string, port: string | number) {
    // 客户端 向目标服务器请求连接
    this.sendData(address, port, {
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
    let count = 0;
    const begin = Date.now();
    this.dgram.on("message", (msg: string, rinfo) => {
      const { port, address } = rinfo;
      // msg = msg.toString();
      const ipKey = `${address}:${port}`;
      try {
        const {
          code,
          data,
          ind = 0,
          groupId,
          packageId,
          packageIds,
          sourceId,
        }: msgType = JSON.parse(msg);

        // 连接尚未建立  此时接收到非建立连接请求的数据将会被忽略
        if (Number(code) > Number(CODE.sucConnect)) {
          if (!this.connectClientMap[ipKey] && !this.connectServerMap[ipKey]) {
            // 尚未建立连接，却收到高于连接建立的code，返回尚未建立连接code 拒绝连接
            this.sendData(address, port, {
              code: CODE.reject,
            });
            return;
          }
        }

        const connectObj =
          this.connectServerMap[ipKey] || this.connectClientMap[ipKey];

        if (connectObj) {
          connectObj.isInteraction = true;
          connectObj.timeoutCount = 0;
        }

        switch (code) {
          // 服务端接收到客户端请求连接
          case CODE.reqConnect: {
            // 回应客户端可以连入
            this.sendData(address, port, { code: CODE.repConnect });
            // 如果目标已在连接列表中，重新连入将会移除之前的连接
            if (this.connectClientMap[ipKey]) {
              delete this.connectClientMap[ipKey];
            }
            this.connectClientCache[ipKey] = new connectClient(
              this,
              address,
              port
            );
            break;
          }
          // 客户端接收到服务端回应
          case CODE.repConnect: {
            // 将当前连接对象移动到已连接map，并从缓存中删除该对象
            this.connectServerMap[ipKey] = this.connectServerCache[ipKey];
            delete this.connectServerCache[ipKey];
            // 触发客户端连接事件
            this.connectServerMap[ipKey].emit(
              "connect",
              this.connectServerMap[ipKey]
            );
            // 回应服务端收到回信 连接建立
            this.sendData(address, port, { code: CODE.sucConnect });
            break;
          }
          // 服务端接收到客户端回应
          case CODE.sucConnect: {
            // 将当前连接对象移动到已连接map，并从缓存中删除该对象
            this.connectClientMap[ipKey] = this.connectClientCache[ipKey];
            delete this.connectClientCache[ipKey];
            // 服务端触发连接事件
            this.eventEmitter.emit("connect", this.connectClientMap[ipKey]);
            break;
          }
          // 服务端收到客户端ping 回应pong
          case CODE.ping: {
            const client = this.connectClientMap[ipKey];
            client.pong();
            break;
          }
          // 客户端收到pong
          case CODE.pong: {
            // const server = this.connectServerMap[ipKey];
            // server.timeoutCount = 0;
            break;
          }
          // 服务端/客户端接收到数据
          case CODE.sendData: {
            if (!this.receivedPackageCache[ipKey]) {
              this.receivedPackageCache[ipKey] = [];
            }
            if (!this.receivedGroupCache[ipKey]) {
              this.receivedGroupCache[ipKey] = [];
            }
            this.receivedPackageCache[ipKey].push({
              packageId,
              data,
            });
            // console.log("接收到的包", packageId);
            // 接收到数据，清空超时计时器
            clearTimeout(this.dataReceivedTimeout[ipKey]);
            const filePath = "/Users/fujiu/Desktop/rdt/test/bak.js";
            if (count === 0 && fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
            if (!fs.existsSync(filePath) && packageId === 0) {
              // console.log(data);
              fs.writeFileSync(filePath, Buffer.from(data.data));
              count++;
            } else {
              this.receivedPackageCache[ipKey].sort(
                (a, b) => a.packageId - b.packageId
              );
              for (
                let i = count;
                i < this.receivedPackageCache[ipKey].length;
                i++
              ) {
                const { packageId, data } = this.receivedPackageCache[ipKey][i];
                if (packageId === count) {
                  fs.appendFileSync(
                    filePath,
                    Buffer.from(data.data),
                    function (e) {
                      console.log(e);
                    }
                  );
                  count++;
                } else {
                  break;
                }
              }
            }
            this.receivedGroupCache[ipKey].push({
              packageId,
              sourceId,
              groupId,
            });

            // 判断包组是否接收完毕
            if (
              this.receivedGroupCache[ipKey].every((cache) =>
                this.receivedGroupInfoCache[ipKey].find(
                  (v) =>
                    v.packageId === cache.packageId &&
                    v.groupId === cache.groupId &&
                    v.sourceId === cache.sourceId
                )
              )
            ) {
              // 如果接收完毕，立即回应发送方（没有参数表示全部接收成功）
              this.sendData(address, port, { code: CODE.recReceiveInfo });
              // 清空包组信息
              this.receivedGroupCache[ipKey] = [];
              // 清空已接收完的包组
              this.receivedGroupInfoCache[ipKey] = [];
            } else {
              // 数据未接收完毕，设置超时计时器
              this.dataReceivedTimeout[ipKey] = setTimeout(() => {
                // console.log(
                //   this.receivedGroupCache[ipKey].map((v) => v.packageId).join(),
                //   "|",
                //   this.receivedGroupInfoCache[ipKey]
                //     .map((v) => v.packageId)
                //     .join()
                // );
                // 计算丢包信息
                let lostInfo = this.receivedGroupCache[ipKey]
                  .filter(
                    (cache) =>
                      !this.receivedGroupInfoCache[ipKey].find((v) => {
                        // console.log(cache, "|", v);
                        return (
                          v.packageId === cache.packageId &&
                          v.groupId === cache.groupId &&
                          v.sourceId === cache.sourceId
                        );
                      })
                  )
                  .map((v) => ({
                    packageId: v.packageId,
                    sourceId: v.sourceId,
                    groupId: v.groupId,
                  }));
                console.log(lostInfo);
                // 500毫秒内，没有接收到发送方数据，视为数据接收超时（丢包）  回应发送方接收情况
                this.sendData(address, port, {
                  code: CODE.recReceiveInfo,
                  data: lostInfo,
                });

                // 清空包组信息
                this.receivedGroupCache[ipKey] = [];
                // 清空已接收完的包组
                this.receivedGroupInfoCache[ipKey] = [];
              }, 500);
            }

            // console.log(this.receivedPackageCache[ipKey].length);

            break;
          }
          // 接收方收到包组信息
          case CODE.reqGroupInfo: {
            clearTimeout(this.dataReceivedTimeout[ipKey]);
            const obj = (data.packageIds || []).map((v) => ({
              packageId: v,
              groupId: data.groupId,
              sourceId: data.sourceId,
            }));
            if (!this.receivedGroupInfoCache[ipKey]?.length) {
              this.receivedGroupInfoCache[ipKey] = obj;
              // 回应发送端
              this.sendData(address, port, {
                code: CODE.recGroupInfo,
                data: groupId,
              });
            }

            return;
          }
          // 发送方收到包组回应
          case CODE.recGroupInfo: {
            clearTimeout(this.reqGroupInfoTimeout[ipKey]);
            // console.log("收到包组回应");
            //  调用发送方法
            setTimeout(() => {
              this.sendWithCon();
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
          case CODE.recReceiveInfo: {
            data?.length
              ? data.forEach((v) => {
                  this.packageFailed.push({
                    address,
                    port,
                    ...v,
                  });
                })
              : null;

            // data?.length >>> 0
            //   ? console.log("丢包信息", this.packageFailed)
            //   : null;
            const tmp = this.packageConcurrentQueue.filter(
              (queue) =>
                !data?.find(
                  (v) =>
                    queue.packageId === v.packageId &&
                    queue.sourceId === v.sourceId &&
                    queue.groupId === v.groupId
                )
            );
            this.packageConcurrentCache = this.packageConcurrentCache.filter(
              (cache) =>
                !(tmp || []).find(
                  (v) =>
                    v.packageId === cache.packageId &&
                    v.groupId === cache.groupId &&
                    v.sourceId === cache.sourceId
                )
            );
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
            if (!data) {
              // 全部发送成功
              this.coe *= 2;
              setTimeout(() => {
                // 所有包全部发送完毕，退出
                if (!this.packageConcurrentQueue.length) {
                  this.ifSending = false;
                }
              }, 100);
            } else {
              // 部分发送成功
              // 当前并发数量 减去丢包数量
              // this.concurrent = Math.max(
              //   this.concurrent - Math.floor(data.length / 3),
              //   1
              // );
              if (data.length > this.packageConcurrentQueue.length / 2) {
                // 丢包率大于三分之一 重置增量系数
                this.coe = 1;
                this.concurrent -= this.packageConcurrentQueue.length / 20;
              }
            }

            // 清空包并发队列
            this.packageConcurrentQueue = [];
            this.reqGroupInfoTimeout[ipKey] = setTimeout(() => {
              this.sendPackageGroupInfo();
            }, 300);
            // 调用计算并发送当前包组方法
            this.sendPackageGroupInfo();
            return;
          }
        }
      } catch (e) {
        /**
         * 向已成功建立请求的连接对象抛出错误事件
         */
        for (let key in this.connectClientMap) {
          const client = this.connectClientMap[key];
          client.emit("err", e);
        }
        for (let key in this.connectServerMap) {
          const client = this.connectServerMap[key];
          client.emit("err", e);
        }
        /**
         * 向尚未成功建立请求的连接对象抛出错误事件
         */
        for (let key in this.connectClientCache) {
          const client = this.connectClientCache[key];
          client.emit("err", e);
        }
        for (let key in this.connectServerCache) {
          const client = this.connectServerCache[key];
          client.emit("err", e);
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
  close() {
    this.dgram.close();
  }
}
