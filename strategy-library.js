/**
 * Strategy Library — persistent store of LP strategies.
 *
 * Users paste a tweet or description via Telegram.
 * The agent extracts structured criteria and saves it here.
 * During screening, the active strategy's criteria guide token selection and position config.
 */

import fs from "fs";
import { log } from "./logger.js";

const STRATEGY_FILE = "./strategy-library.json";

function load() {
  if (!fs.existsSync(STRATEGY_FILE)) return { active: null, strategies: {} };
  try {
    return JSON.parse(fs.readFileSync(STRATEGY_FILE, "utf8"));
  } catch {
    return { active: null, strategies: {} };
  }
}

function save(data) {
  fs.writeFileSync(STRATEGY_FILE, JSON.stringify(data, null, 2));
}

// ─── Default Strategies ─────────────────────────────────────────
const DEFAULT_STRATEGIES = {
  custom_ratio_spot: {
    id: "custom_ratio_spot",
    name: "Custom Ratio Spot",
    author: "meridian",
    lp_strategy: "spot",
    token_criteria: { notes: "Any token. Ratio expresses directional bias." },
    entry: { condition: "Directional view on token", single_side: null, notes: "75% token = bullish (sell on pump out of range). 75% SOL = bearish/DCA-in (buy on dip). Set bins_below:bins_above proportional to ratio." },
    range: { type: "custom", notes: "bins_below:bins_above ratio matches token:SOL ratio. E.g., 75% token → ~52 bins below, ~17 bins above." },
    exit: { take_profit_pct: 10, notes: "Close when OOR or TP hit. Re-deploy with updated ratio based on new momentum signals." },
    best_for: "Expressing directional bias while earning fees both ways",
  },
  single_sided_reseed: {
    id: "single_sided_reseed",
    name: "Single-Sided Bid-Ask + Re-seed",
    author: "meridian",
    lp_strategy: "bid_ask",
    token_criteria: { notes: "Volatile tokens with strong narrative. Must have active volume." },
    entry: { condition: "Deploy token-only (amount_x only, amount_y=0) bid-ask, bins below active bin only", single_side: "token", notes: "As price drops through bins, token sold for SOL. Bid-ask concentrates at bottom edge." },
    range: { type: "default", bins_below_pct: 100, notes: "All bins below active bin. bins_above=0." },
    exit: { notes: "When OOR downside: close_position(skip_swap=true) → redeploy token-only bid-ask at new lower price. Do NOT swap to SOL. Full close only when token dead or after N re-seeds with declining performance." },
    best_for: "Riding volatile tokens down without cutting losses. DCA out via LP.",
  },
  fee_compounding: {
    id: "fee_compounding",
    name: "Fee Compounding",
    author: "meridian",
    lp_strategy: "any",
    token_criteria: { notes: "Stable volume pools with consistent fee generation." },
    entry: { condition: "Deploy normally with any shape", notes: "Strategy is about management, not entry shape." },
    range: { type: "default", notes: "Standard range for the pair." },
    exit: { notes: "When unclaimed fees > $5 AND in range: claim_fees → add_liquidity back into same position. Normal close rules otherwise." },
    best_for: "Maximizing yield on stable, range-bound pools via compounding",
  },
  multi_layer: {
    id: "multi_layer",
    name: "Multi-Layer",
    author: "meridian",
    lp_strategy: "mixed",
    token_criteria: { notes: "High volume pools. Layer multiple shapes into ONE position via addLiquidityByStrategy to sculpt a composite distribution." },
    entry: {
      condition: "Create ONE position, then layer additional shapes onto it with add-liquidity. Each layer adds a different strategy/shape to the same position, compositing them.",
      notes: "Step 1: deploy (creates position with first shape). Step 2+: add-liquidity to same position with different shapes. All layers share the same bin range but different distribution curves stack on top of each other.",
      example_patterns: {
        smooth_edge: "Deploy Bid-Ask (edges) → add-liquidity Spot (fills the middle gap). 2 layers, 1 position.",
        full_composite: "Deploy Bid-Ask (edges) → add-liquidity Spot (middle) → add-liquidity Curve (center boost). 3 layers, 1 position.",
        edge_heavy: "Deploy Bid-Ask → add-liquidity Bid-Ask again (double edge weight). 2 layers, 1 position.",
      },
    },
    range: { type: "custom", notes: "All layers share the position's bin range (set at deploy). Choose range wide enough for the widest layer needed." },
    exit: { notes: "Single position — one close, one claim. The composite shape means fees earned reflect ALL layers combined." },
    best_for: "Creating custom liquidity distributions by stacking shapes in one position. Single position to manage.",
  },
  partial_harvest: {
    id: "partial_harvest",
    name: "Partial Harvest",
    author: "meridian",
    lp_strategy: "any",
    token_criteria: { notes: "High fee pools where taking profit incrementally is preferred." },
    entry: { condition: "Deploy normally", notes: "Strategy is about progressive profit-taking, not entry." },
    range: { type: "default", notes: "Standard range." },
    exit: { take_profit_pct: 10, notes: "When total return >= 10% of deployed capital: withdraw_liquidity(bps=5000) to take 50% off. Remaining 50% keeps running. Repeat at next threshold." },
    best_for: "Locking in profits without fully exiting winning positions",
  },
  // ─── LP Army Strategies ────────────────────────────────────────
  bid_ask_bounce: {
    id: "bid_ask_bounce",
    name: "Bid-Ask Bounce Play",
    author: "MichaelZogot (LP Army)",
    lp_strategy: "bid_ask",
    token_criteria: {
      min_mcap: 150000,
      min_holders: 100,
      min_tvl: 10000,
      min_volume_24h: 5000,
      notes: "Tokens with strong narrative and active trading volume. Prefer tokens near support zones. Avoid tokens with high bundler concentration.",
    },
    entry: {
      condition: "Deploy single-sided SOL bid-ask when token is near a support zone or showing bounce signals. Remove auto-fill and manually adjust bins to concentrate at support levels.",
      single_side: "SOL",
      notes: "All bins below active bin. SOL enters as price drops through bins, buying token at each level. When price bounces back up, token is sold for SOL at each bin, earning swap fees. Classic bid-ask flip.",
    },
    range: {
      type: "custom",
      bins_below_pct: 100,
      bins_above_pct: 0,
      notes: "Full bid-ask: all bins below active bin. Wider range = more DCA layers but slower flip. Tighter range = faster flip but less DCA depth. Adjust based on volatility.",
    },
    exit: {
      take_profit_pct: 5,
      stop_loss_pct: -30,
      notes: "Close when position flips fully to token side and price recovers (TP). Or close if token drops below stop loss. Re-deploy at new price level if token still has narrative.",
    },
    best_for: "Earning fees on volatile tokens via bid-ask flip. Works best on tokens with strong support zones and active trading volume.",
  },
  fibonacci_range: {
    id: "fibonacci_range",
    name: "Fibonacci Range Selection",
    author: "Jajajak.sats (LP Army)",
    lp_strategy: "bid_ask",
    token_criteria: {
      min_mcap: 300000,
      min_holders: 200,
      min_tvl: 15000,
      notes: "Tokens with clear price action and Fibonacci levels. Works best on tokens with established trading history. Use with Supertrend/BB/MACD/RSI for confirmation.",
    },
    entry: {
      condition: "Identify key Fibonacci retracement levels (0.382, 0.5, 0.618) from recent swing high/low. Deploy bid-ask with bins concentrated at Fib support levels.",
      single_side: "SOL",
      notes: "Use Fibonacci retracement tool to identify support zones. Concentrate bins at 0.382, 0.5, and 0.618 levels. This creates natural DCA layers at historically significant price levels.",
    },
    range: {
      type: "fibonacci",
      fib_levels: [0.382, 0.5, 0.618],
      notes: "Range spans from 0.786 retracement (deepest support) to current price. Bin density concentrated at 0.382-0.618 zone where most bounces occur.",
    },
    exit: {
      take_profit_pct: 8,
      notes: "Close when price bounces to 0.236 or 0 (swing high) level. Or when fees earned exceed target. Re-deploy at new Fib levels after close.",
    },
    best_for: "Systematic range selection using Fibonacci levels. Proven to generate 60+ SOL profits across multiple wallets. Works with any technical indicator combo.",
  },
  bear_market_accumulation: {
    id: "bear_market_accumulation",
    name: "Bear Market SOL Accumulation",
    author: "LP Army Collective",
    lp_strategy: "bid_ask",
    token_criteria: {
      min_mcap: 500000,
      min_holders: 100,
      min_tvl: 10000,
      notes: "Focus on tokens with strong fundamentals that survive bear markets. Avoid low-cap memecoins. Prefer tokens with real utility or strong community.",
    },
    entry: {
      condition: "Deploy bid-ask positions during bear market. Use DLMM as DCA mechanism to accumulate SOL while earning fees. Focus on tokens that hold value during market downturns.",
      single_side: "SOL",
      notes: "Bear market = accumulation phase. Deploy SOL-side bid-ask to buy tokens at discount prices. Earn fees from the volatility of the downtrend. Goal: lower cost basis to almost nothing.",
    },
    range: {
      type: "wide",
      bins_below_pct: 80,
      bins_above_pct: 20,
      notes: "Wider range during bear markets to capture more price movement. 80% below for DCA buying, 20% above for fee earning on bounces.",
    },
    exit: {
      take_profit_pct: 15,
      notes: "Longer hold periods in bear market. Close only when: (1) position is profitable and fees are good, (2) token fundamentals deteriorate, (3) market shows signs of reversal and better opportunities exist.",
    },
    best_for: "Accumulating SOL during bear markets. Treat LP like a business, not trading. Stay calm during nukes. Use volatility to lower cost basis.",
  },
  bear_market_daily_yield: {
    id: "bear_market_daily_yield",
    name: "Bear Market Daily Yield",
    author: "Bojjifomo (LP Army)",
    lp_strategy: "bid_ask",
    token_criteria: {
      min_mcap: 500000,
      min_holders: 100,
      min_tvl: 10000,
      min_volume_24h: 5000,
      notes: "Newbie-friendly bear market strategy. Focus on tokens with consistent daily volume. Bear season in DLMM is different from spot - volume still exists for fee capture.",
    },
    entry: {
      condition: "Deploy during bear market on tokens with active daily volume. DLMM works differently from spot trading - bear seasons have happened 3-4 times for memecoins but DLMM still generates fees.",
      single_side: "SOL",
      notes: "Entry is straightforward - find tokens with daily volume > $5K and deploy bid-ask. The key insight: bear market for memecoins != bear market for DLMM. Volume still exists.",
    },
    range: {
      type: "default",
      notes: "Standard range. Let the agent's volatility-based bin calculation handle the range. Focus on execution, not range optimization.",
    },
    exit: {
      min_fee_per_tvl_24h: 7,
      notes: "Close when daily yield drops below 7% fee/TVL. Or when token volume dies completely. Re-deploy on next active token.",
    },
    best_for: "Consistent daily yield generation during bear markets. Perfect for newcomers to DLMM LPing. Focus on volume, not price direction.",
  },
  deep_winter_sol_stacking: {
    id: "deep_winter_sol_stacking",
    name: "Deep Winter SOL Stacking",
    author: "MichaelZogot (LP Army)",
    lp_strategy: "bid_ask",
    token_criteria: {
      min_mcap: 1000000,
      min_holders: 500,
      min_tvl: 50000,
      notes: "Only high-conviction tokens with strong fundamentals. This is a long-term positioning strategy for the next bull market (2028/29). Focus on SOL and BTC pairs.",
    },
    entry: {
      condition: "Deploy during early bear market. Position for the next bull cycle by stacking SOL through LP fees. Use the volatility of the downtrend to accumulate.",
      single_side: "SOL",
      notes: "This is the Positioning Phase. The bear market is not the loss phase - it's when you build your stack. Deploy on SOL/BTC pairs and let the volatility work for you.",
    },
    range: {
      type: "wide",
      bins_below_pct: 70,
      bins_above_pct: 30,
      notes: "Wide range for long-term positioning. 70% below for accumulation, 30% above for fee capture on bounces. Don't rebalance frequently - let the position work.",
    },
    exit: {
      take_profit_pct: 25,
      notes: "Very long hold periods. Close only when: (1) bull market is confirmed and better opportunities exist, (2) position has generated 25%+ return, (3) token fundamentals deteriorate significantly.",
    },
    best_for: "Long-term SOL accumulation during bear markets. Position for the next bull cycle. Patience is the edge.",
  },
  bid_ask_flip: {
    id: "bid_ask_flip",
    name: "Bid-Ask Flip on Strong Tokens",
    author: "Jaypee (LP Army)",
    lp_strategy: "bid_ask",
    token_criteria: {
      min_mcap: 500000,
      min_holders: 200,
      min_tvl: 20000,
      notes: "Tokens with strong fundamentals and active trading. Focus on tokens that hold value during market downturns. Avoid tokens with high bot holder percentage.",
    },
    entry: {
      condition: "Deploy bid-ask flip positions on tokens with strong fundamentals. Core focus during bear market: bid-ask flip positions on tokens with strong community and active volume.",
      single_side: "SOL",
      notes: "Bid-ask flip: SOL enters as price drops, tokens are sold as price recovers. The flip happens naturally as price oscillates. Each flip earns swap fees.",
    },
    range: {
      type: "tight",
      bins_below_pct: 60,
      bins_above_pct: 40,
      notes: "Tighter range for faster flips. 60/40 split favors SOL-side for bear market bias. Adjust ratio based on market sentiment.",
    },
    exit: {
      take_profit_pct: 5,
      notes: "Quick flips. Close when position flips and earns target profit. Re-deploy immediately on same or different token. Compound gains by increasing position size.",
    },
    best_for: "Active bear market strategy. Flip positions on strong tokens to generate consistent returns. Works best with high-volume tokens.",
  },
  bear_market_majors_lp: {
    id: "bear_market_majors_lp",
    name: "Bear Market Majors LP",
    author: "Mikus (LP Army)",
    lp_strategy: "bid_ask",
    token_criteria: {
      pair_requirements: ["SOL/USDC", "BTC/USDC", "SOL/USDT"],
      min_tvl: 100000,
      notes: "LP majors like SOL and BTC during bear markets. These pairs have the highest volume and most consistent fee generation. Best strategy for bear market period.",
    },
    entry: {
      condition: "Deploy on SOL/BTC major pairs during bear market. Use DLMM to LP these pairs and earn fees from the high trading volume.",
      notes: "Majors have the most consistent volume even in bear markets. SOL and BTC pairs generate reliable fees. This is the safest bear market LP strategy.",
    },
    range: {
      type: "default",
      notes: "Standard range for major pairs. Let the agent's volatility-based calculation handle the range. Focus on execution.",
    },
    exit: {
      min_fee_per_tvl_24h: 5,
      notes: "Close when yield drops below 5% fee/TVL. Major pairs are lower yield but more consistent. Re-deploy on same pair.",
    },
    best_for: "Safe, consistent yield during bear markets. LP majors for reliable fee generation. Lower yield but higher safety.",
  },
};

