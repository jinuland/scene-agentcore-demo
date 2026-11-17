// Shared UI/server vocabulary. Server authorization remains authoritative.
// owner/player/admin are the product vocabulary. The four legacy roles remain
// readable so existing invited workspaces keep working, but new projects are
// created with the single-owner studio model.
export const teamRoles = ["owner", "player", "admin", "planner", "artist", "director", "reviewer"] as const;
export const permissionNames = ["read", "edit", "plan", "image", "assign", "submit", "approve", "request_changes", "reopen", "comment", "publish", "manage_members"] as const;
export type TeamRole = typeof teamRoles[number];
export type TeamPermission = typeof permissionNames[number];
export const rolePermissions: Record<TeamRole, readonly TeamPermission[]> = {
  owner: ["read", "edit", "plan", "image", "assign", "submit", "approve", "request_changes", "reopen", "comment", "publish", "manage_members"],
  player: ["read"],
  // Administrators operate the studio but do not automatically consume image
  // generation budget for a creator's work.
  admin: ["read", "edit", "assign", "submit", "approve", "request_changes", "reopen", "comment", "publish", "manage_members"],
  planner: ["read", "edit", "plan", "image", "assign", "submit", "comment"],
  artist: ["read", "edit", "image", "submit", "comment"],
  director: ["read", "edit", "plan", "assign", "submit", "approve", "request_changes", "reopen", "comment", "publish"],
  reviewer: ["read", "request_changes", "comment"],
};
