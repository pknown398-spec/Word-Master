import { useEffect, useState } from 'react';
import { TitleScreen } from './components/TitleScreen.tsx';
import { GameTable } from './components/GameTable.tsx';
import { useGameSocket } from './hooks/useGameSocket.ts';
import { soundFX } from './utils/sound.ts';

export default function App() {
  const {
    connected,
    roomState,
    yourPlayerId,
    serverDraft,
    serverOffsetMs,
    errorMessage,
    clearError,
    createRoom,
    joinRoom,
    leaveRoom,
    sendMessage,
  } = useGameSocket();

  const [muted, setMuted] = useState(false);
  const [backdropFailed, setBackdropFailed] = useState(false);
  const [initialRoomCode] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return (params.get('room') || '').trim().toUpperCase();
    } catch {
      return '';
    }
  });

  const toggleMute = () => {
    setMuted((prev) => {
      const next = !prev;
      soundFX.muted = next;
      return next;
    });
  };

  // Global keyboard shortcut: 'M' to toggle sound when not typing in an input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key.toLowerCase() === 'm') {
        toggleMute();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Sync URL ?room=CODE when inside a room for easy sharing
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (roomState?.code) {
        if (url.searchParams.get('room') !== roomState.code) {
          url.searchParams.set('room', roomState.code);
          window.history.replaceState({}, '', url.toString());
        }
      } else if (url.searchParams.has('room') && !initialRoomCode) {
        url.searchParams.delete('room');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {
      // Ignore history API issues
    }
  }, [roomState?.code, initialRoomCode]);

  return (
    <div className="relative min-h-dvh w-full bg-[#092e22] overflow-x-hidden">
      {/* Generated tabletop felt backdrop with resilient CSS fallback and contrast scrim */}
      {!backdropFailed && (
        <img
          src="/src/assets/images/tabletop_felt_backdrop_1795019348082.jpg"
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
          onError={() => setBackdropFailed(true)}
          className="fixed inset-0 w-full h-full object-cover pointer-events-none select-none opacity-65"
        />
      )}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none bg-gradient-to-b from-[#07261c]/75 via-[#092e22]/55 to-[#061e16]/85"
      />

      {!roomState || !yourPlayerId ? (
        <TitleScreen
          initialRoomCode={initialRoomCode}
          connected={connected}
          errorMessage={errorMessage}
          muted={muted}
          onToggleMute={toggleMute}
          onClearError={clearError}
          onCreateRoom={createRoom}
          onJoinRoom={joinRoom}
        />
      ) : (
        <GameTable
          roomState={roomState}
          yourPlayerId={yourPlayerId}
          serverDraft={serverDraft}
          serverOffsetMs={serverOffsetMs}
          errorMessage={errorMessage}
          muted={muted}
          onToggleMute={toggleMute}
          onClearError={clearError}
          onSendMessage={sendMessage}
          onLeaveRoom={leaveRoom}
        />
      )}
    </div>
  );
}
