import * as SQLite from 'expo-sqlite';
import { GpsSample } from '../lib/geometry';
import { LapRecord } from '../lib/analysis';
import type { TrackRef } from '../data/tracks';

let dbInstance: SQLite.SQLiteDatabase | null = null;

async function db() {
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync('kartlap.db');
    await dbInstance.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        track_name TEXT NOT NULL,
        kart TEXT,
        notes TEXT,
        started_at INTEGER NOT NULL,
        weather TEXT,
        track_id TEXT,
        mode TEXT
      );
      CREATE TABLE IF NOT EXISTS laps (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        samples_json TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_laps_session ON laps(session_id);

      CREATE TABLE IF NOT EXISTS track_references (
        track_id TEXT PRIMARY KEY,
        track_name TEXT NOT NULL,
        samples_json TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        length_m REAL NOT NULL,
        recorded_at INTEGER NOT NULL,
        source_session_id TEXT,
        source_lap_id TEXT
      );

      CREATE TABLE IF NOT EXISTS ai_chat_threads (
        cache_key TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        lap_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ai_threads_updated ON ai_chat_threads(updated_at DESC);

      CREATE TABLE IF NOT EXISTS track_layouts (
        id TEXT PRIMARY KEY,
        track_id TEXT NOT NULL,
        name TEXT NOT NULL,
        samples_json TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        length_m REAL NOT NULL,
        recorded_at INTEGER NOT NULL,
        source_session_id TEXT,
        source_lap_id TEXT,
        is_default INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_layouts_track ON track_layouts(track_id);

      CREATE TABLE IF NOT EXISTS gamification_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        xp INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        season_started_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS achievements_unlocked (
        achievement_id TEXT PRIMARY KEY,
        session_id TEXT,
        unlocked_at INTEGER NOT NULL,
        celebrated INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS daily_challenges (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        template_id TEXT NOT NULL,
        target INTEGER NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        completed INTEGER NOT NULL DEFAULT 0,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_challenges_date ON daily_challenges(date);

      CREATE TABLE IF NOT EXISTS pb_records (
        id TEXT PRIMARY KEY,
        track_id TEXT NOT NULL,
        layout_id TEXT,
        session_id TEXT NOT NULL,
        lap_id TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        celebrated INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pb_track ON pb_records(track_id, layout_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS kart_setups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        chassis_brand TEXT,
        chassis_model TEXT,
        chassis_year INTEGER,
        engine_type TEXT,
        engine_tune TEXT,
        hours REAL DEFAULT 0,
        tire_pressure_front REAL,
        tire_pressure_rear REAL,
        camber_deg REAL,
        gear_front INTEGER,
        gear_rear INTEGER,
        ballast_kg REAL,
        category TEXT,
        notes TEXT,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kart_setups_active ON kart_setups(is_active DESC);
    `);

    // Migration v1 → v2: copia track_references pra track_layouts (1 layout
    // por pista, marcado como default). Roda uma vez só — controlado via
    // PRAGMA user_version. Mantém track_references pra rollback fácil; será
    // removida num release futuro quando o caminho novo estiver assentado.
    const version = await dbInstance.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version'
    );
    if ((version?.user_version ?? 0) < 1) {
      const legacyRefs = await dbInstance.getAllAsync<any>(
        'SELECT * FROM track_references'
      );
      for (const r of legacyRefs) {
        const exists = await dbInstance.getFirstAsync<any>(
          'SELECT id FROM track_layouts WHERE track_id = ? LIMIT 1',
          r.track_id
        );
        if (exists) continue; // já tem algum layout pra essa pista, pula
        const layoutId = `layout_${r.track_id}_${Date.now()}`;
        await dbInstance.runAsync(
          `INSERT INTO track_layouts (id, track_id, name, samples_json, duration_ms, length_m, recorded_at, source_session_id, source_lap_id, is_default)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          layoutId,
          r.track_id,
          'Layout principal',
          r.samples_json,
          r.duration_ms,
          r.length_m,
          r.recorded_at,
          r.source_session_id ?? null,
          r.source_lap_id ?? null
        );
      }
      // Sessions ganham coluna layout_id (nullable, sessões antigas ficam null).
      // ALTER TABLE em SQLite só adiciona coluna no fim — perfeito pra migration.
      try {
        await dbInstance.execAsync('ALTER TABLE sessions ADD COLUMN layout_id TEXT');
      } catch {
        // Coluna já existe (rerun de migration depois de crash) — segue.
      }
      await dbInstance.execAsync('PRAGMA user_version = 1');
    }

    // Migration v1 → v2: sessions ganham kart_setup_id pra associar o setup
    // usado naquela sessão (pneus, cambagem, etc).
    const v2 = await dbInstance.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version'
    );
    if ((v2?.user_version ?? 0) < 2) {
      try {
        await dbInstance.execAsync('ALTER TABLE sessions ADD COLUMN kart_setup_id TEXT');
      } catch {
        // Coluna já existe — segue.
      }
      await dbInstance.execAsync('PRAGMA user_version = 2');
    }

    // Migration v2 → v3: laps ganham coluna imu_samples_json pra guardar
    // o stream da IMU (accel + gyro a ~50Hz). Pra voltas antigas o campo
    // fica NULL — readers tratam null como "sem dado IMU".
    const v3 = await dbInstance.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version'
    );
    if ((v3?.user_version ?? 0) < 3) {
      try {
        await dbInstance.execAsync('ALTER TABLE laps ADD COLUMN imu_samples_json TEXT');
      } catch {
        // Coluna já existe — segue.
      }
      await dbInstance.execAsync('PRAGMA user_version = 3');
    }

    // Migration v3 → v4: tabela de pistas custom criadas pelo usuário.
    // Hardcoded TRACKS cobrem só 8 kartódromos; quando o piloto está numa
    // pista fora da lista, cria a sua aqui (nome + GPS atual). Mescladas
    // com as hardcoded em getAllTracks().
    const v4 = await dbInstance.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version'
    );
    if ((v4?.user_version ?? 0) < 4) {
      await dbInstance.execAsync(`
        CREATE TABLE IF NOT EXISTS custom_tracks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          short_name TEXT NOT NULL,
          city TEXT,
          state TEXT,
          lat REAL NOT NULL,
          lng REAL NOT NULL,
          length_m REAL,
          created_at INTEGER NOT NULL
        );
      `);
      await dbInstance.execAsync('PRAGMA user_version = 4');
    }
  }
  return dbInstance;
}

