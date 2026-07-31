// Pending-approval registry for the Slack ingress.
//
// The pipeline's approval hook is a promise; Slack's answer arrives later on a
// different event. This holds that gap as explicit state keyed by thread, so the
// handler stays synchronous and the timeout is guaranteed rather than implied.

import { classifyReply, classifyReaction, isAllowed } from "./guards.mjs";

/** Slack answers within minutes or not at all; a stuck gate must not hold a run open forever. */
export const DEFAULT_APPROVAL_TIMEOUT_MS = 30 * 60_000;

/**
 * @param {{timeoutMs?: number, onResolved?: (r: {threadTs: string, decision: string, actor: string|null}) => void}} [opts]
 */
export function createApprovalRegistry({ timeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS, onResolved } = {}) {
  const pending = new Map(); // thread_ts -> { resolve, timer, allowlist, promptTs }

  function settle(threadTs, decision, actor) {
    const entry = pending.get(threadTs);
    if (!entry) return false;
    clearTimeout(entry.timer);
    pending.delete(threadTs);
    entry.resolve(decision === "approve");
    onResolved?.({ threadTs, decision, actor });
    return true;
  }

  return {
    /** @returns {Promise<boolean>} resolved by a decision or denied on timeout. */
    wait(threadTs, { allowlist, promptTs }) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          // Deny, never approve. An unanswered gate is not consent.
          if (pending.delete(threadTs)) {
            resolve(false);
            onResolved?.({ threadTs, decision: "timeout", actor: null });
          }
        }, timeoutMs);
        timer.unref?.();
        pending.set(threadTs, { resolve, timer, allowlist, promptTs });
      });
    },

    /** A threaded reply may carry the decision. */
    handleReply({ threadTs, user, text }) {
      const entry = pending.get(threadTs);
      if (!entry || !isAllowed(user, entry.allowlist)) return false;
      const decision = classifyReply(text);
      if (!decision) return false;
      return settle(threadTs, decision, user);
    },

    /**
     * A reaction may carry the decision. Accepted on the prompt message or on
     * the thread parent — operators reliably react to one or the other.
     */
    handleReaction({ itemTs, threadTs, user, reaction }) {
      const key = pending.has(threadTs) ? threadTs : null;
      const entry = key ? pending.get(key) : null;
      if (!entry) return false;
      if (itemTs && entry.promptTs && itemTs !== entry.promptTs && itemTs !== threadTs) return false;
      if (!isAllowed(user, entry.allowlist)) return false;
      const decision = classifyReaction(reaction);
      if (!decision) return false;
      return settle(key, decision, user);
    },

    isPending(threadTs) {
      return pending.has(threadTs);
    },

    size() {
      return pending.size;
    },
  };
}
