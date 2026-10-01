/** Applies only to the ChatGPT transport conversation, never the API answer. */
export const WIDGET_CHAT_POLICY = [
  "Transport chat policy: do not write a preamble, progress update, reasoning, file/command list, tool summary, or repeated acknowledgement in this ChatGPT conversation.",
  "Send the complete answer or client-owned tool_calls ONLY through workbench_api_submit. This policy must not shorten, replace, or reduce the quality of that API result.",
  "After an accepted tool_calls callback, remain silent in chat: the client will execute the tools and continue in a later request. After an accepted final-text callback, the only permitted chat reply is exactly Thành công.",
  "If the callback is invalid_result, repair and resubmit silently; it is not a terminal failure. If the request is cancelled or unknown_request, stop and do not retry; the only permitted chat reply is exactly Thất bại. Do not invent success before an accepted callback.",
].join(" ");

export type WidgetSubmitStatus = "accepted" | "unknown_request" | "invalid_result" | "cancelled";

export function widgetSubmitNotice(status: WidgetSubmitStatus, hasToolCalls: boolean): string {
  switch (status) {
    case "accepted": return hasToolCalls
      ? "Tool calls accepted. Continue only when the client sends its next request. Remain silent in chat."
      : "Thành công. The only permitted chat reply is exactly Thành công.";
    case "cancelled": return "Thất bại. The API client cancelled this request. No result was delivered. Stop; do not retry, activate a widget, or send another answer for it. The only permitted chat reply is exactly Thất bại.";
    case "unknown_request": return "Thất bại. This request is no longer pending. Do not retry it. The only permitted chat reply is exactly Thất bại.";
    case "invalid_result": return "The API request is still pending. Re-read workbench_api_read_request for this request_id, follow its required/allowed tool names, argument JSON schemas and maximum call count, then resubmit a corrected result for the same request_id. Required tools cannot be replaced by final text. Repair silently; do not post a progress update or Thất bại in chat.";
  }
}