// =========================
// Sessions
// =========================

export type SessionMode = 'reference' | 'race';

export type Session = {
  id: string;
  trackName: string;
  kart: string | null;
  notes: string | null;
  startedAt: number;
  weather: string | null;
  trackId: string | null;
  mode: SessionMode | null;
  /** Layout/traçado usado nessa sessão. Null em sessões antigas (pré-migração v1). */
  layoutId: string | null;
  /** Setup do kart usado. Null em sessões antigas (pré-migração v2). */
  kartSetupId: string | null;
};

export async function createSession(
  data: Omit<Session, 'id' | 'startedAt'>
): Promise<Session> {
  const d = await db();
  const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  await d.runAsync(
    `INSERT INTO sessions (id, track_name, kart, notes, started_at, weather, track_id, mode, layout_id, kart_setup_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.trackName,
    data.kart,
    data.notes,
    startedAt,
    data.weather,
    data.trackId,
    data.mode,
    data.layoutId,
    data.kartSetupId
  );
  return { id, startedAt, ...data };
}

export async function listSessions(): Promise<Session[]> {
  const d = await db();
  const rows = await d.getAllAsync<any>(
    `SELECT id,
            track_name as trackName,
            kart,
            notes,
            started_at as startedAt,
            weather,
            track_id as trackId,
            mode,
            layout_id as layoutId,
            kart_setup_id as kartSetupId
     FROM sessions
     ORDER BY started_at DESC`
  );
  return rows;
}

export async function getSession(id: string): Promise<Session | null> {
  const d = await db();
  const row = await d.getFirstAsync<any>(
    `SELECT id,
            track_name as trackName,
            kart,
            notes,
            started_at as startedAt,
            weather,
            track_id as trackId,
            mode,
            layout_id as layoutId,
            kart_setup_id as kartSetupId
     FROM sessions
     WHERE id = ?`,
    id
  );
  return row ?? null;
}

/**
 * Histórico de uma pista: pra cada sessão, devolve a melhor volta e a
 * contagem de voltas. Usado pelo Coach IA pra contextualizar a análise da
 * volta atual ("você tá X segundos do seu PB nessa pista", "ritmo melhorou
 * desde a sessão passada", etc).
 *
 * Ordem: cronológica DESC (mais recente primeiro). `bestLapMs` pode ser
 * null se a sessão não tem voltas detectadas — caller filtra se quiser.
 */
export type TrackHistoryEntry = {
  sessionId: string;
  startedAt: number;
  lapCount: number;
  bestLapMs: number | null;
  mode: SessionMode | null;
};

export async function getTrackHistory(
  trackId: string,
  limit: number = 10
): Promise<TrackHistoryEntry[]> {
  const d = await db();
  const rows = await d.getAllAsync<any>(
    `SELECT s.id          as sessionId,
            s.started_at  as startedAt,
            s.mode        as mode,
            COUNT(l.id)   as lapCount,
            MIN(l.duration_ms) as bestLapMs
     FROM sessions s
     LEFT JOIN laps l ON l.session_id = s.id
     WHERE s.track_id = ?
     GROUP BY s.id
     ORDER BY s.started_at DESC
     LIMIT ?`,
    trackId,
    limit
  );
  return rows.map((r) => ({
    sessionId: r.sessionId,
    startedAt: r.startedAt,
    mode: r.mode ?? null,
    lapCount: r.lapCount ?? 0,
    bestLapMs: r.bestLapMs ?? null,
  }));
}

// =========================
// Custom tracks
// =========================

export type NewCustomTrack = {
  name: string;
  shortName: string;
  city?: string | null;
  state?: string | null;
  lat: number;
  lng: number;
  lengthM?: number | null;
};

/** Lista pistas custom criadas pelo usuário (ordem: mais recente primeiro).
 *  Resiliente: retorna [] se a tabela não existe (migration ainda não
 *  rodou em algum device antigo) ou se a query falha por qualquer motivo. */
export async function listCustomTracks(): Promise<TrackRef[]> {
  try {
    const d = await db();
    const rows = await d.getAllAsync<any>(
      `SELECT id, name, short_name, city, state, lat, lng, length_m
       FROM custom_tracks
       ORDER BY created_at DESC`
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      shortName: r.short_name,
      city: r.city ?? '',
      state: r.state ?? '',
      lat: r.lat,
      lng: r.lng,
      lengthM: r.length_m ?? 0,
    }));
  } catch {
    return [];
  }
}

/** Cria uma pista custom. Retorna o TrackRef pronto pra usar. */
export async function addCustomTrack(t: NewCustomTrack): Promise<TrackRef> {
  const d = await db();
  // id estável + único. Prefixo "custom-" distingue de hardcoded em qualquer
  // lugar que precise diferenciar (ex: não deixar deletar hardcoded).
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await d.runAsync(
    `INSERT INTO custom_tracks (id, name, short_name, city, state, lat, lng, length_m, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    t.name,
    t.shortName,
    t.city ?? null,
    t.state ?? null,
    t.lat,
    t.lng,
    t.lengthM ?? null,
    Date.now()
  );
  return {
    id,
    name: t.name,
    shortName: t.shortName,
    city: t.city ?? '',
    state: t.state ?? '',
    lat: t.lat,
    lng: t.lng,
    lengthM: t.lengthM ?? 0,
  };
}

/** Remove uma pista custom (e seus layouts/sessões ficam órfãos por trackId
 *  string — não impacta o histórico já gravado). */
export async function deleteCustomTrack(id: string): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM custom_tracks WHERE id = ?', id);
}

