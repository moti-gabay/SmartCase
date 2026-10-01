// Mobile login: credentials → Auth.js session JWT, returned in the body instead
// of a Set-Cookie. The native app stores it in the device keychain and sends it
// back as `Cookie: <cookieName>=<token>`, so `auth()` in every existing Route
// Handler decodes it unchanged — including the throttled status re-check that
// revokes suspended users. The salt MUST equal the cookie name Auth.js would
// have used for this request (secure-prefixed on HTTPS) or `auth()` cannot
// decode the token. Node runtime only: never import from middleware.
import { NextResponse } from "next/server"
import { encode } from "next-auth/jwt"
import { z } from "zod"
import { STAFF_ROLES } from "@/lib/authz"
import { verifyCredentials, checkLoginRate } from "@/lib/services/credentials"
import type { UserRole } from "@/types"

const schema = z.object({
  email:    z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
})

const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60 // Auth.js default

function sessionCookieName(reqUrl: string): string {
  const secure = new URL(reqUrl).protocol === "https:"
  return `${secure ? "__Secure-" : ""}authjs.session-token`
}

const clientKey = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown"

export async function POST(req: Request) {
  if (!checkLoginRate(clientKey(req))) {
    return NextResponse.json({ error: "יותר מדי ניסיונות — נסה שוב בעוד דקה" }, { status: 429 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "נתונים לא תקינים" }, { status: 400 })
  }

  const secret = process.env.AUTH_SECRET
  if (!secret) {
    console.error("[auth/login] AUTH_SECRET is not set")
    return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 })
  }

  const outcome = await verifyCredentials(parsed.data.email, parsed.data.password)
  if (!outcome.ok) {
    if (outcome.reason === "invalid") {
      return NextResponse.json({ error: "אימייל או סיסמה שגויים" }, { status: 401 })
    }
    const error = outcome.reason === "suspended" ? "החשבון הושעה" : "החשבון ממתין לאישור מנהל"
    return NextResponse.json({ error, code: outcome.reason }, { status: 403 })
  }

  // Staff-only surface — same rule as requireStaffSession(), enforced at issue
  // time so a CLIENT never holds a token at all.
  const { user } = outcome
  if (!STAFF_ROLES.includes(user.role as UserRole)) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 })
  }

  // Same claims auth.ts's jwt() seeds on a browser sign-in.
  const cookieName = sessionCookieName(req.url)
  const now = Date.now()
  const token = await encode({
    token: {
      sub: user.id,
      name: user.name,
      email: user.email,
      id: user.id,
      role: user.role,
      status: user.status,
      statusCheckedAt: now,
    },
    secret,
    salt: cookieName,
    maxAge: SESSION_MAX_AGE_S,
  })

  return NextResponse.json({
    token,
    cookieName,
    expiresAt: new Date(now + SESSION_MAX_AGE_S * 1000).toISOString(),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  })
}
