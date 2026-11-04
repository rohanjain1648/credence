import { expect, test } from "vitest";
import { categorize } from "@/lib/scoring/categorize";

test.each([
  [{ title: "Lakers vs. Celtics", eventSlug: "nba-lal-bos-2026-11-04" }, "SPORTS"],
  [{ title: "Will the Chiefs beat the Bills?" }, "SPORTS"],
  [{ title: "Miami Heat vs. Orlando Magic" }, "SPORTS"],
  [{ title: "Which party will win the Senate in 2026?" }, "POLITICS"],
  [{ title: "Bitcoin above $120,000 on November 7?" }, "CRYPTO"],
  [{ title: "Fed decreases interest rates by 25 bps after December 2026 meeting?" }, "ECONOMICS"],
  [{ title: "Will Taylor Swift announce a new album?" }, "CULTURE"],
  [{ title: "Highest temperature in NYC on Nov 5?" }, "WEATHER"],
  [{ title: 'Will Powell say "recession" during the press conference?' }, "MENTIONS"],
  [{ title: "Will OpenAI release GPT-6 in 2026?" }, "TECH"],
  [{ title: "Will NVIDIA close above $200 on Friday?" }, "TECH"],
  [{ title: "Will the S&P 500 close higher this week?" }, "FINANCE"],
  [{ title: "Anything", apiCategory: "Sports" }, "SPORTS"],
  [{ title: "Anything", apiCategory: "Science" }, "TECH"],
  [{ title: "Who will win?", slug: "epl-ars-che-2026-11-08" }, "SPORTS"],
  [{ title: "Something random" }, "OTHER"],
])("categorize %o → %s", (input, group) => expect(categorize(input)).toBe(group));
