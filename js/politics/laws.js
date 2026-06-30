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

  // ── Transport ──
  { id: 'transit', name: 'Mass Transit Investment', cat: 'Transport', vec: { env: 0.6, econ: -0.2 }, desc: 'Fund buses & metro. Eases congestion, costs money.', fx: { upkeepAdd: 200, happyAdd: 0.05, pollution: -0.12, issues: { transport: 0.5, environment: 0.2 } } },
  { id: 'bike_lanes', name: 'Citywide Bike Lanes', cat: 'Transport', vec: { env: 0.7, social: -0.2 }, desc: 'Protected cycle network. Greener, healthier.', fx: { happyAdd: 0.04, pollution: -0.08, issues: { transport: 0.3, environment: 0.3 } } },
  { id: 'congestion_charge', name: 'Congestion Charge', cat: 'Transport', vec: { env: 0.6, econ: -0.1 }, desc: 'Toll the core. Revenue + cleaner air, unpopular with drivers.', fx: { revenueAdd: 220, pollution: -0.15, happyAdd: -0.03, issues: { transport: -0.2, environment: 0.3 } } },
  { id: 'free_transit', name: 'Free Public Transport', cat: 'Transport', vec: { econ: -0.6, env: 0.5 }, desc: 'Fare-free transit. Very popular, very costly.', fx: { upkeepAdd: 360, happyAdd: 0.08, pollution: -0.12, issues: { transport: 0.6 } } },
  { id: 'highway', name: 'Highway Expansion', cat: 'Transport', vec: { econ: 0.5, env: -0.5 }, desc: 'More road capacity. Growth now, sprawl & smog later.', fx: { growthMult: 1.08, pollution: 0.12, issues: { transport: 0.3, environment: -0.3 } } },

  // ── Health ──
  { id: 'public_health', name: 'Universal Healthcare', cat: 'Health', vec: { econ: -0.7, social: -0.3 }, desc: 'Care for all. Costly but loved.', fx: { upkeepAdd: 300, happyAdd: 0.08, issues: { health: 0.6 } } },
  { id: 'mental_health', name: 'Mental Health Program', cat: 'Health', vec: { social: -0.3, econ: -0.3 }, desc: 'Clinics & outreach. Lowers crime, costs money.', fx: { upkeepAdd: 160, crime: -0.08, happyAdd: 0.04, issues: { health: 0.3, crime: 0.2 } } },
  { id: 'vaccination', name: 'Vaccination Drive', cat: 'Health', vec: { social: -0.2, env: 0.1 }, desc: 'Public immunisation. Healthier workforce.', fx: { upkeepAdd: 120, growthMult: 1.04, happyAdd: 0.03, issues: { health: 0.4 } } },
  { id: 'soda_tax', name: 'Sugar Tax', cat: 'Health', vec: { auth: 0.4, env: 0.2 }, desc: 'Tax junk food. Revenue + health, mild grumbling.', fx: { revenueAdd: 110, happyAdd: -0.02, issues: { health: 0.2, taxes: -0.1 } } },

  // ── Education ──
  { id: 'free_college', name: 'Free Higher Education', cat: 'Education', vec: { econ: -0.6, social: -0.3 }, desc: 'Tuition-free college. Skilled workforce, big bill.', fx: { upkeepAdd: 320, growthMult: 1.06, happyAdd: 0.05, issues: { education: 0.6 } } },
  { id: 'school_choice', name: 'School Choice Vouchers', cat: 'Education', vec: { econ: 0.5, auth: -0.1 }, desc: 'Vouchers for private schools. Divisive.', fx: { happyAdd: 0.01, issues: { education: 0.2, taxes: -0.1 } } },
  { id: 'stem_grants', name: 'STEM Research Grants', cat: 'Education', vec: { econ: 0.2, env: 0.2 }, desc: 'Fund science & tech. Long-run growth.', fx: { upkeepAdd: 140, growthMult: 1.05, issues: { education: 0.3, business: 0.2 } } },
  { id: 'adult_ed', name: 'Adult Re-skilling', cat: 'Education', vec: { econ: -0.2, social: -0.2 }, desc: 'Retrain workers. Cuts unemployment.', fx: { upkeepAdd: 110, growthMult: 1.04, issues: { jobs: 0.3, education: 0.2 } } },

  // ── Labor & welfare ──
  { id: 'min_wage', name: 'Higher Minimum Wage', cat: 'Labor', vec: { econ: -0.7 }, desc: 'Raise the floor. Popular, pricier for business.', fx: { happyAdd: 0.05, growthMult: 0.97, issues: { jobs: 0.3, business: -0.3 } } },
  { id: 'ubi', name: 'Universal Basic Income', cat: 'Welfare', vec: { econ: -0.9, social: -0.3 }, desc: 'Cash for all citizens. Hugely popular, hugely costly.', fx: { upkeepAdd: 500, happyAdd: 0.10, growthMult: 1.05, issues: { housing: 0.3, jobs: 0.2 } } },
  { id: 'unemployment', name: 'Unemployment Benefits', cat: 'Welfare', vec: { econ: -0.5 }, desc: 'Support job-seekers. Safety net, ongoing cost.', fx: { upkeepAdd: 200, happyAdd: 0.04, issues: { jobs: 0.3 } } },
  { id: 'paid_leave', name: 'Paid Family Leave', cat: 'Labor', vec: { econ: -0.5, social: -0.4 }, desc: 'Mandated leave. Popular, slight business drag.', fx: { happyAdd: 0.05, growthMult: 0.98, issues: { jobs: 0.2 } } },
  { id: 'right_to_work', name: 'Right-to-Work Law', cat: 'Labor', vec: { econ: 0.7 }, desc: 'Weaken unions. Business-friendly, divisive.', fx: { growthMult: 1.07, happyAdd: -0.02, issues: { business: 0.4, jobs: -0.1 } } },

  // ── Business & tech ──
  { id: 'startup_zone', name: 'Startup Enterprise Zone', cat: 'Business', vec: { econ: 0.7, env: -0.1 }, desc: 'Tax breaks for new firms. Jobs magnet.', fx: { taxMult: 0.96, growthMult: 1.12, issues: { business: 0.5, jobs: 0.3 } } },
  { id: 'tourism_board', name: 'Tourism Board', cat: 'Business', vec: { econ: 0.4 }, desc: 'Market the city. Boosts attraction revenue.', fx: { upkeepAdd: 90, revenueAdd: 180, happyAdd: 0.02, issues: { business: 0.3 } } },
  { id: 'broadband', name: 'Municipal Broadband', cat: 'Tech', vec: { econ: -0.2, env: 0.1 }, desc: 'Public high-speed internet. Modern & popular.', fx: { upkeepAdd: 130, growthMult: 1.05, happyAdd: 0.04, issues: { business: 0.3, education: 0.2 } } },
  { id: 'smart_city', name: 'Smart City Sensors', cat: 'Tech', vec: { econ: 0.3, auth: 0.3 }, desc: 'IoT traffic & utility optimisation.', fx: { upkeepAdd: 150, pollution: -0.06, happyAdd: 0.03, issues: { transport: 0.2, services: 0.2 } } },
  { id: 'crypto_hub', name: 'Crypto & Fintech Hub', cat: 'Tech', vec: { econ: 0.8, auth: -0.3 }, desc: 'Court digital finance. Volatile revenue.', fx: { revenueAdd: 240, growthMult: 1.04, crime: 0.05, issues: { business: 0.4 } } },

  // ── Environment (more) ──
  { id: 'carbon_tax', name: 'Carbon Tax', cat: 'Environment', vec: { env: 0.9, econ: -0.4 }, desc: 'Price pollution. Cleaner air, revenue, business cost.', fx: { revenueAdd: 200, pollution: -0.3, growthMult: 0.96, issues: { environment: 0.5, business: -0.3 } } },
  { id: 'tree_planting', name: 'Urban Reforestation', cat: 'Environment', vec: { env: 0.8 }, desc: 'Plant a million trees. Cleaner, happier.', fx: { upkeepAdd: 90, pollution: -0.15, happyAdd: 0.05, issues: { environment: 0.4 } } },
  { id: 'plastic_ban', name: 'Single-Use Plastic Ban', cat: 'Environment', vec: { env: 0.7, auth: 0.2 }, desc: 'Cut waste. Greener, minor business gripe.', fx: { pollution: -0.1, happyAdd: 0.02, issues: { environment: 0.3, business: -0.1 } } },
  { id: 'recycle_mandate', name: 'Mandatory Recycling', cat: 'Environment', vec: { env: 0.7, auth: 0.3 }, desc: 'Required sorting. Cleaner city.', fx: { upkeepAdd: 70, pollution: -0.12, issues: { environment: 0.3 } } },
  { id: 'green_roofs', name: 'Green Roof Incentive', cat: 'Environment', vec: { env: 0.6, econ: -0.1 }, desc: 'Subsidise living roofs. Cooler, cleaner.', fx: { upkeepAdd: 80, pollution: -0.08, happyAdd: 0.03, issues: { environment: 0.3, housing: 0.1 } } },

  // ── Safety & justice ──
  { id: 'cctv', name: 'Public CCTV Network', cat: 'Policing', vec: { auth: 0.8, social: 0.2 }, desc: 'Cameras everywhere. Less crime, privacy cost.', fx: { upkeepAdd: 120, crime: -0.12, happyAdd: -0.02, issues: { crime: 0.3 } } },
  { id: 'community_policing', name: 'Community Policing', cat: 'Policing', vec: { auth: 0.1, social: -0.2 }, desc: 'Officers on the beat building trust.', fx: { upkeepAdd: 130, crime: -0.1, happyAdd: 0.04, issues: { crime: 0.3, services: 0.1 } } },
  { id: 'curfew', name: 'Night Curfew', cat: 'Policing', vec: { auth: 0.9, social: 0.3 }, desc: 'Restrict night movement. Order over freedom.', fx: { crime: -0.15, happyAdd: -0.06, issues: { crime: 0.3 } } },
  { id: 'decriminalize', name: 'Drug Decriminalisation', cat: 'Justice', vec: { auth: -0.8, social: -0.3 }, desc: 'Treatment over jail. Divisive, frees resources.', fx: { upkeepAdd: -60, crime: -0.04, happyAdd: 0.02, issues: { crime: 0.1, health: 0.2 } } },

  // ── Housing (more) ──
  { id: 'zoning_reform', name: 'Upzoning Reform', cat: 'Housing', vec: { econ: 0.5, env: -0.1 }, desc: 'Allow denser building. More homes, faster growth.', fx: { growthMult: 1.15, happyAdd: 0.02, issues: { housing: 0.4, business: 0.2 } } },
  { id: 'homeless_program', name: 'Housing-First Program', cat: 'Housing', vec: { econ: -0.5, social: -0.3 }, desc: 'House the homeless directly. Costly, compassionate.', fx: { upkeepAdd: 220, crime: -0.06, happyAdd: 0.05, issues: { housing: 0.4, crime: 0.1 } } },
  { id: 'heritage', name: 'Heritage Protection', cat: 'Housing', vec: { env: 0.3, auth: 0.3 }, desc: 'Protect old districts. Charming but slows building.', fx: { growthMult: 0.94, happyAdd: 0.04, issues: { housing: -0.1, environment: 0.2 } } },

  // ── Governance / civic ──
  { id: 'participatory_budget', name: 'Participatory Budgeting', cat: 'Governance', vec: { auth: -0.5, social: -0.2 }, desc: 'Let residents allocate funds. Builds trust.', fx: { happyAdd: 0.05, issues: { services: 0.3 } } },
  { id: 'open_data', name: 'Open Government Data', cat: 'Governance', vec: { auth: -0.4, econ: 0.2 }, desc: 'Publish city data. Transparency & innovation.', fx: { happyAdd: 0.02, growthMult: 1.02, issues: { services: 0.2, business: 0.1 } } },
  { id: 'sister_city', name: 'Sister City Program', cat: 'Governance', vec: { nat: -0.6, econ: 0.2 }, desc: 'Build foreign ties. Trade & goodwill.', fx: { revenueAdd: 90, happyAdd: 0.02, issues: { business: 0.2 } } },
];

const LAW_BY_ID = Object.fromEntries(LAWS.map(l => [l.id, l]));
const LAW_CATEGORIES = [...new Set(LAWS.map(l => l.cat))];

if (typeof module !== 'undefined') module.exports = { LAWS, LAW_BY_ID, LAW_CATEGORIES };
