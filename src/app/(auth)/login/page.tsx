"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { signIn } from "next-auth/react"
import { Eye, EyeOff, LogIn, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

const schema = z.object({
  email:    z.string().email("כתובת דוא\"ל לא תקינה"),
  password: z.string().min(1, "נא להזין סיסמה"),
})

type FormValues = z.infer<typeof schema>

export default function LoginPage() {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [googleLoading, setGoogleLoading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  // The Google flow is a full redirect; a rejected sign-in (unknown or
  // unapproved email — see the linking-only gate in auth.ts) returns here with
  // ?error=. Read it from the URL directly to avoid useSearchParams' Suspense
  // requirement. AccessDenied maps to the generic "staff accounts only" copy;
  // any other value is a transient OAuth failure.
  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error")
    if (!error) return
    // Intentional post-hydration URL read: a lazy useState initializer would
    // read the param during SSR (window undefined) and again on the client,
    // producing a hydration mismatch whenever ?error= is present.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAuthError(
      error === "AccessDenied"
        ? "התחברות עם Google זמינה רק לחשבונות צוות מאושרים. פנה למנהל המערכת."
        : "אירעה שגיאה בהתחברות עם Google. נסה שוב."
    )
  }, [])

  async function onGoogleSignIn() {
    setAuthError(null)
    setGoogleLoading(true)
    try {
      await signIn("google", { callbackUrl: "/dashboard" })
    } catch {
      // Transport failure before the OAuth redirect (offline, blocked request).
      setAuthError("אירעה שגיאה בהתחברות עם Google. נסה שוב.")
    } finally {
      // Success has already navigated away; on failure this frees the button to retry.
      setGoogleLoading(false)
    }
  }

  async function onSubmit(data: FormValues) {
    setAuthError(null)
    const result = await signIn("credentials", {
      email:    data.email,
      password: data.password,
      redirect: false,
    })

    if (!result || result.error) {
      // `code` is carried by the custom CredentialsSignin subclasses thrown in
      // auth.ts, letting us show account-state copy distinct from bad credentials.
      const code = (result as { code?: string } | undefined)?.code
      setAuthError(
        code === "pending_approval"
          ? "החשבון שלך ממתין לאישור מנהל המערכת. תקבל גישה לאחר האישור."
          : code === "suspended"
          ? "החשבון שלך הושעה. לפרטים נוספים פנה למנהל המערכת."
          : "כתובת הדוא\"ל או הסיסמה שגויים"
      )
      return
    }

    router.replace("/dashboard")
    router.refresh()
  }

  return (
    <div className="w-full max-w-md">
      {/* Logo / Brand */}
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-white backdrop-blur">
          <span className="text-2xl font-bold">S</span>
        </div>
        <h1 className="text-2xl font-bold text-white">SmartCase</h1>
        <p className="mt-1 text-sm text-indigo-300">מערכת ניהול תיקים</p>
      </div>

      {/* Card */}
      <div className="rounded-2xl bg-white p-8 shadow-2xl">
        <h2 className="mb-6 text-xl font-semibold text-slate-900">כניסה למערכת</h2>

        {/* Global error */}
        {authError && (
          <div className="mb-5 flex items-start gap-2.5 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{authError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          {/* Email */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              כתובת דוא"ל
            </label>
            <input
              {...register("email")}
              type="email"
              dir="ltr"
              autoComplete="email"
              placeholder="your@email.com"
              className={cn(
                "w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-slate-400",
                "focus:outline-none focus:ring-2 focus:ring-indigo-500",
                "disabled:bg-slate-50 disabled:text-slate-400",
                errors.email
                  ? "border-red-400 bg-red-50/50 focus:ring-red-500"
                  : "border-slate-300 bg-white"
              )}
              disabled={isSubmitting}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
            )}
          </div>

          {/* Password */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              סיסמה
            </label>
            <div className="relative">
              <input
                {...register("password")}
                type={showPassword ? "text" : "password"}
                dir="ltr"
                autoComplete="current-password"
                placeholder="••••••••"
                className={cn(
                  "w-full rounded-lg border px-3.5 py-2.5 pe-10 text-sm placeholder:text-slate-400",
                  "focus:outline-none focus:ring-2 focus:ring-indigo-500",
                  "disabled:bg-slate-50 disabled:text-slate-400",
                  errors.password
                    ? "border-red-400 bg-red-50/50 focus:ring-red-500"
                    : "border-slate-300 bg-white"
                )}
                disabled={isSubmitting}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password && (
              <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5",
              "bg-indigo-600 text-sm font-semibold text-white",
              "hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-60",
              "transition-colors"
            )}
          >
            {isSubmitting ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            {isSubmitting ? "מתחבר..." : "כניסה"}
          </button>
        </form>

        {/* Divider */}
        <div className="my-6 flex items-center gap-3">
          <span className="h-px flex-1 bg-slate-200" />
          <span className="text-xs font-medium text-slate-400">או</span>
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        {/* Google — linking-only for existing approved staff accounts */}
        <button
          type="button"
          onClick={onGoogleSignIn}
          disabled={isSubmitting || googleLoading}
          className={cn(
            "flex w-full items-center justify-center gap-2.5 rounded-lg border px-4 py-2.5",
            "border-slate-300 bg-white text-sm font-semibold text-slate-700",
            "hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-60",
            "transition-colors"
          )}
        >
          {googleLoading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
            </svg>
          )}
          {googleLoading ? "מתחבר..." : "התחברות עם Google"}
        </button>

        <p className="mt-6 text-center text-sm text-slate-500">
          אין לך חשבון?{" "}
          <Link href="/register" className="font-medium text-indigo-600 hover:text-indigo-700">
            הירשם כאן
          </Link>
        </p>
      </div>
    </div>
  )
}
