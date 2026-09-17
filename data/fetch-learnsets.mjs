import { writeFileSync } from 'node:fs';

const ENDPOINT = 'https://beta.pokeapi.co/graphql/v1beta';
const PAGE = 20000;

async function gql(query) {
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const learnsets = {};
for (let offset = 0; ; offset += PAGE) {
  const data = await gql(`{
    pokemon_v2_pokemonmove(
      where: {pokemon_id: {_lte: 1025}, move_learn_method_id: {_eq: 1}},
      distinct_on: [pokemon_id, move_id], order_by: [{pokemon_id: asc}, {move_id: asc}, {level: asc}],
      limit: ${PAGE}, offset: ${offset}
    ) { pokemon_id level pokemon_v2_move { name } }
  }`);
  const rows = data.pokemon_v2_pokemonmove;
  for (const r of rows) (learnsets[r.pokemon_id] ??= []).push([r.pokemon_v2_move.name, r.level]);
  console.log('page', offset, rows.length);
  if (rows.length < PAGE) break;
}
for (const list of Object.values(learnsets)) list.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
writeFileSync('data/learnsets.json', JSON.stringify(learnsets));
console.log(Object.keys(learnsets).length, 'species');
