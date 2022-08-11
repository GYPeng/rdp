import typescript from "rollup-plugin-typescript2";
import babel from "rollup-plugin-babel";

export default {
  // 核心选项
  input: "./main.ts", // 必须
  plugins: [typescript(), babel()],

  output: {
    // 必须 (如果要输出多个，可以是一个数组)
    // 核心选项
    file: "./dist/main.js", // 必须
    format: "cjs", // 必须
  },
};
