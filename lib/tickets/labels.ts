import type { VariantProps } from "class-variance-authority";
import type { badgeVariants } from "@/components/ui/badge";
import { tickets } from "@/lib/db/schema";

export type TicketStatus = (typeof tickets.status.enumValues)[number];
type TicketPriority = (typeof tickets.priority.enumValues)[number];
type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

// Shared by the ticket list and the thread view so the two can't drift
// apart on wording or colour.
export const STATUS_LABELS: Record<TicketStatus, string> = {
  new: "New",
  pending_review: "Pending Review",
  approved: "Approved",
  escalated: "Escalated",
  resolved: "Resolved",
  waiting_on_customer: "Waiting on Customer",
  triaged_out: "Triaged Out",
};

export const STATUS_VARIANTS: Record<TicketStatus, BadgeVariant> = {
  new: "default",
  pending_review: "secondary",
  approved: "secondary",
  escalated: "destructive",
  resolved: "outline",
  waiting_on_customer: "secondary",
  triaged_out: "outline",
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const PRIORITY_VARIANTS: Record<TicketPriority, BadgeVariant> = {
  low: "outline",
  medium: "secondary",
  high: "default",
  urgent: "destructive",
};

export const PRIORITIES = tickets.priority.enumValues;
