import { createContext } from "react";
import type { Socket } from "socket.io-client";

export const BytebaseRealtimeContext = createContext<{
  socket: Socket | null;
  connected: boolean;
}>({ socket: null, connected: false });
