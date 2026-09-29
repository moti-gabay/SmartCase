// Hebrew letter generation / refinement, shared by /api/ai/letter* and the
// assistant's generate_letter / refine_letter actions. Plain server module —
// never "use server": callers pass an already-authorized actor.
import { prisma } from "@/lib/prisma";
import { generateHebrewLetter, refineHebrewLetter } from "@/lib/ai/gemini";
import { CASE_TYPE_LABELS, LETTER_TYPE_LABELS, LETTER_TYPE_INSTRUCTIONS } from "@/lib/constants";

export const LETTER_TYPES = Object.keys(LETTER_TYPE_LABELS);

export interface GeneratedLetterResult {
  id: string;
  letterType: string;
  title: string;
  content: string;
  createdAt: Date;
}

// Returns null when the case does not exist. An unknown letterType falls back
// to CLAIM_REQUEST, matching the original route.
export async function generateLetter(input: {
  caseId: string;
  letterType: string;
  context?: string;
  actor: { id: string; name?: string | null };
}): Promise<GeneratedLetterResult | null> {
  const type = LETTER_TYPES.includes(input.letterType) ? input.letterType : "CLAIM_REQUEST";
  const context = input.context?.trim() || undefined;

  const c = await prisma.case.findUnique({
    where: { id: input.caseId },
    include: { client: true, assignedAgent: { select: { name: true } } },
  });
  if (!c) return null;

  const content = await generateHebrewLetter({
    clientName: c.client.fullName,
    nationalId: c.client.nationalId,
    dateOfBirth: c.client.dateOfBirth.toLocaleDateString("he-IL"),
    primaryCondition: c.client.primaryCondition ?? "לא צוין",
    recognizedPercentage: c.client.recognizedPercentage ?? undefined,
    claimedPercentage: c.claimedPercentage ?? undefined,
    claimDescription: c.claimDescription ?? undefined,
    caseType: CASE_TYPE_LABELS[c.caseType] ?? c.caseType,
    caseNumber: c.caseNumber,
    agentName: c.assignedAgent?.name ?? input.actor.name ?? "צוות SmartCase",
    letterTypeLabel: LETTER_TYPE_LABELS[type],
    letterPurpose: LETTER_TYPE_INSTRUCTIONS[type],
    context,
  });

  const title = `${LETTER_TYPE_LABELS[type]} – ${c.client.fullName}`;
  const saved = await prisma.generatedLetter.create({
    data: {
      caseId: input.caseId,
      createdById: input.actor.id,
      letterType: type as never,
      title,
      content,
      context: context ?? null,
    },
    select: { id: true, createdAt: true },
  });
  return { id: saved.id, letterType: type, title, content, createdAt: saved.createdAt };
}

// Returns the new content, or null when the letter does not exist.
export async function refineLetter(id: string, feedback: string): Promise<string | null> {
  const letter = await prisma.generatedLetter.findUnique({ where: { id }, select: { content: true } });
  if (!letter) return null;
  const content = await refineHebrewLetter(letter.content, feedback.trim());
  await prisma.generatedLetter.update({ where: { id }, data: { content } });
  return content;
}
