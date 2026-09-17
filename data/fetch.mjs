import { writeFileSync } from 'node:fs';

const ENDPOINT = 'https://beta.pokeapi.co/graphql/v1beta';

async function gql(query) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const pokemonData = await gql(`{
  pokemon_v2_pokemon(where: {id: {_lte: 1025}}, order_by: {id: asc}) {
    id name
    pokemon_v2_pokemontypes(order_by: {slot: asc}) { pokemon_v2_type { name } }
    pokemon_v2_pokemonstats { base_stat pokemon_v2_stat { name } }
    pokemon_v2_pokemonspecy { pokemon_v2_pokemonspeciesnames(where: {language_id: {_eq: 9}}) { name } }
  }
}`);

const statKey = { hp: 'hp', attack: 'atk', defense: 'def', 'special-attack': 'spa', 'special-defense': 'spd', speed: 'spe' };
const pokemon = {};
for (const p of pokemonData.pokemon_v2_pokemon) {
  const base = {};
  for (const s of p.pokemon_v2_pokemonstats) base[statKey[s.pokemon_v2_stat.name]] = s.base_stat;
  pokemon[p.id] = {
    id: p.id,
    name: p.pokemon_v2_pokemonspecy?.pokemon_v2_pokemonspeciesnames[0]?.name ?? p.name,
    slug: p.name,
    types: p.pokemon_v2_pokemontypes.map((t) => t.pokemon_v2_type.name),
    base,
  };
}

const moveData = await gql(`{
  pokemon_v2_move(where: {pokemon_v2_movedamageclass: {name: {_neq: ""}}}, order_by: {id: asc}) {
    id name power accuracy pp priority move_effect_chance
    pokemon_v2_type { name }
    pokemon_v2_movedamageclass { name }
    pokemon_v2_movetarget { name }
    pokemon_v2_movemeta { min_hits max_hits min_turns max_turns drain healing crit_rate ailment_chance flinch_chance stat_chance
      pokemon_v2_movemetaailment { name } pokemon_v2_movemetacategory { name } }
    pokemon_v2_movemetastatchanges { change pokemon_v2_stat { name } }
    pokemon_v2_movenames(where: {language_id: {_eq: 9}}) { name }
    pokemon_v2_moveeffect { pokemon_v2_moveeffecteffecttexts(where: {language_id: {_eq: 9}}) { short_effect } }
  }
}`);

const moves = {};
for (const m of moveData.pokemon_v2_move) {
  const meta = m.pokemon_v2_movemeta[0] ?? {};
  moves[m.name] = {
    id: m.id,
    slug: m.name,
    name: m.pokemon_v2_movenames[0]?.name ?? m.name,
    type: m.pokemon_v2_type.name,
    category: m.pokemon_v2_movedamageclass.name,
    power: m.power,
    accuracy: m.accuracy,
    pp: m.pp,
    priority: m.priority,
    target: m.pokemon_v2_movetarget?.name ?? 'selected-pokemon',
    effectChance: m.move_effect_chance,
    minHits: meta.min_hits,
    maxHits: meta.max_hits,
    drain: meta.drain ?? 0,
    healing: meta.healing ?? 0,
    critRate: meta.crit_rate ?? 0,
    ailment: meta.pokemon_v2_movemetaailment?.name ?? 'none',
    ailmentChance: meta.ailment_chance ?? 0,
    flinchChance: meta.flinch_chance ?? 0,
    statChance: meta.stat_chance ?? 0,
    metaCategory: meta.pokemon_v2_movemetacategory?.name ?? 'damage',
    statChanges: m.pokemon_v2_movemetastatchanges.map((s) => ({ stat: statKey[s.pokemon_v2_stat.name] ?? s.pokemon_v2_stat.name, change: s.change })),
    effect: m.pokemon_v2_moveeffect?.pokemon_v2_moveeffecteffecttexts[0]?.short_effect?.replace(/\$effect_chance/g, String(m.move_effect_chance ?? '')) ?? '',
  };
}

const typeData = await gql(`{
  pokemon_v2_typeefficacy {
    damage_factor
    pokemonV2TypeByTargetTypeId { name }
    pokemon_v2_type { name }
  }
}`);
const types = {};
for (const t of typeData.pokemon_v2_typeefficacy) {
  const atk = t.pokemon_v2_type.name;
  (types[atk] ??= {})[t.pokemonV2TypeByTargetTypeId.name] = t.damage_factor / 100;
}

writeFileSync('data/pokemon.json', JSON.stringify(pokemon));
writeFileSync('data/moves.json', JSON.stringify(moves));
writeFileSync('data/types.json', JSON.stringify(types));
console.log(Object.keys(pokemon).length, 'pokemon', Object.keys(moves).length, 'moves', Object.keys(types).length, 'types');
