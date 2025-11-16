import type { Context } from "telegraf";

type TemplateValues = Record<string, string | number | null | undefined>;

export function renderTemplate(template: string | undefined, values: TemplateValues = {}): string {
  if (!template) {
    return "";
  }

  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = values[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

export function resolveUserDisplayName(
  source:
    | Context["from"]
    | {
        first_name?: string | null;
        last_name?: string | null;
        username?: string | null;
        id?: number | string | null;
      }
    | undefined,
): string {
  if (!source) {
    return "there";
  }

  const first = source.first_name?.trim();
  const last = source.last_name?.trim();

  if (first && last) {
    return `${first} ${last}`;
  }
  if (first) {
    return first;
  }

  const username = source.username?.trim();
  if (username) {
    return username.startsWith("@") ? username : `@${username}`;
  }

  if (typeof source.id === "number" || typeof source.id === "string") {
    return String(source.id);
  }

  return "there";
}
