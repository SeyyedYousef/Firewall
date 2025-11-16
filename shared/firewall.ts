export type RuleCondition =
  | {
      kind: "text_contains";
      value: string;
      caseSensitive?: boolean;
    }
  | {
      kind: "regex";
      pattern: string;
      flags?: string;
    }
  | {
      kind: "keyword";
      keywords: string[];
      match: "any" | "all";
      caseSensitive?: boolean;
    }
  | {
      kind: "media_type";
      types: Array<"photo" | "video" | "document" | "audio" | "voice" | "animation" | "video_note" | "sticker">;
    }
  | {
      kind: "link_domain";
      domains: string[];
      allowSubdomains?: boolean;
    }
  | {
      kind: "user_role";
      roles: Array<"new" | "restricted" | "admin" | "owner">;
    }
  | {
      kind: "time_range";
      startHour: number;
      endHour: number;
      timezone?: string;
    }
  | {
      kind: "message_length";
      min?: number;
      max?: number;
    };

export type RuleAction =
  | {
      kind: "delete_message";
    }
  | {
      kind: "warn";
      message?: string;
      severity?: "low" | "medium" | "high";
    }
  | {
      kind: "mute";
      durationSeconds: number;
      reason?: string;
    }
  | {
      kind: "kick";
      reason?: string;
    }
  | {
      kind: "ban";
      reason?: string;
      durationSeconds?: number;
    }
  | {
      kind: "log";
      level?: "debug" | "info" | "warn" | "error";
      message?: string;
    };

export type RuleEscalationStep = {
  threshold: number;
  windowSeconds: number;
  actions: RuleAction[];
};

export type RuleEscalation = {
  steps: RuleEscalationStep[];
  resetAfterSeconds?: number;
};

export type FirewallRuleConfig = {
  version: 1;
  name: string;
  description?: string;
  enabled: boolean;
  scope: "group" | "global";
  priority: number;
  matchAll?: boolean;
  conditions: RuleCondition[];
  actions: RuleAction[];
  escalation?: RuleEscalation;
  tags?: string[];
  createdBy?: string | null;
};
