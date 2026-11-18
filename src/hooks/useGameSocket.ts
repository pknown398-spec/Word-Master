import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientMessage,
  RoomStatePublic,
  RoundAnswers,
  ServerMessage,
} from '../types/game.ts';

function getOrCreateClientId(): string {
  const key = 'npat_client_id';
  try {
    let id = sessionStorage.getItem(key);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `p_${Math.random().toString(36).slice(2, 11)}`;
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return `p_${Math.random().toString(36).slice(2, 11)}`;
  }
}

export function useGameSocket() {
  const clientIdRef = useRef<string>(getOrCreateClientId());
  const wsRef = useRef<WebSocket | null>(null);
  const lastJoinRef = useRef<
    | { mode: 'create'; playerName: string }
    | { mode: 'join'; roomCode: string; playerName: string }
    | null
  >(null);

  const [connected, setConnected] = useState(false);
  const [roomState, setRoomState] = useState<RoomStatePublic | null>(null);
  const [yourPlayerId, setYourPlayerId] = useState<string | null>(null);
  const [serverDraft, setServerDraft] = useState<RoundAnswers | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const connect = useCallback(() => {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setErrorMessage(null);
      // Auto-rejoin room on reconnect if we were in one
      if (lastJoinRef.current) {
        if (lastJoinRef.current.mode === 'join') {
          ws.send(
            JSON.stringify({
              type: 'join_room',
              roomCode: lastJoinRef.current.roomCode,
              playerName: lastJoinRef.current.playerName,
              clientId: clientIdRef.current,
            } satisfies ClientMessage)
          );
        }
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        if (msg.type === 'room_state') {
          setServerOffsetMs(msg.state.serverNow - Date.now());
          setRoomState(msg.state);
          setYourPlayerId(msg.yourPlayerId);
          if (msg.yourDraft) {
            setServerDraft(msg.yourDraft);
          }
          // Update rejoin target once room exists
          const me = msg.state.players.find((p) => p.id === msg.yourPlayerId);
          if (me) {
            lastJoinRef.current = {
              mode: 'join',
              roomCode: msg.state.code,
              playerName: me.name,
            };
          }
        } else if (msg.type === 'error') {
          setErrorMessage(msg.message);
        } else if (msg.type === 'left_room') {
          lastJoinRef.current = null;
          setRoomState(null);
          setYourPlayerId(null);
          setServerDraft(null);
        }
      } catch {
        // Ignore malformed frame
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (lastJoinRef.current) {
        setTimeout(() => {
          connect();
        }, 1500);
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  const sendMessage = useCallback(
    (msg: ClientMessage) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
        return true;
      }
      connect();
      setErrorMessage('Connecting to game server... Please try again.');
      return false;
    },
    [connect]
  );

  const createRoom = useCallback(
    (playerName: string) => {
      setErrorMessage(null);
      lastJoinRef.current = { mode: 'create', playerName };
      sendMessage({
        type: 'create_room',
        playerName,
        clientId: clientIdRef.current,
      });
    },
    [sendMessage]
  );

  const joinRoom = useCallback(
    (roomCode: string, playerName: string) => {
      setErrorMessage(null);
      const cleanCode = roomCode.trim().toUpperCase();
      lastJoinRef.current = { mode: 'join', roomCode: cleanCode, playerName };
      sendMessage({
        type: 'join_room',
        roomCode: cleanCode,
        playerName,
        clientId: clientIdRef.current,
      });
    },
    [sendMessage]
  );

  const leaveRoom = useCallback(() => {
    lastJoinRef.current = null;
    sendMessage({ type: 'leave_room' });
    setRoomState(null);
    setYourPlayerId(null);
    setServerDraft(null);
  }, [sendMessage]);

  return {
    connected,
    roomState,
    yourPlayerId,
    serverDraft,
    serverOffsetMs,
    errorMessage,
    clearError: () => setErrorMessage(null),
    createRoom,
    joinRoom,
    leaveRoom,
    sendMessage,
  };
}
