import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

type NotionBlock = Record<string, unknown>

function richText(content: string) {
  // Notion caps rich_text content at 2000 chars per block
  return [{ type: 'text', text: { content: content.slice(0, 2000) } }]
}

/** Minimal markdown -> Notion blocks (headings, bullets, paragraphs). */
function markdownToBlocks(markdown: string): NotionBlock[] {
  const blocks: NotionBlock[] = []
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('### ')) {
      blocks.push({ heading_3: { rich_text: richText(line.slice(4)) } })
    } else if (line.startsWith('## ')) {
      blocks.push({ heading_2: { rich_text: richText(line.slice(3)) } })
    } else if (line.startsWith('# ')) {
      blocks.push({ heading_1: { rich_text: richText(line.slice(2)) } })
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({ bulleted_list_item: { rich_text: richText(line.slice(2)) } })
    } else {
      blocks.push({ paragraph: { rich_text: richText(line) } })
    }
  }
  // Notion allows max 100 children per create-page request
  return blocks.slice(0, 100)
}

async function notionFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Notion API ${res.status}: ${body}`)
  }
  return res.json()
}

export const createNotionIdea = createTool({
  id: 'create-notion-idea',
  description:
    'Creates a page in the YouTube video ideas Notion database with the idea title, the full research brief as page content, and video metadata properties. Only call this after the user has confirmed the brief.',
  inputSchema: z.object({
    title: z.string().describe('Short, clear video idea title for the Notion page'),
    report: z
      .string()
      .describe('Full research brief in markdown: angles, validation, titles, hook'),
    bucket: z
      .enum(['AI concepts', 'AI SDK specific', 'Mastra specific', 'Product development'])
      .describe('Which content bucket this video idea belongs to'),
    excitement: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe('How exciting this idea is, 1-5, based on the research verdict'),
    confidence: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe('Confidence the video will perform, 1-5, based on validation evidence'),
    effort: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe('Estimated production effort, 1-5 (5 = most effort)'),
  }),
  requireApproval: true,
  execute: async ({ title, report, bucket, excitement, confidence, effort }) => {
    const databaseId = process.env.NOTION_DATABASE_ID
    if (!process.env.NOTION_API_KEY || !databaseId) {
      throw new Error('NOTION_API_KEY and NOTION_DATABASE_ID must be set')
    }

    // Discover the title property name (varies per database: "Name", "Title", ...)
    const db = await notionFetch(`/databases/${databaseId}`)
    const titleProp = Object.entries(db.properties as Record<string, { type: string }>).find(
      ([, prop]) => prop.type === 'title',
    )?.[0]
    if (!titleProp) throw new Error('No title property found on the Notion database')

    const properties: Record<string, unknown> = {
      [titleProp]: { title: richText(title) },
      Status: { select: { name: 'Needs Research' } },
      Format: { select: { name: 'Long form' } },
      Bucket: { select: { name: bucket } },
    }
    if (excitement) properties.Excitement = { select: { name: String(excitement) } }
    if (confidence) properties.Confidence = { select: { name: String(confidence) } }
    if (effort) properties.Effort = { select: { name: String(effort) } }

    const page = await notionFetch('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties,
        children: markdownToBlocks(report),
      }),
    })

    return { url: page.url as string, pageId: page.id as string }
  },
})
