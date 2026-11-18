import React, { useMemo } from 'react';
import { Crown, Trophy } from 'lucide-react';
import type { PlayerPublic, RoundResult } from '../types/game.ts';

interface LeaderboardProps {
  players: PlayerPublic[];
  roundHistory: RoundResult[];
  yourPlayerId: string;
  turnPlayerId: string | null;
}

function formatMarks(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

export const Leaderboard: React.FC<LeaderboardProps> = ({
  players,
  roundHistory,
  yourPlayerId,
  turnPlayerId,
}) => {
  const rankedPlayers = useMemo(
    () =>
      [...players].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.name.localeCompare(b.name);
      }),
    [players]
  );

  const completedRoundsCount = roundHistory.length;
  const topScore = rankedPlayers[0]?.score ?? 0;

  return (
    <aside
      aria-label="Persistent room leaderboard"
      className="bg-[#FBF9F4] text-[#18201D] rounded-2xl shadow-xl border border-[#E5DCCB] p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E5DCCB]">
        <h3
          className="text-base font-extrabold text-[#18201D] flex items-center gap-2 whitespace-nowrap"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          <Trophy className="w-4 h-4 text-[#D97706] shrink-0" />
          <span>Leaderboard</span>
        </h3>
        <span className="text-xs font-medium text-[#54615B] tabular-nums whitespace-nowrap">
          {completedRoundsCount}{' '}
          {completedRoundsCount === 1 ? 'Round' : 'Rounds'}
        </span>
      </div>

      <div className="mt-3 divide-y divide-[#ECE5D5]">
        {rankedPlayers.map((player, index) => {
          const isLeader = topScore > 0 && player.score === topScore;
          const isMe = player.id === yourPlayerId;
          const isTurn = player.id === turnPlayerId;
          const lastRoundScore =
            player.roundScores.length > 0
              ? player.roundScores[player.roundScores.length - 1]
              : null;

          return (
            <div
              key={player.id}
              className={`py-2.5 first:pt-1 last:pb-1 ${
                isMe ? 'bg-amber-50/60 -mx-2 px-2 rounded-lg' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-5 text-xs font-mono tabular-nums font-bold text-[#54615B] shrink-0">
                    #{index + 1}
                  </span>
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: player.color }}
                  />
                  <span className="text-sm font-bold text-[#18201D] truncate">
                    {player.name}
                  </span>
                  {isLeader && (
                    <Crown
                      className="w-3.5 h-3.5 text-[#D97706] shrink-0"
                      aria-label="Current leader"
                    />
                  )}
                </div>

                <div className="text-right shrink-0">
                  <span className="text-base font-extrabold font-mono tabular-nums text-[#0F5132]">
                    {formatMarks(player.score)}
                  </span>
                </div>
              </div>

              {/* Unboxed status + multi-round cumulative trail */}
              <div className="pl-7 mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] text-[#54615B]">
                <div className="flex items-center gap-1.5">
                  {isMe && <span className="font-semibold text-[#18201D]">You</span>}
                  {isMe && (isTurn || player.hasEndedGame || !player.connected) && (
                    <span aria-hidden="true">·</span>
                  )}
                  {isTurn && !player.hasEndedGame && (
                    <span className="font-semibold text-[#B45309]">Turn</span>
                  )}
                  {player.hasEndedGame && (
                    <span className="text-[#7A8580]">Ended</span>
                  )}
                  {!player.connected && !player.hasEndedGame && (
                    <span className="text-red-700">Reconnecting</span>
                  )}
                  {!isMe && !isTurn && !player.hasEndedGame && player.connected && (
                    <span>Active</span>
                  )}
                </div>

                {lastRoundScore !== null && (
                  <span className="font-mono tabular-nums text-emerald-700 font-semibold">
                    Last +{formatMarks(lastRoundScore)}
                  </span>
                )}
              </div>

              {player.roundScores.length > 0 && (
                <div className="pl-7 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-mono tabular-nums text-[#43504A]">
                  {player.roundScores.map((rs, rIdx) => {
                    const letter = roundHistory[rIdx]?.letter;
                    return (
                      <span key={rIdx} className="whitespace-nowrap">
                        R{rIdx + 1}
                        {letter ? `(${letter})` : ''}:{formatMarks(rs)}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
};
