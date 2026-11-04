# Credence: Design

Entry for **Total Recall: Tatum x Walrus Memory Hackathon**, track 01 *Markets & Sports Prediction*.
Submissions close **2026-11-10 17:00 UTC** (22:30 IST).

## 1. Pitch

> Polymarket shows you what the crowd thinks. Credence shows you what the people who are usually right think, and it never forgets who they are.

Credence tracks onchain prediction-market traders ("voices") and scores them on **skill, not profit**. It stores everything it learns in **Walrus Memory on Mainnet**. It uses that memory to publish a **Sharp Line** next to the Polymarket and Kalshi prices: the market price pulled toward where credible money sits. Users log their own picks before events and are scored the same way. As markets resolve, Credence learns which voices to trust and how much to trust them, and the product visibly changes.

## 2. Why this wins (judging map)

| Criterion | Weight | How Credence scores |
|---|---|---|
| Walrus + Tatum integration | 30% | Memory is the learning substrate: dossiers, lessons, pre-event calls, checkpoints, user picks. Tatum Prediction API is used deeply (markets, holders, wallet histories, leaderboards, price history). Tatum Sui RPC verifies the memory account and anchors receipts. |
| Technical quality | 30% | Typed Tatum client with rate limiting and credit budgeting. Memory write queue that respects relayer limits. Tested scoring math. Sui reads and writes through Tatum's gateway. |
| Creativity | 20% | The "voices" are onchain wallets with real track records, so there is no cold start. Skill is measured against the price paid, not PnL. The Amnesia and Time Machine demos make memory tangible. |
| Presentation | 20% | Election-night learning story (US midterms, 2026-11-03), a clean demo, and a blog post built from the app's own memory trail. |

Prize targets: Track 1st ($500) + Best Walrus Memory ($500). Agent Payments ($500, x402 on Sui) is out of scope unless everything else ships early.

## 3. Hackathon hard requirements (must all be true at submission)

1. Walrus Memory integrated and writing on **Mainnet** (`https://relayer.memory.walrus.xyz`).
2. At least **10 memories** stored on Mainnet. Target: 300+.
3. Tatum RPC used for onchain data: **Tatum Sui RPC** (`https://sui-mainnet.gateway.tatum.io`) plus Tatum Data API.
4. Public repo + working demo (deployed URL).
5. Published blog post: what it does, how it uses Tatum + Walrus, how it learned over time.
6. Form fields: Tatum dashboard account ID; `MEMWAL_AGENT_ID` (delegate public key).

## 4. Users and core loop

**Who:** sports fans, forecasters, fantasy players, election watchers. They are web2-friendly, so no wallet is needed to use the app.

**Loop:**
1. **Observe.** Pull live markets (Polymarket + Kalshi via Tatum Prediction API) and the wallets holding each side.
2. **Judge.** Score each wallet's closed positions: did they buy at prices that later proved too cheap? Score per category.
3. **Remember.** Write distilled knowledge to Walrus Memory. That covers voice dossiers, pre-event calls, resolved-market lessons, user picks, and trust-model checkpoints.
4. **Apply.** Compute the Sharp Line for each tracked market from current holders weighted by remembered credibility. Flag credible-money and venue disagreements.
5. **Resolve and learn.** When markets resolve, settle picks, update voice credibility, refit how much to trust sharp money (λ) per category, and write lessons and a new checkpoint.

## 5. Scoring model

### 5.1 Categories
`Group = SPORTS | POLITICS | CRYPTO | CULTURE | MENTIONS | WEATHER | ECONOMICS | TECH | FINANCE | OTHER`. These match the Tatum top-traders categories. A market's group comes from the API category when present, otherwise from keyword and slug heuristics. Wallet history rows have no category, so they are categorized from `title`/`eventSlug`.

### 5.2 Voice credibility (per wallet, per group, plus OVERALL)
Input: closed positions with `avgPrice` p, resolution price y (`curPrice`: 1 = held outcome won), `totalBought`, and settlement time.

