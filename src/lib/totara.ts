const API_ENDPOINT = '/totara-api/api/graphql.php'
const TOKEN_ENDPOINT = '/totara-api/totara/oauth2/token.php'

// ── Public types ─────────────────────────────────────────────────────────────

export interface Course {
  id: string
  title: string
  summary: string
  imageUrl?: string
  url: string
  skill_domains: string[]
  role_relevance: string[]
  proficiency_level: string
  compliance_flag: boolean
  estimated_duration: number
  skillArea?: string
  completion?: {
    statuskey: string | null
    timecompleted: string | null
  }
  raw_customfields: RawCustomField[]
}

export interface JobAssignment {
  id: string
  fullname: string
  userName: string
  position?: string
  organisation?: string
  manager?: { fullname: string }
}

// ── Internal types ────────────────────────────────────────────────────────────

interface RawCustomField {
  definition: { shortname: string }
  raw_value: string | null
}

interface RawCourse {
  id: number | string
  fullname: string
  summary?: string | null
  image?: string | null
  url: string
  completion?: {
    statuskey: string | null
    timecompleted: string | null
  } | null
  custom_fields?: RawCustomField[] | null
}

// ── OAuth token cache ─────────────────────────────────────────────────────────

interface TokenCache {
  token: string
  expiresAt: number
}

let tokenCache: TokenCache | null = null

export async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token
  }

  const clientId = import.meta.env.VITE_TOTARA_CLIENT_ID
  const clientSecret = import.meta.env.VITE_TOTARA_CLIENT_SECRET

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OAuth token request failed: ${res.status} ${res.statusText} — ${body}`)
  }

  const data = await res.json()

  if (!data.access_token) {
    throw new Error(`OAuth response missing access_token: ${JSON.stringify(data)}`)
  }

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  }

  console.log('[Totara] OAuth token acquired, expires in', data.expires_in, 'seconds')
  return tokenCache.token
}

// ── GraphQL request ───────────────────────────────────────────────────────────

async function gqlRequest<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const res = import.meta.env.DEV
    ? await (async () => {
        const token = await getAccessToken()
        return fetch(API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ query, variables }),
        })
      })()
    : await fetch('/api/totara', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      })

  if (!res.ok) {
    throw new Error(`Totara API error: ${res.status} ${res.statusText}`)
  }

  const json = await res.json()

  if (json.errors?.length) {
    const msg = json.errors.map((e: { message: string }) => e.message).join(', ')
    throw new Error(`Totara GraphQL error: ${msg}`)
  }

  return json.data as T
}

// ── getRawCatalogue ───────────────────────────────────────────────────────────

export async function getRawCatalogue(): Promise<unknown> {
  const token = await getAccessToken()

  const query = `
    query GetRawCatalogue($query: core_course_courses_query) {
      core_course_courses(query: $query) {
        total
        next_cursor
        items {
          id
          fullname
          summary
          image
          url
          completionenabled
          completion {
            status
            statuskey
            progress
            timecompleted
          }
          custom_fields {
            definition {
              shortname
              fullname
              type
            }
            raw_value
          }
        }
      }
    }
  `

  const res = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query,
      variables: { query: { pagination: { cursor: '', limit: 100 } } },
    }),
  })

  if (!res.ok) {
    throw new Error(`Totara API error: ${res.status} ${res.statusText}`)
  }

  return res.json() // return the full envelope including errors if any
}

// ── testConnection ────────────────────────────────────────────────────────────

export async function testConnection(): Promise<boolean> {
  try {
    await gqlRequest<{ totara_webapi_status: { status: string } }>(
      `query { totara_webapi_status { status } }`
    )
    return true
  } catch (err) {
    console.error('[Totara] testConnection failed:', err)
    return false
  }
}

// ── getCatalogue ──────────────────────────────────────────────────────────────

const COURSES_QUERY = `
  query GetCourses($query: core_course_courses_query) {
    core_course_courses(query: $query) {
      items {
        id
        fullname
        summary
        image
        url
        completion {
          statuskey
          timecompleted
        }
        custom_fields {
          definition { shortname }
          raw_value
        }
      }
      total
      next_cursor
    }
  }
