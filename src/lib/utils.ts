import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow, isPast } from "date-fns";
import { he } from "date-fns/locale";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  return format(new Date(date), "dd/MM/yyyy", { locale: he });
}

export function formatDatetime(date: Date | string): string {
  return format(new Date(date), "dd/MM/yyyy HH:mm", { locale: he });
}

export function timeAgo(date: Date | string): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: he });
}

export function isDateOverdue(date: Date | string): boolean {
  return isPast(new Date(date));
}

export function calculateAge(dateOfBirth: Date | string): number {
  return Math.floor(
    (Date.now() - new Date(dateOfBirth).getTime()) / (1000 * 60 * 60 * 24 * 365.25)
  );
}

// True when `date` falls within the next `days` days (or has already passed).
export function isWithinDays(date: Date | string, days: number): boolean {
  return new Date(date).getTime() - Date.now() < 1000 * 60 * 60 * 24 * days;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function generateCaseNumber(): string {
  const year = new Date().getFullYear();
  const seq = Math.floor(Math.random() * 99999).toString().padStart(5, "0");
  return `SC-${year}-${seq}`;
}
