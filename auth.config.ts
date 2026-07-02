// Edge-safe auth config — no Node.js-only imports (Prisma, bcrypt, etc.).
// Imported by middleware.ts (Edge runtime) and extended by auth.ts (Node.js).
import type { NextAuthConfig } from "next-auth"

export const authConfig = {
  // Trust the deployment host header. Required for `next start` and proxied
  // deployments (Vercel sets this automatically, self-hosted does not).
  trustHost: true,

  pages: {
    signIn: "/login",
  },

  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const path = nextUrl.pathname

      const isProtected =
        path.startsWith("/dashboard") ||
        path.startsWith("/cases") ||
        path.startsWith("/clients") ||
        path.startsWith("/tasks") ||
        path.startsWith("/documents") ||
        path.startsWith("/ai-tools") ||
        path.startsWith("/settings")

      const isAuthPage = path === "/login" || path === "/register"

      if (isProtected) {
        // Unauthenticated → NextAuth redirects to pages.signIn automatically
        return isLoggedIn
      }

      if (isAuthPage && isLoggedIn) {
        // Already logged in and hitting /login or /register → back to dashboard
        return Response.redirect(new URL("/dashboard", nextUrl))
      }

      return true
    },
  },

  providers: [],
} satisfies NextAuthConfig