`

function parseCustomFields(fields: RawCustomField[]): Partial<Course> {
  const get = (shortname: string): string =>
    fields.find((f) => f.definition.shortname === shortname)?.raw_value ?? ''

  const skill_domains_raw = get('skill_domains')
  const role_relevance_raw = get('role_relevance')
  const compliance_raw = get('compliance_flag')
  const skillAreaRaw = get('SkillArea')

  return {
    skill_domains: skill_domains_raw
      ? skill_domains_raw.split(',').map((s) => s.trim()).filter(Boolean)
      : [],
    role_relevance: role_relevance_raw
      ? role_relevance_raw.split(',').map((s) => s.trim()).filter(Boolean)
      : [],
    proficiency_level: get('proficiency_level'),
    compliance_flag: compliance_raw === '1' || compliance_raw.toLowerCase() === 'true',
    estimated_duration: parseInt(get('estimated_duration') || '0', 10) || 0,
    skillArea: skillAreaRaw || undefined,
  }
}

function parseCourse(item: RawCourse): Course {
  const customfields = item.custom_fields ?? []
  const parsed = parseCustomFields(customfields)

  return {
    id: String(item.id),
    title: item.fullname,
    summary: item.summary ?? '',
    imageUrl: item.image ?? undefined,
    url: item.url,
    completion: item.completion ?? undefined,
    ...parsed,
    raw_customfields: customfields,
  } as Course
}

export async function getCatalogue(): Promise<Course[]> {
  const allCourses: Course[] = []
  let cursor = ''

  do {
    const data = await gqlRequest<{
      core_course_courses: {
        items: RawCourse[]
        total: number
        next_cursor: string
      }
    }>(COURSES_QUERY, {
      query: { pagination: { cursor, limit: 100 } },
    })

    const result = data.core_course_courses
    allCourses.push(...result.items.map(parseCourse))
    cursor = result.next_cursor
  } while (cursor)

  return allCourses
}

// ── lookupUserByEmail ─────────────────────────────────────────────────────────

export async function lookupUserByEmail(email: string): Promise<{
  id: string
  fullname: string
  email: string
  profileImageUrl?: string
} | null> {
  // No email filter exists in core_user_users_filters — fetch all active users
  // and match client-side. Fine for teams up to ~500 users.
  const data = await gqlRequest<{
    core_user_users: {
      items: Array<{
        id: string | number
        fullname: string
        email: string
        profileimageurl?: string
      }>
      total: number
    }
  }>(
    `query LookupUsers($query: core_user_users_query) {
      core_user_users(query: $query) {
        items {
          id
          fullname
          email
          profileimageurl
        }
        total
      }
    }`,
    { query: { pagination: { cursor: '', limit: 500 } } }
  )

  const match = data.core_user_users.items.find(
    (u) => u.email.toLowerCase() === email.toLowerCase().trim()
  )

  if (!match) return null

  return {
    id: String(match.id),
    fullname: match.fullname,
    email: match.email,
    profileImageUrl: match.profileimageurl || undefined,
  }
}

// ── getDirectReports ─────────────────────────────────────────────────────────

export interface DirectReport {
  userId: string
  userName: string
  jobAssignmentId: string
  position?: string
}

export async function getDirectReports(managerJobAssignmentId: string): Promise<DirectReport[]> {
  const data = await gqlRequest<{
    totara_job_job_assignments: {
      items: Array<{
        id: string | number
        managerjaid: string | number | null
        user: { id: string | number; fullname: string } | null
        position: { fullname: string } | null
      }>
      total: number
      next_cursor: string
    }
  }>(
    `query GetAllJobAssignments($query: totara_job_job_assignments_query) {
      totara_job_job_assignments(query: $query) {
        items {
          id
          managerjaid
          user { id fullname }
          position { fullname }
        }
        total
        next_cursor
      }
    }`,
    { query: { pagination: { cursor: '', limit: 200 } } }
  )

  return data.totara_job_job_assignments.items
    .filter(
      (item) =>
        item.user &&
        item.managerjaid !== null &&
        item.managerjaid !== undefined &&
        String(item.managerjaid) === managerJobAssignmentId
    )
    .map((item) => ({
      userId: String(item.user!.id),
      userName: item.user!.fullname,
      jobAssignmentId: String(item.id),
      position: item.position?.fullname,
    }))
}

// ── getUserJobAssignment ──────────────────────────────────────────────────────

export async function getUserJobAssignment(userId: string): Promise<JobAssignment | null> {
  const data = await gqlRequest<{
    totara_job_job_assignment: {
      found: boolean
      job_assignment: {
        id: string
        fullname: string
        user?: { fullname: string } | null
        position?: { fullname: string } | null
        organisation?: { fullname: string } | null
        managerja?: {
          user?: { fullname: string } | null
        } | null
      } | null
    }
  }>(
    `query GetJobAssignment($target_job: totara_job_job_assignment_reference!) {
      totara_job_job_assignment(target_job: $target_job) {
        found
        job_assignment {
          id
          fullname
          user { fullname }
          position { fullname }
          organisation { fullname }
          managerja {
            user { fullname }
          }
        }
      }
    }`,
    { target_job: { user: { id: parseInt(userId, 10) } } }
  )

  const result = data.totara_job_job_assignment
  if (!result.found || !result.job_assignment) return null

  const ja = result.job_assignment
  return {
    id: String(ja.id),
    fullname: ja.fullname,
    userName: ja.user?.fullname ?? '',
    position: ja.position?.fullname,
    organisation: ja.organisation?.fullname,
    manager: ja.managerja?.user ? { fullname: ja.managerja.user.fullname } : undefined,
  }
}

// ── enrolUser ─────────────────────────────────────────────────────────────────

export async function enrolUser(
  courseId: string,
  userId: string
): Promise<{ wasAlreadyEnrolled: boolean }> {
  console.log(`[Totara] Enrolling user ${userId} in course ${courseId}`)

  const data = await gqlRequest<{
    enrol_manual_enrol_user: {
      success: boolean
      was_already_enrolled: boolean
    }
  }>(
    `mutation EnrolUser($input: enrol_manual_enrol_user_input!) {
      enrol_manual_enrol_user(input: $input) {
        success
        was_already_enrolled
      }
    }`,
    {
      input: {
        user: { id: parseInt(userId, 10) },
        course: { id: parseInt(courseId, 10) },
      },
    }
  )

  console.log('[Totara] Enrolment response:', data)

  const { success, was_already_enrolled } = data.enrol_manual_enrol_user

  if (!success && !was_already_enrolled) {
    throw new Error(
      'Enrolment returned success: false — check manual enrolment is enabled on this course in Totara admin'
    )
  }

  return { wasAlreadyEnrolled: was_already_enrolled }
}

export async function createGoal(name: string, userId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const ninetyDays = now + 90 * 24 * 60 * 60

  await gqlRequest(
    `mutation CreateGoal($input: perform_goal_create_input!) {
      perform_goal_create_goal(input: $input) {
        goal { id }
      }
    }`,
    {
      input: {
        name,
        user: { id: parseInt(userId, 10) },
        start_date: now,
        target_date: ninetyDays,
        target_value: 100,
        target_type: 'date',
        plugin_name: 'basic',
        status: 'not_started',
      },
    }
  )
}
