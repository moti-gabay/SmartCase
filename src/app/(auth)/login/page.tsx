"use client"

import { useState } from "react"
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

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

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