function ensureDefaultStrategies() {
  const db = load();
  let added = false;
  for (const [id, strategy] of Object.entries(DEFAULT_STRATEGIES)) {
    if (!db.strategies[id]) {
      db.strategies[id] = {
        ...strategy,
        added_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      added = true;
    }
  }
  if (added) {
    if (!db.active) db.active = "custom_ratio_spot";
    save(db);
    log("strategy", "Preloaded default strategies");
  }
}

ensureDefaultStrategies();

// ─── Tool Handlers ─────────────────────────────────────────────

/**
 * Add or update a strategy.
 * The agent parses the raw tweet/text and fills in the structured fields.
 */
export function addStrategy({
  id,
  name,
  author = "unknown",
  lp_strategy = "bid_ask",       // "bid_ask" | "spot" | "curve"
  token_criteria = {},           // { min_mcap, min_age_days, requires_kol, notes }
  entry = {},                    // { condition, price_change_threshold_pct, single_side }
  range = {},                    // { type, bins_below_pct, notes }
  exit = {},                     // { take_profit_pct, notes }
  best_for = "",                 // short description of ideal conditions
  raw = "",                      // original tweet/text
}) {
  if (!id || !name) return { error: "id and name are required" };

  const db = load();

  // Slugify id
  const slug = id.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

  db.strategies[slug] = {
    id: slug,
    name,
    author,
    lp_strategy,
    token_criteria,
    entry,
    range,
    exit,
    best_for,
    raw,
    added_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Auto-set as active if it's the first strategy
  if (!db.active) db.active = slug;

  save(db);
  log("strategy", `Strategy saved: ${name} (${slug})`);
  return { saved: true, id: slug, name, active: db.active === slug };
}

/**
 * List all strategies with a summary.
 */
export function listStrategies() {
  const db = load();
  const strategies = Object.values(db.strategies).map((s) => ({
    id: s.id,
    name: s.name,
    author: s.author,
    lp_strategy: s.lp_strategy,
    best_for: s.best_for,
    active: db.active === s.id,
    added_at: s.added_at?.slice(0, 10),
  }));
  return { active: db.active, count: strategies.length, strategies };
}

/**
 * Get full details of a strategy including raw text and all criteria.
 */
export function getStrategy({ id }) {
  if (!id) return { error: "id required" };
  const db = load();
  const strategy = db.strategies[id];
  if (!strategy) return { error: `Strategy "${id}" not found`, available: Object.keys(db.strategies) };
  return { ...strategy, is_active: db.active === id };
}

/**
 * Set the active strategy used during screening cycles.
 */
export function setActiveStrategy({ id }) {
  if (!id) return { error: "id required" };
  const db = load();
  if (!db.strategies[id]) return { error: `Strategy "${id}" not found`, available: Object.keys(db.strategies) };
  db.active = id;
  save(db);
  log("strategy", `Active strategy set to: ${db.strategies[id].name}`);
  return { active: id, name: db.strategies[id].name };
}

/**
 * Remove a strategy.
 */
export function removeStrategy({ id }) {
  if (!id) return { error: "id required" };
  const db = load();
  if (!db.strategies[id]) return { error: `Strategy "${id}" not found` };
  const name = db.strategies[id].name;
  delete db.strategies[id];
  if (db.active === id) db.active = Object.keys(db.strategies)[0] || null;
  save(db);
  log("strategy", `Strategy removed: ${name}`);
  return { removed: true, id, name, new_active: db.active };
}

/**
 * Get the currently active strategy — used by screening cycle.
 */
export function getActiveStrategy() {
  const db = load();
  if (!db.active || !db.strategies[db.active]) return null;
  return db.strategies[db.active];
}
