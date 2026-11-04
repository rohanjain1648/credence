export const GROUPS = [
  "SPORTS",
  "POLITICS",
  "CRYPTO",
  "CULTURE",
  "MENTIONS",
  "WEATHER",
  "ECONOMICS",
  "TECH",
  "FINANCE",
  "OTHER",
] as const;
export type Group = (typeof GROUPS)[number];

const API_CATEGORY: Record<string, Group> = {
  sports: "SPORTS",
  esports: "SPORTS",
  politics: "POLITICS",
  elections: "POLITICS",
  "us-current-affairs": "POLITICS",
  geopolitics: "POLITICS",
  world: "POLITICS",
  crypto: "CRYPTO",
  culture: "CULTURE",
  "pop culture": "CULTURE",
  "pop-culture": "CULTURE",
  entertainment: "CULTURE",
  mentions: "MENTIONS",
  weather: "WEATHER",
  climate: "WEATHER",
  economics: "ECONOMICS",
  economy: "ECONOMICS",
  economic: "ECONOMICS",
  financials: "FINANCE",
  finance: "FINANCE",
  business: "FINANCE",
  stocks: "FINANCE",
  tech: "TECH",
  technology: "TECH",
  science: "TECH",
  ai: "TECH",
};

const LEAGUE_SLUG =
  /^(nfl|nba|nhl|mlb|wnba|cfb|cbb|ncaab|ncaaf|ncaa|epl|ucl|uel|uecl|laliga|lal|sea|seriea|bundesliga|bun|ligue1|fl1|mls|atp|wta|ufc|f1|pga|ipl|cricket|tennis|boxing|mma|nascar|soccer|football|basketball|hockey|baseball)(-|$)/;

const TEAMS = [
  // NFL
  "cardinals", "falcons", "ravens", "bills", "panthers", "bears", "bengals", "browns", "cowboys", "broncos", "lions",
  "packers", "texans", "colts", "jaguars", "chiefs", "raiders", "chargers", "rams", "dolphins", "vikings", "patriots",
  "saints", "giants", "jets", "eagles", "steelers", "49ers", "niners", "seahawks", "buccaneers", "titans", "commanders",
  // NBA
  "hawks", "celtics", "nets", "hornets", "bulls", "cavaliers", "cavs", "mavericks", "mavs", "nuggets", "pistons",
  "warriors", "rockets", "pacers", "clippers", "lakers", "grizzlies", "heat", "bucks", "timberwolves", "pelicans",
  "knicks", "thunder", "magic", "76ers", "sixers", "suns", "trail blazers", "blazers", "kings", "spurs", "raptors",
  "jazz", "wizards",
  // NHL
  "bruins", "sabres", "red wings", "canadiens", "senators", "lightning", "maple leafs", "hurricanes", "blue jackets",
  "devils", "islanders", "rangers", "flyers", "penguins", "capitals", "blackhawks", "avalanche", "stars", "wild",
  "predators", "blues", "flames", "oilers", "canucks", "ducks", "sharks", "golden knights", "kraken", "utah hockey",
  // MLB
  "diamondbacks", "braves", "orioles", "red sox", "cubs", "white sox", "reds", "guardians", "rockies", "tigers",
  "astros", "royals", "angels", "dodgers", "marlins", "brewers", "twins", "mets", "yankees", "athletics", "phillies",
  "pirates", "padres", "mariners", "rays", "nationals", "blue jays",
];

const words = (list: string[]) => new RegExp(`\\b(${list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");

/** Checked in order; the first match wins. */
const KEYWORDS: Array<[Group, RegExp]> = [
  ["MENTIONS", /\b(say|says|said|mention|mentions|mentioned)\b/i],
  ["WEATHER", /\b(temperature|weather|hurricane|rainfall|snowfall|tornado|earthquake|degrees|°f|°c)\b/i],
  [
    "CRYPTO",
    /\b(bitcoin|btc|ethereum|eth|solana|xrp|dogecoin|doge|crypto|cryptocurrency|memecoin|stablecoin|binance|coinbase|sui|cardano|polymarket token)\b/i,
  ],
  [
    "ECONOMICS",
    /\b(fed|fomc|interest rates?|rate (cut|hike)s?|bps|inflation|cpi|gdp|recession|unemployment|jobs report|payrolls|treasury yields?|tariffs?)\b/i,
  ],
  ["FINANCE", /(s&p|\bnasdaq\b|\bdow jones\b|\bstock\b|\bshares\b|\bipo\b|\bearnings\b|\bmarket cap\b)/i],
  [
    "POLITICS",
    /\b(elections?|senate|house of representatives|house|governor|gubernatorial|president(ial)?|primary|nominee|nomination|democrats?|democratic|republicans?|gop|congress|parliament|prime minister|mayor|trump|biden|harris|vance|newsom|midterms?|electoral|ballot|cabinet|impeach\w*|supreme court|referendum)\b/i,
  ],
  [
    "TECH",
    /\b(openai|gpt-?\d*|chatgpt|anthropic|claude|gemini|deepseek|google|apple|iphone|microsoft|nvidia|spacex|starship|tesla|ai model|agi)\b/i,
  ],
  [
    "CULTURE",
    /\b(album|song|movie|film|box office|oscars?|grammys?|emmys?|golden globes?|netflix|spotify|billboard|celebrity|taylor swift|kanye|drake|beyonc[eé]|youtube|mrbeast|tiktok|eurovision|person of the year|pregnant|married|divorce)\b/i,
  ],
  [
    "SPORTS",
    /\b(vs\.?|nfl|nba|nhl|mlb|wnba|ncaa|super bowl|stanley cup|world series|playoffs?|premier league|champions league|la liga|serie a|bundesliga|ligue 1|mls|world cup|grand slam|wimbledon|us open|ufc|boxing|grand prix|formula 1|f1|pga|cricket|ipl|olympics?|mvp|touchdowns?|o\/u|over\/under|spread)\b/i,
  ],
  ["SPORTS", words(TEAMS)],
];

export function categorize(i: {
  title?: string | null;
  slug?: string | null;
  eventSlug?: string | null;
  apiCategory?: string | null;
  tags?: string[] | null;
}): Group {
  const fromApi = i.apiCategory ? API_CATEGORY[i.apiCategory.trim().toLowerCase()] : undefined;
  if (fromApi) return fromApi;

  for (const slug of [i.eventSlug, i.slug]) {
    if (slug && LEAGUE_SLUG.test(slug.toLowerCase())) return "SPORTS";
  }

  const text = [i.title ?? "", ...(i.tags ?? [])].join(" ");
  for (const [group, re] of KEYWORDS) {
    if (re.test(text)) return group;
  }
  return "OTHER";
}
