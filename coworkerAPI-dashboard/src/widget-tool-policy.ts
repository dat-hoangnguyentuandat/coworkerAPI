import { assertBoundedToolJson, checkToolSchemas, ToolSchemaError } from "./tool-schema.js";

export class WidgetToolPolicyError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
type Tool = { name: string; namespace?: string };
export type WidgetToolPolicy = { tools: Map<string, Tool>; schemas: Map<string, Record<string, unknown>>; allowed: Set<string>; required: boolean; maxCalls: number };
const record = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const name = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(v);
function fail(code: string, message: string): never { throw new WidgetToolPolicyError(code, message); }

/** Deterministic client-owned tool routing; never execute tools in the gateway. */
export function widgetToolPolicy(definitions: unknown[] = [], choice?: unknown, parallel?: unknown): WidgetToolPolicy {
  const tools = new Map<string, Tool>();
  const schemas = new Map<string, Record<string, unknown>>();
  const add = (value: unknown, namespace?: string) => {
    if (!record(value) || (value.type !== "function" && !(value.type === undefined && record(value.input_schema)))) fail("unsupported_tools", "Widget supports client function tools and function namespaces only.");
    const fn = record(value.function) ? value.function : value;
    if (!name(fn.name)) fail("invalid_tools", "Function name is invalid.");
    if (fn.defer_loading === true) fail("unsupported_tools", "Deferred tool loading is not supported by the widget.");
    const key = namespace ? `${namespace}.${fn.name}` : fn.name;
    if (tools.has(key) || tools.size >= 1024) fail("invalid_tools", "Function names must be unique and the tool set bounded.");
    const schema = fn.parameters ?? fn.input_schema ?? { type: "object", properties: {}, additionalProperties: false };
    if (!record(schema)) fail("invalid_tool_schema", "Function parameters must be a JSON Schema object.");
    try { assertBoundedToolJson(schema); } catch { fail("invalid_tool_schema", "Function parameters exceed JSON structural limits."); }
    schemas.set(key, structuredClone(schema));
    tools.set(key, { name: fn.name, ...(namespace ? { namespace } : {}) });
  };
  for (const value of definitions) {
    if (record(value) && value.type === "namespace") {
      if (!name(value.name) || !Array.isArray(value.tools) || !value.tools.length) fail("invalid_tools", "Function namespace must have a valid name and functions.");
      for (const fn of value.tools) add(fn, value.name);
    } else add(value);
  }
  const policy: WidgetToolPolicy = { tools, schemas, allowed: new Set(tools.keys()), required: false, maxCalls: parallel === false ? 1 : 16 };
  if (parallel !== undefined && typeof parallel !== "boolean") fail("invalid_tool_choice", "parallel_tool_calls must be boolean.");
  const resolve = (ref: unknown): string => {
    if (!record(ref) || !["function", "tool"].includes(ref.type)) fail("unsupported_tool_choice", "Tool choice must reference a client function.");
    const fn = record(ref.function) ? ref.function : ref;
    if (!name(fn.name) || (ref.namespace !== undefined && !name(ref.namespace))) fail("invalid_tool_choice", "Tool choice reference is invalid.");
    const key = ref.namespace ? `${ref.namespace}.${fn.name}` : fn.name;
    if (!tools.has(key)) fail("invalid_tool_choice", "Chosen function is not declared in the request.");
    return key;
  };
  if (choice === undefined || choice === "auto") return policy;
  if (choice === "none") { policy.allowed.clear(); return policy; }
  if (choice === "required") policy.required = true;
  else if (record(choice)) {
    if (choice.disable_parallel_tool_use !== undefined && typeof choice.disable_parallel_tool_use !== "boolean") fail("invalid_tool_choice", "disable_parallel_tool_use must be boolean.");
    if (choice.disable_parallel_tool_use === true) policy.maxCalls = 1;
    if (choice.type === "none") policy.allowed.clear();
    else if (choice.type === "auto") { /* Anthropic automatic choice. */ }
    else if (choice.type === "any") policy.required = true;
    else if (["function", "tool"].includes(choice.type)) { policy.allowed = new Set([resolve(choice)]); policy.required = true; if (choice.type === "function") policy.maxCalls = 1; }
    else if (choice.type === "allowed_tools") {
      if (!["auto", "required"].includes(choice.mode) || !Array.isArray(choice.tools) || !choice.tools.length) fail("invalid_tool_choice", "Allowed tools require a nonempty function subset and valid mode.");
      policy.allowed = new Set(choice.tools.map(resolve)); policy.required = choice.mode === "required";
    } else fail("unsupported_tool_choice", "This tool choice is not supported by the widget.");
  } else fail("invalid_tool_choice", "Tool choice is invalid.");
  if (policy.required && !policy.allowed.size) fail("invalid_tool_choice", "Required tool choice needs at least one callable function.");
  return policy;
}

export async function validateWidgetToolSchemas(policy: WidgetToolPolicy): Promise<void> {
  try { await checkToolSchemas([...policy.schemas.values()].map(schema => ({ schema }))); }
  catch (error) { throw new WidgetToolPolicyError(error instanceof ToolSchemaError ? error.code : "invalid_tool_schema", error instanceof ToolSchemaError ? error.message : "Invalid tool schema."); }
}
