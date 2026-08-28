import fs from "node:fs/promises";
import path from "node:path";

const out = path.join(process.cwd(), "data", "source-status.json");
const payload = {
  updatedAt: new Date().toISOString(),
  status: "adapter-pending",
  note: "下一步接入经核验的中国大陆服公开数据源。当前脚本只验证定时刷新链路，不抓取或伪造实时数据。"
};

await fs.writeFile(out, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`updated ${out}`);
