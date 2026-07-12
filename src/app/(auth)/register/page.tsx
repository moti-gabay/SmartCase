"use client"

import { useState } from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Eye, EyeOff, UserPlus, AlertCircle, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"

const schema = z
  .object({
    name:            z.string().min(2, "השם חייב להכיל לפחות 2 תווים"),
    email:           z.string().email("כתובת דוא\"ל לא תקינה"),
    password:        z.string().min(8, "הסיסמה חייבת להכיל לפחות 8 תווים"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "הסיסמאות אינן תואמות",
    path:    ["confirmPassword"],
  })

type FormValues = z.infer<typeof schema>

export default function RegisterPage() {
  const [showPassword,  setShowPassword]  = useState(false)
  const [showConfirm,   setShowConfirm]   = useState(false)
  const [serverError,   setServerError]   = useState<string | null>(null)
  const [success,       setSuccess]       = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormValues) {
    setServerError(null)
    const res = await fetch("/api/auth/register", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ name: data.name, email: data.email, password: data.password }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setServerError(body.error ?? "שגיאת שרת, נסה שוב")
      return
    }

    // New accounts default to PENDING_APPROVAL and cannot log in until an admin
    // approves them — so we do NOT auto sign-in; we show a pending-approval state.
    setSuccess(true)
  }

  return (
    <div className="w-full max-w-md">
      {/* Logo */}
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-white backdrop-blur">
          <span className="text-2xl font-bold">S</span>
        </div>
        <h1 className="text-2xl font-bold text-white">SmartCase</h1>
        <p className="mt-1 text-sm text-indigo-300">מערכת ניהול תיקים</p>
      </div>

      <div className="rounded-2xl bg-white p-8 shadow-2xl">
        <h2 className="mb-6 text-xl font-semibold text-slate-900">יצירת חשבון חדש</h2>

        {/* Success banner — account created, awaiting admin approval */}
        {success && (
          <div className="mb-5 flex items-start gap-2.5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              החשבון נוצר בהצלחה וממתין לאישור מנהל המערכת. תוכל להתחבר לאחר האישור.{" "}
              <Link href="/login" className="font-medium underline">מעבר לכניסה</Link>
            </span>
          </div>
        )}

        {/* Error banner */}
        {serverError && (
          <div className="mb-5 flex items-start gap-2.5 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          {/* Full name */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">שם מלא</label>
            <input
              {...register("name")}
              type="text"
              autoComplete="name"
              placeholder="ישראל ישראלי"
              className={cn(
                "w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-slate-400",
                "focus:outline-none focus:ring-2 focus:ring-indigo-500",
                errors.name ? "border-red-400 bg-red-50/50" : "border-slate-300"
              )}
              disabled={isSubmitting || success}
            />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
          </div>

          {/* Email */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">כתובת דוא"ל</label>
            <input
              {...register("email")}
              type="email"
              dir="ltr"
              autoComplete="email"
              placeholder="your@email.com"
              className={cn(
                "w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-slate-400",
                "focus:outline-none focus:ring-2 focus:ring-indigo-500",
                errors.email ? "border-red-400 bg-red-50/50" : "border-slate-300"
              )}
              disabled={isSubmitting || success}
            />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
          </div>

          {/* Password */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">סיסמה</label>
            <div className="relative">
              <input
                {...register("password")}
                type={showPassword ? "text" : "password"}
                dir="ltr"
                autoComplete="new-password"
                placeholder="לפחות 8 תווים"
                className={cn(
                  "w-full rounded-lg border px-3.5 py-2.5 pe-10 text-sm placeholder:text-slate-400",
                  "focus:outline-none focus:ring-2 focus:ring-indigo-500",
                  errors.password ? "border-red-400 bg-red-50/50" : "border-slate-300"
                )}
                disabled={isSubmitting || success}
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
            {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
          </div>

          {/* Confirm password */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">אימות סיסמה</label>
            <div className="relative">
              <input
                {...register("confirmPassword")}
                type={showConfirm ? "text" : "password"}
                dir="ltr"
                autoComplete="new-password"
                placeholder="חזור על הסיסמה"
                className={cn(
                  "w-full rounded-lg border px-3.5 py-2.5 pe-10 text-sm placeholder:text-slate-400",
                  "focus:outline-none focus:ring-2 focus:ring-indigo-500",
                  errors.confirmPassword ? "border-red-400 bg-red-50/50" : "border-slate-300"
                )}
                disabled={isSubmitting || success}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.confirmPassword && (
              <p className="mt-1 text-xs text-red-600">{errors.confirmPassword.message}</p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting || success}
            className={cn(
              "mt-2 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5",
              "bg-indigo-600 text-sm font-semibold text-white",
              "hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
            )}
          >
            {isSubmitting ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            {isSubmitting ? "יוצר חשבון..." : "הרשמה"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          כבר יש לך חשבון?{" "}
          <Link href="/login" className="font-medium text-indigo-600 hover:text-indigo-700">
            כניסה
          </Link>
        </p>
      </div>
    </div>
  )
}
