/* politics/lobbying.js — external influence groups.
 *
 * Industry & interest lobbies sit outside the elected government but constantly
 * push it. Each group has an agenda expressed against the existing law book
 * (laws it favours / opposes), a base influence, and a "deal" it can offer the
 * mayor: cash and political capital now, in exchange for backing its agenda —
 * and a quiet rise in the city's corruption level.
 *
 * Data only; the Government engine reads this to drive satisfaction, vote bias,
 * deal offers, corruption and scandals.
 */

const LOBBY_GROUPS = [
  {
    id: 'construction', name: 'Builders & Contractors', icon: '🏗️', color: '#f59e0b',
    blurb: 'Wants shovels in the ground — stimulus, looser zoning, fewer codes.',
    favors: ['infra_spend', 'zoning_reform', 'biz_incentive'],
    opposes: ['building_codes', 'emissions', 'rent_control'],
    influence: 0.9, donation: { money: 9000, capital: 2 }, graft: 14,
  },
  {
    id: 'auto', name: 'Automotive Alliance', icon: '🚗', color: '#ef4444',
    blurb: 'Cheap fuel, fast roads, no speed limits, light-touch emissions.',
    favors: ['coal_subsidy', 'tax_cut', 'infra_spend'],
    opposes: ['transit', 'speed_limits', 'emissions'],
    influence: 0.8, donation: { money: 8000, capital: 2 }, graft: 13,
  },
  {
    id: 'transit', name: 'Transit Workers Union', icon: '🚆', color: '#22c55e',
    blurb: 'Public transport investment, jobs, and a strong social safety net.',
    favors: ['transit', 'edu_budget', 'welfare'],
    opposes: ['austerity', 'coal_subsidy', 'tax_cut'],
    influence: 0.75, donation: { money: 6000, capital: 3 }, graft: 9,
  },
  {
    id: 'green', name: 'Green Coalition', icon: '🌱', color: '#10b981',
    blurb: 'Emissions limits, renewables, transit and strict building standards.',
    favors: ['emissions', 'green_energy', 'transit', 'building_codes'],
    opposes: ['coal_subsidy', 'zoning_reform', 'open_borders'],
    influence: 0.7, donation: { money: 5000, capital: 3 }, graft: 8,
  },
  {
    id: 'realestate', name: 'Real Estate Board', icon: '🏢', color: '#a855f7',
    blurb: 'Upzoning, tax cuts and incentives; no rent control or red tape.',
    favors: ['zoning_reform', 'tax_cut', 'biz_incentive'],
    opposes: ['rent_control', 'building_codes', 'housing_grants'],
    influence: 0.85, donation: { money: 10000, capital: 2 }, graft: 16,
  },
];

const LOBBY_BY_ID = Object.fromEntries(LOBBY_GROUPS.map(g => [g.id, g]));

if (typeof module !== 'undefined') module.exports = { LOBBY_GROUPS, LOBBY_BY_ID };
