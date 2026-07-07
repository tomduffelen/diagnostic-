# Compass — POC

An AI-powered leadership skills diagnostic tool. Compass connects to a live Totara 20 LMS, pulls the real course catalogue, runs a conversational leadership skill diagnostic via Claude, and enrols learners directly into recommended courses — all from a mobile-friendly web app.

---

## What this POC proves

1. **Real catalogue integration** — The app pulls live course data from Totara 20 via the external GraphQL API and injects it into Claude's context, so AI recommendations reference real courses by exact title.
2. **End-to-end enrolment** — Tapping Enrol fires the `enrol_manual_enrol_user` mutation and the learner appears in the course in Totara within seconds.

These two things were the success criteria. Both work.

---

## What this POC does not prove

- Manager views or approval workflows
- Real user authentication (single learner ID hardcoded in `.env`)
- Gap profiles written back to Totara
- Offline capability
- Course completion tracking (the OAuth client credentials flow has no user context, so completion is always null)
- Production security (API keys are in browser-side code — fine for a POC, not for production)

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript |
| Styling | Tailwind CSS v3 + Space Mono font |
| State | Zustand (with localStorage persistence) |
| AI | Anthropic Claude (`claude-sonnet-4-5`) |
| LMS | Totara 20 external GraphQL API |
| CORS | Vite dev proxy (both Totara and Anthropic) |
| PWA | vite-plugin-pwa |

> **Node version note:** Vite 8 requires Node 20.19+. This project is pinned to Vite 5.4 to support Node 20.15. Do not upgrade Vite without upgrading Node first.

---

## Project structure

```
src/
  lib/
    totara.ts       — all Totara API calls (OAuth, catalogue, enrolment, job assignment)
    diagnostic.ts   — Claude API integration, system prompt builder, gap profile parser
    matcher.ts      — matches AI-recommended course titles to catalogue IDs
  pages/
    HomeScreen.tsx        — / landing page
    DiagnosticScreen.tsx  — /diagnostic chat interface
    ResultsScreen.tsx     — /results gap profile + course cards + enrol buttons
    CoursesScreen.tsx     — /courses enrolled courses list
    DebugScreen.tsx       — /debug API test panel (dev only)
    SetupScreen.tsx       — shown when .env vars are missing
  store.ts          — Zustand store (catalogue, messages, gapProfile, enrolledCourseIds)
  App.tsx           — router + env var guard
  main.tsx          — app entry point
```

---

## Prerequisites

- Totara 20 instance with the external API enabled
- Totara OAuth2 API client (client ID + secret)
- Anthropic API key
- Node.js 18 or 20 (not 20.19+ — see note above)

---

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create `.env.local`

```env
VITE_TOTARA_URL=https://your-totara-site.com
VITE_TOTARA_CLIENT_ID=your-oauth-client-id
VITE_TOTARA_CLIENT_SECRET=your-oauth-client-secret
VITE_ANTHROPIC_API_KEY=your-anthropic-key
VITE_LEARNER_USER_ID=6
```

All five are required. On startup, if any are missing the app shows a setup screen explaining what each one is and how to get it.

### 3. Run

```bash
npm run dev
```

Opens on `http://localhost:5173`.

---

## Getting Totara API credentials

### Create an OAuth2 API client

1. Log in to Totara as admin
2. Navigate to **Admin → API Clients**
3. Click **Add client**
4. Give it a name (e.g. "Jeeves POC") and save
5. Copy the **client_id** and **client_secret** into your `.env.local`

The API client user needs permissions to:
- Read courses (`core_course_courses`)
- Read job assignments (`totara_job_job_assignment`)
- Enrol users (`enrol_manual_enrol_user`)

### Enable manual enrolment on test courses

The enrolment mutation only works if manual enrolment is enabled on the course:

1. Open the course in Totara
2. Go to **Course administration → Users → Enrolment methods**
3. Enable **Manual enrolments** (click the eye icon if it is disabled)

Do this on at least one course before testing enrolment.

---

## How the Totara API works (what we learned)

The Totara 20 external API is a proper GraphQL API, different from the older internal AJAX API (`/totara/webapi/ajax.php`). Key facts discovered during this build:

### Endpoint

```
POST https://YOUR-SITE-URL/api/graphql.php
```

### Authentication — OAuth 2.0 client credentials

```bash
# Step 1: get a token
curl -X POST 'https://YOUR-SITE-URL/totara/oauth2/token.php' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=client_credentials&client_id=ID&client_secret=SECRET'

# Response: { "access_token": "...", "expires_in": 86400 }

# Step 2: use the token on every request
Authorization: Bearer YOUR-ACCESS-TOKEN
```