Exclude positions with p ≤ 0.005 or p ≥ 0.995, `totalBought` < $5, or settlement after `asOf`.

- edge per bet: e = y − p; variance: v = p(1 − p)
- `edge` (shrunk mean) = Σe / (n + K), with **K = 10**
- `z` = Σe / √(Σv + 0.25·K)
- `credibility` = 50 + 50·tanh(z / 3) → 0..100, where 50 means neutral or no evidence
- `wins` = count of y ≥ 0.99; also `pnl` = Σ realizedPnl and `volume` = Σ totalBought (shown, never used for credibility)

Shrinkage keeps lucky small samples near 50. A credibility value can be computed "as of" any date, which powers the Time Machine.

### 5.3 Sharp Line (binary markets; outcome index 0 is "A")
For each open holder i: side ∈ {0, 1}, `currentValue` V, and credibility C in the market's group (fallback OVERALL; unknown counts as 0 weight).
- weight w = ((C − 50)/50)² · ln(1 + V) when C > **55**, else 0
- consensus S = Σw[side = 0] / Σw
- line L = clamp(q + λ_g · (S − q), 0.01, 0.99), where q is the market price of A
- No line when Σw < **1.0** ("not enough credible money")

### 5.4 Learning how much to trust sharps (λ per group)
Observations come from resolved markets that had a pre-close snapshot: (q, S, y).
- λ = clamp((Σ(S − q)(y − q) + κ·λ₀) / (Σ(S − q)² + κ), 0, 0.6), with **λ₀ = 0.25** and **κ = 0.5**
- A group with fewer than 1 observation uses λ₀.
- The learning curve is prequential: each market's L uses λ fitted only on markets resolved before it. Cumulative Brier of L is compared with the cumulative Brier of q.

Results are reported honestly. If sharps add nothing in a group, λ shrinks toward 0 and the app says so.

### 5.5 Picks
A user picks an outcome with a confidence c in [0.5, 0.99] **before** the market's close time. Credence stores the market price p of that outcome at pick time (plus the Kalshi price and Sharp Line if available).
- Settle with y: `edge` = y − p; `brierUser` = (c − y)²; `brierMarket` = (p − y)²
- The user's credibility is computed with the same formula as wallets (p = price at pick).
- The bias report covers overconfidence (mean c − hit rate), favorite lean (mean p of picks), and per-group edge.

## 6. Memory design (Walrus Memory, Mainnet)

SDK: `@mysten-incubation/memwal@0.1.12`. Relayer limits per account: 500 points/hour and 60 points/minute. `remember` costs 5 points and `recall` costs 1. Storage is capped at 1 GB.

**App budget:** at most 80 remembers per hour and 10 per minute. Writes go through a persistent queue (`memories` table) and are flushed with `rememberBulk` (up to 20 items).

| Namespace | Kind | Written when | Example human text |
|---|---|---|---|
| `credence-voices` | `dossier` | voice first scored (n ≥ 20) or credibility moves ≥ 5 | "Wallet 0xab…12 (GoalDigger) is sharp on SPORTS: credibility 81 over 142 resolved bets, buys at +6.2 pts below fair." |
| `credence-calls` | `call` | final snapshot before close; election calls | "Before close, the crowd had Lakers at 41%. Credible money leaned Lakers (S=0.78). Sharp Line 50%." |
| `credence-lessons` | `lesson` | market resolves | "Lakers won. The Sharp Line (50%) beat the crowd (41%). GoalDigger +2.1, 0x9f… −3.4." |
| `credence-checkpoints` | `checkpoint` | after each resolution batch (at most hourly) | "Checkpoint #37: λ SPORTS 0.31, POLITICS 0.08; 182 voices; prev blob …" |
| `credence-user-<handle>` | `pick`, `scorecard`, `preference` | a user logs a pick, settles one, or follows a league or voice | "@ravi picked NO on 'Fed cuts in Dec' at 70% confidence when the market said 58%. Reason: …" |

**Format:** each memory is a human sentence (good for semantic recall) followed by `\n§credence/v1 ` and compact JSON `{kind, data}`. All memory text goes through `encodeMemory` / `decodeMemory`. Max 12,000 chars.

