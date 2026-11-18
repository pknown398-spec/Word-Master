export type CategoryKey = 'name' | 'place' | 'animal' | 'thing';

export const CATEGORIES: ReadonlyArray<{
  key: CategoryKey;
  label: string;
  placeholderExample: string;
}> = [
  { key: 'name', label: 'Name', placeholderExample: 'e.g. Amina' },
  { key: 'place', label: 'Place', placeholderExample: 'e.g. Amsterdam' },
  { key: 'animal', label: 'Animal', placeholderExample: 'e.g. Albatross' },
  { key: 'thing', label: 'Thing', placeholderExample: 'e.g. Anchor' },
];

export type RoundAnswers = Record<CategoryKey, string>;

export type RoomPhase =
  | 'LOBBY'
  | 'TURN_SELECT'
  | 'PLAYING'
  | 'VERIFYING'
  | 'ROUND_SUMMARY'
  | 'GAME_OVER';

export interface PlayerPublic {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  isHost: boolean;
  score: number;
  hasStopped: boolean;
  hasEndedGame: boolean;
  roundScores: number[];
}

export interface CategoryResult {
  raw: string;
  normalized: string;
  valid: boolean;
  reason?:
    | 'empty'
    | 'wrong_letter'
    | 'not_english'
    | 'not_real'
    | 'wrong_category';
  verificationNote?: string;
  marks: number;
  sharedCount: number;
}

export interface PlayerRoundOutcome {
  playerId: string;
  playerName: string;
  playerColor: string;
  answers: Record<CategoryKey, CategoryResult>;
  totalRoundMarks: number;
}

export interface RoundResult {
  roundNumber: number;
  letter: string;
  selectedByPlayerId: string;
  selectedByPlayerName: string;
  stoppedFirstByPlayerId: string | null;
  stoppedFirstByPlayerName: string | null;
  playerResults: Record<string, PlayerRoundOutcome>;
}

export interface RoomStatePublic {
  code: string;
  phase: RoomPhase;
  players: PlayerPublic[];
  roundNumber: number;
  turnPlayerId: string | null;
  currentLetter: string | null;
  usedLetters: string[];
  countdownEndsAt: number | null;
  stopCountdownSeconds: number;
  stoppedFirstBy: { id: string; name: string } | null;
  serverNow: number;
  verificationError: string | null;
  lastRoundResult: RoundResult | null;
  roundHistory: RoundResult[];
}

export type ClientMessage =
  | { type: 'create_room'; playerName: string; clientId: string }
  | { type: 'join_room'; roomCode: string; playerName: string; clientId: string }
  | { type: 'start_match' }
  | { type: 'update_settings'; stopCountdownSeconds: number }
  | { type: 'spin_alphabet' }
  | { type: 'update_draft'; answers: RoundAnswers }
  | { type: 'player_stop'; answers: RoundAnswers }
  | { type: 'retry_verification' }
  | { type: 'next_round' }
  | { type: 'end_game'; forAll?: boolean }
  | { type: 'play_again' }
  | { type: 'leave_room' };

export type ServerMessage =
  | {
      type: 'room_state';
      state: RoomStatePublic;
      yourPlayerId: string;
      yourDraft?: RoundAnswers;
    }
  | { type: 'error'; message: string }
  | { type: 'left_room' };
