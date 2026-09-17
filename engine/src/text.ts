import type { BattleEvent, StageKey, Status } from './types';

const STAT_NAMES: Record<StageKey, string> = {
  atk: 'Attack',
  def: 'Defense',
  spa: 'Sp. Atk',
  spd: 'Sp. Def',
  spe: 'Speed',
  acc: 'accuracy',
  eva: 'evasion',
};

const STATUS_NAMES: Record<Status, string> = {
  none: '',
  par: 'verlamd',
  slp: 'in slaap gevallen',
  brn: 'verbrand',
  psn: 'vergiftigd',
  tox: 'zwaar vergiftigd',
  frz: 'bevroren',
};

export function describe(e: BattleEvent): string {
  switch (e.type) {
    case 'turn':
      return `Beurt ${e.turn}`;
    case 'switch':
      return `${e.name} komt in het veld!`;
    case 'move':
      return `${e.name} gebruikt ${e.move}!`;
    case 'miss':
      return `De aanval van ${e.name} mist!`;
    case 'fail':
      return `Maar het mislukt...`;
    case 'damage': {
      if (e.effectiveness === 0) return `Het heeft geen effect op ${e.name}...`;
      const parts: string[] = [];
      if (e.crit) parts.push('Critical hit!');
      if (e.effectiveness > 1) parts.push('Super effectief!');
      if (e.effectiveness < 1) parts.push('Niet zo effectief...');
      parts.push(`${e.name} verliest ${e.amount} HP.`);
      return parts.join(' ');
    }
    case 'heal':
      return `${e.name} herstelt ${e.amount} HP.`;
    case 'stat':
      if (e.change === 0) return `${STAT_NAMES[e.stat]} van ${e.name} kan niet verder.`;
      return `${STAT_NAMES[e.stat]} van ${e.name} ${e.change > 0 ? 'stijgt' : 'daalt'}${Math.abs(e.change) > 1 ? ' flink' : ''}!`;
    case 'status':
      return `${e.name} is ${STATUS_NAMES[e.status]}!`;
    case 'cure':
      return `${e.name} is weer gezond.`;
    case 'statusEffect':
      switch (e.text) {
        case 'skip':
          return e.status === 'par' ? `${e.name} is verlamd en kan niet bewegen!` : e.status === 'slp' ? `${e.name} slaapt.` : `${e.name} is bevroren!`;
        case 'thaw':
          return `${e.name} ontdooit!`;
        case 'wake':
          return `${e.name} wordt wakker!`;
        case 'residual':
          return `${e.name} heeft last van ${e.status === 'brn' ? 'de brandwond' : 'het gif'}.`;
      }
      return '';
    case 'flinch':
      return `${e.name} deinst terug!`;
    case 'faint':
      return `${e.name} is uitgeschakeld!`;
    case 'end':
      return `Speler ${e.winner === 'a' ? 'A' : 'B'} wint!`;
  }
}
