import { ability as abilityData } from './data';
import type { BattleEvent, StageKey, Status, Terrain, Weather } from './types';

const WEATHER_TEXT: Record<Weather, { start: string; end: string; residual: string }> = {
  none: { start: '', end: '', residual: '' },
  sun: { start: 'De zon gaat fel schijnen!', end: 'De zon zwakt af.', residual: '' },
  rain: { start: 'Het begint te regenen!', end: 'De regen stopt.', residual: '' },
  sand: { start: 'Een zandstorm steekt op!', end: 'De zandstorm gaat liggen.', residual: 'De zandstorm raast.' },
  hail: { start: 'Het begint te sneeuwen!', end: 'De sneeuw stopt.', residual: 'De sneeuwstorm raast.' },
};
const TERRAIN_TEXT: Record<Terrain, { start: string; end: string }> = {
  none: { start: '', end: '' },
  electric: { start: 'Elektriciteit knettert over het veld!', end: 'De elektriciteit verdwijnt.' },
  grassy: { start: 'Gras overwoekert het veld!', end: 'Het gras verdwijnt.' },
  psychic: { start: 'Het veld wordt vreemd!', end: 'Het veld wordt weer normaal.' },
  misty: { start: 'Mist bedekt het veld!', end: 'De mist trekt weg.' },
};

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
    case 'weather':
      return WEATHER_TEXT[e.weather][e.text];
    case 'terrain':
      return TERRAIN_TEXT[e.terrain][e.text];
    case 'protect':
      return `${e.name} beschermt zichzelf!`;
    case 'charge':
      return `${e.name} zet ${e.move} in!`;
    case 'ability': {
      const a = abilityData(e.ability).name;
      switch (e.text) {
        case 'intimidate':
          return `${a} van ${e.name} intimideert de tegenstander!`;
        case 'immune':
          return `${a} van ${e.name} maakt de aanval onschadelijk!`;
        case 'endure':
          return `${e.name} houdt stand dankzij ${a}!`;
        case 'contact':
          return `${a} van ${e.name} straft de aanraking af!`;
        case 'cure':
          return `${a} geneest ${e.name}.`;
        case 'boost':
          return `${a} van ${e.name} treedt in werking!`;
        case 'no-drop':
          return `${a} van ${e.name} voorkomt de verlaging!`;
        case 'loaf':
          return `${e.name} luiert...`;
        case 'weather':
        case 'terrain':
          return `${a} van ${e.name} verandert het veld!`;
      }
      return `${a} van ${e.name}!`;
    }
    case 'faint':
      return `${e.name} is uitgeschakeld!`;
    case 'end':
      return `Speler ${e.winner === 'a' ? 'A' : 'B'} wint!`;
  }
}
