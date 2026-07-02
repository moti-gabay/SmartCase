// Runs in Edge runtime — only imports auth.config.ts (no Prisma, no bcrypt).
// NextAuth re-creates a lightweight JWT-verifying instance from authConfig.
import NextAuth from "next-auth"
import { authConfig } from "./auth.config"

const { auth } = NextAuth(authConfig)

export default auth

export const config = {
  // Match all paths except Next.js internals and static files
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
