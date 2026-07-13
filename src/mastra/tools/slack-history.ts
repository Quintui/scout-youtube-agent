import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

const SLACK_API = 'https://slack.com/api'

async function slackFetch(method: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${SLACK_API}/${method}${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  })
  const data = await res.json()
  if (!data.ok) throw new Error(`Slack API ${method} failed: ${data.error}`)
  return data
}

// Cache user ID -> display name lookups for the process lifetime
const userNameCache = new Map<string, string>()

async function resolveUserName(userId: string): Promise<string> {
  if (userNameCache.has(userId)) return userNameCache.get(userId)!
  try {
    const data = await slackFetch('users.info', { user: userId })
    const name =
      data.user?.profile?.display_name || data.user?.real_name || data.user?.name || userId
    userNameCache.set(userId, name)
    return name
  } catch {
    return userId
  }
}

export const listSlackChannels = createTool({
  id: 'list-slack-channels',
  description:
    'Lists public Slack channels in the workspace, including whether the bot is a member. Use this to resolve a channel name to an ID before fetching messages.',
  inputSchema: z.object({}),
  execute: async () => {
    const data = await slackFetch('conversations.list', {
      types: 'public_channel',
      exclude_archived: 'true',
      limit: '200',
    })
    return {
      channels: (data.channels as any[]).map(c => ({
        id: c.id as string,
        name: c.name as string,
        botIsMember: Boolean(c.is_member),
        topic: (c.topic?.value as string) || undefined,
      })),
    }
  },
})

export const fetchSlackMessages = createTool({
  id: 'fetch-slack-messages',
  description:
    'Fetches recent messages from a Slack channel the bot is a member of. Accepts a channel ID (preferred, e.g. C0123ABC) or a channel name. Returns messages newest-first with author names and timestamps. Only works for channels the bot has been invited to.',
  inputSchema: z.object({
    channel: z.string().describe('Channel ID (C...) or channel name (without #)'),
    limit: z.number().int().min(1).max(100).default(30).describe('How many messages to fetch'),
  }),
  execute: async ({ channel, limit }) => {
    let channelId = channel
    // Resolve a channel name to an ID
    if (!/^C[A-Z0-9]+$/.test(channel)) {
      const list = await slackFetch('conversations.list', {
        types: 'public_channel',
        exclude_archived: 'true',
        limit: '200',
      })
      const match = (list.channels as any[]).find(
        c => c.name === channel.replace(/^#/, '').toLowerCase(),
      )
      if (!match) throw new Error(`Channel "${channel}" not found`)
      channelId = match.id
    }

    const data = await slackFetch('conversations.history', {
      channel: channelId,
      limit: String(limit),
    })

    const messages = await Promise.all(
      (data.messages as any[])
        .filter(m => m.type === 'message' && m.text)
        .map(async m => ({
          author: m.user ? await resolveUserName(m.user) : (m.username ?? 'unknown'),
          text: m.text as string,
          time: new Date(Number(m.ts) * 1000).toISOString(),
          isThreadParent: Boolean(m.reply_count),
          replyCount: (m.reply_count as number) ?? 0,
        })),
    )

    return { channelId, messages }
  },
})
