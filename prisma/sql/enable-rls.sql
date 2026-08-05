-- Enable Row Level Security on all public tables.
--
-- Context: this app connects to Postgres directly via DATABASE_URL (see src/lib/prisma.ts),
-- using a role that owns these tables. Table owners bypass RLS by default, so this does NOT
-- affect the app's own Prisma queries. What it blocks is Supabase's auto-generated
-- PostgREST/GraphQL API, which otherwise exposes every public-schema table to any caller
-- holding the project's anon/authenticated key — bypassing NextAuth entirely.
--
-- No policies are added on purpose: with RLS enabled and zero policies, Postgres denies
-- all access to non-owner roles (anon, authenticated) by default. That's the desired state —
-- this app has no legitimate use for Supabase's client-side REST/GraphQL access.
--
-- Run manually against Supabase (not part of `prisma db push` — Prisma's schema DSL has no
-- RLS syntax). Re-run after any db:push that adds a new table.

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversion_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversion_children ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversion_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installed_plugins ENABLE ROW LEVEL SECURITY;
