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

  // ───────── Additional events ─────────
  { id: 'festival', title: 'City Festival Proposal', cat: 'Culture', weight: 6, blurb: 'Promoters pitch a huge street festival.', choices: [
    { label: 'Fund it fully', desc: 'Costly but joyful.', effects: { money: -6000, approval: 4, happyAddTmp: 0.06, news: 'City throws its biggest festival yet!' } },
    { label: 'Public-private mix', desc: 'Share the cost.', effects: { money: -2000, approval: 2, happyAddTmp: 0.03, news: 'Sponsored festival lights up downtown.' } },
    { label: 'Decline', desc: 'Save the cash.', effects: { approval: -1, news: 'Council passes on festival plan.' } } ] },
  { id: 'strike', title: 'Transit Workers Strike', cat: 'Labor', weight: 6, blurb: 'Bus and metro staff threaten to walk out.', choices: [
    { label: 'Meet their demands', desc: 'Costly peace.', effects: { money: -7000, approval: 2, popularity: { soc: 2 }, news: 'Pay deal averts transit strike.' } },
    { label: 'Hold firm', desc: 'Risk chaos.', effects: { approval: -4, stability: -4, happyAddTmp: -0.05, news: 'Transit grinds to a halt as strike begins.' } } ] },
  { id: 'flood', title: 'Flood Warning', cat: 'Disaster', weight: 5, blurb: 'Heavy rains threaten low-lying districts.', choices: [
    { label: 'Emergency flood defenses', desc: 'Spend to protect.', effects: { money: -9000, approval: 3, stability: 3, news: 'Flood barriers spare the city the worst.' } },
    { label: 'Hope it passes', desc: 'Gamble.', effects: { money: -3000, approval: -5, stability: -5, happyAddTmp: -0.06, news: 'Floods damage homes; mayor faces blame.' } } ] },
  { id: 'blackout', title: 'Power Grid Strain', cat: 'Infrastructure', weight: 6, blurb: 'Demand is outpacing supply; brownouts loom.', choices: [
    { label: 'Emergency generators', desc: 'Quick, dirty fix.', effects: { money: -5000, approval: 1, news: 'Generators keep the lights on.' } },
    { label: 'Rolling blackouts', desc: 'Ration power.', effects: { approval: -4, happyAddTmp: -0.05, news: 'Rolling blackouts anger residents.' } } ] },
  { id: 'startup_pitch', title: 'Unicorn Startup', cat: 'Economy', weight: 6, blurb: 'A fast-growing startup wants HQ incentives.', choices: [
    { label: 'Offer the package', desc: 'Bet on jobs.', effects: { money: -8000, approval: 3, popularity: { con: 2, lib: 1 }, news: 'Startup HQ to bring thousands of jobs.' } },
    { label: 'Negotiate equity', desc: 'Share the upside.', effects: { money: 5000, approval: 1, news: 'City takes a stake in startup deal.' } } ] },
  { id: 'pandemic', title: 'Disease Outbreak', cat: 'Health', weight: 4, blurb: 'A contagious illness is spreading.', choices: [
    { label: 'Fund response & testing', desc: 'Costly, responsible.', effects: { money: -10000, approval: 3, stability: 2, news: 'Swift health response contains outbreak.' } },
    { label: 'Downplay it', desc: 'Risky inaction.', effects: { approval: -6, stability: -5, happyAddTmp: -0.08, news: 'Outbreak worsens amid slow response.' } } ] },
  { id: 'olympics', title: 'Host the Games?', cat: 'Culture', weight: 3, when: g => g.game.sim.population > 8000, blurb: 'The city is shortlisted to host a global sporting event.', choices: [
    { label: 'Bid to host', desc: 'Prestige & tourism, huge cost.', effects: { money: -20000, approval: 6, happyAddTmp: 0.08, news: 'City wins bid to host the Games!' } },
    { label: 'Withdraw', desc: 'Too risky.', effects: { approval: -2, news: 'City pulls out of hosting race.' } } ] },
  { id: 'wildfire', title: 'Wildfire Risk', cat: 'Disaster', weight: 4, blurb: 'A dry season raises wildfire danger at the edges.', choices: [
    { label: 'Prevention crews', desc: 'Fund firebreaks.', effects: { money: -5000, stability: 3, news: 'Fire crews clear brush ahead of the season.' } },
    { label: 'Cross fingers', desc: 'Save money.', effects: { approval: -3, stability: -4, news: 'Wildfire scorches outskirts; criticism mounts.' } } ] },
  { id: 'tech_grant', title: 'National Tech Grant', cat: 'Economy', weight: 6, blurb: 'A national fund offers an innovation grant — with strings.', choices: [
    { label: 'Accept conditions', desc: 'Cash for compliance.', effects: { money: 12000, approval: 2, news: 'City lands major tech grant.' } },
    { label: 'Decline strings', desc: 'Keep autonomy.', effects: { approval: 1, popularity: { libt: 2 }, news: 'City rejects grant over conditions.' } } ] },
  { id: 'protest_march', title: 'Mass Protest', cat: 'Civil', weight: 6, when: g => g.approval < 45, blurb: 'Thousands march over the cost of living.', choices: [
    { label: 'Meet the organisers', desc: 'Listen & concede.', effects: { approval: 3, stability: 4, happyAddTmp: 0.03, news: 'Mayor meets protest leaders, pledges action.' } },
    { label: 'Deploy police', desc: 'Show of force.', effects: { approval: -4, stability: -3, popularity: { libt: -2 }, news: 'Heavy-handed response draws condemnation.' } } ] },
  { id: 'art_donation', title: 'Billionaire Art Gift', cat: 'Culture', weight: 5, blurb: 'A patron offers a world-class art collection — if you build a wing.', choices: [
    { label: 'Build the wing', desc: 'Invest in culture.', effects: { money: -7000, approval: 3, happyAddTmp: 0.04, news: 'New museum wing draws global acclaim.' } },
    { label: 'Politely decline', desc: 'Not now.', effects: { approval: -1, news: 'City declines costly art gift.' } } ] },
  { id: 'water_short', title: 'Water Shortage', cat: 'Infrastructure', weight: 5, blurb: 'A drought is draining reservoirs.', choices: [
    { label: 'Mandatory rationing', desc: 'Unpopular but prudent.', effects: { approval: -3, stability: 2, happyAddTmp: -0.03, news: 'Water rationing imposed during drought.' } },
    { label: 'Emergency pipeline', desc: 'Expensive fix.', effects: { money: -11000, approval: 2, news: 'New pipeline secures water supply.' } } ] },
  { id: 'crime_wave', title: 'Crime Wave', cat: 'Safety', weight: 6, when: g => g.drivers.crime > 0.45, blurb: 'A spike in crime has residents on edge.', choices: [
    { label: 'Surge policing', desc: 'Costly crackdown.', effects: { money: -6000, approval: 3, stability: 3, news: 'Police surge brings crime under control.' } },
    { label: 'Social programs', desc: 'Address root causes.', effects: { money: -4000, approval: 1, happyAddTmp: 0.03, popularity: { soc: 2, grn: 1 }, news: 'City invests in youth & jobs to fight crime.' } } ] },
  { id: 'film_studio', title: 'Film Studio Interest', cat: 'Economy', weight: 5, blurb: 'A studio scouts the city for a production hub.', choices: [
    { label: 'Tax credits', desc: 'Lure the cameras.', effects: { money: -5000, approval: 2, happyAddTmp: 0.03, news: 'Hollywood comes to town with new studio.' } },
    { label: 'Pass', desc: 'Not worth it.', effects: { news: 'Studio looks elsewhere.' } } ] },
  { id: 'corruption_tip', title: 'Whistleblower Tip', cat: 'Scandal', weight: 5, blurb: 'An insider offers evidence of contractor kickbacks.', choices: [
    { label: 'Investigate fully', desc: 'Clean house.', effects: { approval: 2, stability: 3, media: 2, news: 'Probe roots out contractor corruption.' } },
    { label: 'Bury it', desc: 'Avoid scandal.', effects: { money: -4000, media: -2, stability: -2, news: 'Quiet settlement raises eyebrows.' } } ] },
  { id: 'green_award', title: 'Green City Award', cat: 'Environment', weight: 5, when: g => g.game.sim.avgPollution < 0.15, blurb: 'The city is nominated for a sustainability prize.', choices: [
    { label: 'Campaign for it', desc: 'Spend on the bid.', effects: { money: -3000, approval: 4, happyAddTmp: 0.05, popularity: { grn: 3 }, news: 'City wins national Green City award!' } },
    { label: 'Stay humble', desc: 'Let results speak.', effects: { approval: 2, popularity: { grn: 1 }, news: 'City quietly celebrates clean-air milestone.' } } ] },
  { id: 'refugees', title: 'Refugee Resettlement', cat: 'Immigration', weight: 5, blurb: 'A national program asks the city to resettle families.', choices: [
    { label: 'Welcome them', desc: 'Growth & goodwill, polarising.', effects: { approval: 1, happyAddTmp: 0.02, popularity: { soc: 2, grn: 1, nat: -2 }, news: 'City opens its doors to refugees.' } },
    { label: 'Decline quota', desc: 'Avoid friction.', effects: { popularity: { nat: 2, soc: -2 }, news: 'City declines resettlement request.' } } ] },
  { id: 'stadium_deal', title: 'Pro Team Relocation', cat: 'Culture', weight: 4, when: g => g.game.sim.population > 12000, blurb: 'A pro sports team will relocate — if you fund a stadium.', choices: [
    { label: 'Fund the stadium', desc: 'Civic pride, big spend.', effects: { money: -18000, approval: 5, happyAddTmp: 0.06, news: 'Pro team coming to town!' } },
    { label: 'Refuse subsidy', desc: 'Protect taxpayers.', effects: { approval: 1, popularity: { libt: 2 }, news: 'City refuses to subsidise stadium.' } } ] },
  { id: 'data_breach', title: 'City Data Breach', cat: 'Tech', weight: 5, blurb: 'Hackers breach municipal systems.', choices: [
    { label: 'Invest in cybersecurity', desc: 'Fix it properly.', effects: { money: -6000, approval: 1, stability: 2, news: 'City hardens defenses after breach.' } },
    { label: 'Minimal response', desc: 'Hope it blows over.', effects: { approval: -3, media: -2, news: 'Critics slam weak response to data breach.' } } ] },
  { id: 'trade_deal', title: 'Regional Trade Pact', cat: 'Economy', weight: 5, blurb: 'Neighbouring cities propose a trade alliance.', choices: [
    { label: 'Join the pact', desc: 'Open markets.', effects: { money: 4000, approval: 2, popularity: { con: 1, lib: 1 }, news: 'City joins regional trade alliance.' } },
    { label: 'Protect local firms', desc: 'Go it alone.', effects: { popularity: { nat: 2 }, news: 'City opts out of trade pact.' } } ] },
  { id: 'heatwave', title: 'Record Heatwave', cat: 'Disaster', weight: 5, blurb: 'A brutal heatwave endangers vulnerable residents.', choices: [
    { label: 'Open cooling centers', desc: 'Protect people.', effects: { money: -3000, approval: 3, happyAddTmp: 0.02, news: 'Cooling centers save lives in heatwave.' } },
    { label: 'Issue advisories only', desc: 'Cheap.', effects: { approval: -2, happyAddTmp: -0.03, news: 'Heatwave strains the city; questions over response.' } } ] },
  { id: 'university_bid', title: 'New University Campus', cat: 'Education', weight: 4, blurb: 'A university wants to open a campus downtown.', choices: [
    { label: 'Donate the land', desc: 'Invest in knowledge.', effects: { money: -9000, approval: 4, happyAddTmp: 0.04, popularity: { lib: 2, grn: 1 }, news: 'New university campus to anchor downtown.' } },
    { label: 'Sell at market rate', desc: 'Fill the coffers.', effects: { money: 7000, approval: 1, news: 'University buys downtown site.' } } ] },
  { id: 'mural_project', title: 'Public Art Initiative', cat: 'Culture', weight: 6, blurb: 'Local artists propose murals across the city.', choices: [
    { label: 'Commission murals', desc: 'Brighten the streets.', effects: { money: -2000, approval: 2, happyAddTmp: 0.03, popularity: { grn: 1, lib: 1 }, news: 'Vibrant murals transform the city.' } },
    { label: 'Decline', desc: 'Not a priority.', effects: { approval: -1, news: 'Mural plan shelved.' } } ] },
  { id: 'pension_crisis', title: 'Pension Shortfall', cat: 'Economy', weight: 5, blurb: 'The city pension fund is underfunded.', choices: [
    { label: 'Top it up now', desc: 'Responsible, costly.', effects: { money: -12000, approval: 1, stability: 3, news: 'City shores up pension fund.' } },
    { label: 'Kick the can', desc: 'Defer the problem.', effects: { approval: -2, stability: -3, news: 'Pension gap left for the future.' } } ] },
];

if (typeof module !== 'undefined') module.exports = { POL_EVENTS };
