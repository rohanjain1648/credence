export const NS = {
  voices: "credence-voices",
  calls: "credence-calls",
  lessons: "credence-lessons",
  checkpoints: "credence-checkpoints",
  user: (handle: string) => `credence-user-${handle.toLowerCase().replace(/[^a-z0-9_]/g, "-")}`,
} as const;