**Checkpoint chain:** each checkpoint's JSON carries `seq`, `prevBlobId`, λ per group, scoring stats, and the top 100 voices `[address, group, credibility, n]`. This forms an append-only audit trail of the trust model on Walrus.

**Memory makes the product change visibly:**
- Sharp Lines and voice rankings come from remembered credibility.
- Every memory row stores an `effect`, the product change it caused (for example, "λ SPORTS 0.25 → 0.31", "Sharp Line on X 47% → 52%"). The Brain page shows it.
- **Time Machine:** a slider over checkpoints shows what Credence believed then: λ, top voices, and Sharp Lines recomputed with past memory.
- **Amnesia:** a button wipes all learned tables locally, then restores from Walrus. It uses `recall({namespace: 'credence-checkpoints', sort: 'recent', limit: 1})` and `listMemories` counts. The tagline is "Get your memory back."
- **Déjà vu:** the market page recalls similar past lessons and calls (`recall` in `credence-lessons`/`credence-calls`).
- **Personal:** pick-time warnings come from the user's memory, for example "You're 1–6 on underdogs in NFL."

## 7. Sui integration (via Tatum)

- **Client:** `SuiJsonRpcClient` with `JsonRpcHTTPTransport({ url: 'https://sui-mainnet.gateway.tatum.io', rpc: { headers: { 'x-api-key': TATUM_API_KEY } } })`. Tatum's gRPC endpoint (`sui-mainnet-grpc.gateway.tatum.io:443`) is an optional upgrade once verified.
- **Memory Proof (P1):** `getObject(MEMWAL_ACCOUNT_ID, { showContent, showOwner })` shows owner, delegate key count, active flag, and created_at. It includes "verified at checkpoint #N" (`getLatestCheckpointSequenceNumber`).
- **Receipts (P2):** a Move package `credence::receipts` with `record(kind: u8, ref_id, digest, memory_blob_id, clock)`. It emits a `Receipt` event with the onchain timestamp. Picks and pre-event calls are batched into one PTB per tick, signed by a server keypair and executed through Tatum RPC. The receipt page verifies by reading the transaction's events through Tatum RPC. Gas is about 1 SUI total for the hackathon.

## 8. Data sources and budgets

- **Tatum Prediction API** (`https://api.tatum.io/v4/data/prediction`, header `x-api-key`). Credits: markets list/get 100, positions 100, wallet history 100, top traders 200, price history 200. The free tier is 1M credits and 5 req/s. Client limits: **4 req/s**, and a **daily credit cap** (`TATUM_DAILY_CREDIT_CAP`, default 60,000) that stops non-essential calls. Every call is logged to `api_usage`.
- **Polymarket-only endpoints:** positions, wallet history, top traders, filters on status, category, tag, search, and minVolume.
- **Kalshi** via `listMarkets({ platform: 'kalshi', endingBefore, sort: 'endingSoon' })` for venue comparison.
- **Optional:** The Odds API (`ODDS_API_KEY`) for sportsbook moneylines (de-vigged average), P2.

## 9. Architecture

```
            ┌───────────── Next.js app (Vercel) ─────────────┐
 browser ──▶│ Radar · Market · Voices · Me · Brain · Receipt │
            │ API: /api/picks /api/ask /api/brain/* /api/cron│
            └───────┬──────────────────────────┬─────────────┘
                    │ reads/writes             │ runTick()
               ┌────▼─────┐   ┌────────────────▼──────────────┐
               │ SQLite / │◀──┤ engine: markets · holders ·   │◀── worker (local loop)
               │ Turso    │   │ voices · sharp · calls ·      │◀── GitHub Actions cron
               └──────────┘   │ resolve · picks · checkpoint  │
                              └──┬──────────┬──────────┬──────┘
                    Tatum Prediction API   Walrus Memory   Tatum Sui RPC
                    (markets, holders,     (Mainnet relayer) (proof, receipts)
                     wallets, leaders)
```