export async function deleteSession(id: string): Promise<void> {
  const d = await db();
  // FK ON DELETE CASCADE existe no schema, mas PRAGMA foreign_keys não tá
  // explicitamente ON neste DB — então deletes em cascade NÃO disparam
  // automaticamente. Deletamos manualmente em ordem (filhos antes do pai)
  // pra garantir que não fica lap órfã. PBs/achievements referenciam por
  // string session_id e ficam — não impactam o histórico visível.
  await d.runAsync('DELETE FROM laps WHERE session_id = ?', id);
  await d.runAsync('DELETE FROM sessions WHERE id = ?', id);
}

// =========================
// Laps
// =========================

export async function saveLap(lap: LapRecord): Promise<void> {
  const d = await db();
  // imu_samples_json é null quando o lap foi gravado sem IMU (lap antigo
  // ou IMU falhou). JSON.stringify de undefined gera "undefined" como
  // string — proteção explícita pra mandar null real.
  const imuJson =
    lap.imuSamples && lap.imuSamples.length > 0
      ? JSON.stringify(lap.imuSamples)
      : null;
  await d.runAsync(
    `INSERT INTO laps (id, session_id, started_at, duration_ms, samples_json, imu_samples_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    lap.id,
    lap.sessionId,
    lap.startedAt,
    lap.durationMs,
    JSON.stringify(lap.samples),
    imuJson
  );
}

export async function getLapsForSession(sessionId: string): Promise<LapRecord[]> {
  const d = await db();
  const rows = await d.getAllAsync<any>(
    `SELECT id,
            session_id as sessionId,
            started_at as startedAt,
            duration_ms as durationMs,
            samples_json,
            imu_samples_json
     FROM laps
     WHERE session_id = ?
     ORDER BY started_at ASC`,
    sessionId
  );
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    startedAt: r.startedAt,
    durationMs: r.durationMs,
    samples: JSON.parse(r.samples_json) as GpsSample[],
    imuSamples: r.imu_samples_json ? JSON.parse(r.imu_samples_json) : undefined,
  }));
}

// =========================
// Track references
// =========================

export type TrackReference = {
  trackId: string;
  trackName: string;
  samples: GpsSample[];
  durationMs: number;
  lengthM: number;
  recordedAt: number;
  sourceSessionId?: string;
  sourceLapId?: string;
};

export async function getTrackReference(
  trackId: string
): Promise<TrackReference | null> {
  const d = await db();
  const row = await d.getFirstAsync<any>(
    'SELECT * FROM track_references WHERE track_id = ?',
    trackId
  );
  if (!row) return null;
  return {
    trackId: row.track_id,
    trackName: row.track_name,
    samples: JSON.parse(row.samples_json),
    durationMs: row.duration_ms,
    lengthM: row.length_m,
    recordedAt: row.recorded_at,
    sourceSessionId: row.source_session_id ?? undefined,
    sourceLapId: row.source_lap_id ?? undefined,
  };
}

export async function saveTrackReference(ref: TrackReference): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT OR REPLACE INTO track_references
     (track_id, track_name, samples_json, duration_ms, length_m, recorded_at, source_session_id, source_lap_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ref.trackId,
    ref.trackName,
    JSON.stringify(ref.samples),
    ref.durationMs,
    ref.lengthM,
    ref.recordedAt,
    ref.sourceSessionId ?? null,
    ref.sourceLapId ?? null
  );
}

export async function deleteTrackReference(trackId: string): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM track_references WHERE track_id = ?', trackId);
}

export async function listTrackReferences(): Promise<TrackReference[]> {
  const d = await db();
  const rows = await d.getAllAsync<any>(
    'SELECT * FROM track_references ORDER BY recorded_at DESC'
  );
  return rows.map((row) => ({
    trackId: row.track_id,
    trackName: row.track_name,
    samples: JSON.parse(row.samples_json),
    durationMs: row.duration_ms,
    lengthM: row.length_m,
    recordedAt: row.recorded_at,
    sourceSessionId: row.source_session_id ?? undefined,
    sourceLapId: row.source_lap_id ?? undefined,
  }));
}
// =========================
// AI chat threads
// =========================

/**
 * Conversa do Coach IA por volta. Persistida pra você poder reabrir uma
 * thread de dias atrás na aba Insights. Key = `${sessionId}:${lapId}` —
 * mesma convenção do cache em memória do aiAnalysis.ts.
 */
export type AiChatThreadRow = {
  cacheKey: string;
  sessionId: string;
  lapId: string;
  provider: string;
  systemPrompt: string;
  /** Lista de mensagens em ordem: [{role, content}, ...]. Inclui o prompt user inicial. */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  createdAt: number;
  updatedAt: number;
};

/** Entrada enxuta pra listagem — não carrega `messages` (pode ser pesado). */
export type AiChatThreadSummary = {
  cacheKey: string;
  sessionId: string;
  lapId: string;
  provider: string;
  updatedAt: number;
  /** Preview da última mensagem (assistant ou user, o que for mais recente). */
  preview: string;
  messageCount: number;
  /** Joined das sessions/laps pra UI mostrar contexto sem 2ª query. */
  trackName: string | null;
  sessionStartedAt: number | null;
  lapDurationMs: number | null;
};

export async function saveAiChatThread(thread: Omit<AiChatThreadRow, 'createdAt' | 'updatedAt'> & {
  createdAt?: number;
  updatedAt?: number;
}): Promise<void> {
  const d = await db();
  const now = Date.now();
  const createdAt = thread.createdAt ?? now;
  const updatedAt = thread.updatedAt ?? now;
  await d.runAsync(
    `INSERT INTO ai_chat_threads (cache_key, session_id, lap_id, provider, system_prompt, messages_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       provider = excluded.provider,
       system_prompt = excluded.system_prompt,
       messages_json = excluded.messages_json,
       updated_at = excluded.updated_at`,
    thread.cacheKey,
    thread.sessionId,
    thread.lapId,
    thread.provider,
    thread.systemPrompt,
    JSON.stringify(thread.messages),
    createdAt,
    updatedAt
  );
}

export async function getAiChatThread(cacheKey: string): Promise<AiChatThreadRow | null> {
  const d = await db();
  const row = await d.getFirstAsync<any>(
    `SELECT cache_key      as cacheKey,
            session_id     as sessionId,
            lap_id         as lapId,
            provider,
            system_prompt  as systemPrompt,
            messages_json,
            created_at     as createdAt,
            updated_at     as updatedAt
     FROM ai_chat_threads WHERE cache_key = ?`,
    cacheKey
  );
  if (!row) return null;
  return {
    cacheKey: row.cacheKey,
    sessionId: row.sessionId,
    lapId: row.lapId,
    provider: row.provider,
    systemPrompt: row.systemPrompt,
    messages: JSON.parse(row.messages_json),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function deleteAiChatThread(cacheKey: string): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM ai_chat_threads WHERE cache_key = ?', cacheKey);
}

export async function listAiChatThreads(limit: number = 30): Promise<AiChatThreadSummary[]> {
  const d = await db();
  const rows = await d.getAllAsync<any>(
    `SELECT t.cache_key      as cacheKey,
            t.session_id     as sessionId,
            t.lap_id         as lapId,
            t.provider       as provider,
            t.messages_json  as messagesJson,
            t.updated_at     as updatedAt,
            s.track_name     as trackName,
            s.started_at     as sessionStartedAt,
            l.duration_ms    as lapDurationMs
     FROM ai_chat_threads t
     LEFT JOIN sessions s ON s.id = t.session_id
     LEFT JOIN laps     l ON l.id = t.lap_id
     ORDER BY t.updated_at DESC
     LIMIT ?`,
    limit
  );
  return rows.map((r) => {
    const msgs: Array<{ role: string; content: string }> = JSON.parse(r.messagesJson);
    // Preview = última mensagem do assistant (mais informativa que o user follow-up)
    const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
    const preview = (lastAssistant?.content ?? msgs.at(-1)?.content ?? '').slice(0, 140);
    return {
      cacheKey: r.cacheKey,
      sessionId: r.sessionId,
      lapId: r.lapId,
      provider: r.provider,
      updatedAt: r.updatedAt,
      preview,
      messageCount: msgs.length,
      trackName: r.trackName ?? null,
      sessionStartedAt: r.sessionStartedAt ?? null,
      lapDurationMs: r.lapDurationMs ?? null,
    };
  });
}

// =========================
// Track layouts (múltiplos traçados por pista)
// =========================

/**
 * Cada layout é uma referência gravada da pista numa configuração específica
 * (ex: "Layout principal", "Layout curto", "Inverso", "Configuração corrida").
 *
 * Uma pista pode ter N layouts. Sessão referencia o layout escolhido via
 * `session.layoutId`. Quando o piloto cria sessão sem escolher (sessões
 * legadas ou app sem múltiplos layouts), usa o `is_default`.
 */
export type TrackLayout = {
  id: string;
  trackId: string;
  name: string;
  samples: GpsSample[];
  durationMs: number;
  lengthM: number;
  recordedAt: number;
  sourceSessionId?: string;
  sourceLapId?: string;
  isDefault: boolean;
};

function rowToLayout(row: any): TrackLayout {
  return {
    id: row.id,
    trackId: row.track_id,
    name: row.name,
    samples: JSON.parse(row.samples_json),
    durationMs: row.duration_ms,
    lengthM: row.length_m,
    recordedAt: row.recorded_at,
    sourceSessionId: row.source_session_id ?? undefined,
    sourceLapId: row.source_lap_id ?? undefined,
    isDefault: Boolean(row.is_default),
  };
}

export async function listLayoutsForTrack(trackId: string): Promise<TrackLayout[]> {
  const d = await db();
  const rows = await d.getAllAsync<any>(
    'SELECT * FROM track_layouts WHERE track_id = ? ORDER BY is_default DESC, recorded_at DESC',
    trackId
  );
  return rows.map(rowToLayout);
}

export async function getLayout(id: string): Promise<TrackLayout | null> {
  const d = await db();
  const row = await d.getFirstAsync<any>('SELECT * FROM track_layouts WHERE id = ?', id);
  return row ? rowToLayout(row) : null;
}

export async function getDefaultLayoutForTrack(
  trackId: string
): Promise<TrackLayout | null> {
  const d = await db();
  // Tenta o default explícito; se ninguém tá marcado, pega o mais recente.
  const row =
    (await d.getFirstAsync<any>(
      'SELECT * FROM track_layouts WHERE track_id = ? AND is_default = 1 LIMIT 1',
      trackId
    )) ??
    (await d.getFirstAsync<any>(
      'SELECT * FROM track_layouts WHERE track_id = ? ORDER BY recorded_at DESC LIMIT 1',
      trackId
    ));
  return row ? rowToLayout(row) : null;
}

export async function saveLayout(layout: TrackLayout): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT OR REPLACE INTO track_layouts
     (id, track_id, name, samples_json, duration_ms, length_m, recorded_at, source_session_id, source_lap_id, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    layout.id,
    layout.trackId,
    layout.name,
    JSON.stringify(layout.samples),
    layout.durationMs,
    layout.lengthM,
    layout.recordedAt,
    layout.sourceSessionId ?? null,
    layout.sourceLapId ?? null,
    layout.isDefault ? 1 : 0
  );
}

export async function deleteLayout(id: string): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM track_layouts WHERE id = ?', id);
}

/**
 * Marca um layout como default e desmarca os outros da mesma pista numa
 * transação simples (2 statements consecutivos — risco baixo de race em
 * app single-user).
 */
export async function setDefaultLayout(trackId: string, layoutId: string): Promise<void> {
  const d = await db();
  await d.runAsync(
    'UPDATE track_layouts SET is_default = 0 WHERE track_id = ?',
    trackId
  );
  await d.runAsync('UPDATE track_layouts SET is_default = 1 WHERE id = ?', layoutId);
}

/**
 * Lista todos os layouts agrupados por trackId. Usado pelo new-session
 * pra mostrar o resumo "X traçados cadastrados / melhor volta no padrão"
 * sem precisar de N+1 queries.
 */
export async function listAllLayoutsGrouped(): Promise<Map<string, TrackLayout[]>> {
  const d = await db();
  const rows = await d.getAllAsync<any>(
    'SELECT * FROM track_layouts ORDER BY track_id, is_default DESC, recorded_at DESC'
  );
  const out = new Map<string, TrackLayout[]>();
  for (const row of rows) {
    const layout = rowToLayout(row);
    const list = out.get(layout.trackId) ?? [];
    list.push(layout);
    out.set(layout.trackId, list);
  }
  return out;
}

// =========================
// Kart setups
// =========================

/**
 * Setup do kart — configuração mecânica que afeta pilotagem. Múltiplos
 * setups podem coexistir (ex: "K7 Rotax", "K3 OK", "Sprint"); apenas um é
 * marcado `isActive` por vez, e sessões novas herdam o ativo por default.
 *
 * Campos cobrem o essencial pra kart amador/semi-pro:
 *   - Pressão dianteira/traseira (bar)
 *   - Cambagem (graus, geralmente -2 a 0)
 *   - Coroa/pinhão (gear_rear / gear_front)
 *   - Lastro
 *   - Chassi (marca + modelo + ano)
 *   - Motor (tipo + tune)
 *   - Categoria (Rental, Cadete, etc — referenciado no perfil também)
 *   - Horas de uso (acumulado, pra trocar peças)
 */
export type KartSetup = {
  id: string;
  name: string;
  chassisBrand?: string | null;
  chassisModel?: string | null;
  chassisYear?: number | null;
  engineType?: string | null;
  engineTune?: string | null;
  hours: number;
  tirePressureFront?: number | null;
  tirePressureRear?: number | null;
  camberDeg?: number | null;
  gearFront?: number | null;
  gearRear?: number | null;
  ballastKg?: number | null;
  category?: string | null;
  notes?: string | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
};

function rowToKartSetup(row: any): KartSetup {
  return {
    id: row.id,
    name: row.name,
    chassisBrand: row.chassis_brand ?? null,
    chassisModel: row.chassis_model ?? null,
    chassisYear: row.chassis_year ?? null,
    engineType: row.engine_type ?? null,
    engineTune: row.engine_tune ?? null,
    hours: row.hours ?? 0,
    tirePressureFront: row.tire_pressure_front ?? null,
    tirePressureRear: row.tire_pressure_rear ?? null,
    camberDeg: row.camber_deg ?? null,
    gearFront: row.gear_front ?? null,
    gearRear: row.gear_rear ?? null,
    ballastKg: row.ballast_kg ?? null,
    category: row.category ?? null,
    notes: row.notes ?? null,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listKartSetups(): Promise<KartSetup[]> {
  const d = await db();
  const rows = await d.getAllAsync<any>(
    'SELECT * FROM kart_setups ORDER BY is_active DESC, updated_at DESC'
  );
  return rows.map(rowToKartSetup);
}

export async function getKartSetup(id: string): Promise<KartSetup | null> {
  const d = await db();
  const row = await d.getFirstAsync<any>('SELECT * FROM kart_setups WHERE id = ?', id);
  return row ? rowToKartSetup(row) : null;
}

export async function getActiveKartSetup(): Promise<KartSetup | null> {
  const d = await db();
  const row = await d.getFirstAsync<any>(
    'SELECT * FROM kart_setups WHERE is_active = 1 LIMIT 1'
  );
  return row ? rowToKartSetup(row) : null;
}

export async function saveKartSetup(setup: KartSetup): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT OR REPLACE INTO kart_setups (
       id, name,
       chassis_brand, chassis_model, chassis_year,
       engine_type, engine_tune, hours,
       tire_pressure_front, tire_pressure_rear, camber_deg,
       gear_front, gear_rear, ballast_kg,
       category, notes, is_active, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    setup.id,
    setup.name,
    setup.chassisBrand ?? null,
    setup.chassisModel ?? null,
    setup.chassisYear ?? null,
    setup.engineType ?? null,
    setup.engineTune ?? null,
    setup.hours,
    setup.tirePressureFront ?? null,
    setup.tirePressureRear ?? null,
    setup.camberDeg ?? null,
    setup.gearFront ?? null,
    setup.gearRear ?? null,
    setup.ballastKg ?? null,
    setup.category ?? null,
    setup.notes ?? null,
    setup.isActive ? 1 : 0,
    setup.createdAt,
    setup.updatedAt
  );
}

export async function deleteKartSetup(id: string): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM kart_setups WHERE id = ?', id);
}

/**
 * Marca um setup como ativo, desmarca os outros. Usado quando o piloto
 * escolhe qual setup tá rodando no momento.
 */
export async function setActiveKartSetup(id: string): Promise<void> {
  const d = await db();
  await d.runAsync('UPDATE kart_setups SET is_active = 0');
  await d.runAsync('UPDATE kart_setups SET is_active = 1 WHERE id = ?', id);
}

// =========================
// Gamification (XP, PB records)
// =========================

export type GamificationState = {
  xp: number;
  level: number;
  seasonStartedAt: number;
  updatedAt: number;
};

export async function getGamificationState(): Promise<GamificationState> {
  const d = await db();
  const row = await d.getFirstAsync<any>('SELECT * FROM gamification_state WHERE id = 1');
  if (!row) {
    const now = Date.now();
    const fresh: GamificationState = { xp: 0, level: 1, seasonStartedAt: now, updatedAt: now };
    await d.runAsync(
      `INSERT INTO gamification_state (id, xp, level, season_started_at, updated_at)
       VALUES (1, ?, ?, ?, ?)`,
      fresh.xp,
      fresh.level,
      fresh.seasonStartedAt,
      fresh.updatedAt
    );
    return fresh;
  }
  return {
    xp: row.xp,
    level: row.level,
    seasonStartedAt: row.season_started_at,
    updatedAt: row.updated_at,
  };
}

export async function saveGamificationState(state: GamificationState): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT OR REPLACE INTO gamification_state (id, xp, level, season_started_at, updated_at)
     VALUES (1, ?, ?, ?, ?)`,
    state.xp,
    state.level,
    state.seasonStartedAt,
    state.updatedAt
  );
}

export type PbRecord = {
  id: string;
  trackId: string;
  layoutId: string | null;
  sessionId: string;
  lapId: string;
  durationMs: number;
  celebrated: boolean;
  createdAt: number;
};

export async function getCurrentPb(
  trackId: string,
  layoutId: string | null
): Promise<PbRecord | null> {
  const d = await db();
  const row = await d.getFirstAsync<any>(
    `SELECT * FROM pb_records WHERE track_id = ? AND (layout_id IS ? OR layout_id = ?)
     ORDER BY duration_ms ASC LIMIT 1`,
    trackId,
    layoutId,
    layoutId
  );
  if (!row) return null;
  return {
    id: row.id,
    trackId: row.track_id,
    layoutId: row.layout_id ?? null,
    sessionId: row.session_id,
    lapId: row.lap_id,
    durationMs: row.duration_ms,
    celebrated: Boolean(row.celebrated),
    createdAt: row.created_at,
  };
}

export async function savePbRecord(rec: PbRecord): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT INTO pb_records (id, track_id, layout_id, session_id, lap_id, duration_ms, celebrated, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    rec.id,
    rec.trackId,
    rec.layoutId,
    rec.sessionId,
    rec.lapId,
    rec.durationMs,
    rec.celebrated ? 1 : 0,
    rec.createdAt
  );
}