Tokens expire in 86400 seconds (24 hours). The app caches the token in memory and re-fetches 60 seconds before expiry.

### Request format

```json
{
  "query": "query { totara_webapi_status { status } }",
  "variables": {}
}
```

Standard GraphQL. No `operationName` required.

### Catalogue query

```graphql
query GetCourses($query: core_course_courses_query) {
  core_course_courses(query: $query) {
    items {
      id
      fullname
      summary
      image
      url
      completion { statuskey timecompleted }
      custom_fields {
        definition { shortname }
        raw_value
      }
    }
    total
    next_cursor
  }
}
```

Variables: `{ "query": { "pagination": { "cursor": "", "limit": 100 } } }`

Pagination is cursor-based. Loop until `next_cursor` is empty.

**Field name gotchas:**
- Course name is `fullname`, not `title`
- Course image is a plain `String` URL, not `image { url }`
- Custom fields are `custom_fields { definition { shortname } raw_value }`, not `customfields { shortname data }`

### Enrolment mutation

```graphql
mutation EnrolUser($input: enrol_manual_enrol_user_input!) {
  enrol_manual_enrol_user(input: $input) {
    success
    was_already_enrolled
  }
}
```

Variables:
```json
{
  "input": {
    "user": { "id": 6 },
    "course": { "id": 7 }
  }
}
```

Pass IDs as integers, not strings. The response includes `was_already_enrolled` — the app treats this as a success rather than an error.

### Job assignment query

```graphql
query GetJobAssignment($target_job: totara_job_job_assignment_reference!) {
  totara_job_job_assignment(target_job: $target_job) {
    found
    job_assignment {
      id
      fullname
      position { fullname }
      organisation { fullname }
      managerja { user { fullname } }
    }
  }
}
```

Variables: `{ "target_job": { "user": { "id": 6 } } }`

The plural `totara_job_job_assignments` query does not support filtering by user — you must use the singular form with `target_job: { user: { id: N } }`.

### Custom fields

Custom fields on `core_course` return `totara_customfield_field` objects with this shape:
```graphql
custom_fields {
  definition { shortname }   # the field name, e.g. "skill_domains"
  raw_value                  # the value as a raw string
}
```

The app looks for these shortnames: `skill_domains`, `role_relevance`, `proficiency_level`, `compliance_flag`, `estimated_duration`. If they don't exist on a course, the app falls back gracefully to empty defaults. Currently no custom fields are set on courses in the test instance, so AI recommendations are based on course titles only.

---

## How the AI diagnostic works

1. On load, the app fetches the full course catalogue from Totara
2. The catalogue is injected into Claude's system prompt as a course list
3. Claude (`claude-sonnet-4-5`) runs a 4–6 exchange conversation to identify skill gaps
4. When ready, Claude outputs a `<gap_profile>` JSON block containing gaps, strengths, and recommended course titles (exact titles from the catalogue)
5. The gap profile is extracted from the response and stored in Zustand
6. The matcher looks up each recommended title in the catalogue to get the real course ID for enrolment

The system prompt instructs Claude to only recommend courses that exist in the catalogue by exact title, which makes the title-based matching reliable.

---

## The /debug screen

The debug screen at `/debug` (visible as `[debug]` in the footer in dev mode) lets you test every API call individually before using the main app. Always run this first when setting up a new environment.

**Steps (run in order):**

1. **OAuth token** — fires the token request and shows the first 20 characters of the token
2. **Connection** — queries `totara_webapi_status { status }`, confirms the API is reachable
3. **Catalogue** — runs `core_course_courses`, shows course count and titles, reports custom fields
4. **Job assignment** — queries the test user's job assignment (name, position, manager)
5. **Enrolment** — enter a course ID and fire the enrolment mutation; shows `success` and `was_already_enrolled`

Each result has a "Show raw" toggle to inspect the full JSON response.

---

## CORS — how it's solved

All external API calls go through the Vite dev proxy, so no browser CORS restrictions apply:

```
Browser → localhost:5173/totara-api/...  → proxy → https://your-totara.com/...
Browser → localhost:5173/anthropic-api/... → proxy → https://api.anthropic.com/...
```

The Anthropic proxy additionally strips the `Origin` and `Referer` headers so Anthropic doesn't detect it as a browser CORS request and block it.

This proxy only exists in development (`npm run dev`). In production (Vercel), the app instead calls two serverless functions — `api/totara.js` and `api/anthropic.js` — which hold the secrets server-side and proxy the same requests. `src/lib/totara.ts` and `src/lib/diagnostic.ts` pick the right path automatically based on `import.meta.env.DEV`.

