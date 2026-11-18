import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  CategoryKey,
  CategoryResult,
  ClientMessage,
  PlayerRoundOutcome,
  RoomPhase,
  RoomStatePublic,
  RoundAnswers,
  RoundResult,
  ServerMessage,
} from './src/types/game.ts';
import {
  verifyRoundEntries,
  type EntryCandidate,
  type VerifiedEntryVerdict,
} from './server/verifyEntries.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const CATEGORY_KEYS: CategoryKey[] = ['name', 'place', 'animal', 'thing'];
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const PLAYER_COLORS = [
  '#DC2626', // Crimson
  '#2563EB', // Royal Blue
  '#D97706', // Amber Gold
  '#059669', // Emerald
  '#7C3AED', // Plum
  '#0D9488', // Teal
  '#E11D48', // Rose
  '#4F46E5', // Indigo
];

interface PlayerInternal {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  isHost: boolean;
  score: number;
  hasStopped: boolean;
  hasEndedGame: boolean;
  roundScores: number[];
  ws: WebSocket | null;
}

interface RoomInternal {
  code: string;
  phase: RoomPhase;
  players: PlayerInternal[];
  roundNumber: number;
  turnPointer: number;
  currentLetter: string | null;
  selectedByPlayerId: string | null;
  selectedByPlayerName: string | null;
  usedLetters: string[];
  countdownEndsAt: number | null;
  stopCountdownSeconds: number;
  countdownTimer: ReturnType<typeof setTimeout> | null;
  stoppedFirstBy: { id: string; name: string } | null;
  currentDrafts: Record<string, RoundAnswers>;
  roundParticipants: Set<string>;
  isFinalizing: boolean;
  verificationError: string | null;
  lastRoundResult: RoundResult | null;
  roundHistory: RoundResult[];
  lastActivityAt: number;
}

const rooms = new Map<string, RoomInternal>();
const socketSession = new WeakMap<WebSocket, { roomCode: string; playerId: string }>();

function emptyAnswers(): RoundAnswers {
  return { name: '', place: '', animal: '', thing: '' };
}

function sanitizeAnswers(input: Partial<RoundAnswers> | undefined): RoundAnswers {
  return {
    name: typeof input?.name === 'string' ? input.name.slice(0, 60) : '',
    place: typeof input?.place === 'string' ? input.place.slice(0, 60) : '',
    animal: typeof input?.animal === 'string' ? input.animal.slice(0, 60) : '',
    thing: typeof input?.thing === 'string' ? input.thing.slice(0, 60) : '',
  };
}

function generateRoomCode(): string {
  for (let attempt = 0; attempt < 25; attempt++) {
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function getActivePlayers(room: RoomInternal): PlayerInternal[] {
  return room.players.filter((p) => !p.hasEndedGame);
}

function getCurrentTurnPlayer(room: RoomInternal): PlayerInternal | null {
  const active = getActivePlayers(room);
  if (active.length === 0) return null;
  return active[room.turnPointer % active.length];
}

function sendJson(ws: WebSocket | null, payload: ServerMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function buildPublicState(room: RoomInternal): RoomStatePublic {
  const turnPlayer = getCurrentTurnPlayer(room);
  return {
    code: room.code,
    phase: room.phase,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: p.connected,
      isHost: p.isHost,
      score: p.score,
      hasStopped: p.hasStopped,
      hasEndedGame: p.hasEndedGame,
      roundScores: [...p.roundScores],
    })),
    roundNumber: room.roundNumber,
    turnPlayerId: turnPlayer ? turnPlayer.id : null,
    currentLetter: room.currentLetter,
    usedLetters: [...room.usedLetters],
    countdownEndsAt: room.countdownEndsAt,
    stopCountdownSeconds: room.stopCountdownSeconds,
    stoppedFirstBy: room.stoppedFirstBy,
    serverNow: Date.now(),
    verificationError: room.verificationError,
    lastRoundResult: room.lastRoundResult,
    roundHistory: room.roundHistory,
  };
}