The local DB is a **cache and index**. What Credence *learned* lives in Walrus Memory and can be restored from it.

## 10. Pages

1. **Radar `/`:** live markets ranked by credible disagreement (|L − q|) and venue gap, with group filters. Header stats: memories stored, voices tracked, λ per group.
2. **Market `/market/[id]`:** venue prices, price chart, Sharp Line breakdown (top contributors), déjà vu memories, and a pick form.
3. **Voices `/voices`:** skill leaderboard per group with a PnL column and a "Profit ≠ skill" scatter. `/voices/[address]` shows a dossier: credibility per group, history, recent bets, and memory receipts.
4. **Me `/me`:** picks (open and settled), scorecards, calibration, and the bias report.
5. **Brain `/brain`:** memory feed (namespace, text, blob ID → Walruscan, effect), Sui Memory Proof, learning curve (Brier vs market, λ over time), Time Machine, and the Amnesia button.
6. **Receipt `/receipt/[id]`:** a shareable pick receipt with the Walrus blob and Sui transaction.

## 11. Demo script (about 3 min)

1. The Radar shows a market where the crowd says 41% and the Sharp Line says 50%. Explain why from its top contributors.
2. Open a voice: profit ≠ skill. Show the whale with big PnL and credibility 48 next to a quiet wallet with credibility 84.
3. Log a pick, and the receipt appears (Walrus blob ID + Sui tx).
4. Show the Brain: what election night taught it, with λ and credibility shifts. Then the learning curve.
5. **Amnesia:** wipe, then restore from Walrus Mainnet. The numbers come back.
6. **Time Machine:** drag back to Nov 1 and watch the Sharp Line change with less memory.

## 12. Milestones

| By (IST) | Milestone |
|---|---|
| Oct 31 | Keys verified (smoke script). Scaffold, Tatum client, DB, raw election snapshots. First 10+ Mainnet memories. |
| Nov 2 | Voices seeded and scored. Sharp Line computed. **Election calls written to memory before polls open on Nov 3.** |
| Nov 4 | Radar + Market UI. Resolutions processed on election night: lessons, λ, checkpoints. |
| Nov 6 | Picks + Me. Voices UI. Brain (feed, proof, learning curve). Worker running continuously. |
| Nov 8 | Time Machine, Amnesia, Sui receipts, déjà vu. Optional sportsbook odds. |
| Nov 10, 22:30 | Deployed, README, blog post, demo video, submitted. |

## 13. Non-goals

- No trading, custody, or betting execution. Credence is read-only on markets.
- No user accounts or passwords. Users have a handle stored in a cookie.
- No markets with more than two outcomes. Polymarket multi-outcome events are already sets of binary markets.
- No Tatum AI Builder path and no x402 payments (stretch only).

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Tatum credits run out | Daily cap, aggressive caching, budgeted ticks, usage visible on Brain |
| Relayer 429s or slow jobs | Persistent queue, bulk writes, backoff, idempotency keys, UI shows pending |
| Wrong Polymarket↔Kalshi pairing | Similarity threshold + manual overrides file; disagreement shown only for confident pairs |
| Sharp money adds no edge | λ learns toward 0. The story becomes "Credence learned the crowd is right in politics"; still a learning loop |
| Election markets resolve slowly | Sports resolve daily (NFL, NBA, soccer), so the loop keeps turning regardless |
| Judges run without keys | Degraded mode with banners; seeded demo DB snapshot in repo |

## 15. Decisions made on the user's behalf (review these)

- Name "Credence" (working). Stack: Next.js 16 + TypeScript + Tailwind, Vitest, Drizzle + libSQL (SQLite file locally, Turso in prod), Vercel.
- Constants: K = 10, credibility tanh scale 3, MIN_CREDIBILITY 55, MIN_WEIGHT 1.0, λ₀ 0.25, κ 0.5, λ max 0.6.
- App memory budget: 80 remembers/hour. Tatum: 4 req/s, 60k credits/day cap.
- Handles instead of accounts. Sui receipts are signed by a server wallet, not user wallets.
