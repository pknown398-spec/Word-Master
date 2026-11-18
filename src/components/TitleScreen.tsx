import React, { useEffect, useState } from 'react';
import { ArrowRight, Users, Volume2, VolumeX } from 'lucide-react';

interface TitleScreenProps {
  initialRoomCode: string;
  connected: boolean;
  errorMessage: string | null;
  muted: boolean;
  onToggleMute: () => void;
  onClearError: () => void;
  onCreateRoom: (playerName: string) => void;
  onJoinRoom: (roomCode: string, playerName: string) => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  initialRoomCode,
  connected,
  errorMessage,
  muted,
  onToggleMute,
  onClearError,
  onCreateRoom,
  onJoinRoom,
}) => {
  const [mode, setMode] = useState<'create' | 'join'>(
    initialRoomCode ? 'join' : 'create'
  );
  const [playerName, setPlayerName] = useState(() => {
    try {
      return localStorage.getItem('npat_player_name') || '';
    } catch {
      return '';
    }
  });
  const [roomCode, setRoomCode] = useState(initialRoomCode);

  useEffect(() => {
    if (initialRoomCode) {
      setMode('join');
      setRoomCode(initialRoomCode);
    }
  }, [initialRoomCode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = playerName.trim();
    if (!trimmedName) return;
    try {
      localStorage.setItem('npat_player_name', trimmedName);
    } catch {
      // Ignore storage error
    }
    if (mode === 'create') {
      onCreateRoom(trimmedName);
    } else {
      if (!roomCode.trim()) return;
      onJoinRoom(roomCode.trim().toUpperCase(), trimmedName);
    }
  };

  return (
    <div className="relative min-h-dvh w-full overflow-hidden flex flex-col justify-between p-4 sm:p-8">
      {/* Top right sound control only — low occlusion */}
      <div className="relative z-10 flex items-center justify-between max-w-6xl w-full mx-auto">
        <div className="text-xs font-medium tracking-wide text-emerald-100/75 flex items-center gap-2">
          <span>Online Tabletop Room</span>
          <span aria-hidden="true">·</span>
          <span>{connected ? 'Server Ready' : 'Connecting...'}</span>
        </div>
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? 'Unmute game audio' : 'Mute game audio'}
          className="h-10 px-3 rounded-lg bg-[#0d3527]/85 border border-emerald-200/15 text-emerald-50 hover:bg-[#134735] transition-colors flex items-center gap-2 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          <span>{muted ? 'Muted' : 'Sound On'}</span>
        </button>
      </div>

      {/* Main Split Tabletop Layout: Left Hero Title Lockup over calm felt, Right Entry Sheet */}
      <main className="relative z-10 max-w-6xl w-full mx-auto my-auto py-6 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        {/* Left Zone: Bespoke SVG Lockup + Rules Overview over 35%+ calm space */}
        <div className="lg:col-span-7 flex flex-col items-start text-left">
          {/* Custom inline SVG letter tile emblem */}
          <svg
            viewBox="0 0 264 56"
            className="w-56 h-12 mb-5"
            aria-hidden="true"
          >
            {[
              { letter: 'N', x: 0, bg: '#DC2626' },
              { letter: 'P', x: 68, bg: '#2563EB' },
              { letter: 'A', x: 136, bg: '#D97706' },
              { letter: 'T', x: 204, bg: '#059669' },
            ].map((tile) => (
              <g key={tile.letter} transform={`translate(${tile.x}, 2)`}>
                <rect
                  x="0"
                  y="0"
                  width="50"
                  height="50"
                  rx="10"
                  fill="#FBF9F4"
                  stroke="#D6C7A9"
                  strokeWidth="2"
                />
                <rect
                  x="5"
                  y="5"
                  width="40"
                  height="40"
                  rx="7"
                  fill={tile.bg}
                  fillOpacity="0.1"
                />
                <text
                  x="25"
                  y="34"
                  textAnchor="middle"
                  fill={tile.bg}
                  fontFamily="Bricolage Grotesque, sans-serif"
                  fontWeight="800"
                  fontSize="26"
                >
                  {tile.letter}
                </text>
              </g>
            ))}
          </svg>

          <h1
            className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#FAF7F0] leading-[1.06] mb-4"
            style={{ fontFamily: 'var(--font-display)', textWrap: 'balance' }}
          >
            Name, Place, Animal, Thing
          </h1>

          <p className="text-base sm:text-lg text-emerald-100/85 max-w-xl leading-relaxed mb-6">
            Gather your friends in a live room just like Ludo. Take turns spinning a random
            alphabet, fill all four categories in secret, and race to hit Stop before the
            10-second clock runs out.
          </p>

          {/* Clean unboxed metadata rule strip — zero pills */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs sm:text-sm text-amber-200/90 font-medium">
            <span>2+ Unlimited Players</span>
            <span aria-hidden="true" className="text-emerald-200/40">·</span>
            <span>10 pts Unique</span>
            <span aria-hidden="true" className="text-emerald-200/40">·</span>
            <span>10 ÷ N Shared</span>
            <span aria-hidden="true" className="text-emerald-200/40">·</span>
            <span>10s Stop Countdown</span>
          </div>
        </div>

        {/* Right Zone: Ivory Tabletop Entry Card */}
        <div className="lg:col-span-5">
          <div className="bg-[#FBF9F4] text-[#18201D] rounded-2xl shadow-2xl p-6 sm:p-8 border border-[#E5DCCB]">
            {/* Segmented Mode Switch */}
            <div
              className="grid grid-cols-2 gap-1 p-1 bg-[#EFE9DC] rounded-xl mb-6"
              role="tablist"
              aria-label="Room mode"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'create'}
                onClick={() => {
                  setMode('create');
                  onClearError();
                }}
                className={`h-11 rounded-lg text-sm font-semibold transition-all whitespace-nowrap cursor-pointer ${
                  mode === 'create'
                    ? 'bg-[#FFFFFF] text-[#18201D] shadow-sm'
                    : 'text-[#54615B] hover:text-[#18201D]'
                }`}
              >
                Create Room
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'join'}
                onClick={() => {
                  setMode('join');
                  onClearError();
                }}
                className={`h-11 rounded-lg text-sm font-semibold transition-all whitespace-nowrap cursor-pointer ${
                  mode === 'join'
                    ? 'bg-[#FFFFFF] text-[#18201D] shadow-sm'
                    : 'text-[#54615B] hover:text-[#18201D]'
                }`}
              >
                Join Room
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="player-name-input"
                  className="block text-sm font-semibold text-[#293530] mb-1.5"
                >
                  Your Name
                </label>
                <input
                  id="player-name-input"
                  type="text"
                  maxLength={24}
                  required
                  value={playerName}
                  onChange={(e) => {
                    setPlayerName(e.target.value);
                    if (errorMessage) onClearError();
                  }}
                  placeholder="Enter your display name"
                  className="w-full h-12 px-4 rounded-xl bg-white border border-[#D4CBB8] text-[#18201D] placeholder:text-[#8B9690] text-base focus:outline-none focus:ring-2 focus:ring-[#D97706] focus:border-[#D97706]"
                />
              </div>

              {mode === 'join' && (
                <div>
                  <label
                    htmlFor="room-code-input"
                    className="block text-sm font-semibold text-[#293530] mb-1.5"
                  >
                    Room Code
                  </label>
                  <input
                    id="room-code-input"
                    type="text"
                    maxLength={8}
                    required
                    value={roomCode}
                    onChange={(e) => {
                      setRoomCode(e.target.value.toUpperCase());
                      if (errorMessage) onClearError();
                    }}
                    placeholder="e.g. K7M2P"
                    className="w-full h-12 px-4 rounded-xl bg-white border border-[#D4CBB8] text-[#18201D] placeholder:text-[#8B9690] text-base font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-[#D97706] focus:border-[#D97706]"
                  />
                </div>
              )}

              {errorMessage && (
                <div
                  role="alert"
                  className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 font-medium"
                >
                  {errorMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={!connected || !playerName.trim() || (mode === 'join' && !roomCode.trim())}
                className="w-full h-12 px-5 rounded-xl bg-[#D97706] hover:bg-[#B45309] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-base shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>{mode === 'create' ? 'Create New Room' : 'Join Game Room'}</span>
                <ArrowRight className="w-5 h-5" />
              </button>
            </form>

            <div className="mt-5 pt-4 border-t border-[#E6DEC8] flex items-center justify-between text-xs text-[#54615B]">
              <span className="flex items-center gap-1.5">
                <Users className="w-4 h-4 text-[#0F5132]" />
                <span>Min 2 players · Unlimited seats</span>
              </span>
              <span>Instant room link</span>
            </div>
          </div>
        </div>
      </main>

      {/* Single flat control-hint line */}
      <footer className="relative z-10 text-center text-xs text-emerald-100/60 tracking-wide">
        Enter to start · Tab between fields · M to mute sound
      </footer>
    </div>
  );
};
