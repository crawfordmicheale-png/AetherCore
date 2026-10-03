// @ts-check
/**
 * Generates a card's rules text from its derived stats, so the text always
 * matches the numbers the engine will use.
 */
import { STATUS_DEFS } from './statuses.js';

/** @param {string} kind */
const statusName = (kind) => STATUS_DEFS[kind]?.name ?? kind;

/**
 * @param {import('./card.js').Rider} rider
 * @returns {string}
 */
export function riderText(rider) {
  switch (rider.kind) {
    case 'crush':
      return 'Crush (2× damage to Block)';
    case 'pierce':
      return 'Pierce (ignores Block)';
    case 'reinforce':
      return `Reinforce (+${rider.stacks} Block if you have Block)`;
    case 'ward':
      return 'Ward (prevent the next debuff)';
    case 'rime':
      return 'Rime (this Block persists)';
    case 'charge':
      return `Gain ${rider.stacks} Charge`;
    case 'searing':
      return `Searing ${rider.stacks}`;
    default:
      return `Apply ${rider.stacks} ${statusName(rider.kind)}`;
  }
}

/**
 * @param {import('./card.js').DerivedCard} d
 * @returns {string[]} one entry per line of rules text
 */
export function cardRulesText(d) {
  /** @type {string[]} */
  const lines = [];
  if (d.verb === 'attack') {
    const where =
      d.target === 'all' ? ' to ALL enemies' : d.target === 'random' ? ' to random enemies' : '';
    const times = d.hits > 1 ? ` ${d.hits} times` : '';
    lines.push(`Deal ${d.valuePerHit} damage${where}${times}.`);
    if (d.rider) lines.push(`${riderText(d.rider)}.`);
  } else if (d.verb === 'defend') {
    lines.push(`Gain ${d.valuePerHit * d.hits} Block.`);
    if (d.rider) lines.push(`${riderText(d.rider)}.`);
  } else if (d.utility === 'conduit') {
    lines.push(d.rider ? `${riderText(d.rider)}.` : 'No effect (Core has no status rider).');
  } else if (d.utility === 'relay') {
    if (d.rider) lines.push(`${riderText(d.rider)}.`);
    lines.push(`Draw ${d.draw}.`);
  }
  lines.push(...d.modText);
  if (d.suppressed.mod) lines.push('[Mod suppressed]');
  if (d.suppressed.coreRider) lines.push('[Rider suppressed]');
  const keywords = d.keywords.map((k) =>
    k === 'exhaust' && d.overclock > 0 ? 'Exhaust (Overclocked)' : k[0].toUpperCase() + k.slice(1),
  );
  if (keywords.length) lines.push(`${keywords.join('. ')}.`);
  return lines;
}
