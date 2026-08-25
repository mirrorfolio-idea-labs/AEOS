import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Button } from './components/ui/button.js';
import { client } from './api.js';

interface TerminalPanelProps {
  sessionId: string;
  /** Fired once the takeover shell is torn down — headless view resumes. */
  onReleased: () => void;
}

/**
 * Human-takeover terminal (spec §9, P2.M5): bridges an xterm.js instance to
 * the session runner's PTY over the WebSocket attach endpoint. Release kills
 * the shell — exactly one actor remains.
 */
export function TerminalPanel({ sessionId, onReleased }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | undefined>(undefined);
  const [connecting, setConnecting] = useState(true);

  useEffect(() => {
    const term = new Terminal({ cursorBlink: true, fontSize: 12 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current!);
    try {
      fit.fit();
    } catch {
      // zero-size container before layout — first resize fixes it
    }

    const socket = new WebSocket(client.attachUrl(sessionId));
    wsRef.current = socket;
    socket.onopen = () => {
      setConnecting(false);
      socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      term.focus();
    };
    socket.onmessage = (event) => term.write(event.data as string);
    socket.onclose = () => term.write('\r\n\x1b[2m[detach — session back in headless mode]\x1b[0m\r\n');

    term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    });

    const resize = (): void => {
      if (socket.readyState !== WebSocket.OPEN) return;
      try {
        fit.fit();
        socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      } catch {
        // unmeasurable during transitions
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(containerRef.current!);

    return () => {
      observer.disconnect();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      term.dispose();
    };
  }, [sessionId]);

  const release = (): void => {
    wsRef.current?.send(JSON.stringify({ type: 'release' }));
    onReleased();
  };

  return (
    <div className="flex h-full flex-col gap-2 p-4" data-testid="terminal-panel">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {connecting
            ? 'attaching to live session…'
            : `attached to session ${sessionId} — type to interact`}
        </span>
        <Button variant="outline" size="sm" data-testid="pty-release" onClick={release}>
          Release
        </Button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 rounded-md border bg-black p-1" />
    </div>
  );
}
