export function assistantFailureMessage(code: string): string {
  if (code === 'MODEL_HTTP_429') return 'The free AI provider is rate-limiting requests. Try later, or use the inventory and procurement screens.';
  if (code === 'MISSING_TOOL_CALL' || code === 'INVALID_TOOL_ARGUMENTS') return 'The AI did not return a valid operation, so no answer could be produced. You can inspect inventory and budget directly in the dashboard.';
  if (code === 'RUN_TIMEOUT' || code === 'INTERRUPTED') return 'The assistant request was interrupted or timed out. Check any recovered proposal links before requesting drafts again.';
  if (code === 'MODEL_UNAVAILABLE' || code.startsWith('MODEL_HTTP_')) return 'The AI provider is unavailable. Use the inventory and procurement screens, or try later.';
  return 'The assistant could not complete this request. Use the dashboard or inspect any recovered proposal links.';
}
