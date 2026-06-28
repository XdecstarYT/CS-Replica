/* politics/laws.js — the law book.
 *
 * Each law carries an ideology vector (how parties feel about it, via
 * polSimilarity) and an `fx` block of concrete, default-neutral effects that
 * are aggregated into the city's policy modifiers and citizen issue-satisfaction.
 *
 * fx fields (all optional, neutral by default):
 *   taxMult     multiplies weekly tax revenue          (1 = neutral)
 *   revenueAdd  flat weekly treasury income ($)
 *   upkeepAdd   flat weekly treasury cost ($)
 *   growthMult  multiplies zone occupancy growth        (1 = neutral)
 *   happyAdd    additive citywide happiness             (+/-, ~±0.1 scale)
 *   crime       delta to crime index                    (− = safer)
 *   pollution   delta to pollution index                (− = cleaner)
 *   approval    one-off approval shock on passage
 *   issues      per-issue satisfaction deltas { housing, jobs, taxes, ... }
 */

const LAWS = [
  // ── Taxation ──
  { id: 'tax_cut', name: 'Income Tax Cut', cat: 'Tax', vec: { econ: 0.8, auth: -0.2 },
    desc: 'Reduce income tax. Boosts growth & business mood, lowers revenue.',
    fx: { taxMult: 0.85, growthMult: 1.12, happyAdd: 0.04, issues: { taxes: 0.4, jobs: 0.1 } } },
  { id: 'tax_hike', name: 'Progressive Tax Hike', cat: 'Tax', vec: { econ: -0.8 },
    desc: 'Raise taxes on high earners to fund services.',
    fx: { taxMult: 1.18, growthMult: 0.94, happyAdd: -0.03, issues: { taxes: -0.3, services: 0.2 } } },
  { id: 'corp_tax', name: 'Corporate Tax Relief', cat: 'Tax', vec: { econ: 0.7, nat: -0.1 },
    desc: 'Cut corporate tax to attract employers.',
    fx: { taxMult: 0.93, growthMult: 1.10, revenueAdd: 0, issues: { jobs: 0.3, business: 0.4, taxes: 0.1 } } },

  // ── Housing ──
  { id: 'rent_control', name: 'Rent Control', cat: 'Housing', vec: { econ: -0.6, social: -0.2 },
    desc: 'Cap rents. Helps affordability, dampens new building.',
    fx: { growthMult: 0.9, happyAdd: 0.06, issues: { housing: 0.5, business: -0.2 } } },
  { id: 'housing_grants', name: 'Affordable Housing Grants', cat: 'Housing', vec: { econ: -0.4, env: 0.1 },
    desc: 'Subsidise homes. Costly but popular.',
    fx: { upkeepAdd: 220, growthMult: 1.08, happyAdd: 0.05, issues: { housing: 0.5 } } },

  // ── Immigration ──
  { id: 'open_borders', name: 'Open Immigration', cat: 'Immigration', vec: { nat: -0.9, econ: -0.1 },
    desc: 'Welcome newcomers. Faster growth, polarising.',
    fx: { growthMult: 1.18, happyAdd: -0.02, issues: { jobs: 0.2, housing: -0.1 } } },
  { id: 'border_control', name: 'Strict Immigration', cat: 'Immigration', vec: { nat: 0.9, auth: 0.4 },
    desc: 'Tighten borders. Slows growth, reassures some voters.',
    fx: { growthMult: 0.9, issues: { jobs: 0.1, crime: 0.1 } } },

  // ── Environment / Energy ──
  { id: 'emissions', name: 'Emissions Regulations', cat: 'Environment', vec: { env: 0.9, econ: -0.3 },
    desc: 'Limit industrial pollution. Cleaner air, pricier industry.',
    fx: { pollution: -0.35, growthMult: 0.95, happyAdd: 0.05, issues: { environment: 0.5, business: -0.2 } } },
  { id: 'green_energy', name: 'Renewable Energy Mandate', cat: 'Energy', vec: { env: 0.8, econ: -0.2 },
    desc: 'Mandate clean power. Costly upfront, popular.',
    fx: { upkeepAdd: 160, pollution: -0.2, happyAdd: 0.04, issues: { environment: 0.4 } } },
  { id: 'coal_subsidy', name: 'Cheap Energy Subsidy', cat: 'Energy', vec: { env: -0.7, econ: 0.4 },
    desc: 'Subsidise cheap power for industry.',
    fx: { upkeepAdd: 120, growthMult: 1.08, pollution: 0.2, issues: { business: 0.3, environment: -0.4 } } },

  // ── Policing / Crime / Emergency ──
  { id: 'police_fund', name: 'Increase Police Funding', cat: 'Policing', vec: { auth: 0.7, econ: 0.1 },
    desc: 'More officers. Lowers crime, costs money.',
    fx: { upkeepAdd: 180, crime: -0.3, happyAdd: 0.03, issues: { crime: 0.5 } } },
  { id: 'defund_police', name: 'Reallocate Police Budget', cat: 'Policing', vec: { auth: -0.7, econ: -0.2 },
    desc: 'Shift funds to social programs. Divisive.',
    fx: { upkeepAdd: -120, crime: 0.15, issues: { services: 0.3, crime: -0.2 } } },
  { id: 'tough_crime', name: 'Tough-on-Crime Act', cat: 'Crime', vec: { auth: 0.8, social: 0.5 },
    desc: 'Harsher sentencing.',
    fx: { crime: -0.2, happyAdd: -0.02, issues: { crime: 0.4 } } },
  { id: 'emergency_powers', name: 'Emergency Powers Act', cat: 'Emergency', vec: { auth: 1.0 },
    desc: 'Sweeping executive authority during crises. Order up, liberty down.',
    fx: { crime: -0.25, happyAdd: -0.08, approval: -4, issues: { crime: 0.3, services: -0.2 } } },

  // ── Healthcare / Education / Welfare ──
  { id: 'universal_health', name: 'Universal Healthcare', cat: 'Healthcare', vec: { econ: -0.7, env: 0.1 },
    desc: 'Public healthcare for all. Expensive, very popular.',
    fx: { upkeepAdd: 300, happyAdd: 0.08, issues: { healthcare: 0.6 } } },
  { id: 'edu_budget', name: 'Education Investment', cat: 'Education', vec: { econ: -0.4, env: 0.1 },
    desc: 'Fund schools. Long-term growth & happiness.',
    fx: { upkeepAdd: 200, growthMult: 1.05, happyAdd: 0.04, issues: { services: 0.4 } } },
  { id: 'welfare', name: 'Welfare Expansion', cat: 'Welfare', vec: { econ: -0.8 },
    desc: 'Safety net for the unemployed.',
    fx: { upkeepAdd: 240, happyAdd: 0.06, issues: { jobs: 0.3, services: 0.3 } } },
  { id: 'austerity', name: 'Austerity Package', cat: 'Welfare', vec: { econ: 0.7 },
    desc: 'Deep spending cuts to balance the books.',
    fx: { upkeepAdd: -300, happyAdd: -0.07, approval: -5, issues: { services: -0.4, taxes: 0.2 } } },

  // ── Transport / Infrastructure / Traffic ──
  { id: 'transit', name: 'Public Transport Investment', cat: 'Transport', vec: { env: 0.6, econ: -0.3 },
    desc: 'Fund transit. Less traffic & pollution.',
    fx: { upkeepAdd: 170, pollution: -0.15, happyAdd: 0.05, issues: { environment: 0.3, services: 0.2 } } },
  { id: 'infra_spend', name: 'Infrastructure Stimulus', cat: 'Infrastructure', vec: { econ: -0.2, auth: 0.1 },
    desc: 'Big public works program.',
    fx: { upkeepAdd: 220, growthMult: 1.1, happyAdd: 0.03, issues: { jobs: 0.4 } } },
  { id: 'speed_limits', name: 'Lower Speed Limits', cat: 'Traffic', vec: { auth: 0.4, env: 0.3 },
    desc: 'Safer streets, mildly unpopular with drivers.',
    fx: { crime: -0.05, happyAdd: -0.01, issues: { crime: 0.1, environment: 0.1 } } },

  // ── Business / Zoning / Building ──
  { id: 'biz_incentive', name: 'Business Incentives', cat: 'Business', vec: { econ: 0.6 },
    desc: 'Grants & breaks to attract firms.',
    fx: { upkeepAdd: 140, growthMult: 1.12, issues: { jobs: 0.4, business: 0.5 } } },
  { id: 'zoning_reform', name: 'Zoning Liberalisation', cat: 'Zoning', vec: { econ: 0.4, env: -0.1 },
    desc: 'Relax zoning to allow denser, faster building.',
    fx: { growthMult: 1.15, happyAdd: -0.01, issues: { housing: 0.3, business: 0.2 } } },
  { id: 'building_codes', name: 'Strict Building Codes', cat: 'Building', vec: { auth: 0.4, env: 0.3 },
    desc: 'Safety & efficiency standards. Slower, safer building.',
    fx: { growthMult: 0.93, pollution: -0.1, happyAdd: 0.03, issues: { environment: 0.2, housing: -0.1 } } },

  // ── Civil liberties / vice ──
  { id: 'free_speech', name: 'Free Speech Charter', cat: 'Civil Rights', vec: { auth: -0.8, social: -0.2 },
    desc: 'Strong protections for expression & assembly.',
    fx: { happyAdd: 0.04, issues: { services: 0.1 } } },
  { id: 'gambling', name: 'Legalise Casinos', cat: 'Gambling', vec: { social: -0.3, econ: 0.3 },
    desc: 'Tax revenue from gambling, with social cost.',
    fx: { revenueAdd: 260, crime: 0.12, happyAdd: -0.02, issues: { taxes: 0.2, crime: -0.1 } } },
  { id: 'alcohol', name: 'Relaxed Alcohol Laws', cat: 'Alcohol', vec: { auth: -0.4, social: -0.3 },
    desc: 'Looser licensing. Nightlife revenue, more disorder.',
    fx: { revenueAdd: 140, crime: 0.08, happyAdd: 0.02, issues: { business: 0.2, crime: -0.1 } } },
];

const LAW_BY_ID = Object.fromEntries(LAWS.map(l => [l.id, l]));
const LAW_CATEGORIES = [...new Set(LAWS.map(l => l.cat))];

if (typeof module !== 'undefined') module.exports = { LAWS, LAW_BY_ID, LAW_CATEGORIES };
