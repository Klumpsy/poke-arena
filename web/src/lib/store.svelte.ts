import type { RealtimeChannel, Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { BadgeRow, BattleRow, CooldownRow, DebtRow, GymRow, PlayerRow, PokemonRow, PresenceMeta, TeamRow } from './types';

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
  gyms = $state<GymRow[]>([]);
  badges = $state<BadgeRow[]>([]);
  cooldowns = $state<CooldownRow[]>([]);
  debts = $state<DebtRow[]>([]);
  allPokemon = $state<PokemonRow[]>([]);
  nextClaimant = $state<string | null>(null);

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
    await this.loadPlayer();
    if (!this.player) {
      await this.signOut();
      return;
    }
    await Promise.all([this.loadPokemon(), this.loadTeam(), this.loadPlayers(), this.loadBattles(), this.loadSyncToken(), this.loadArena()]);
    void supabase.rpc('heartbeat');
    this.subscribe();
    this.pollTimer = setInterval(() => {
      void this.loadPokemon();
      void this.loadTeam();
      void this.loadBattles();
      void this.loadPlayers();
      void this.loadArena();
      void supabase.rpc('heartbeat');
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

  async signIn(name: string, password: string): Promise<void> {
    this.error = null;
    const email = playerEmail(name);
    if (!email) {
      this.error = 'Gebruik letters of cijfers in je naam.';
      return;
    }
    const login = await supabase.auth.signInWithPassword({ email, password });
    if (!login.error) return;
    if (!/Invalid login credentials/i.test(login.error.message)) {
      this.error = friendlyAuthError(login.error.message);
      return;
    }
    const signup = await supabase.auth.signUp({ email, password, options: { data: { name } } });
    if (signup.error) {
      this.error = /already registered/i.test(signup.error.message)
        ? 'Deze naam bestaat al, maar het wachtwoord klopt niet.'
        : friendlyAuthError(signup.error.message);
    }
  }

  async rename(name: string): Promise<void> {
    this.error = null;
    const { error } = await supabase.rpc('rename_player', { p_name: name });
    if (error) this.error = error.message;
    else await this.loadPlayers();
    await this.trackPresence();
  }

  async signOut(): Promise<void> {
    this.teardown();
    await supabase.auth.signOut();
    this.session = null;
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

  async loadArena(): Promise<void> {
    const [gyms, badges, cooldowns, debts, all, next] = await Promise.all([
      supabase.from('gyms').select('*').order('sort'),
      supabase.from('badges').select('*'),
      supabase.from('gym_cooldowns').select('*').gt('until', new Date().toISOString()),
      supabase.from('debts').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('pokemon').select('*').order('level', { ascending: false }),
      supabase.rpc('next_claimant'),
    ]);
    this.gyms = (gyms.data as GymRow[] | null) ?? [];
    this.badges = (badges.data as BadgeRow[] | null) ?? [];
    this.cooldowns = (cooldowns.data as CooldownRow[] | null) ?? [];
    this.debts = (debts.data as DebtRow[] | null) ?? [];
    this.allPokemon = (all.data as PokemonRow[] | null) ?? [];
    this.nextClaimant = (next.data as string | null) ?? null;
  }

  badgesOf(playerId: string): BadgeRow[] {
    return this.badges.filter((b) => b.player_id === playerId);
  }

  gymOf(playerId: string): GymRow | undefined {
    return this.gyms.find((g) => g.leader_id === playerId);
  }

  cooldownFor(gymId: string): CooldownRow | undefined {
    return this.cooldowns.find((c) => c.gym_id === gymId && c.player_id === this.me);
  }

  async claimGym(gymId: string): Promise<void> {
    this.error = null;
    const { error } = await supabase.rpc('claim_gym', { p_gym: gymId });
    if (error) this.error = error.message;
    await this.loadArena();
  }

  async releaseGym(): Promise<void> {
    this.error = null;
    const { error } = await supabase.rpc('release_gym');
    if (error) this.error = error.message;
    await this.loadArena();
  }

  async settleDebt(debtId: string): Promise<void> {
    this.error = null;
    const { error } = await supabase.rpc('settle_debt', { p_debt: debtId });
    if (error) this.error = error.message;
    await this.loadArena();
  }

  async loadPlayers(): Promise<void> {
    const { data } = await supabase.from('players').select('*').order('rating', { ascending: false }).order('wins', { ascending: false }).order('name');
    this.players = (data as PlayerRow[] | null) ?? [];
    if (this.me) this.player = this.players.find((p) => p.id === this.me) ?? this.player;
  }

  async loadBattles(): Promise<void> {
    if (!this.me) return;
    void supabase.rpc('tidy_battles');
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
    const fresh = Date.now() - 3 * 60 * 1000;
    this.incoming = rows.filter((b) => b.status === 'pending' && b.opponent_id === this.me && new Date(b.created_at).getTime() > fresh);
    const out = rows.find((b) => b.status === 'pending' && b.challenger_id === this.me) ?? null;
    const declined = rows.find((b) => b.status === 'declined' && b.challenger_id === this.me && this.outgoing?.id === b.id);
    if (declined) this.error = `${this.nameOf(declined.opponent_id)} heeft je uitdaging afgewezen.`;
    this.outgoing = out;
    await this.trackPresence();
  }

  nameOf(playerId: string): string {
    return this.players.find((p) => p.id === playerId)?.name ?? 'Onbekend';
  }

  async challenge(opponentId: string, gymId: string | null = null, stake: string | null = null): Promise<boolean> {
    if (!this.me) return false;
    this.error = null;
    const { error } = await supabase.rpc('challenge', { p_opponent: opponentId, p_gym: gymId, p_stake: stake });
    if (error) this.error = error.message;
    await this.loadBattles();
    return !error;
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

  async forfeit(battleId: string): Promise<void> {
    this.error = null;
    const { error } = await supabase.rpc('forfeit_battle', { p_battle: battleId });
    if (error) this.error = error.message;
    await Promise.all([this.loadBattles(), this.loadPlayers(), this.loadArena()]);
  }

  async claimAbandoned(battleId: string): Promise<void> {
    this.error = null;
    const { error } = await supabase.rpc('claim_abandoned_battle', { p_battle: battleId });
    if (error) this.error = error.message;
    await Promise.all([this.loadBattles(), this.loadPlayers(), this.loadArena()]);
  }

  async finishBattle(battleId: string, winnerId: string): Promise<void> {
    await supabase.rpc('finish_battle', { p_battle: battleId, p_winner: winnerId });
    await Promise.all([this.loadBattles(), this.loadPlayers(), this.loadArena()]);
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

export function playerEmail(name: string): string | null {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return slug.length >= 2 ? `${slug}@players.poke-arena` : null;
}

function friendlyAuthError(message: string): string {
  if (/Vul een naam in/.test(message)) return 'Vul een naam in van 2 tot 30 tekens.';
  if (/Database error saving new user/.test(message)) return 'Vul een naam in van 2 tot 30 tekens.';
  if (/Password should be/i.test(message)) return 'Wachtwoord moet minimaal 6 tekens zijn.';
  if (/rate limit/i.test(message)) return 'Even wachten, te veel pogingen achter elkaar.';
  return message;
}

export const store = new ArenaStore();
