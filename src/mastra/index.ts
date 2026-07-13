import { Mastra } from '@mastra/core/mastra'
import { SimpleAuth } from '@mastra/core/server'
import { LibSQLStore } from '@mastra/libsql'
import { PostgresStore } from '@mastra/pg'
import { slackAgent } from './agents/slack-agent'

// Postgres in production (Railway), local file for dev
const storage = process.env.DATABASE_URL?.startsWith('postgres')
  ? new PostgresStore({
      id: 'mastra-storage',
      connectionString: process.env.DATABASE_URL,
    })
  : new LibSQLStore({
      id: 'mastra-storage',
      url: process.env.DATABASE_URL ?? 'file:./mastra.db',
    })

export const mastra = new Mastra({
  agents: { slackAgent },
  // Persists memory, channel state, and thread subscriptions
  storage,
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
