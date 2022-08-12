export const isBuffer = (target: any) => Buffer.isBuffer(target);

export const isString = (target: any) =>
  Object.prototype.toString.call(target) === "[object String]";

export const isArray = (target: any) => Array.isArray(target);

export const isObject = (target: any) =>
  Object.prototype.toString.call(target) === "[object Object]";
