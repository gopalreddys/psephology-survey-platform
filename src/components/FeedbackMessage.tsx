"use client";

import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import type { ReactNode } from "react";

type FeedbackTone = "success" | "error" | "info" | "auto";

type FeedbackMessageProps = {
  message: string | ReactNode;
  tone?: FeedbackTone;
  className?: string;
};

function inferTone(message: string | ReactNode): Exclude<FeedbackTone, "auto"> {
  if (typeof message !== "string") return "info";
  return /unable|failed|error|invalid|required|select |must |cannot|not available|not found|no authenticated|only |^no |could not|assign at least|complete .* before|outside|unavailable/i.test(message)
    ? "error"
    : /success|created|saved|assigned|updated|uploaded|completed|submitted|ready|sent|resolved/i.test(message)
      ? "success"
      : "info";
}

export default function FeedbackMessage({ message, tone = "auto", className = "" }: FeedbackMessageProps) {
  const resolvedTone = tone === "auto" ? inferTone(message) : tone;
  const Icon = resolvedTone === "success" ? CheckCircle2 : resolvedTone === "error" ? AlertCircle : Info;
  const role = resolvedTone === "error" ? "alert" : "status";

  return (
    <div className={`platform-feedback platform-feedback-${resolvedTone} ${className}`.trim()} role={role} aria-live="polite">
      <Icon size={16} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
