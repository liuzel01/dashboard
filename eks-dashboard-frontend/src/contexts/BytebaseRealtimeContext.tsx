import React, { useContext, useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import type { BytebaseRequest } from "../services/api";
import { AuthContext } from "./AuthContextValue";
import { BytebaseRealtimeContext as Context } from "./BytebaseRealtimeContextValue";

const terminalStatuses = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

export const BytebaseRealtimeProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const navigate = useNavigate();
  const { me, permissions } = useContext(AuthContext);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const allowed = permissions.includes("menu:bytebase");

  useEffect(() => {
    const token = localStorage.getItem("authToken");
    if (!token || !allowed || !me?.username) {
      setSocket(null);
      setConnected(false);
      return;
    }
    const next = io("/bytebase", {
      path: "/socket.io",
      transports: ["websocket"],
      auth: { token },
    });
    setSocket(next);
    next.on("bytebase-ready", () => setConnected(true));
    next.on("disconnect", () => setConnected(false));
    next.on("bytebase-request-updated", (request: BytebaseRequest) => {
      if (
        !terminalStatuses.has(request.status) ||
        typeof Notification === "undefined" ||
        Notification.permission !== "granted"
      )
        return;
      const key = `bytebase-notified:${me.username}:${request.request_id}:${request.status}`;
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, new Date().toISOString());
      const notification = new Notification(
        request.status === "SUCCEEDED"
          ? "Bytebase 发布成功"
          : "Bytebase 发布已结束",
        {
          body: `${request.environment_id} / ${request.title}：${request.status}`,
          tag: `bytebase-request-${request.request_id}`,
        },
      );
      notification.onclick = () => {
        window.focus();
        navigate("/bytebase");
        notification.close();
      };
    });
    return () => {
      next.disconnect();
      setConnected(false);
      setSocket((current) => (current === next ? null : current));
    };
  }, [allowed, me?.username, navigate]);

  const value = useMemo(() => ({ socket, connected }), [socket, connected]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
};