function broadcastRoom(room: RoomInternal) {
  room.lastActivityAt = Date.now();
  const state = buildPublicState(room);
  for (const player of room.players) {
    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
      const msg: ServerMessage = {
        type: 'room_state',
        state,
        yourPlayerId: player.id,
        yourDraft:
          room.phase === 'PLAYING'
            ? room.currentDrafts[player.id] ?? emptyAnswers()
            : undefined,
      };
      player.ws.send(JSON.stringify(msg));
    }
  }
}

function clearCountdown(room: RoomInternal) {
  if (room.countdownTimer) {
    clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
  }
  room.countdownEndsAt = null;
}

function normalizeAnswer(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isEnglishLatinInput(raw: string): boolean {
  return /^[a-zA-Z][a-zA-Z\s'.-]*$/.test(raw);
}

async function finalizeRound(room: RoomInternal) {
  if (
    (room.phase !== 'PLAYING' && room.phase !== 'VERIFYING') ||
    !room.currentLetter ||
    room.isFinalizing
  ) {
    return;
  }

  room.isFinalizing = true;
  room.verificationError = null;
  clearCountdown(room);

  const targetLetter = room.currentLetter.toLowerCase();
  const participants = room.players.filter((p) => room.roundParticipants.has(p.id));

  // Lock all participants immediately and enter VERIFYING phase
  for (const p of participants) {
    if (!p.hasStopped) {
      p.hasStopped = true;
    }
  }
  room.phase = 'VERIFYING';
  broadcastRoom(room);

  // Pre-parse entries and gather unique English candidates for real-world check
  type PreParsed = {
    raw: string;
    normalized: string;
    preValid: boolean;
    reason?: 'empty' | 'wrong_letter' | 'not_english';
    note?: string;
    cacheKey?: string;
  };

  const preParsedByPlayer = new Map<string, Record<CategoryKey, PreParsed>>();
  const candidateMap = new Map<string, EntryCandidate>();

  for (const p of participants) {
    const draft = room.currentDrafts[p.id] ?? emptyAnswers();
    const record = {} as Record<CategoryKey, PreParsed>;

    for (const cat of CATEGORY_KEYS) {
      const raw = (draft[cat] ?? '').trim();
      const normalized = normalizeAnswer(raw);

      if (normalized.length === 0) {
        record[cat] = {
          raw,
          normalized,
          preValid: false,
          reason: 'empty',
          note: 'No answer written',
        };
      } else if (!isEnglishLatinInput(raw)) {
        record[cat] = {
          raw,
          normalized,
          preValid: false,
          reason: 'not_english',
          note: 'Must be written in English',
        };
      } else if (normalized[0] !== targetLetter) {
        record[cat] = {
          raw,
          normalized,
          preValid: false,
          reason: 'wrong_letter',
          note: `Must start with ${room.currentLetter}`,
        };
      } else {
        const cacheKey = `${cat}::${normalized}`;
        record[cat] = { raw, normalized, preValid: true, cacheKey };
        if (!candidateMap.has(cacheKey)) {
          candidateMap.set(cacheKey, {
            cacheKey,
            category: cat,
            word: raw,
          });
        }
      }
    }

    preParsedByPlayer.set(p.id, record);
  }

  let verdicts = new Map<string, VerifiedEntryVerdict>();
  if (candidateMap.size > 0) {
    try {
      verdicts = await verifyRoundEntries(Array.from(candidateMap.values()));
    } catch (err) {
      room.isFinalizing = false;
      room.verificationError =
        err instanceof Error
          ? err.message
          : 'Could not verify answers. Please retry.';
      broadcastRoom(room);
      return;
    }
  }

  const playerOutcomes: Record<string, PlayerRoundOutcome> = {};
  for (const p of participants) {
    playerOutcomes[p.id] = {
      playerId: p.id,
      playerName: p.name,
      playerColor: p.color,
      answers: {
        name: { raw: '', normalized: '', valid: false, reason: 'empty', marks: 0, sharedCount: 0 },
        place: { raw: '', normalized: '', valid: false, reason: 'empty', marks: 0, sharedCount: 0 },
        animal: { raw: '', normalized: '', valid: false, reason: 'empty', marks: 0, sharedCount: 0 },
        thing: { raw: '', normalized: '', valid: false, reason: 'empty', marks: 0, sharedCount: 0 },
      },
      totalRoundMarks: 0,
    };
  }

  for (const cat of CATEGORY_KEYS) {
    const freqMap = new Map<string, number>();

    // First pass: check deterministic + Gemini real-world English verification
    for (const p of participants) {
      const parsed = preParsedByPlayer.get(p.id)![cat];
      if (!parsed.preValid || !parsed.cacheKey) continue;
      const verdict = verdicts.get(parsed.cacheKey);
      if (verdict?.isValid) {
        freqMap.set(parsed.normalized, (freqMap.get(parsed.normalized) ?? 0) + 1);
      }
    }

    // Second pass: assign marks (10 unique valid, 10 / count shared valid, 0 invalid)
    for (const p of participants) {
      const parsed = preParsedByPlayer.get(p.id)![cat];
      let result: CategoryResult;

      if (!parsed.preValid || !parsed.cacheKey) {
        result = {
          raw: parsed.raw,
          normalized: parsed.normalized,
          valid: false,
          reason: parsed.reason,
          verificationNote: parsed.note,
          marks: 0,
          sharedCount: 0,
        };
      } else {
        const verdict = verdicts.get(parsed.cacheKey);
        if (!verdict || !verdict.isValid) {
          const reason: CategoryResult['reason'] =
            verdict?.reasonCode === 'not_english'
              ? 'not_english'
              : verdict?.reasonCode === 'wrong_category'
              ? 'wrong_category'
              : 'not_real';
          result = {
            raw: parsed.raw,
            normalized: parsed.normalized,
            valid: false,
            reason,
            verificationNote: verdict?.note ?? 'Not a real-world English item',
            marks: 0,
            sharedCount: 0,
          };
        } else {
          const count = freqMap.get(parsed.normalized) ?? 1;
          const marks = Number((10 / count).toFixed(2));
          result = {
            raw: parsed.raw,
            normalized: parsed.normalized,
            valid: true,
            verificationNote: verdict.note,
            marks,
            sharedCount: count,
          };
        }
      }

      playerOutcomes[p.id].answers[cat] = result;
      playerOutcomes[p.id].totalRoundMarks = Number(
        (playerOutcomes[p.id].totalRoundMarks + result.marks).toFixed(2)
      );
    }
  }

  // Record marks onto players
  for (const p of participants) {
    const roundTotal = playerOutcomes[p.id].totalRoundMarks;
    p.score = Number((p.score + roundTotal).toFixed(2));
    p.roundScores.push(roundTotal);
  }

  const roundResult: RoundResult = {
    roundNumber: room.roundNumber,
    letter: room.currentLetter,
    selectedByPlayerId: room.selectedByPlayerId ?? '',
    selectedByPlayerName: room.selectedByPlayerName ?? '',
    stoppedFirstByPlayerId: room.stoppedFirstBy?.id ?? null,
    stoppedFirstByPlayerName: room.stoppedFirstBy?.name ?? null,
    playerResults: playerOutcomes,
  };

  room.lastRoundResult = roundResult;
  room.roundHistory.push(roundResult);
  room.isFinalizing = false;
  room.verificationError = null;

  // Check if at least 2 active players remain; otherwise conclude the room match
  const active = getActivePlayers(room);
  if (active.length < 2) {
    room.phase = 'GAME_OVER';
  } else {
    room.phase = 'ROUND_SUMMARY';
    room.turnPointer = (room.turnPointer + 1) % active.length;
  }

  broadcastRoom(room);
}

function checkAllStopped(room: RoomInternal): boolean {
  const activeConnected = room.players.filter(
    (p) => room.roundParticipants.has(p.id) && !p.hasEndedGame && p.connected
  );
  if (activeConnected.length === 0) return true;
  return activeConnected.every((p) => p.hasStopped);
}

function ensureHostExists(room: RoomInternal) {
  if (!room.players.some((p) => p.isHost && !p.hasEndedGame)) {
    const candidate =
      room.players.find((p) => !p.hasEndedGame && p.connected) ??
      room.players.find((p) => !p.hasEndedGame) ??
      room.players[0];
    if (candidate) {
      for (const p of room.players) p.isHost = false;
      candidate.isHost = true;
    }
  }
}

function handleClientMessage(ws: WebSocket, rawData: string) {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(rawData) as ClientMessage;
  } catch {
    sendJson(ws, { type: 'error', message: 'Invalid message payload.' });
    return;
  }

  if (msg.type === 'create_room') {
    const cleanName = msg.playerName.trim().slice(0, 24);
    if (!cleanName) {
      sendJson(ws, { type: 'error', message: 'Please enter your player name.' });
      return;
    }
    const clientId = msg.clientId.trim() || crypto.randomUUID();
    const code = generateRoomCode();
    const player: PlayerInternal = {
      id: clientId,
      name: cleanName,
      color: PLAYER_COLORS[0],
      connected: true,
      isHost: true,
      score: 0,
      hasStopped: false,
      hasEndedGame: false,
      roundScores: [],
      ws,
    };

    const room: RoomInternal = {
      code,
      phase: 'LOBBY',
      players: [player],
      roundNumber: 0,
      turnPointer: 0,
      currentLetter: null,
      selectedByPlayerId: null,
      selectedByPlayerName: null,
      usedLetters: [],
      countdownEndsAt: null,
      stopCountdownSeconds: 10,
      countdownTimer: null,
      stoppedFirstBy: null,
      currentDrafts: {},
      roundParticipants: new Set(),
      isFinalizing: false,
      verificationError: null,
      lastRoundResult: null,
      roundHistory: [],
      lastActivityAt: Date.now(),
    };

    rooms.set(code, room);
    socketSession.set(ws, { roomCode: code, playerId: player.id });
    broadcastRoom(room);
    return;
  }

  if (msg.type === 'join_room') {
    const code = msg.roomCode.trim().toUpperCase();
    const cleanName = msg.playerName.trim().slice(0, 24);
    if (!code) {
      sendJson(ws, { type: 'error', message: 'Please enter a room code.' });
      return;
    }
    if (!cleanName) {
      sendJson(ws, { type: 'error', message: 'Please enter your player name.' });
      return;
    }

    const room = rooms.get(code);
    if (!room) {
      sendJson(ws, { type: 'error', message: `Room "${code}" not found. Check the code and try again.` });
      return;
    }

    const clientId = msg.clientId.trim() || crypto.randomUUID();
    const existing = room.players.find((p) => p.id === clientId);

    if (existing) {
      existing.ws = ws;
      existing.connected = true;
      existing.name = cleanName;
      socketSession.set(ws, { roomCode: code, playerId: existing.id });
      broadcastRoom(room);
      return;
    }

    // Unlimited players allowed!
    const color = PLAYER_COLORS[room.players.length % PLAYER_COLORS.length];
    const newPlayer: PlayerInternal = {
      id: clientId,
      name: cleanName,
      color,
      connected: true,
      isHost: false,
      score: 0,
      hasStopped: false,
      hasEndedGame: false,
      roundScores: new Array(room.roundHistory.length).fill(0),
      ws,
    };

    room.players.push(newPlayer);
    if (room.phase === 'PLAYING') {
      room.roundParticipants.add(newPlayer.id);
      room.currentDrafts[newPlayer.id] = emptyAnswers();
    }

    socketSession.set(ws, { roomCode: code, playerId: newPlayer.id });
    broadcastRoom(room);
    return;
  }

  const session = socketSession.get(ws);
  if (!session) {
    sendJson(ws, { type: 'error', message: 'You are not in a room.' });
    return;
  }

  const room = rooms.get(session.roomCode);
  if (!room) {
    sendJson(ws, { type: 'error', message: 'Room no longer exists.' });
    return;
  }

  const player = room.players.find((p) => p.id === session.playerId);
  if (!player) {
    sendJson(ws, { type: 'error', message: 'Player not found in room.' });
    return;
  }

  switch (msg.type) {
    case 'start_match': {
      if (room.phase !== 'LOBBY') return;
      const active = getActivePlayers(room);
      if (active.length < 2) {
        sendJson(ws, {
          type: 'error',
          message: 'Minimum 2 players are required to start the game.',
        });
        return;
      }
      room.roundNumber = 1;
      room.turnPointer = 0;
      room.phase = 'TURN_SELECT';
      broadcastRoom(room);
      break;
    }

    case 'update_settings': {
      if (!player.isHost) {
        sendJson(ws, {
          type: 'error',
          message: 'Only the room host can edit the Stop countdown.',
        });
        return;
      }
      if (room.countdownEndsAt !== null) {
        sendJson(ws, {
          type: 'error',
          message: 'Cannot change Stop countdown while the timer is actively running.',
        });
        return;
      }
      const parsed = Math.round(Number(msg.stopCountdownSeconds));
      if (!Number.isFinite(parsed) || parsed < 3 || parsed > 60) {
        sendJson(ws, {
          type: 'error',
          message: 'Stop countdown must be between 3 and 60 seconds.',
        });
        return;
      }
      room.stopCountdownSeconds = parsed;
      broadcastRoom(room);
      break;
    }

    case 'spin_alphabet': {
      if (room.phase !== 'TURN_SELECT') return;
      const turnPlayer = getCurrentTurnPlayer(room);
      if (!turnPlayer || turnPlayer.id !== player.id) {
        sendJson(ws, {
          type: 'error',
          message: `Wait for ${turnPlayer?.name ?? 'the active player'} to spin the alphabet.`,
        });
        return;
      }

      let available = ALPHABET.filter((ch) => !room.usedLetters.includes(ch));
      if (available.length === 0) {
        room.usedLetters = [];
        available = [...ALPHABET];
      }

      const chosen = available[Math.floor(Math.random() * available.length)];
      room.usedLetters.push(chosen);
      room.currentLetter = chosen;
      room.selectedByPlayerId = player.id;
      room.selectedByPlayerName = player.name;
      room.stoppedFirstBy = null;
      clearCountdown(room);
      room.currentDrafts = {};
      room.roundParticipants = new Set();

      for (const p of room.players) {
        p.hasStopped = false;
        if (!p.hasEndedGame) {
          room.roundParticipants.add(p.id);
          room.currentDrafts[p.id] = emptyAnswers();
        }
      }

      room.phase = 'PLAYING';
      broadcastRoom(room);
      break;
    }

    case 'update_draft': {
      if (room.phase !== 'PLAYING') return;
      if (player.hasStopped || player.hasEndedGame) return;
      room.currentDrafts[player.id] = sanitizeAnswers(msg.answers);
      room.lastActivityAt = Date.now();
      break;
    }

    case 'player_stop': {
      if (room.phase !== 'PLAYING') return;
      if (player.hasStopped || player.hasEndedGame) return;

      const latest = sanitizeAnswers(msg.answers);
      room.currentDrafts[player.id] = latest;

      // Before anyone has triggered STOP, the first player MUST have filled all 4 items
      if (room.countdownEndsAt === null) {
        const allFilled = CATEGORY_KEYS.every((k) => latest[k].trim().length > 0);
        if (!allFilled) {
          sendJson(ws, {
            type: 'error',
            message: 'Fill all 4 items (Name, Place, Animal, Thing) before pressing Stop.',
          });
          return;
        }

        const durationMs = room.stopCountdownSeconds * 1000;
        player.hasStopped = true;
        room.stoppedFirstBy = { id: player.id, name: player.name };
        room.countdownEndsAt = Date.now() + durationMs;

        // If somehow all players already stopped (e.g. solo connected edge), finalize right away
        if (checkAllStopped(room)) {
          void finalizeRound(room);
          return;
        }

        // Configured countdown + 250ms grace period for final client keystrokes in flight
        room.countdownTimer = setTimeout(() => {
          void finalizeRound(room);
        }, durationMs + 250);

        broadcastRoom(room);
      } else {
        // Countdown is already running; remaining players can stop with whatever they have
        player.hasStopped = true;
        if (checkAllStopped(room)) {
          void finalizeRound(room);
        } else {
          broadcastRoom(room);
        }
      }
      break;
    }

    case 'retry_verification': {
      if (room.phase === 'VERIFYING' && !room.isFinalizing) {
        void finalizeRound(room);
      }
      break;
    }

    case 'next_round': {
      if (room.phase !== 'ROUND_SUMMARY') return;
      const active = getActivePlayers(room);
      if (active.length < 2) {
        room.phase = 'GAME_OVER';
        broadcastRoom(room);
        return;
      }
      room.roundNumber += 1;
      room.currentLetter = null;
      room.lastRoundResult = null;
      room.verificationError = null;
      room.stoppedFirstBy = null;
      clearCountdown(room);
      room.phase = 'TURN_SELECT';
      broadcastRoom(room);
      break;
    }

    case 'end_game': {
      if (room.phase === 'LOBBY') {
        if (player.isHost) {
          room.phase = 'GAME_OVER';
          broadcastRoom(room);
        }
        return;
      }

      if (msg.forAll && player.isHost) {
        if (room.phase === 'PLAYING') {
          void finalizeRound(room);
          return;
        }
        clearCountdown(room);
        room.verificationError = null;
        room.isFinalizing = false;
        room.phase = 'GAME_OVER';
        broadcastRoom(room);
        return;
      }

      // Individual player chooses End Game -> their game ends & they see their total score
      player.hasEndedGame = true;
      player.hasStopped = true;

      if (room.phase === 'PLAYING') {
        const active = getActivePlayers(room);
        if (active.length < 2 || checkAllStopped(room)) {
          void finalizeRound(room);
          return;
        }
      } else if (room.phase === 'TURN_SELECT') {
        const active = getActivePlayers(room);
        if (active.length < 2) {
          room.phase = 'GAME_OVER';
        } else {
          room.turnPointer = room.turnPointer % active.length;
        }
      } else if (room.phase === 'ROUND_SUMMARY') {
        const active = getActivePlayers(room);
        if (active.length < 2) {
          room.phase = 'GAME_OVER';
        }
      }

      ensureHostExists(room);
      broadcastRoom(room);
      break;
    }

    case 'play_again': {
      clearCountdown(room);
      room.phase = 'LOBBY';
      room.roundNumber = 0;
      room.turnPointer = 0;
      room.currentLetter = null;
      room.selectedByPlayerId = null;
      room.selectedByPlayerName = null;
      room.usedLetters = [];
      room.stoppedFirstBy = null;
      room.currentDrafts = {};
      room.roundParticipants = new Set();
      room.isFinalizing = false;
      room.verificationError = null;
      room.lastRoundResult = null;
      room.roundHistory = [];

      for (const p of room.players) {
        p.score = 0;
        p.hasStopped = false;
        p.hasEndedGame = false;
        p.roundScores = [];
      }

      // Remove disconnected players on full room reset
      room.players = room.players.filter((p) => p.connected);
      ensureHostExists(room);
      broadcastRoom(room);
      break;
    }

    case 'leave_room': {
      socketSession.delete(ws);
      if (room.phase === 'LOBBY') {
        room.players = room.players.filter((p) => p.id !== player.id);
      } else {
        player.connected = false;
        player.ws = null;
      }
      sendJson(ws, { type: 'left_room' });
      if (room.players.length === 0) {
        clearCountdown(room);
        rooms.delete(room.code);
      } else {
        ensureHostExists(room);
        if (room.phase === 'PLAYING' && checkAllStopped(room)) {
          void finalizeRound(room);
        } else {
          broadcastRoom(room);
        }
      }
      break;
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeRooms: rooms.size });
  });

  app.get('/api/rooms/:code', (req, res) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      res.status(404).json({ exists: false });
      return;
    }
    res.json({
      exists: true,
      code: room.code,
      playerCount: room.players.length,
      phase: room.phase,
    });
  });

  if (IS_PROD) {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      handleClientMessage(ws, data.toString());
    });

    ws.on('close', () => {
      const session = socketSession.get(ws);
      if (!session) return;
      const room = rooms.get(session.roomCode);
      if (!room) return;
      const player = room.players.find((p) => p.id === session.playerId);
      if (!player) return;

      // Only mark disconnected if this socket is still the active one for that player
      if (player.ws === ws) {
        player.connected = false;
        player.ws = null;
        ensureHostExists(room);
        if (room.phase === 'PLAYING' && checkAllStopped(room)) {
          void finalizeRound(room);
        } else {
          broadcastRoom(room);
        }
      }
    });
  });

  // Periodic cleanup of stale rooms (> 2 hours idle)
  setInterval(() => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [code, room] of rooms.entries()) {
      const anyConnected = room.players.some((p) => p.connected);
      if (!anyConnected && room.lastActivityAt < cutoff) {
        clearCountdown(room);
        rooms.delete(code);
      }
    }
  }, 10 * 60 * 1000);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Name Place Animal Thing server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