---

## Accessing from another machine (ngrok)

### Run ngrok

```bash
npx ngrok http 5173
```

Ngrok gives you a public HTTPS URL like `https://abc123.ngrok-free.app`. Open that on any device on any network.

### Vite configuration required

Three settings are needed for ngrok to work correctly:

```typescript
server: {
  allowedHosts: true,      // accepts requests from any hostname (not just localhost)
  hmr: { clientPort: 443 }, // tells Vite's hot-reload to connect on HTTPS port 443
  ...
}
```

Without `allowedHosts: true`, Vite blocks the request with "This host is not allowed."
Without `hmr: { clientPort: 443 }`, the page loads but you get ERR_NGROK_8012 because the HMR WebSocket tries to connect on `ws://localhost:5173` instead of `wss://your-ngrok-url.ngrok-free.app`.

### Start the dev server with `--host`

```bash
npm run dev -- --host
```

This makes Vite listen on all network interfaces (not just localhost), which ngrok requires.

### Free ngrok limitations

- The URL changes every time you restart ngrok (paid plan gets a fixed subdomain)
- The Vite proxy runs server-side on your machine — Totara and Anthropic API calls work fine through the tunnel
- Keep your machine awake and `npm run dev` running for the tunnel to stay alive

---

## App screens

### `/` — Home
Shows either a "Run diagnostic" CTA (first visit) or the last gap profile summary with options to view results, run again, or go to enrolled courses.

### `/diagnostic` — Chat
Loads the Totara catalogue, then opens a Claude conversation. Messages render markdown. When Claude outputs a `<gap_profile>` block (after 4–6 exchanges), the raw JSON is hidden and a "View results" button appears.

### `/results` — Gap profile + courses
Shows identified gaps with severity (Required / Develop / Stretch), strengths, and matched course cards from the real Totara catalogue. Each card has an **Enrol** button that fires the mutation. After enrolment, the button changes to "✓ ENROLLED" with an "Open in Totara" link.

### `/courses` — Enrolled courses
Lists courses the user has enrolled in during this session, with a direct link to each course in Totara.

### `/debug` — API test panel
Dark-themed developer screen. Tests OAuth, connection, catalogue, job assignment, and enrolment in sequence. Raw JSON toggle on each result. Only visible in dev mode.

---

## Outstanding items before production

### Security
- **API keys in the browser during local dev only** — in `npm run dev`, `VITE_ANTHROPIC_API_KEY` and `VITE_TOTARA_CLIENT_SECRET` are still embedded in the client bundle (fine for local testing). In production, `api/totara.js` and `api/anthropic.js` hold these secrets server-side instead, so the deployed bundle never contains them.

### Authentication
- **Hardcoded learner ID** — `VITE_LEARNER_USER_ID` is a single integer set in `.env`. A production version needs SSO or at minimum a login step that maps the session to a Totara user ID.

### Totara custom fields
- **No custom fields set yet** — The AI currently recommends courses based on titles only, because no courses have `skill_domains`, `compliance_flag`, or `estimated_duration` custom fields configured. Once those are tagged in Totara admin, the system prompt will include that metadata and recommendations will be more precise.

### Completion data
- **Always null via OAuth** — The `completion` field on `core_course` reflects the current user's completion state, but with OAuth client credentials (no end-user context) it is always null. To show real completion status, the API call would need to be made in the context of the learner — either via a user-delegated token or a separate admin API call filtered by user ID.

### Infrastructure
- **No deployment target** — The app runs as a Vite dev server. Production would need a proper build (`npm run build`) deployed to a static host (Vercel, Netlify, S3) with the Vite proxy replaced by a real backend.

---

## Quick reference

```bash
# Install
npm install

# Run locally
npm run dev

# Run accessible on network (for ngrok or local mobile testing)
npm run dev -- --host

# Type check
npx tsc --noEmit

# Build for production
npm run build
```

Environment variables required in `.env.local`:

| Variable | Description |
|---|---|
| `VITE_TOTARA_URL` | Full URL of the Totara site, no trailing slash |
| `VITE_TOTARA_CLIENT_ID` | OAuth2 client ID from Totara API Clients admin |
| `VITE_TOTARA_CLIENT_SECRET` | OAuth2 client secret |
| `VITE_ANTHROPIC_API_KEY` | Anthropic API key from console.anthropic.com |
| `VITE_LEARNER_USER_ID` | Totara user ID (integer) for the test learner |
