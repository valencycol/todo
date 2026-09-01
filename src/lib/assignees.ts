export interface Assignee {
  key: string;
  name: string;
  email: string;
  enabled: boolean;
}

/**
 * Who a list can be emailed to. Alvita's address isn't verified as a
 * Cloudflare Email Sending destination yet, so she's listed but disabled
 * until `ALVITA_ENABLED` is flipped to "true" in wrangler.jsonc (after her
 * address is registered + verified — see the comment there).
 */
export function getAssignees(env: Env): Assignee[] {
  return [
    { key: "valency", name: "Valency", email: env.ASSIGNEE_VALENCY_EMAIL, enabled: true },
    { key: "alvita", name: "Alvita", email: env.ASSIGNEE_ALVITA_EMAIL, enabled: String(env.ALVITA_ENABLED) === "true" },
  ];
}

export function resolveAssignee(env: Env, key: unknown): Assignee {
  const assignees = getAssignees(env);
  const found = assignees.find((a) => a.key === key && a.enabled);
  return found ?? assignees[0]!;
}
