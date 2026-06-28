/* politics/events.js — random political events with branching choices.
 *
 * Each choice carries a standard `effects` block the Government applies:
 *   money        flat treasury change ($)
 *   approval     approval delta (points)
 *   stability    civic-stability delta (− = unrest)
 *   happyAddTmp  temporary citywide happiness nudge that decays
 *   popularity   { partyId: delta }  shift a party's standing
 *   relations    { intlId: delta }   shift a foreign relationship
 *   enact/repeal lawId to force-activate / deactivate
 *   media        bias nudge (− critical, + favourable)
 *   news         headline announced after the choice
 *
 * `weight` sets base frequency; optional `when(gov)` gates availability.
 */

const POL_EVENTS = [
  {
    id: 'corruption', title: 'Corruption Investigation', cat: 'Scandal', weight: 8,
    blurb: 'Auditors flag irregular payments inside city hall. How do you respond?',
    choices: [
      { label: 'Open public inquiry', desc: 'Transparent but damaging short term.',
        effects: { approval: -3, stability: 4, media: 2, news: 'Mayor launches open inquiry into corruption claims.' } },
      { label: 'Quietly settle', desc: 'Make it disappear — for now.',
        effects: { money: -8000, approval: 1, media: -2, stability: -3, news: 'Officials downplay audit; critics smell a cover-up.' } },
      { label: 'Deny everything', desc: 'Risky if it resurfaces.',
        effects: { approval: -1, media: -3, stability: -2, news: 'City hall flatly denies wrongdoing.' } },
    ],
  },
  {
    id: 'boom', title: 'Economic Boom', cat: 'Economy', weight: 7,
    blurb: 'A tech employer wants to relocate downtown.',
    choices: [
      { label: 'Roll out the red carpet', desc: 'Tax breaks for jobs.',
        effects: { money: -5000, approval: 4, happyAddTmp: 0.05, popularity: { con: 2, lib: 2 }, news: 'Major employer chooses our city — thousands of jobs incoming!' } },
      { label: 'Demand community benefits', desc: 'Harder bargain.',
        effects: { money: 6000, approval: 2, popularity: { soc: 2, grn: 1 }, news: 'City secures community fund from incoming employer.' } },
    ],
  },
  {
    id: 'recession', title: 'Recession Warning', cat: 'Economy', weight: 6,
    blurb: 'Regional downturn threatens the budget.',
    choices: [
      { label: 'Stimulus spending', desc: 'Borrow to grow.',
        effects: { money: -10000, approval: 2, happyAddTmp: 0.03, news: 'Council approves emergency stimulus package.' } },
      { label: 'Tighten the belt', desc: 'Cuts to weather the storm.',
        effects: { money: 4000, approval: -4, happyAddTmp: -0.05, popularity: { soc: -2 }, news: 'Austerity measures announced amid downturn fears.' } },
    ],
  },
  {
    id: 'housing_crisis', title: 'Housing Affordability Crisis', cat: 'Housing', weight: 7,
    when: g => g.drivers.housing < 0.45,
    blurb: 'Rents are spiralling and families are priced out.',
    choices: [
      { label: 'Emergency rent caps', desc: 'Popular, distorts the market.',
        effects: { approval: 5, enact: 'rent_control', popularity: { soc: 3, grn: 2 }, news: 'Emergency rent caps imposed citywide.' } },
      { label: 'Fast-track new builds', desc: 'Supply-side fix.',
        effects: { approval: 2, enact: 'zoning_reform', popularity: { lib: 2, con: 1 }, news: 'City fast-tracks thousands of new homes.' } },
      { label: 'Do nothing', desc: 'Let the market sort it.',
        effects: { approval: -6, stability: -5, news: 'Officials face backlash for housing inaction.' } },
    ],
  },
  {
    id: 'pandemic', title: 'Public Health Emergency', cat: 'Crisis', weight: 5,
    blurb: 'An outbreak is spreading through the city.',
    choices: [
      { label: 'Strict lockdown', desc: 'Saves lives, hurts the economy.',
        effects: { money: -12000, approval: -2, happyAddTmp: -0.08, stability: 3, news: 'Mayor orders lockdown to contain outbreak.' } },
      { label: 'Stay open, fund hospitals', desc: 'Risky balance.',
        effects: { money: -6000, approval: 1, happyAddTmp: -0.03, news: 'City funds hospitals but keeps businesses open.' } },
    ],
  },
  {
    id: 'celebrity', title: 'Celebrity Endorsement', cat: 'Campaign', weight: 6,
    blurb: 'A beloved local star offers to back the administration.',
    choices: [
      { label: 'Accept gratefully', desc: 'A polling bump.',
        effects: { approval: 4, media: 2, news: 'Celebrity endorsement lifts the mayor in the polls.' } },
      { label: 'Politely decline', desc: 'Stay above it.',
        effects: { approval: 0, media: 1, news: 'Mayor declines celebrity endorsement, citing independence.' } },
    ],
  },
  {
    id: 'cyber', title: 'Cyber Attack on City Systems', cat: 'Crisis', weight: 5,
    blurb: 'Ransomware has locked municipal services.',
    choices: [
      { label: 'Pay the ransom', desc: 'Fast, sets a precedent.',
        effects: { money: -15000, approval: -1, news: 'City quietly pays ransom to restore services.' } },
      { label: 'Refuse, rebuild systems', desc: 'Painful but principled.',
        effects: { money: -7000, approval: -3, stability: -2, happyAddTmp: -0.04, news: 'Services down for days after refusing ransom demand.' } },
    ],
  },
  {
    id: 'budget_crisis', title: 'Budget Crisis', cat: 'Economy', weight: 6,
    when: g => g.game.sim.money < 5000,
    blurb: 'The treasury is dangerously low.',
    choices: [
      { label: 'Issue municipal bonds', desc: 'Debt now, interest later.',
        effects: { money: 20000, approval: -1, news: 'City issues bonds to cover shortfall.' } },
      { label: 'Slash services', desc: 'Brutal but immediate.',
        effects: { money: 8000, approval: -6, happyAddTmp: -0.06, news: 'Deep service cuts spark public anger.' } },
    ],
  },
  {
    id: 'leadership', title: 'Leadership Challenge', cat: 'Politics', weight: 4,
    blurb: 'Rivals within the ruling bloc question your leadership.',
    choices: [
      { label: 'Face them down', desc: 'Show strength.',
        effects: { approval: 2, stability: -2, news: 'Mayor sees off leadership challenge.' } },
      { label: 'Offer concessions', desc: 'Buy peace.',
        effects: { approval: -1, stability: 3, popularity: { ind: 2 }, news: 'Backroom deal settles leadership dispute.' } },
    ],
  },
  {
    id: 'foreign_invest', title: 'Foreign Investment Offer', cat: 'International', weight: 6,
    blurb: 'An overseas fund offers to invest in city infrastructure.',
    choices: [
      { label: 'Accept the capital', desc: 'Money now, strings attached.',
        effects: { money: 18000, approval: 1, relations: { eastland: 8 }, popularity: { nat: -2 }, news: 'Foreign fund invests heavily in city infrastructure.' } },
      { label: 'Protect local control', desc: 'Sovereignty over cash.',
        effects: { approval: 2, relations: { eastland: -4 }, popularity: { nat: 3 }, news: 'City rejects foreign bid, citing local control.' } },
    ],
  },
  {
    id: 'sanctions', title: 'Trade Dispute', cat: 'International', weight: 4,
    blurb: 'A neighbouring region threatens tariffs.',
    choices: [
      { label: 'Negotiate a deal', desc: 'Compromise.',
        effects: { money: -3000, relations: { westmark: 6 }, approval: 1, news: 'Trade deal averts tariffs with neighbouring region.' } },
      { label: 'Retaliate', desc: 'Stand firm.',
        effects: { money: -6000, relations: { westmark: -10 }, popularity: { nat: 3 }, approval: -1, news: 'Tit-for-tat tariffs hit local businesses.' } },
    ],
  },
  {
    id: 'protest_wave', title: 'Mass Demonstration', cat: 'Unrest', weight: 6,
    when: g => g.approval < 45,
    blurb: 'Thousands march on city hall demanding change.',
    choices: [
      { label: 'Meet the organisers', desc: 'De-escalate.',
        effects: { approval: 3, stability: 5, happyAddTmp: 0.02, news: 'Mayor meets protest leaders; tensions ease.' } },
      { label: 'Send in police', desc: 'Order, at a cost.',
        effects: { approval: -5, stability: -6, media: -2, popularity: { nat: 1, libt: -2 }, news: 'Heavy-handed response to protest draws condemnation.' } },
    ],
  },
  {
    id: 'infra_proposal', title: 'Grand Infrastructure Proposal', cat: 'Infrastructure', weight: 5,
    blurb: 'Engineers pitch a transformative transit project.',
    choices: [
      { label: 'Fund it', desc: 'Bold and costly.',
        effects: { money: -14000, approval: 3, enact: 'transit', happyAddTmp: 0.04, news: 'City greenlights landmark transit megaproject.' } },
      { label: 'Shelve it', desc: 'Too expensive for now.',
        effects: { approval: -2, news: 'Ambitious transit plan shelved over costs.' } },
    ],
  },
  {
    id: 'inquiry', title: 'Public Inquiry Demanded', cat: 'Scandal', weight: 4,
    blurb: 'Campaigners demand an inquiry into a service failure.',
    choices: [
      { label: 'Grant it', desc: 'Accountability.',
        effects: { approval: 2, stability: 3, media: 1, news: 'Independent inquiry into service failures announced.' } },
      { label: 'Reject it', desc: 'Looks defensive.',
        effects: { approval: -4, media: -2, news: 'Government refuses inquiry, drawing criticism.' } },
    ],
  },
  {
    id: 'grant', title: 'National Grant Available', cat: 'International', weight: 5,
    blurb: 'A national fund offers a development grant — with conditions.',
    choices: [
      { label: 'Take green strings', desc: 'Cash for climate targets.',
        effects: { money: 12000, enact: 'green_energy', popularity: { grn: 2 }, news: 'City wins national green development grant.' } },
      { label: 'Decline conditions', desc: 'Keep your hands free.',
        effects: { approval: 0, news: 'City passes on conditional national grant.' } },
    ],
  },
  {
    id: 'whistleblower', title: 'Whistleblower Leak', cat: 'Scandal', weight: 4,
    blurb: 'Leaked documents embarrass the administration.',
    choices: [
      { label: 'Own it & reform', desc: 'Turn the page.',
        effects: { approval: -2, stability: 4, media: 1, news: 'Mayor pledges reform after damaging leak.' } },
      { label: 'Hunt the leaker', desc: 'Authoritarian look.',
        effects: { approval: -3, media: -3, popularity: { libt: -3 }, news: 'Crackdown on whistleblower alarms civil-liberties groups.' } },
    ],
  },
];

if (typeof module !== 'undefined') module.exports = { POL_EVENTS };
