import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  Crown,
  Dices,
  Flag,
  Hand,
  Loader2,
  LogOut,
  Play,
  RotateCcw,
  ShieldCheck,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  CATEGORIES,
  type CategoryKey,
  type ClientMessage,
  type RoomStatePublic,
  type RoundAnswers,
} from '../types/game.ts';
import { soundFX } from '../utils/sound.ts';
import { Leaderboard } from './Leaderboard.tsx';

interface GameTableProps {
  roomState: RoomStatePublic;
  yourPlayerId: string;
  serverDraft: RoundAnswers | null;
  serverOffsetMs: number;
  errorMessage: string | null;
  muted: boolean;
  onToggleMute: () => void;
  onClearError: () => void;
  onSendMessage: (msg: ClientMessage) => boolean;
  onLeaveRoom: () => void;
}

const EMPTY_ANSWERS: RoundAnswers = {
  name: '',
  place: '',
  animal: '',
  thing: '',
};

const ALPHABET_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function formatMarks(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

export const GameTable: React.FC<GameTableProps> = ({
  roomState,
  yourPlayerId,
  serverDraft,
  serverOffsetMs,
  errorMessage,
  muted,
  onToggleMute,
  onClearError,
  onSendMessage,
  onLeaveRoom,
}) => {
  const me = useMemo(
    () => roomState.players.find((p) => p.id === yourPlayerId) ?? null,
    [roomState.players, yourPlayerId]
  );

  const activePlayers = useMemo(
    () => roomState.players.filter((p) => !p.hasEndedGame),
    [roomState.players]
  );

  const turnPlayer = useMemo(
    () => roomState.players.find((p) => p.id === roomState.turnPlayerId) ?? null,
    [roomState.players, roomState.turnPlayerId]
  );

  const isMyTurn = Boolean(me && roomState.turnPlayerId === me.id);

  // Copy invite link feedback
  const [copiedLink, setCopiedLink] = useState(false);

  // Local writing inputs for PLAYING phase
  const [answers, setAnswers] = useState<RoundAnswers>(EMPTY_ANSWERS);
  const lastRoundKeyRef = useRef<string>('');
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  // Animated letter spin state when entering PLAYING
  const [displayLetter, setDisplayLetter] = useState<string | null>(
    roomState.currentLetter
  );
  const [isSpinningAnim, setIsSpinningAnim] = useState(false);

  // Smooth 10s countdown state
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const lastSecondTickRef = useRef<number | null>(null);
  const prevCountdownActiveRef = useRef<boolean>(false);
  const prevPhaseRef = useRef<string>(roomState.phase);

  // Manual Stop countdown editor state (defaults to 10s)
  const [countdownInput, setCountdownInput] = useState<string>(
    String(roomState.stopCountdownSeconds)
  );

  useEffect(() => {
    setCountdownInput(String(roomState.stopCountdownSeconds));
  }, [roomState.stopCountdownSeconds]);

  const applyStopCountdown = (seconds: number) => {
    const clamped = Math.max(3, Math.min(60, Math.round(seconds)));
    setCountdownInput(String(clamped));
    onSendMessage({ type: 'update_settings', stopCountdownSeconds: clamped });
  };

  const handleCountdownFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(countdownInput);
    if (!Number.isFinite(num)) return;
    applyStopCountdown(num);
  };

  // Reset local answers when a new round starts
  useEffect(() => {
    const key = `${roomState.roundNumber}_${roomState.currentLetter ?? 'none'}_${roomState.phase}`;
    if (roomState.phase === 'PLAYING' && lastRoundKeyRef.current !== key) {
      lastRoundKeyRef.current = key;
      setAnswers(serverDraft ?? EMPTY_ANSWERS);
      setTimeout(() => {
        firstInputRef.current?.focus();
      }, 80);
    } else if (roomState.phase !== 'PLAYING') {
      lastRoundKeyRef.current = key;
    }
  }, [roomState.phase, roomState.roundNumber, roomState.currentLetter, serverDraft]);

  // Letter spin reveal animation & audio on transition into PLAYING
  useEffect(() => {
    if (
      roomState.phase === 'PLAYING' &&
      prevPhaseRef.current !== 'PLAYING' &&
      roomState.currentLetter
    ) {
      setIsSpinningAnim(true);
      let step = 0;
      const maxSteps = 10;
      const interval = setInterval(() => {
        step += 1;
        if (step < maxSteps) {
          setDisplayLetter(
            ALPHABET_GLYPHS[Math.floor(Math.random() * ALPHABET_GLYPHS.length)]
          );
          soundFX.playSpinTick();
        } else {
          clearInterval(interval);
          setDisplayLetter(roomState.currentLetter);
          setIsSpinningAnim(false);
          soundFX.playLetterLocked();
        }
      }, 55);
      prevPhaseRef.current = roomState.phase;
      return () => clearInterval(interval);
    }

    if (
      roomState.phase === 'ROUND_SUMMARY' &&
      (prevPhaseRef.current === 'PLAYING' || prevPhaseRef.current === 'VERIFYING')
    ) {
      const myOutcome = roomState.lastRoundResult?.playerResults[yourPlayerId];
      const hasTen = myOutcome
        ? Object.values(myOutcome.answers).some((a) => a.marks === 10)
        : false;
      soundFX.playRoundReveal(hasTen);
    }

    if (roomState.phase === 'GAME_OVER' && prevPhaseRef.current !== 'GAME_OVER') {
      soundFX.playGameOver();
    }

    prevPhaseRef.current = roomState.phase;
    setDisplayLetter(roomState.currentLetter);
    setIsSpinningAnim(false);
  }, [roomState.phase, roomState.currentLetter, roomState.lastRoundResult, yourPlayerId]);

  // Sound when someone triggers the 10-second STOP timer
  useEffect(() => {
    const active = roomState.countdownEndsAt !== null;
    if (active && !prevCountdownActiveRef.current) {
      soundFX.playStopPressed();
    }
    prevCountdownActiveRef.current = active;
  }, [roomState.countdownEndsAt]);

  // Smooth RAF loop for 10s STOP countdown
  useEffect(() => {
    if (!roomState.countdownEndsAt || roomState.phase !== 'PLAYING') {
      setRemainingMs(null);
      lastSecondTickRef.current = null;
      return;
    }

    let rafId = 0;
    const endAt = roomState.countdownEndsAt;

    const tick = () => {
      const serverNowApprox = Date.now() + serverOffsetMs;
      const left = Math.max(0, endAt - serverNowApprox);
      setRemainingMs(left);

      const ceilSec = Math.ceil(left / 1000);
      if (ceilSec >= 1 && ceilSec <= 3 && ceilSec !== lastSecondTickRef.current) {
        lastSecondTickRef.current = ceilSec;
        soundFX.playCountdownTick(ceilSec === 1);
      }

      if (left > 0) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [roomState.countdownEndsAt, roomState.phase, serverOffsetMs]);

  const handleCopyInvite = async () => {
    const url = `${window.location.origin}/?room=${roomState.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Fallback select
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleAnswerChange = (key: CategoryKey, value: string) => {
    if (me?.hasStopped || me?.hasEndedGame) return;
    if (errorMessage) onClearError();
    const updated = { ...answers, [key]: value };
    setAnswers(updated);

    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      onSendMessage({ type: 'update_draft', answers: updated });
    }, 100);
  };

  const handleStopClick = () => {
    if (!me || me.hasStopped) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    onSendMessage({ type: 'player_stop', answers });
  };

  const allFourFilled = CATEGORIES.every((c) => answers[c.key].trim().length > 0);
  const countdownRunning = roomState.countdownEndsAt !== null;
  const canClickStop =
    Boolean(me && !me.hasStopped) && (countdownRunning || allFourFilled);

  // Sorted leaderboard by total score descending
  const rankedPlayers = useMemo(
    () => [...roomState.players].sort((a, b) => b.score - a.score),
    [roomState.players]
  );

  // Show Final Score view if the room is GAME_OVER OR if this specific player clicked End Game
  const showPersonalOrRoomGameOver =
    roomState.phase === 'GAME_OVER' || Boolean(me?.hasEndedGame);

  const phaseLabel =
    roomState.phase === 'LOBBY'
      ? 'Lobby'
      : roomState.phase === 'TURN_SELECT'
      ? `Round ${roomState.roundNumber} · Pick Letter`
      : roomState.phase === 'PLAYING'
      ? `Round ${roomState.roundNumber} · Letter ${roomState.currentLetter ?? ''}`
      : roomState.phase === 'VERIFYING'
      ? `Round ${roomState.roundNumber} · Verifying`
      : roomState.phase === 'ROUND_SUMMARY'
      ? `Round ${roomState.roundNumber} · Results`
      : 'Final Standings';

  const showPersistentLeaderboard =
    !showPersonalOrRoomGameOver &&
    (roomState.phase === 'TURN_SELECT' ||
      roomState.phase === 'PLAYING' ||
      roomState.phase === 'VERIFYING' ||
      roomState.phase === 'ROUND_SUMMARY');

  return (
    <div className="relative min-h-dvh w-full flex flex-col justify-between p-3 sm:p-5 lg:p-6">
      {/* Unobtrusive Top Perimeter HUD */}
      <header className="relative z-10 max-w-7xl w-full mx-auto flex flex-wrap items-center justify-between gap-3 bg-[#0c3325]/90 border border-emerald-200/15 rounded-xl px-4 py-2.5 text-emerald-50 shadow-lg">
        {/* Left: Room identity + copy link */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold tracking-tight whitespace-nowrap shrink-0">
            <span className="font-mono tracking-wider text-amber-300">
              {roomState.code}
            </span>
          </div>
          <button
            type="button"
            onClick={handleCopyInvite}
            className="h-8 px-2.5 rounded-lg bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-200/15 text-xs font-medium text-emerald-100 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copiedLink ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Link Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Invite</span>
              </>
            )}
          </button>
          <span className="hidden sm:inline text-xs text-emerald-200/70 whitespace-nowrap">
            {phaseLabel}
          </span>
        </div>

        {/* Right: Your score + Mute + End Game / Leave */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {me && (
            <div className="text-xs sm:text-sm font-medium text-emerald-100 whitespace-nowrap tabular-nums pr-1">
              Score: <strong className="text-amber-300 font-mono">{formatMarks(me.score)}</strong>
            </div>
          )}

          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            className="h-9 w-9 rounded-lg bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-200/15 flex items-center justify-center text-emerald-100 transition-colors cursor-pointer"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {!showPersonalOrRoomGameOver && roomState.phase !== 'LOBBY' && (
            <button
              type="button"
              onClick={() => onSendMessage({ type: 'end_game' })}
              className="h-9 px-3 rounded-lg bg-red-600/90 hover:bg-red-600 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Flag className="w-3.5 h-3.5" />
              <span>End Game</span>
            </button>
          )}

          {(roomState.phase === 'LOBBY' || showPersonalOrRoomGameOver) && (
            <button
              type="button"
              onClick={onLeaveRoom}
              className="h-9 px-3 rounded-lg bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-200/15 text-emerald-100 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Leave</span>
            </button>
          )}
        </div>
      </header>

      {/* Error Toast if any */}
      {errorMessage && (
        <div className="relative z-20 max-w-2xl w-full mx-auto mt-3">
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-sm font-medium text-red-900 shadow-lg"
          >
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={onClearError}
              className="text-xs font-bold text-red-700 hover:text-red-900 px-2 py-1 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Center Playfield */}
      <main className="relative z-10 max-w-7xl w-full mx-auto my-auto py-4 sm:py-6">
        {/* ======================== GAME OVER / PERSONAL END GAME ======================== */}
        {showPersonalOrRoomGameOver && (
          <section className="max-w-3xl mx-auto bg-[#FBF9F4] text-[#18201D] rounded-2xl shadow-2xl border border-[#E5DCCB] p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#E5DCCB]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#54615B] mb-1">
                  {roomState.phase === 'GAME_OVER' ? 'Match Complete' : 'Your Game Ended'}
                </p>
                <h2
                  className="text-3xl sm:text-4xl font-extrabold text-[#18201D]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {roomState.phase === 'GAME_OVER' && rankedPlayers[0]
                    ? `${rankedPlayers[0].name} Wins`
                    : `Final Score: ${formatMarks(me?.score ?? 0)}`}
                </h2>
              </div>

              {me && (
                <div className="bg-[#0F5132] text-[#FAF7F0] rounded-xl px-5 py-3 text-right shrink-0">
                  <div className="text-xs text-emerald-100/80">Your Total Score</div>
                  <div className="text-3xl font-extrabold font-mono tabular-nums text-amber-300">
                    {formatMarks(me.score)}
                  </div>
                </div>
              )}
            </div>

            {me?.hasEndedGame && roomState.phase !== 'GAME_OVER' && (
              <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
                You ended your game early. Other players in the room can continue playing
                their remaining rounds.
              </div>
            )}

            {/* Final Standings Table */}
            <div className="mt-6">
              <h3 className="text-sm font-bold text-[#293530] mb-3">
                Room Leaderboard ({roomState.roundHistory.length} rounds played)
              </h3>
              <div className="overflow-x-auto rounded-xl border border-[#E5DCCB]">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#EFE9DC] text-[#3F4B45] text-xs font-semibold">
                      <th className="py-2.5 px-4">Rank</th>
                      <th className="py-2.5 px-4">Player</th>
                      <th className="py-2.5 px-4">Rounds</th>
                      <th className="py-2.5 px-4 text-right">Total Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ECE5D5] bg-white">
                    {rankedPlayers.map((p, idx) => (
                      <tr
                        key={p.id}
                        className={p.id === yourPlayerId ? 'bg-amber-50/60 font-semibold' : ''}
                      >
                        <td className="py-3 px-4 font-mono tabular-nums text-[#54615B]">
                          #{idx + 1}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{ backgroundColor: p.color }}
                            />
                            <span className="text-[#18201D]">{p.name}</span>
                            {idx === 0 && roomState.phase === 'GAME_OVER' && (
                              <Crown className="w-4 h-4 text-amber-600 shrink-0" />
                            )}
                            {p.id === yourPlayerId && (
                              <span className="text-xs text-[#54615B]">(You)</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-xs text-[#54615B]">
                          {p.roundScores.length > 0
                            ? p.roundScores.map(formatMarks).join(' · ')
                            : '0'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-base text-[#0F5132]">
                          {formatMarks(p.score)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={onLeaveRoom}
                className="h-11 px-5 rounded-xl bg-[#EFE9DC] hover:bg-[#E4DCCB] text-[#18201D] font-semibold text-sm transition-colors cursor-pointer"
              >
                Back to Title
              </button>
              {roomState.phase === 'GAME_OVER' && (
                <button
                  type="button"
                  onClick={() => onSendMessage({ type: 'play_again' })}
                  className="h-11 px-5 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white font-bold text-sm flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Play Again in Room</span>
                </button>
              )}
            </div>
          </section>
        )}

        {/* ======================== LOBBY ======================== */}
        {!showPersonalOrRoomGameOver && roomState.phase === 'LOBBY' && (
          <section className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: Room Code & Invite Card */}
            <div className="lg:col-span-5 bg-[#FBF9F4] text-[#18201D] rounded-2xl shadow-2xl border border-[#E5DCCB] p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#54615B] mb-1">
                Room Code
              </p>
              <div className="text-4xl font-extrabold font-mono tracking-widest text-[#0F5132] mb-4">
                {roomState.code}
              </div>
              <p className="text-sm text-[#43504A] leading-relaxed mb-5">
                Share this code or invite link with friends. Minimum 2 players are
                needed to start, and unlimited players can join the table.
              </p>
              <button
                type="button"
                onClick={handleCopyInvite}
                className="w-full h-11 px-4 rounded-xl bg-[#0F5132] hover:bg-[#0B3B24] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-300" />
                    <span>Invite Link Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy Shareable Invite Link</span>
                  </>
                )}
              </button>

              {/* Stop Countdown Timer Setting (Default 10s, Host Editable) */}
              <div className="mt-5 pt-5 border-t border-[#E5DCCB]">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-bold text-[#293530] flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#0F5132]" />
                    <span>Stop Countdown Timer</span>
                  </span>
                  <span className="text-xs font-mono tabular-nums font-bold text-[#0F5132]">
                    {roomState.stopCountdownSeconds}s
                    {roomState.stopCountdownSeconds === 10 ? ' (Default)' : ''}
                  </span>
                </div>

                {me?.isHost ? (
                  <div className="space-y-2.5">
                    <form
                      onSubmit={handleCountdownFormSubmit}
                      className="flex items-center gap-2"
                    >
                      <input
                        type="number"
                        min={3}
                        max={60}
                        step={1}
                        aria-label="Stop countdown seconds"
                        value={countdownInput}
                        onChange={(e) => setCountdownInput(e.target.value)}
                        className="w-24 h-10 px-3 rounded-lg bg-white border border-[#D4CBB8] font-mono tabular-nums text-sm font-bold text-[#18201D] focus:outline-none focus:ring-2 focus:ring-[#D97706]"
                      />
                      <span className="text-xs text-[#54615B]">sec (3–60)</span>
                      <button
                        type="submit"
                        className="ml-auto h-10 px-3.5 rounded-lg bg-[#EFE9DC] hover:bg-[#E4DCCB] text-[#18201D] text-xs font-bold transition-colors cursor-pointer"
                      >
                        Set Timer
                      </button>
                    </form>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[5, 10, 15, 20, 30].map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => applyStopCountdown(sec)}
                          className={`h-8 px-2.5 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
                            roomState.stopCountdownSeconds === sec
                              ? 'bg-[#0F5132] text-white'
                              : 'bg-white border border-[#D4CBB8] text-[#3F4B45] hover:bg-[#EFE9DC]'
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[#54615B]">
                    When any player presses Stop, others have{' '}
                    <strong className="text-[#18201D] font-mono tabular-nums">
                      {roomState.stopCountdownSeconds}s
                    </strong>{' '}
                    to finish (host can edit).
                  </p>
                )}
              </div>
            </div>

            {/* Right: Seated Players Roster & Start CTA */}
            <div className="lg:col-span-7 bg-[#FBF9F4] text-[#18201D] rounded-2xl shadow-2xl border border-[#E5DCCB] p-6">
              <div className="flex items-center justify-between mb-4">
                <h2
                  className="text-xl font-bold text-[#18201D] flex items-center gap-2"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  <Users className="w-5 h-5 text-[#0F5132]" />
                  <span>Players at Table ({roomState.players.length})</span>
                </h2>
                <span className="text-xs font-medium text-[#54615B]">
                  Min 2 · Unlimited max
                </span>
              </div>

              <div className="divide-y divide-[#ECE5D5] border border-[#E5DCCB] rounded-xl bg-white overflow-hidden mb-6">
                {roomState.players.map((p, index) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between px-4 py-3 text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="font-semibold text-[#18201D]">{p.name}</span>
                      {p.id === yourPlayerId && (
                        <span className="text-xs text-[#54615B]">You</span>
                      )}
                      {p.isHost && (
                        <span className="text-xs font-semibold text-amber-700">
                          Host
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#54615B] font-medium">
                      Turn #{index + 1} · {p.connected ? 'Ready' : 'Offline'}
                    </div>
                  </div>
                ))}
              </div>

              {me?.isHost ? (
                <button
                  type="button"
                  disabled={activePlayers.length < 2}
                  onClick={() => onSendMessage({ type: 'start_match' })}
                  className="w-full h-12 px-5 rounded-xl bg-[#D97706] hover:bg-[#B45309] disabled:bg-[#C8BFA8] disabled:cursor-not-allowed text-white font-bold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Play className="w-5 h-5" />
                  <span>
                    {activePlayers.length < 2
                      ? 'Waiting for at least 2 players...'
                      : `Start Match (${activePlayers.length} Players)`}
                  </span>
                </button>
              ) : (
                <div className="h-12 px-4 rounded-xl bg-[#EFE9DC] text-[#3F4B45] text-sm font-medium flex items-center justify-center">
                  {activePlayers.length < 2
                    ? 'Waiting for more players to join...'
                    : 'Waiting for host to start the match...'}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ======================== ACTIVE MATCH WORKSPACE + PERSISTENT LEADERBOARD ======================== */}
        {showPersistentLeaderboard && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <div className="lg:col-span-8 min-w-0">
              {/* ======================== TURN_SELECT ======================== */}
              {roomState.phase === 'TURN_SELECT' && (
                <section className="bg-[#FBF9F4] text-[#18201D] rounded-2xl shadow-2xl border border-[#E5DCCB] p-6 sm:p-8 text-center">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#54615B] mb-2">
                    Round {roomState.roundNumber} · Alphabet Selection Turn
                  </div>

                  <h2
                    className="text-2xl sm:text-3xl font-extrabold text-[#18201D] mb-6"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {isMyTurn
                      ? 'Your Turn to Spin a Random Alphabet'
                      : `${turnPlayer?.name ?? 'Next Player'} is Picking the Alphabet`}
                  </h2>

                  {/* Turn Order Track (Ludo-style player queue) */}
                  <div className="flex flex-wrap items-center justify-center gap-3 mb-7">
                    {activePlayers.map((p) => {
                      const isTurn = p.id === roomState.turnPlayerId;
                      return (
                        <div
                          key={p.id}
                          className={`px-3.5 py-2 rounded-xl border text-sm font-semibold flex items-center gap-2 transition-all ${
                            isTurn
                              ? 'bg-amber-50 border-amber-500 text-[#18201D] shadow-sm scale-[1.03]'
                              : 'bg-white border-[#E5DCCB] text-[#54615B]'
                          }`}
                        >
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: p.color }}
                          />
                          <span>{p.name}</span>
                          {isTurn && (
                            <span className="text-xs font-bold text-amber-700">· Turn</span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Central Random Alphabet Tile */}
                  <div className="w-32 h-32 mx-auto mb-7 rounded-2xl bg-[#0F5132] border-4 border-[#D6C7A9] shadow-xl flex items-center justify-center">
                    <span
                      className="text-6xl font-extrabold text-[#FAF7F0]"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      ?
                    </span>
                  </div>

                  {isMyTurn ? (
                    <button
                      type="button"
                      onClick={() => onSendMessage({ type: 'spin_alphabet' })}
                      className="h-13 px-8 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white font-bold text-base shadow-md inline-flex items-center justify-center gap-2.5 transition-transform active:scale-95 cursor-pointer"
                    >
                      <Dices className="w-5 h-5" />
                      <span>Spin Random Alphabet</span>
                    </button>
                  ) : (
                    <p className="text-sm text-[#54615B] font-medium">
                      Get ready! Once {turnPlayer?.name ?? 'they'} spin, everyone writes Name,
                      Place, Animal, and Thing starting with that letter.
                    </p>
                  )}

                  {/* Between-round Stop countdown display / host quick editor */}
                  <div className="mt-6 pt-4 border-t border-[#E5DCCB] flex flex-wrap items-center justify-center gap-3 text-xs text-[#54615B]">
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[#0F5132]" />
                      <span>Stop Countdown:</span>
                      <strong className="font-mono tabular-nums text-[#18201D]">
                        {roomState.stopCountdownSeconds}s
                      </strong>
                    </span>
                    {me?.isHost && (
                      <form
                        onSubmit={handleCountdownFormSubmit}
                        className="inline-flex items-center gap-1.5"
                      >
                        <input
                          type="number"
                          min={3}
                          max={60}
                          step={1}
                          aria-label="Edit stop countdown seconds"
                          value={countdownInput}
                          onChange={(e) => setCountdownInput(e.target.value)}
                          className="w-16 h-8 px-2 rounded-lg bg-white border border-[#D4CBB8] font-mono tabular-nums text-xs font-bold text-[#18201D] focus:outline-none focus:ring-2 focus:ring-[#D97706]"
                        />
                        <button
                          type="submit"
                          className="h-8 px-2.5 rounded-lg bg-[#EFE9DC] hover:bg-[#E4DCCB] text-[#18201D] font-semibold cursor-pointer"
                        >
                          Update
                        </button>
                      </form>
                    )}
                    {roomState.usedLetters.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          Played:{' '}
                          <span className="font-mono font-semibold text-[#18201D]">
                            {roomState.usedLetters.join(' ')}
                          </span>
                        </span>
                      </>
                    )}
                  </div>
                </section>
              )}

        {/* ======================== PLAYING ======================== */}
        {roomState.phase === 'PLAYING' && (
          <section className="space-y-4">
            {/* Top Round Focal Banner: Locked Letter + Configurable STOP Countdown */}
            <div className="bg-[#FBF9F4] text-[#18201D] rounded-2xl shadow-xl border border-[#E5DCCB] p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div
                  className={`w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-[#0F5132] border-2 border-[#D6C7A9] flex items-center justify-center shrink-0 transition-transform duration-150 ${
                    isSpinningAnim ? 'scale-105' : 'scale-100'
                  }`}
                >
                  <span
                    className="text-4xl sm:text-5xl font-extrabold text-[#FAF7F0]"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {displayLetter ?? roomState.currentLetter}
                  </span>
                </div>
                <div>
                  <div className="text-xs font-semibold text-[#54615B]">
                    Round {roomState.roundNumber} · Random Alphabet
                  </div>
                  <h2
                    className="text-xl sm:text-2xl font-extrabold text-[#18201D]"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    Starts with “{roomState.currentLetter}”
                  </h2>
                  <p className="text-xs text-[#54615B] mt-0.5">
                    Real-world English items only · Hidden until round ends · 10 pts unique
                  </p>
                </div>
              </div>

              {/* Configurable Countdown or Standby */}
              {countdownRunning && remainingMs !== null ? (
                <div className="w-full sm:w-auto bg-red-600 text-white rounded-xl px-5 py-3 text-center sm:text-right shadow-md">
                  <div className="text-xs font-semibold text-red-100">
                    {roomState.stoppedFirstBy?.name ?? 'Player'} clicked STOP!
                  </div>
                  <div className="text-3xl font-extrabold font-mono tabular-nums leading-tight">
                    {(remainingMs / 1000).toFixed(1)}s
                  </div>
                </div>
              ) : (
                <div className="w-full sm:w-auto bg-[#EFE9DC] text-[#3F4B45] rounded-xl px-4 py-3 text-center sm:text-right">
                  <div className="text-xs font-semibold">Timer Standby</div>
                  <div className="text-sm font-bold">
                    {roomState.stopCountdownSeconds}s timer starts on first STOP
                  </div>
                </div>
              )}
            </div>

            {/* Player Stop Status Strip (NO answers shown!) */}
            <div className="bg-[#0c3325]/90 border border-emerald-200/15 rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-emerald-50">
              <span className="font-semibold text-emerald-200/80">Players:</span>
              {activePlayers.map((p) => (
                <div key={p.id} className="flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="font-medium">{p.name}</span>
                  <span
                    className={
                      p.hasStopped ? 'text-amber-300 font-semibold' : 'text-emerald-200/70'
                    }
                  >
                    · {p.hasStopped ? 'Stopped' : 'Typing'}
                  </span>
                </div>
              ))}
            </div>

            {/* Ruled Ivory Writing Sheet */}
            <div className="bg-[#FBF9F4] text-[#18201D] rounded-2xl shadow-2xl border border-[#E5DCCB] p-5 sm:p-7 ruled-sheet">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                {CATEGORIES.map((cat, idx) => {
                  const val = answers[cat.key];
                  const trimmed = val.trim();
                  const target = (roomState.currentLetter ?? '').toLowerCase();
                  const nonEnglish =
                    trimmed.length > 0 && !/^[a-zA-Z][a-zA-Z\s'.-]*$/.test(trimmed);
                  const startsCorrectly =
                    !nonEnglish &&
                    trimmed.length > 0 &&
                    trimmed[0].toLowerCase() === target;
                  const wrongLetter =
                    !nonEnglish &&
                    trimmed.length > 0 &&
                    trimmed[0].toLowerCase() !== target;

                  return (
                    <div key={cat.key}>
                      <div className="flex items-center justify-between mb-1.5">
                        <label
                          htmlFor={`input-${cat.key}`}
                          className="text-sm font-bold text-[#18201D]"
                        >
                          {cat.label}
                        </label>
                        <span
                          className={`text-xs font-medium ${
                            startsCorrectly
                              ? 'text-emerald-700'
                              : nonEnglish || wrongLetter
                              ? 'text-red-600'
                              : 'text-[#6A7570]'
                          }`}
                        >
                          {nonEnglish
                            ? 'English letters only'
                            : startsCorrectly
                            ? `Starts with ${roomState.currentLetter}`
                            : wrongLetter
                            ? `Must start with ${roomState.currentLetter}`
                            : '10 pts max'}
                        </span>
                      </div>
                      <input
                        ref={idx === 0 ? firstInputRef : undefined}
                        id={`input-${cat.key}`}
                        type="text"
                        maxLength={60}
                        readOnly={Boolean(me?.hasStopped)}
                        value={val}
                        onChange={(e) => handleAnswerChange(cat.key, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && idx === CATEGORIES.length - 1 && canClickStop) {
                            handleStopClick();
                          }
                        }}
                        placeholder={`${cat.label} starting with ${roomState.currentLetter ?? ''}...`}
                        className={`w-full h-12 px-4 rounded-xl border text-base font-medium transition-colors focus:outline-none focus:ring-2 ${
                          me?.hasStopped
                            ? 'bg-[#EFE9DC] border-[#D4CBB8] text-[#43504A] cursor-not-allowed'
                            : wrongLetter
                            ? 'bg-white border-red-400 text-[#18201D] focus:ring-red-500'
                            : 'bg-white border-[#D4CBB8] text-[#18201D] focus:ring-[#D97706] focus:border-[#D97706]'
                        }`}
                      />
                    </div>
                  );
                })}
              </div>

              {/* STOP Action Row */}
              <div className="mt-6 pt-5 border-t border-[#E5DCCB] flex flex-col sm:flex-row items-center justify-between gap-4">
                {me?.hasStopped ? (
                  <div className="w-full h-12 rounded-xl bg-emerald-50 border border-emerald-200 px-4 flex items-center justify-center gap-2 text-sm font-semibold text-emerald-900">
                    <Check className="w-4 h-4 text-emerald-700" />
                    <span>
                      Your answers are locked. Waiting for other players before reveal...
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="text-xs sm:text-sm text-[#54615B] font-medium">
                      {countdownRunning
                        ? 'Click STOP before 0.0s or your current answers will auto-stop!'
                        : allFourFilled
                        ? `All 4 items filled — press STOP to lock yours & start the ${roomState.stopCountdownSeconds}s timer!`
                        : 'Fill all 4 categories (Name, Place, Animal, Thing) to enable STOP.'}
                    </div>
                    <button
                      type="button"
                      disabled={!canClickStop}
                      onClick={handleStopClick}
                      className={`w-full sm:w-auto min-w-[200px] h-12 px-6 rounded-xl font-bold text-base flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer ${
                        canClickStop
                          ? 'bg-red-600 hover:bg-red-700 text-white active:scale-95'
                          : 'bg-[#D6CBB7] text-[#696254] cursor-not-allowed'
                      }`}
                    >
                      <Hand className="w-5 h-5" />
                      <span>{countdownRunning ? 'STOP NOW' : 'STOP!'}</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ======================== VERIFYING ======================== */}
        {roomState.phase === 'VERIFYING' && (
          <section className="bg-[#FBF9F4] text-[#18201D] rounded-2xl shadow-2xl border border-[#E5DCCB] p-8 sm:p-10 text-center">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-[#0F5132] text-[#FAF7F0] flex items-center justify-center">
              {roomState.verificationError ? (
                <ShieldCheck className="w-8 h-8 text-amber-300" />
              ) : (
                <Loader2 className="w-8 h-8 animate-spin text-amber-300" />
              )}
            </div>

            <h2
              className="text-2xl sm:text-3xl font-extrabold text-[#18201D] mb-2"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {roomState.verificationError
                ? 'Verification Paused'
                : 'Verifying Real-World English Answers'}
            </h2>

            {roomState.verificationError ? (
              <div className="max-w-lg mx-auto mt-4 space-y-4">
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-900 font-medium">
                  {roomState.verificationError}
                </div>
                <button
                  type="button"
                  onClick={() => onSendMessage({ type: 'retry_verification' })}
                  className="h-11 px-6 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white font-bold text-sm inline-flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Retry Verification</span>
                </button>
              </div>
            ) : (
              <p className="text-sm text-[#54615B] max-w-md mx-auto">
                Checking every submitted Name, Place, Animal, and Thing in English to
                ensure each item exists in the real world and matches its category.
              </p>
            )}
          </section>
        )}

        {/* ======================== ROUND_SUMMARY ======================== */}
        {roomState.phase === 'ROUND_SUMMARY' &&
          roomState.lastRoundResult && (
            <section className="bg-[#FBF9F4] text-[#18201D] rounded-2xl shadow-2xl border border-[#E5DCCB] p-5 sm:p-7">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[#E5DCCB]">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-[#0F5132] text-[#FAF7F0] flex items-center justify-center text-3xl font-extrabold shrink-0" style={{ fontFamily: 'var(--font-display)' }}>
                    {roomState.lastRoundResult.letter}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-[#54615B]">
                      Round {roomState.lastRoundResult.roundNumber} · Auto-Checked Results
                    </div>
                    <h2
                      className="text-2xl font-extrabold text-[#18201D]"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      All Players’ Answers & Scores
                    </h2>
                    {roomState.lastRoundResult.stoppedFirstByPlayerName && (
                      <p className="text-xs text-[#54615B] mt-0.5">
                        Picked by {roomState.lastRoundResult.selectedByPlayerName} · First
                        Stop by {roomState.lastRoundResult.stoppedFirstByPlayerName}
                      </p>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => onSendMessage({ type: 'end_game' })}
                    className="h-11 px-4 rounded-xl bg-[#EFE9DC] hover:bg-red-100 hover:text-red-900 text-[#18201D] font-semibold text-sm transition-colors whitespace-nowrap cursor-pointer"
                  >
                    End My Game
                  </button>
                  {me?.isHost && (
                    <button
                      type="button"
                      onClick={() => onSendMessage({ type: 'end_game', forAll: true })}
                      className="h-11 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition-colors whitespace-nowrap cursor-pointer"
                    >
                      End Match for All
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onSendMessage({ type: 'next_round' })}
                    className="h-11 px-5 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white font-bold text-sm flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <span>Next Round</span>
                    <Play className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Reveal & Auto-Check Matrix */}
              <div className="mt-5 overflow-x-auto rounded-xl border border-[#E5DCCB]">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#EFE9DC] text-[#3F4B45] text-xs font-semibold">
                      <th className="py-3 px-4">Player</th>
                      {CATEGORIES.map((c) => (
                        <th key={c.key} className="py-3 px-4">
                          {c.label}
                        </th>
                      ))}
                      <th className="py-3 px-4 text-right">Round</th>
                      <th className="py-3 px-4 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ECE5D5] bg-white">
                    {rankedPlayers.map((player) => {
                      const outcome =
                        roomState.lastRoundResult!.playerResults[player.id];
                      return (
                        <tr
                          key={player.id}
                          className={
                            player.id === yourPlayerId ? 'bg-amber-50/45' : ''
                          }
                        >
                          <td className="py-3.5 px-4 align-top">
                            <div className="flex items-center gap-2 font-bold text-[#18201D] whitespace-nowrap">
                              <span
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: player.color }}
                              />
                              <span>{player.name}</span>
                              {player.id === yourPlayerId && (
                                <span className="text-xs font-normal text-[#54615B]">
                                  (You)
                                </span>
                              )}
                            </div>
                          </td>

                          {CATEGORIES.map((c) => {
                            const cell = outcome?.answers[c.key];
                            if (!cell) {
                              return (
                                <td key={c.key} className="py-3.5 px-4 text-[#8B9690]">
                                  —
                                </td>
                              );
                            }

                            const isUnique = cell.valid && cell.sharedCount === 1;
                            const isShared = cell.valid && cell.sharedCount > 1;
                            const isRejected =
                              !cell.valid && cell.reason !== 'empty';

                            return (
                              <td key={c.key} className="py-3.5 px-4 align-top">
                                <div
                                  className={`font-semibold ${
                                    isRejected
                                      ? 'line-through text-red-700'
                                      : 'text-[#18201D]'
                                  }`}
                                >
                                  {cell.raw || '—'}
                                </div>
                                <div
                                  className={`text-xs font-mono tabular-nums mt-0.5 ${
                                    isUnique
                                      ? 'text-emerald-700 font-semibold'
                                      : isShared
                                      ? 'text-amber-700 font-semibold'
                                      : isRejected
                                      ? 'text-red-700 font-semibold'
                                      : 'text-[#7A8580]'
                                  }`}
                                >
                                  {isUnique && '+10 · Unique'}
                                  {isShared &&
                                    `+${formatMarks(cell.marks)} · Shared ×${cell.sharedCount}`}
                                  {!cell.valid &&
                                    (cell.reason === 'wrong_letter'
                                      ? '0 · Wrong letter'
                                      : cell.reason === 'not_english'
                                      ? '0 · Not English'
                                      : cell.reason === 'wrong_category'
                                      ? '0 · Wrong category'
                                      : cell.reason === 'not_real'
                                      ? '0 · Not real'
                                      : '0 · Empty')}
                                </div>
                                {cell.verificationNote && cell.reason !== 'empty' && (
                                  <div className="text-[11px] text-[#54615B] mt-0.5 leading-snug">
                                    {cell.verificationNote}
                                  </div>
                                )}
                              </td>
                            );
                          })}

                          <td className="py-3.5 px-4 text-right align-top font-mono tabular-nums font-bold text-[#18201D]">
                            +{formatMarks(outcome?.totalRoundMarks ?? 0)}
                          </td>
                          <td className="py-3.5 px-4 text-right align-top font-mono tabular-nums font-extrabold text-[#0F5132]">
                            {formatMarks(player.score)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[#54615B]">
                <span>
                  Next turn to spin:{' '}
                  <strong className="text-[#18201D]">
                    {turnPlayer?.name ?? 'Next Player'}
                  </strong>
                </span>
                {me?.isHost ? (
                  <form
                    onSubmit={handleCountdownFormSubmit}
                    className="inline-flex items-center gap-2"
                  >
                    <Clock className="w-3.5 h-3.5 text-[#0F5132]" />
                    <span>Next Stop timer:</span>
                    <input
                      type="number"
                      min={3}
                      max={60}
                      step={1}
                      aria-label="Edit stop countdown seconds"
                      value={countdownInput}
                      onChange={(e) => setCountdownInput(e.target.value)}
                      className="w-16 h-8 px-2 rounded-lg bg-white border border-[#D4CBB8] font-mono tabular-nums text-xs font-bold text-[#18201D] focus:outline-none focus:ring-2 focus:ring-[#D97706]"
                    />
                    <span className="font-mono">s</span>
                    <button
                      type="submit"
                      className="h-8 px-2.5 rounded-lg bg-[#EFE9DC] hover:bg-[#E4DCCB] text-[#18201D] font-semibold cursor-pointer"
                    >
                      Save
                    </button>
                  </form>
                ) : (
                  <span>
                    Unique = 10 pts · Shared by N = 10 ÷ N pts · Blank = 0 pts
                  </span>
                )}
              </div>
            </section>
          )}
            </div>

            {/* Persistent Cumulative Leaderboard across rounds */}
            <div className="lg:col-span-4 lg:sticky lg:top-4">
              <Leaderboard
                players={roomState.players}
                roundHistory={roomState.roundHistory}
                yourPlayerId={yourPlayerId}
                turnPlayerId={roomState.turnPlayerId}
              />
            </div>
          </div>
        )}
      </main>

      {/* Quiet single-line bottom hint */}
      <footer className="relative z-10 text-center text-xs text-emerald-100/55">
        M to mute · Answers remain private until the round stops
      </footer>
    </div>
  );
};
