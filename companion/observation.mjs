// Per-job projection of Codex's NDJSON protocol. No shared observer cursor.
import { StringDecoder } from 'node:string_decoder';

export const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
export function excerpt(value, limit, tail = false) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  if (bytes(text) <= limit) return { text, truncated: false };
  const chars = Array.from(text);
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const n = Math.ceil((lo + hi) / 2);
    const part = tail ? chars.slice(-n).join('') : chars.slice(0, n).join('');
    if (bytes(part) <= limit) lo = n; else hi = n - 1;
  }
  return { text: lo ? (tail ? chars.slice(-lo) : chars.slice(0, lo)).join('') : '', truncated: true };
}

export function boundSnapshot(snapshot) {
  const out = structuredClone(snapshot);
  while (bytes(out) + 1 > 8192 && out.recent_activities?.length) {
    out.recent_activities.shift();
    out.truncated = true;
  }
  if (bytes(out) + 1 > 8192) { out.latest_text = null; out.truncated = true; }
  // Path/configuration values can also be unusually large. Keep the object valid.
  if (bytes(out) + 1 > 8192) {
    for (const key of Object.keys(out)) {
      if (typeof out[key] === 'string') out[key] = excerpt(out[key], 256).text;
    }
    for (const key of Object.keys(out.details || {})) {
      if (typeof out.details[key] === 'string') out.details[key] = excerpt(out.details[key], 512).text;
    }
    out.truncated = true;
    out.details_truncated = true;
  }
  // Terminal observations add nested recovery/configuration strings. Budget
  // those too; a long path must not bypass the same 8 KiB response ceiling.
  if (bytes(out) + 1 > 8192) {
    const trim = (value, limit) => {
      if (typeof value === 'string') return excerpt(value, limit).text;
      if (Array.isArray(value)) return value.map((item) => trim(item, limit));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, trim(item, limit)]));
      return value;
    };
    out.truncated = true;
    out.details_truncated = true;
    for (const limit of [256, 128, 64]) {
      const compact = trim(out, limit);
      if (bytes(compact) + 1 <= 8192) return compact;
    }
    return { job_id: excerpt(out.job_id || '', 256).text, status: out.status,
      result_file: excerpt(out.result_file || out.details?.result || '', 512).text,
      truncated: true, details_truncated: true };
  }
  return out;
}

export function createProjection(onConversation = () => {}) {
  const data = { last_event_at: null, recent_activities: [], latest_text: null, warnings: [] };
  let conversation = null;
  const warn = (message) => {
    if (!data.warnings.includes(message) && data.warnings.length < 5) data.warnings.push(message);
  };
  const accept = (event) => {
    data.last_event_at = new Date().toISOString();
    if (event.type === 'thread.started') {
      if (typeof event.thread_id === 'string' && event.thread_id.length <= 256 && event.thread_id !== conversation) {
        conversation = event.thread_id;
        onConversation(conversation);
      }
      return;
    }
    if (event.type === 'error' || event.type === 'turn.failed') {
      warn(excerpt(event.error?.message || event.message || 'Codex reported a failure.', 400).text);
      return;
    }
    if (event.type === 'turn.started' || event.type === 'turn.completed') return;
    if (!['item.started', 'item.updated', 'item.completed'].includes(event.type) || !event.item?.id) {
      warn('Unknown event retained in raw output.');
      return;
    }
    const item = event.item;
    const complete = event.type === 'item.completed';
    if (item.type === 'agent_message') {
      const text = excerpt(item.text || '', 1700, true);
      data.latest_text = { item_id: item.id, text: text.text, truncated: text.truncated,
        incomplete: !complete, status: complete ? 'done' : 'running', updated_at: data.last_event_at };
      return;
    }
    // Reasoning is not part of the user-facing progress projection.
    if (item.type === 'reasoning') return;
    const prior = data.recent_activities.find(activity => activity.item_id === item.id);
    const activity = prior || { item_id: excerpt(item.id, 100).text, started_at: data.last_event_at };
    const tool = excerpt(item.tool || item.type || 'unknown', 100);
    const input = excerpt(item.command ?? item.arguments ?? item.query ?? item.changes ?? item.items ?? '', 240);
    const output = excerpt(item.error ?? item.aggregated_output ?? item.result ?? '', 240);
    const failed = item.status === 'failed' || item.status === 'declined' || item.error ||
      (typeof item.exit_code === 'number' && item.exit_code !== 0);
    Object.assign(activity, {
      tool: tool.text, status: failed ? 'error' : complete ? 'done' : 'running',
      updated_at: data.last_event_at, input_preview: input.text, output_preview: output.text,
      input_truncated: input.truncated, output_truncated: output.truncated,
      truncated: tool.truncated || input.truncated || output.truncated,
    });
    if (!prior) {
      data.recent_activities.push(activity);
      if (data.recent_activities.length > 5) data.recent_activities.shift();
    }
  };
  return { accept, snapshot: () => structuredClone(data), warn };
}

// Bound the pending record independently of raw file retention. Large/malformed
// records degrade observation; only a valid result event can complete a job.
export function createParser(onEvent, onWarning, maxRecord = 8 * 1024 * 1024) {
  const decoder = new StringDecoder('utf8');
  let pending = '', pendingBytes = 0, dropping = false;
  const consume = (text) => {
    for (const fragment of text.split(/(?<=\n)/)) {
      const end = fragment.endsWith('\n');
      if (!dropping) {
        const fragmentBytes = Buffer.byteLength(fragment);
        if (pendingBytes + fragmentBytes > maxRecord) {
          pending = ''; pendingBytes = 0; dropping = true; onWarning('Oversized record omitted from projection; see raw output.');
        } else { pending += fragment; pendingBytes += fragmentBytes; }
      }
      if (end) {
        if (!dropping && pending.trim()) {
          let event;
          try { event = JSON.parse(pending); } catch { onWarning('Malformed record retained in raw output.'); }
          if (event && typeof event === 'object') onEvent(event);
        }
        pending = ''; pendingBytes = 0; dropping = false;
      }
    }
  };
  return { write: (chunk) => consume(decoder.write(chunk)), end: () => consume(decoder.end() + '\n') };
}
