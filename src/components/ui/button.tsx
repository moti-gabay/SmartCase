import { cn } from "@/lib/utils";
import { type ButtonHTMLAttributes, forwardRef } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

const variants = {
  primary:   "bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 active:bg-indigo-800",
  secondary: "bg-indigo-50 text-indigo-700 hover:bg-indigo-100",
  ghost:     "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  danger:    "bg-red-600 text-white hover:bg-red-700 active:bg-red-800",
  outline:   "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm",
};

const sizes = {
  sm: "h-8 px-3 text-sm",
  md: "h-9 px-4 text-sm",
  lg: "h-10 px-5 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  )
);
Button.displayName = "Button";