export async function markPbCelebrated(id: string): Promise<void> {
  const d = await db();
  await d.runAsync('UPDATE pb_records SET celebrated = 1 WHERE id = ?', id);
}

// =========================
// Achievements
// =========================

export type AchievementUnlockRow = {
  achievementId: string;
  sessionId: string | null;
  unlockedAt: number;
  celebrated: boolean;
};

export async function listUnlockedAchievements(): Promise<AchievementUnlockRow[]> {
  const d = await db();
  const rows = await d.getAllAsync<any>(
    'SELECT * FROM achievements_unlocked ORDER BY unlocked_at DESC'
  );
  return rows.map((r) => ({
    achievementId: r.achievement_id,
    sessionId: r.session_id ?? null,
    unlockedAt: r.unlocked_at,
    celebrated: Boolean(r.celebrated),
  }));
}

export async function isAchievementUnlocked(id: string): Promise<boolean> {
  const d = await db();
  const row = await d.getFirstAsync<any>(
    'SELECT achievement_id FROM achievements_unlocked WHERE achievement_id = ?',
    id
  );
  return Boolean(row);
}

export async function unlockAchievement(
  id: string,
  sessionId: string | null
): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT OR IGNORE INTO achievements_unlocked (achievement_id, session_id, unlocked_at, celebrated)
     VALUES (?, ?, ?, 0)`,
    id,
    sessionId,
    Date.now()
  );
}

export async function markAchievementCelebrated(id: string): Promise<void> {
  const d = await db();
  await d.runAsync(
    'UPDATE achievements_unlocked SET celebrated = 1 WHERE achievement_id = ?',
    id
  );
}

// =========================
// Daily Challenges
// =========================

export type DailyChallenge = {
  id: string;
  date: string; // YYYY-MM-DD
  templateId: string;
  target: number;
  progress: number;
  completed: boolean;
  completedAt: number | null;
};

export async function listDailyChallenges(date: string): Promise<DailyChallenge[]> {
  const d = await db();
  const rows = await d.getAllAsync<any>(
    'SELECT * FROM daily_challenges WHERE date = ?',
    date
  );
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    templateId: r.template_id,
    target: r.target,
    progress: r.progress,
    completed: Boolean(r.completed),
    completedAt: r.completed_at ?? null,
  }));
}

export async function saveDailyChallenge(c: DailyChallenge): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT OR REPLACE INTO daily_challenges
     (id, date, template_id, target, progress, completed, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    c.id,
    c.date,
    c.templateId,
    c.target,
    c.progress,
    c.completed ? 1 : 0,
    c.completedAt
  );
}

/** Conta dias consecutivos onde houve pelo menos 1 challenge completo. */
export async function countChallengeStreak(): Promise<number> {
  const d = await db();
  const rows = await d.getAllAsync<{ date: string }>(
    'SELECT DISTINCT date FROM daily_challenges WHERE completed = 1 ORDER BY date DESC'
  );
  if (rows.length === 0) return 0;
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const key = day.toISOString().slice(0, 10);
    if (rows.find((r) => r.date === key)) {
      streak++;
    } else {
      // permitir começar HOJE como 0 e seguir; mas se hoje tá vazio e ontem
      // também, quebra.
      if (i === 0) continue; // hoje pode tá vazio ainda
      break;
    }
  }
  return streak;
}
