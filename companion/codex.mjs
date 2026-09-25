// Codex CLI adapter. Prompts travel through stdin, never through a shell.
export function codexCommand(args) {
  const binary = process.env.CODEX_BIN || 'codex';
  return /\.(mjs|cjs|js)$/i.test(binary)
    ? { cmd: process.execPath, args: [binary, ...args] }
    : { cmd: binary, args };
}

export function codexArgs({ mode, model, effort, conversation, unrestricted, jsonSchema }) {
  const sandbox = unrestricted ? 'danger-full-access'
    : ['staffer', 'implement'].includes(mode) ? 'workspace-write' : 'read-only';
  const args = ['exec'];
  if (conversation) args.push('resume');
  args.push('--json', '--skip-git-repo-check',
    '-c', 'approval_policy="never"', '-c', `sandbox_mode=${JSON.stringify(sandbox)}`);
  if (model) args.push('--model', model);
  if (effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(effort)}`);
  if (jsonSchema) args.push('--output-schema', jsonSchema);
  if (conversation) args.push(conversation);
  args.push('-');
  return args;
}

// Validate the small, closed review contract even when a provider ignores
// --output-schema. Failed validation is retained with the job's diagnostics.
export function validateReview(response, schema) {
  function matches(value, rule) {
    if (rule.enum && !rule.enum.includes(value)) return false;
    if (rule.type === 'string') return typeof value === 'string';
    if (rule.type === 'array') return Array.isArray(value) && value.every(item => matches(item, rule.items));
    if (rule.type === 'object') {
      return value !== null && typeof value === 'object' && !Array.isArray(value)
        && rule.required.every(key => Object.hasOwn(value, key))
        && Object.keys(value).every(key => Object.hasOwn(rule.properties, key) && matches(value[key], rule.properties[key]));
    }
    return false;
  }
  let value;
  try { value = JSON.parse(response); } catch { /* handled by contract check */ }
  if (!matches(value, schema)) throw Object.assign(new Error('Codex review did not match the requested JSON schema. See the retained raw events for the response.'), { reason: 'invalid_review' });
  return response;
}

// A message alone is not a successful turn. Require turn.completed and a zero
// process exit; turn.failed can carry useful partial text without becoming done.
export function createResult() {
  let thread = null, response = '', usage = null, status = null, error = null;
  const accept = (event) => {
    switch (event.type) {
      case 'thread.started': thread = event.thread_id; break;
      case 'turn.started': response = ''; status = null; error = null; break;
      case 'item.completed':
        if (event.item?.type === 'agent_message') response = event.item.text || '';
        break;
      case 'turn.completed': status = 'SUCCESS'; usage = event.usage; break;
      case 'turn.failed': status = 'ERROR'; error = event.error?.message || 'Codex turn failed'; break;
      case 'error': error = event.message || 'Codex stream error'; break;
    }
  };
  return {
    accept,
    result: () => status ? { status, response, usage, error, conversation_id: thread } : null,
    error: () => error,
  };
}
