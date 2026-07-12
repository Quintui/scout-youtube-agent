import { Mastra } from '@mastra/core/mastra'
import { SimpleAuth } from '@mastra/core/server'
import { LibSQLStore } from '@mastra/libsql'
import { slackAgent } from './agents/slack-agent'

export const mastra = new Mastra({
  agents: { slackAgent },
  // Persists channel state, thread subscriptions, and memory across restarts
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: process.env.DATABASE_URL ?? 'file:./mastra.db',
  }),
  server: {
    auth: new SimpleAuth({
      // All /api/* routes require this token (Authorization: Bearer <token>)
      tokens: {
        [process.env.MASTRA_API_KEY!]: { id: 'admin', name: 'Admin' },
      },
      // Channel webhooks must stay reachable by Slack. They are protected
      // separately by Slack's HMAC request signing (SLACK_SIGNING_SECRET).
      public: [/^\/api\/agents\/[^/]+\/channels\/[^/]+\/webhook$/],
    }),
  },
})

