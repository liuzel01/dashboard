import { createContext } from 'react';
import type { Socket } from 'socket.io-client';

export type CicdRealtimeContextValue = {
  socket: Socket | null;
  connected: boolean;
};

export const CicdRealtimeContext = createContext<CicdRealtimeContextValue>({
  socket: null,
  connected: false,
});
