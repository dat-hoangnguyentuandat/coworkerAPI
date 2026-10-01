import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";

export class ToolSchemaError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export type ToolSchemaCheck = { schema: Record<string, unknown>; arguments?: Record<string, unknown> };

// Untrusted schema compilation/regex execution must never block gateway polling.
// No remote schema resolution, data coercion, defaults or property removal.
const workerSource = `
const {parentPort,workerData}=require('node:worker_threads');
const Ajv=require(workerData.modules.ajv); const Ajv2019=require(workerData.modules.ajv2019); const Ajv2020=require(workerData.modules.ajv2020);
const addFormats=require(workerData.modules.formats);
(function () {
try {
  for (const check of workerData.checks) {
    const dialect=check.schema.$schema;
    const Constructor=dialect && dialect.includes('2020-12') ? Ajv2020 : dialect && dialect.includes('2019-09') ? Ajv2019 : Ajv;
    const ajv=new Constructor({strictSchema:true,strictTypes:false,strictTuples:false,allowUnionTypes:true,allErrors:false,coerceTypes:false,useDefaults:false,removeAdditional:false,logger:false,inlineRefs:false});
    addFormats(ajv);
    const validate=ajv.compile(check.schema);
    if (validate.$async) throw new Error('Async schemas are unsupported');
    if (Object.prototype.hasOwnProperty.call(check,'arguments') && !validate(check.arguments)) {
      parentPort.postMessage({valid:false}); return;
    }
  }
  parentPort.postMessage({valid:true});
} catch { parentPort.postMessage({invalidSchema:true}); }
})();
`;
const requireFromPackage = createRequire(import.meta.url);
const modules = { ajv: requireFromPackage.resolve("ajv"), ajv2019: requireFromPackage.resolve("ajv/dist/2019"), ajv2020: requireFromPackage.resolve("ajv/dist/2020"), formats: requireFromPackage.resolve("ajv-formats") };

/** Bound structured-clone/serialization costs before crossing the worker boundary. */
export function assertBoundedToolJson(value: unknown, maxBytes = 1_000_000): void {
  const stack: Array<{ value?: unknown; depth: number; leave?: object }> = [{ value, depth: 0 }]; const ancestors = new Set<object>(); let nodes = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (item.leave) { ancestors.delete(item.leave); continue; }
    if (++nodes > 50_000 || item.depth > 64) throw new ToolSchemaError("invalid_tool_schema", "Tool schema/data exceeds structural limits.");
    const current = item.value;
    if (current === null || typeof current === "string" || typeof current === "boolean") continue;
    if (typeof current === "number" && Number.isFinite(current)) continue;
    if (!current || typeof current !== "object" || ancestors.has(current)) throw new ToolSchemaError("invalid_tool_schema", "Tool schema/data must be bounded JSON.");
    ancestors.add(current);
    stack.push({ leave: current, depth: item.depth });
    for (const nested of Object.values(current)) stack.push({ value: nested, depth: item.depth + 1 });
  }
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) throw new ToolSchemaError("invalid_tool_schema", "Tool schema/data exceeds size limits.");
}

let activeWorkers = 0;
const maxWorkers = 4;
/** Bounded worker lifetime also contains recursive references and pathological regexes. */
export async function checkToolSchemas(checks: ToolSchemaCheck[], timeoutMs = 2000): Promise<boolean> {
  if (!checks.length) return true;
  assertBoundedToolJson(checks);
  if (activeWorkers >= maxWorkers) throw new ToolSchemaError("tool_schema_capacity", "Tool schema validator is busy; retry later.");
  activeWorkers++;
  let worker: Worker | undefined;
  try {
    worker = new Worker(workerSource, { eval: true, workerData: { checks, modules }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
    const running = worker;
    return await new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => reject(new ToolSchemaError("tool_schema_timeout", "Tool schema validation exceeded its time limit.")), timeoutMs);
      const finish = (action: () => void) => { clearTimeout(timer); action(); };
      running.once("message", (message: { valid?: boolean; invalidSchema?: boolean }) => finish(() => {
        if (message.invalidSchema || typeof message.valid !== "boolean") reject(new ToolSchemaError("invalid_tool_schema", "Tool parameters contain an invalid or unsupported JSON Schema."));
        else resolve(message.valid);
      }));
      running.once("error", () => finish(() => reject(new ToolSchemaError("invalid_tool_schema", "Tool schema validator could not process this schema."))));
      running.once("exit", () => finish(() => reject(new ToolSchemaError("invalid_tool_schema", "Tool schema validator exited before completion."))));
    });
  } finally {
    if (worker) await worker.terminate();
    activeWorkers--;
  }
}
