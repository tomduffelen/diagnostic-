import type { Course } from './totara'
import { isExcludedCourse } from './matcher'

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export interface GapProfile {
  gaps: Array<{
    domain: string
    severity: 'compliance' | 'development' | 'aspiration'
    summary: string
    course?: string
    reason?: string
  }>
  strengths: Array<{ domain: string; note: string }>
}

export interface DiagnosticSubjectContext {
  userName: string
  isManagerMode: boolean
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function buildSystemPrompt(
  catalogue: Course[],
  selectedRoles: string[],
  subject?: DiagnosticSubjectContext
): string {
  const validCatalogue = catalogue.filter((c) => !isExcludedCourse(c))

  const courseList = validCatalogue
    .map((c) => {
      const summary = c.summary ? ` | summary: ${stripHtml(c.summary).slice(0, 80)}` : ''
      const skillArea = c.skillArea ? ` | area: ${c.skillArea}` : ''
      return `- "${c.title}"${skillArea} | domains: ${c.skill_domains.join(', ') || 'general'} | compliance: ${c.compliance_flag} | duration: ${c.estimated_duration}min${summary}`
    })
    .join('\n')

  let roleContext: string
  let framingContext: string

  if (subject?.isManagerMode) {
    const name = subject.userName
    const roleStr = selectedRoles.length > 0 ? selectedRoles.join(', ') : 'a member of your team'
    roleContext = `You are assessing ${name} (${roleStr}) on behalf of their manager. Do NOT ask about their role — it is already known.`
    framingContext = `IMPORTANT — manager-proxy mode:
- The person answering is a MANAGER assessing a TEAM MEMBER named ${name}.
- Frame ALL questions around OBSERVED BEHAVIOUR, not self-reflection.
- Use language like: "How does ${name} handle...", "When ${name} faces...", "Have you observed ${name}..."
- For confidence checks, use: "How would you rate ${name}'s comfort with [skill]?" with options: Not yet / Getting there / Confident.
- Do NOT use "How confident are you", "Tell me about your own experience", or any first-person framing.
- The gap profile should describe ${name}'s gaps as observed by their manager.
- Acknowledge at the start that this is a manager-led assessment for ${name}.`
  } else {
    const roleStr = selectedRoles.length > 0 ? selectedRoles.join(', ') : null
    roleContext = roleStr
      ? `The learner's role(s) are already known: ${roleStr}. Do NOT ask about their role. Acknowledge briefly and immediately start diagnosing skill gaps relevant to ${selectedRoles.length === 1 ? 'this role' : 'these roles'}.`
      : `Start by asking their role.`
    framingContext = ''
  }

  const firstName = subject?.userName?.split(' ')[0] ?? ''
  const closingLine = firstName
    ? `Great, ${firstName} — I have everything I need. Tap below to see your results.`
    : `Great — I have everything I need. Tap below to see your results.`

  return `You are Compass, a leadership development coach.

Have a warm, adaptive conversation to identify leadership skill gaps, then output a gap profile.

RULES:
- Ask ONE question at a time. Be warm, brief, conversational, but professional.
- VARY which leadership domains you explore first — randomise so repeat users don't see identical flows. Domains include: delegation, giving feedback, difficult conversations, prioritisation, coaching and developing others, decision-making under pressure, managing change, stakeholder influence, and team resilience/wellbeing.
- ROTATE question types naturally — never use the same format twice in a row:
  1. Scenario: present a realistic situation ("A team member misses the same deadline for the third time — what do you do first?")
  2. Multiple choice: use the <mc_question> format below
  3. Open reflection: ask about a real experience ("Tell me about a time you had to give someone difficult feedback — how did you handle it?")
  4. Confidence check: "How comfortable are you with [skill]?" with options Not yet / Getting there / Confident
- BRANCHING: If a learner shows uncertainty or a gap in an area, ask at least one deeper follow-up before moving on. If clearly confident, move on without probing.
- ADAPTIVE LENGTH: 5–8 exchanges is typical. Go longer if multiple gaps need probing. Go shorter if the learner is competent across all areas. Never pad with unnecessary questions.
- Only reference courses that exist in the catalogue below. Use exact course titles.

${roleContext}

${framingContext}

MULTIPLE CHOICE FORMAT — when you want to ask a multiple-choice question, output EXACTLY this structure. You may write one brief sentence of context BEFORE the block; write nothing after it until the learner replies:
<mc_question>
{"question":"...the question text...","options":["Option A","Option B","Option C","Option D"]}
</mc_question>

Example:
<mc_question>
{"question":"A team member misses the same deadline for the third time. What do you do first?","options":["Set a firm final deadline and escalate if missed","Have a private conversation to understand what's blocking them","Reassign the work to someone else","Raise it in the next team meeting"]}
</mc_question>

Available courses in this organisation's Totara catalogue:
${courseList}

When you have enough information, output ONLY the following — nothing else after it:

<gap_profile>
{
  "gaps": [
    {
      "domain": "difficult conversations",
      "severity": "compliance",
      "summary": "Must complete mandatory people management certification before line-managing others",
      "course": "Core Compliance Fundamentals",
      "reason": "You mentioned avoiding a direct conversation about underperformance — this course covers the mandatory people management certification required for line managers."
    },
    {
      "domain": "delegation",
      "severity": "development",
      "summary": "Would benefit from structured technique training",
      "course": "Advanced Assessment",
      "reason": "When you described how you handle handovers, it came through that delegation is mostly ad hoc — this course gives you a structured, graded framework."
    }
  ],
  "strengths": [
    { "domain": "team communication", "note": "Good grasp of setting clear expectations and checking understanding" }
  ]
}
</gap_profile>
${closingLine}

severity: "compliance" | "development" | "aspiration"
For each gap: include "course" (exact catalogue title) and "reason" (one or two plain-English sentences explaining why THIS course was chosen, referencing something specific the person said in the conversation).
After the closing </gap_profile> tag write ONLY the sentence above. Do NOT summarise. Do NOT list gaps or courses. Nothing else.`
}

export function extractGapProfile(text: string): GapProfile | null {
  const match = text.match(/<gap_profile>([\s\S]*?)<\/gap_profile>/)
  if (!match) return null

  try {
    return JSON.parse(match[1].trim()) as GapProfile
  } catch (err) {
    console.error('[Diagnostic] Failed to parse gap_profile JSON:', err)
    return null
  }
}

export async function sendMessage(
  history: Message[],
  catalogue: Course[],
  selectedRoles: string[] = [],
  subject?: DiagnosticSubjectContext
): Promise<string> {
  let seedContent: string
  if (subject?.isManagerMode) {
    const roleStr = selectedRoles.length > 0 ? selectedRoles.join(', ') : 'a member of my team'
    seedContent = `I'm completing this assessment on behalf of my team member ${subject.userName}, who works as ${roleStr}.`
  } else if (selectedRoles.length > 0) {
    seedContent = `I work as ${selectedRoles.join(' and ')}.`
  } else {
    seedContent = 'Hi'
  }

  const messages = history.length > 0 ? history : [{ role: 'user' as const, content: seedContent }]

  const body = JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: 1500,
    system: buildSystemPrompt(catalogue, selectedRoles, subject),
    messages,
  })

  const res = import.meta.env.DEV
    ? await fetch('/anthropic-api/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body,
      })
    : await fetch('/api/anthropic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.content[0].text as string
}
