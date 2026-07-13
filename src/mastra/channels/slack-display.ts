import type { ToolDisplayFn } from '@mastra/core/channels'
import { defaultTypingStatus } from '@mastra/core/channels'

/**
 * Human-friendly rendering for Scout's tool activity in Slack.
 *
 * Streaming mode: emits `task_update` chunks that render as Slack's native
 * inline task timeline. Each tool call is one row, keyed by toolCallId, that
 * updates in place: in_progress -> complete/error. No raw JSON, no function
 * names - just what Scout is doing, in plain language.
 *
 * Static mode (fallback): posts a single short line when a tool finishes.
 */

const trim = (s: string, max = 90) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/** Pull the first string field out of unknown args (e.g. the delegation prompt). */
function firstString(args: unknown): string | undefined {
  if (typeof args === 'string') return args
  if (args && typeof args === 'object') {
    for (const v of Object.values(args as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) return v
    }
  }
  return undefined
}

function get(obj: unknown, key: string): unknown {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined
}

interface TaskCopy {
  running: string
  done: string
  details?: string
  output?: string
}

/** Map a tool event to human copy. Returns null to hide the tool entirely. */
function copyFor(event: {
  toolName: string
  args: unknown
  result?: unknown
}): TaskCopy | null {
  const { toolName, args, result } = event

  if (toolName === 'agent-researcher') {
    const question = firstString(args)
    return {
      running: '🔎 Researching',
      done: '🔎 Research complete',
      details: question ? trim(question) : undefined,
    }
  }

  if (toolName.includes('listSlackChannels') || toolName.includes('list-slack-channels')) {
    const channels = get(result, 'channels')
    const count = Array.isArray(channels) ? channels.length : undefined
    return {
      running: '📡 Looking up channels',
      done: count ? `📡 Found ${count} channels` : '📡 Channels found',
    }
  }

  if (toolName.includes('fetchSlackMessages') || toolName.includes('fetch-slack-messages')) {
    const channel = firstString(args)
    const messages = get(result, 'messages')
    const count = Array.isArray(messages) ? messages.length : undefined
    return {
      running: channel ? `📥 Reading #${channel.replace(/^#/, '')}` : '📥 Reading channel',
      done: count
        ? `📥 Read ${count} message${count === 1 ? '' : 's'}`
        : '📥 Channel read',
      details: channel ? `#${channel.replace(/^#/, '')}` : undefined,
    }
  }

  if (toolName.includes('createNotionIdea') || toolName.includes('create-notion-idea')) {
    const title = get(args, 'title')
    const url = get(result, 'url')
    return {
      running: '📝 Saving to Notion',
      done: '📝 Saved to Notion',
      details: typeof title === 'string' ? trim(title, 70) : undefined,
      output: typeof url === 'string' ? url : undefined,
    }
  }

  // Built-in channel tools (add_reaction etc.) - not worth a timeline row
  if (toolName.includes('reaction')) return null

  // Unknown tools: readable generic fallback
  const pretty = event.toolName
    .replace(/^(agent-|workflow-)/, '')
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
  return { running: `⚙️ Working: ${pretty}`, done: `⚙️ Done: ${pretty}` }
}

export const slackToolDisplay: ToolDisplayFn = (event, ctx) => {
  // Approval prompts always render as their own interactive card - skip here.
  if (event.kind === 'approval') return undefined

  const copy = copyFor(event)
  if (!copy) return undefined

  if (ctx.mode === 'streaming') {
    if (event.kind === 'running') {
      return {
        kind: 'stream',
        chunk: {
          type: 'task_update',
          id: event.toolCallId,
          title: copy.running,
          status: 'in_progress',
          details: copy.details,
        },
      }
    }
    if (event.kind === 'result') {
      return {
        kind: 'stream',
        chunk: {
          type: 'task_update',
          id: event.toolCallId,
          title: event.isError ? `${copy.running} failed` : copy.done,
          status: event.isError ? 'error' : 'complete',
          details: copy.details,
          output: copy.output,
        },
      }
    }
    // error
    return {
      kind: 'stream',
      chunk: {
        type: 'task_update',
        id: event.toolCallId,
        title: `${copy.running} failed`,
        status: 'error',
        details: trim(event.errorText, 140),
      },
    }
  }

  // Static fallback: one concise line per finished tool, nothing while running.
  if (event.kind === 'result') {
    if (event.isError) {
      return { kind: 'post', message: `${copy.running} failed — ${trim(event.resultText, 140)}` }
    }
    const line = copy.output ? `${copy.done} — ${copy.output}` : copy.done
    return { kind: 'post', message: line }
  }
  if (event.kind === 'error') {
    return { kind: 'post', message: `${copy.running} failed — ${trim(event.errorText, 140)}` }
  }
  return undefined
}

/** Typing indicator copy while Scout works. */
export const slackTypingStatus = (
  chunk: Parameters<typeof defaultTypingStatus>[0],
  ctx: Parameters<typeof defaultTypingStatus>[1],
) => {
  if (chunk.type === 'tool-call') {
    const toolName = (chunk.payload as { toolName?: string })?.toolName ?? ''
    if (toolName === 'agent-researcher') return 'is researching…'
    if (toolName.includes('fetchSlackMessages')) return 'is reading the channel…'
    if (toolName.includes('listSlackChannels')) return 'is looking up channels…'
    if (toolName.includes('createNotionIdea')) return 'is saving to Notion…'
  }
  return defaultTypingStatus(chunk, ctx)
}
