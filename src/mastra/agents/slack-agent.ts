import { Agent } from '@mastra/core/agent'
import { createSlackAdapter } from '@chat-adapter/slack'

export const slackAgent = new Agent({
  id: 'slack-agent',
  name: 'Slack Agent',
  instructions: `You are a helpful assistant living in Slack.
Answer questions clearly and concisely.
Use Slack-friendly formatting: short paragraphs, bullet points where useful.`,
  model: 'openrouter/openai/gpt-4o',
  channels: {
    adapters: {
      // Reads SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN from env automatically
      slack: createSlackAdapter(),
    },
  },
})
