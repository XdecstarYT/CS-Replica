/* politics/parties.js — political parties as ideology vectors.
 *
 * Every party, law and the electorate's "mood" are expressed on the same five
 * ideological axes, each in [-1, +1]. This lets one generic similarity function
 * drive party appeal, bill voting, and coalition maths — no per-pair hand-coding.
 *
 *   econ   : -1 left  (tax & spend, welfare)        .. +1 right (low tax, business)
 *   env    : -1 industry-first                       .. +1 environmentalist
 *   auth   : -1 libertarian (small state, liberty)   .. +1 authoritarian (law & order)
 *   social : -1 progressive                          .. +1 traditional / conservative
 *   nat    : -1 globalist / open                      .. +1 nationalist / closed
 */

const POL_AXES = ['econ', 'env', 'auth', 'social', 'nat'];

const PARTIES = [
  {
    id: 'con', name: 'Conservative Party', short: 'CON', color: '#3b82f6',
    blurb: 'Lower taxes, strong policing, business-friendly, tradition.',
    base: 0.20, vec: { econ: 0.6, env: -0.2, auth: 0.35, social: 0.7, nat: 0.4 },
  },
  {
    id: 'lib', name: 'Liberal Alliance', short: 'LIB', color: '#f59e0b',
    blurb: 'Free markets with a social conscience, civil liberties, openness.',
    base: 0.18, vec: { econ: 0.1, env: 0.4, auth: -0.35, social: -0.5, nat: -0.4 },
  },
  {
    id: 'grn', name: 'Green Future', short: 'GRN', color: '#22c55e',
    blurb: 'Climate first, sustainable transit, parks, clean energy.',
    base: 0.12, vec: { econ: -0.4, env: 1.0, auth: -0.1, social: -0.4, nat: -0.5 },
  },
  {
    id: 'soc', name: 'Socialist Workers', short: 'SOC', color: '#ef4444',
    blurb: 'Public services, welfare, workers, wealth redistribution.',
    base: 0.14, vec: { econ: -0.9, env: 0.5, auth: 0.1, social: -0.3, nat: -0.3 },
  },
  {
    id: 'libt', name: 'Libertarian League', short: 'LBT', color: '#a855f7',
    blurb: 'Minimal government, maximal freedom, deregulation, low tax.',
    base: 0.08, vec: { econ: 0.8, env: -0.3, auth: -0.9, social: -0.1, nat: -0.2 },
  },
  {
    id: 'nat', name: 'National Front', short: 'NAT', color: '#92400e',
    blurb: 'Borders, security, local jobs first, traditional values.',
    base: 0.10, vec: { econ: 0.2, env: -0.4, auth: 0.7, social: 0.8, nat: 1.0 },
  },
  {
    id: 'ind', name: 'Independents', short: 'IND', color: '#94a3b8',
    blurb: 'Pragmatic centrists with no fixed dogma.',
    base: 0.10, vec: { econ: 0.0, env: 0.0, auth: 0.0, social: 0.0, nat: 0.0 },
  },
];

const PARTY_BY_ID = Object.fromEntries(PARTIES.map(p => [p.id, p]));

// Cosine-like similarity in [-1, 1] between two ideology vectors.
function polSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const k of POL_AXES) {
    const av = a[k] || 0, bv = b[k] || 0;
    dot += av * bv; na += av * av; nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

// Demographic voter cohorts. Sizes are re-weighted each cycle from city stats;
// each cohort carries its own ideological lean and the issues it cares about.
const VOTER_COHORTS = [
  { id: 'working',  label: 'Working families', lean: { econ: -0.5, env: 0.0, auth: 0.1, social: 0.0, nat: 0.1 }, cares: ['jobs', 'housing', 'taxes'] },
  { id: 'affluent', label: 'Affluent professionals', lean: { econ: 0.5, env: 0.2, auth: -0.1, social: -0.2, nat: -0.2 }, cares: ['taxes', 'crime', 'services'] },
  { id: 'young',    label: 'Young & students', lean: { econ: -0.2, env: 0.6, auth: -0.4, social: -0.6, nat: -0.5 }, cares: ['housing', 'environment', 'jobs'] },
  { id: 'seniors',  label: 'Seniors', lean: { econ: 0.2, env: -0.1, auth: 0.4, social: 0.6, nat: 0.4 }, cares: ['healthcare', 'crime', 'taxes'] },
  { id: 'business', label: 'Business owners', lean: { econ: 0.7, env: -0.2, auth: -0.2, social: 0.1, nat: 0.1 }, cares: ['taxes', 'business', 'services'] },
];

if (typeof module !== 'undefined') module.exports = { PARTIES, PARTY_BY_ID, POL_AXES, polSimilarity, VOTER_COHORTS };
