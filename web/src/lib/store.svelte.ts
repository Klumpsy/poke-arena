import type { RealtimeChannel, Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { BattleRow, PlayerRow, PokemonRow, PresenceMeta, TeamRow } from './types';

class ArenaStore {
  session = $state<Session | null>(null);
  ready = $state(false);
  player = $state<PlayerRow | null>(null);
  syncToken = $state<string | null>(null);
  pokemon = $state<PokemonRow[]>([]);
  team = $state<string[]>([]);
  players = $state<PlayerRow[]>([]);
  online = $state<PresenceMeta[]>([]);
  incoming = $state<BattleRow[]>([]);
  outgoing = $state<BattleRow | null>(null);
  activeBattle = $state<BattleRow | null>(null);
  error = $state<string | null>(null);

  private lobby: RealtimeChannel | null = null;
  private battlesChannel: RealtimeChannel | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  get me(): string | null {
    return this.session?.user.id ?? null;
  }

  async init(): Promise<void> {
    const { data } = await supabase.auth.getSession();
    this.session = data.session;
    supabase.auth.onAuthStateChange((_event, session) => {
      const changed = session?.user.id !== this.session?.user.id;
      this.session = session;
      if (changed) void this.bootstrap();
    });
    await this.bootstrap();
    this.ready = true;
  }

  private async bootstrap(): Promise<void> {
    this.teardown();
    if (!this.session) return;
    await Promise.all([this.loadPlayer(), this.loadPokemon(), this.loadTeam(), this.loadPlayers(), this.loadBattles(), this.loadSyncToken()]);
    this.subscribe();
    this.pollTimer = setInterval(() => {
      void this.loadPokemon();
      void this.loadBattles();
      void this.loadPlayers();
    }, 15000);
  }

  private teardown(): void {
    if (this.lobby) void supabase.removeChannel(this.lobby);
    if (this.battlesChannel) void supabase.removeChannel(this.battlesChannel);
    this.lobby = null;
    this.battlesChannel = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.online = [];
  }

  async signIn(email: string): Promise<void> {
    this.error = null;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
    if (error) this.error = friendlyAuthError(error.message);
  }

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
    this.player = null;
    this.pokemon = [];
    this.team = [];
    this.activeBattle = null;
  }

  async loadPlayer(): Promise<void> {
    if (!this.me) return;
    const { data } = await supabase.from('players').select('*').eq('id', this.me).maybeSingle();
    this.player = (data as PlayerRow | null) ?? null;
  }

  async loadSyncToken(): Promise<void> {
    const { data } = await supabase.from('sync_tokens').select('token').maybeSingle();
    this.syncToken = (data as { token: string } | null)?.token ?? null;
  }

  async regenerateToken(): Promise<void> {
    const { data, error } = await supabase.rpc('regenerate_sync_token');
    if (error) this.error = error.message;
    else this.syncToken = data as string;
  }

  async loadPokemon(): Promise<void> {
    if (!this.me) return;
    const { data } = await supabase.from('pokemon').select('*').eq('player_id', this.me).order('is_active', { ascending: false }).order('level', { ascending: false });
    this.pokemon = (data as PokemonRow[] | null) ?? [];
    if (this.team.length) this.team = this.team.filter((id) => this.pokemon.some((p) => p.id === id));
  }

  async setMoves(pokemonId: string, moves: string[]): Promise<void> {
    this.error = null;
    const { error } = await supabase.rpc('set_moves', { p_pokemon: pokemonId, p_moves: moves });
    if (error) this.error = error.message;
    else this.pokemon = this.pokemon.map((p) => (p.id === pokemonId ? { ...p, custom_moves: moves } : p));
  }

  async loadTeam(): Promise<void> {
    if (!this.me) return;
    const { data } = await supabase.from('teams').select('*').eq('player_id', this.me).maybeSingle();
    this.team = (data as TeamRow | null)?.pokemon_ids ?? [];
  }

  async saveTeam(ids: string[]): Promise<void> {
    if (!this.me || !ids.length) return;
    const { error } = await supabase.from('teams').upsert({ player_id: this.me, pokemon_ids: ids, updated_at: new Date().toISOString() });
    if (error) this.error = error.message;
    else this.team = ids;
    await this.trackPresence();
  }

  async loadPlayers(): Promise<void> {
    const { data } = await supabase.from('players').select('*').order('wins', { ascending: false }).order('losses', { ascending: true }).order('name');
    this.players = (data as PlayerRow[] | null) ?? [];
    if (this.me) this.player = this.players.find((p) => p.id === this.me) ?? this.player;
  }

  async loadBattles(): Promise<void> {
    if (!this.me) return;
    const { data } = await supabase
      .from('battles')
      .select('*')
      .or(`challenger_id.eq.${this.me},opponent_id.eq.${this.me}`)
      .in('status', ['pending', 'active', 'finished', 'declined'])
      .order('created_at', { ascending: false })
      .limit(30);
    const rows = (data as BattleRow[] | null) ?? [];
    const active = rows.find((b) => b.status === 'active') ?? null;
    const current = this.activeBattle ? rows.find((b) => b.id === this.activeBattle!.id) : null;
    this.activeBattle = active ?? (current?.status === 'finished' ? current : null);
    this.incoming = rows.filter((b) => b.status === 'pending' && b.opponent_id === this.me);
    const out = rows.find((b) => b.status === 'pending' && b.challenger_id === this.me) ?? null;
    const declined = rows.find((b) => b.status === 'declined' && b.challenger_id === this.me && this.outgoing?.id === b.id);
    if (declined) this.error = `${this.nameOf(declined.opponent_id)} heeft je uitdaging afgewezen.`;
    this.outgoing = out;
    await this.trackPresence();
  }

  nameOf(playerId: string): string {
    return this.players.find((p) => p.id === playerId)?.name ?? 'Onbekend';
  }

  async challenge(opponentId: string): Promise<void> {
    if (!this.me) return;
    this.error = null;
    if (!this.team.length) {
      this.error = 'Kies eerst een team.';
      return;
    }
    const { error } = await supabase.from('battles').insert({ challenger_id: this.me, opponent_id: opponentId });
    if (error) this.error = error.message;
    await this.loadBattles();
  }

  async cancelChallenge(): Promise<void> {
    if (!this.outgoing) return;
    await supabase.from('battles').update({ status: 'cancelled' }).eq('id', this.outgoing.id);
    await this.loadBattles();
  }

  async respond(battleId: string, accept: boolean): Promise<void> {
    this.error = null;
    const { error } = await supabase.rpc('respond_battle', { p_battle: battleId, p_accept: accept });
    if (error) this.error = error.message;
    await this.loadBattles();
  }

  async finishBattle(battleId: string, winnerId: string): Promise<void> {
    await supabase.rpc('finish_battle', { p_battle: battleId, p_winner: winnerId });
    await Promise.all([this.loadBattles(), this.loadPlayers()]);
  }

  leaveBattle(): void {
    this.activeBattle = null;
    void this.loadBattles();
    void this.trackPresence();
  }

  private subscribe(): void {
    if (!this.me) return;
    this.lobby = supabase.channel('lobby', { config: { presence: { key: this.me } } });
    this.lobby
      .on('presence', { event: 'sync' }, () => {
        const state = this.lobby!.presenceState<PresenceMeta>();
        this.online = Object.values(state).map((metas) => metas[metas.length - 1]).filter((m) => m && m.id !== this.me);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void this.trackPresence();
      });

    this.battlesChannel = supabase
      .channel(`my-battles-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battles', filter: `opponent_id=eq.${this.me}` }, () => void this.loadBattles())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battles', filter: `challenger_id=eq.${this.me}` }, () => void this.loadBattles())
      .subscribe();
  }

  private async trackPresence(): Promise<void> {
    if (!this.lobby || !this.player) return;
    await this.lobby.track({ id: this.player.id, name: this.player.name, inBattle: Boolean(this.activeBattle) } satisfies PresenceMeta);
  }
}

function friendlyAuthError(message: string): string {
  if (/Alleen e-mailadressen/.test(message)) return message.replace(/^.*?(Alleen e-mailadressen.*)$/, '$1');
  if (/Database error saving new user/.test(message)) return 'Alleen e-mailadressen van cube.nl zijn toegestaan.';
  if (/rate limit/i.test(message)) return 'Even wachten, te veel login-mails achter elkaar.';
  return message;
}

export const store = new ArenaStore();
