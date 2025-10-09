import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, API_BASE, api } from '../api';
import { useAuth } from '../context/AuthContext';
import { ThemeToggle } from '../components/ThemeToggle';

type HistoryRecord = {
  id: number;
  sessionId: string;
  message: string;
  response: string;
  timestamp: string;
};

type ChatResponse = {
  id: number;
  sessionId: string;
  reply: string;
  message: string;
  timestamp: string;
  draftAvailable?: boolean;
  draftText?: string | null;
};

type ApplicationMeta = {
  sessionId: string;
  status: 'collecting' | 'completed';
  hasDraft: boolean;
};

type ChatRole = 'user' | 'assistant';

type ConversationEntry = {
  id: string;
  role: ChatRole;
  text: string;
  timestamp: string;
};

type RtiStatus = 'collecting' | 'completed' | 'unknown';

type SessionState = {
  sessionId: string;
  entries: ConversationEntry[];
  updatedAt: string;
  hasDraft: boolean;
  status: RtiStatus;
  draftText?: string | null;
};

const NEW_SESSION_SENTINEL = '__new-session__';

function createEmptySession(sessionId: string): SessionState {
  return {
    sessionId,
    entries: [],
    updatedAt: new Date(0).toISOString(),
    hasDraft: false,
    status: 'unknown',
    draftText: null,
  };
}

function formatTimestamp(ts: string) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
}

function deriveTitle(entries: ConversationEntry[]) {
  const firstUser = entries.find(entry => entry.role === 'user' && entry.text.trim() !== '');
  if (!firstUser) return 'Conversation';
  const trimmed = firstUser.text.trim();
  return trimmed.length > 42 ? `${trimmed.slice(0, 42)}…` : trimmed;
}

function mergeApplicationMeta(
  sessions: Record<string, SessionState>,
  metas: ApplicationMeta[]
): Record<string, SessionState> {
  const merged: Record<string, SessionState> = {};
  Object.values(sessions).forEach(session => {
    merged[session.sessionId] = { ...session };
  });

  metas.forEach(meta => {
    const session = merged[meta.sessionId] ?? createEmptySession(meta.sessionId);
    session.hasDraft = Boolean(meta.hasDraft);
    session.status = meta.status ?? 'unknown';
    merged[meta.sessionId] = session;
  });

  return merged;
}

export default function Chat() {
  const { user, logout } = useAuth();
  const [sessions, setSessions] = useState<Record<string, SessionState>>({});
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [globalNotice, setGlobalNotice] = useState<string | null>(null);
  const [downloadingSession, setDownloadingSession] = useState<string | null>(null);

  const messageListRef = useRef<HTMLDivElement | null>(null);

  const orderedSessions = useMemo(() => {
    return Object.values(sessions).sort((a, b) => {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [sessions]);

  const currentSession =
    selectedSessionId && selectedSessionId !== NEW_SESSION_SENTINEL
      ? sessions[selectedSessionId] ?? null
      : null;

  const currentMessageCount =
    currentSession?.entries.length ?? (selectedSessionId === NEW_SESSION_SENTINEL ? 0 : 0);

  useEffect(() => {
    if (!selectedSessionId) return;
    if (selectedSessionId === NEW_SESSION_SENTINEL) return;
    messageListRef.current?.scrollTo({
      top: messageListRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [selectedSessionId, currentMessageCount]);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      setLoading(true);
      try {
        const history = await api<HistoryRecord[]>('/api/chat/history');
        if (!active) return;
        const grouped: Record<string, SessionState> = {};
        history.forEach(item => {
          const session = grouped[item.sessionId] ?? createEmptySession(item.sessionId);
          const timestamp = item.timestamp || new Date().toISOString();
          const userEntry: ConversationEntry = {
            id: `user-${item.id}`,
            role: 'user',
            text: item.message,
            timestamp,
          };
          const assistantEntry: ConversationEntry = {
            id: `assistant-${item.id}`,
            role: 'assistant',
            text: item.response,
            timestamp,
          };
          session.entries.push(userEntry, assistantEntry);
          session.updatedAt = timestamp;
          grouped[item.sessionId] = session;
        });

        const metas = await api<ApplicationMeta[]>('/api/chat/applications');
        if (!active) return;
        const combined = mergeApplicationMeta(grouped, metas);
        setSessions(combined);

        const defaultSession = Object.values(combined)
          .filter(session => session.entries.length > 0)
          .sort((a, b) => {
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          })[0];

        setSelectedSessionId(defaultSession ? defaultSession.sessionId : NEW_SESSION_SENTINEL);
        setError(null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load chat history.');
      } finally {
        if (active) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshApplications() {
    try {
      const metas = await api<ApplicationMeta[]>('/api/chat/applications');
      setSessions(prev => mergeApplicationMeta(prev, metas));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      // Non-critical; surface as global notice for visibility.
      setGlobalNotice('Unable to refresh RTI draft status right now.');
    }
  }

  const disableSend = sending || !message.trim();

  function startNewConversation() {
    setSelectedSessionId(NEW_SESSION_SENTINEL);
    setMessage('');
    setGlobalNotice(null);
    setError(null);
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (disableSend) return;

    const trimmed = message.trim();
    if (!trimmed) return;

    setSending(true);
    setError(null);
    setGlobalNotice(null);

    const payload: { message: string; sessionId?: string } = { message: trimmed };
    const usingExisting =
      selectedSessionId &&
      selectedSessionId !== NEW_SESSION_SENTINEL &&
      sessions[selectedSessionId];
    if (usingExisting && selectedSessionId) {
      payload.sessionId = selectedSessionId;
    }

    try {
      const data = await api<ChatResponse>('/api/chat', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const finalSessionId = data.sessionId;
      const userTimestamp = new Date().toISOString();
      const historyTimestamp = data.timestamp || userTimestamp;

      setSessions(prev => {
        const next = { ...prev };
        const existing = next[finalSessionId] ?? createEmptySession(finalSessionId);
        const userEntry: ConversationEntry = {
          id: `user-${Date.now()}`,
          role: 'user',
          text: trimmed,
          timestamp: userTimestamp,
        };
        const assistantEntry: ConversationEntry = {
          id: `assistant-${data.id}`,
          role: 'assistant',
          text: data.reply,
          timestamp: historyTimestamp,
        };
        const updatedEntries = [...existing.entries, userEntry, assistantEntry];
        const session: SessionState = {
          ...existing,
          entries: updatedEntries,
          updatedAt: historyTimestamp,
        };
        if (data.draftAvailable) {
          session.hasDraft = true;
          session.status = 'completed';
          session.draftText = data.draftText ?? session.draftText ?? null;
          setGlobalNotice('Your RTI draft is ready. Use Download draft to save a copy.');
        } else if (session.status === 'unknown') {
          session.status = 'collecting';
        }
        next[finalSessionId] = session;
        return next;
      });

      setSelectedSessionId(finalSessionId);
      setMessage('');

      if (data.draftAvailable) {
        await refreshApplications();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteSession(sessionId: string) {
    const confirmed = window.confirm('Delete this conversation and any saved RTI drafts?');
    if (!confirmed) return;

    try {
      await api(`/api/chat/${sessionId}`, { method: 'DELETE' });
      setSessions(prev => {
        if (!(sessionId in prev)) return prev;
        const { [sessionId]: removed, ...rest } = prev;
        const remainingSessions = Object.values(rest).sort((a, b) => {
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });
        setSelectedSessionId(current => {
          if (current !== sessionId) return current;
          return remainingSessions.length > 0
            ? remainingSessions[0].sessionId
            : NEW_SESSION_SENTINEL;
        });
        return rest;
      });
      setGlobalNotice('Conversation deleted.');
      await refreshApplications();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to delete conversation.');
    }
  }

  async function handleDownloadDraft(sessionId: string) {
    try {
      setDownloadingSession(sessionId);
      const token = localStorage.getItem('token');
      const res = await fetch(
        `${API_BASE}/api/chat/application/${encodeURIComponent(sessionId)}/download`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        }
      );
      if (!res.ok) {
        if (res.status === 401) {
          logout();
          throw new Error('Your session has expired. Please log in again.');
        }
        const text = await res.text();
        throw new Error(text || 'Unable to download draft.');
      }
      const content = await res.text();
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `rti-draft-${sessionId}.txt`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setGlobalNotice('Draft downloaded.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download RTI draft.');
    } finally {
      setDownloadingSession(null);
    }
  }

  const showEmptyState =
    !loading &&
    (orderedSessions.length === 0 ||
      (selectedSessionId === NEW_SESSION_SENTINEL && !message && !currentSession));

  const mobileSessionValue =
    selectedSessionId && selectedSessionId !== NEW_SESSION_SENTINEL
      ? selectedSessionId
      : NEW_SESSION_SENTINEL;

  return (
    <div className="flex min-h-screen bg-[#f9fafc] text-slate-900 transition-colors duration-300 dark:bg-[#1f1f22] dark:text-slate-100">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-[#e4e7ef] bg-white px-3 pb-4 pt-6 dark:border-[#26262a] dark:bg-[#1a1a1d] md:flex md:sticky md:top-0 md:h-screen md:overflow-y-auto">
        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            onClick={startNewConversation}
            className="w-full rounded-full border border-[#d5d9e4] bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-[#f5f7fb] dark:border-[#2d2d32] dark:bg-[#202123] dark:text-slate-200 dark:hover:bg-[#2a2b31]"
          >
            + New chat
          </button>
        </div>
        <div className="mt-6 flex items-center justify-between px-1 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
          <span>Recent</span>
          <button
            type="button"
            onClick={() => refreshApplications()}
            className="text-slate-400 transition hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Refresh
          </button>
        </div>
        <nav className="mt-2 flex-1 overflow-y-auto pr-1">
          {orderedSessions.length === 0 && !loading && (
            <div className="rounded-lg border border-dashed border-black/10 px-3 py-6 text-center text-xs text-slate-500 dark:border-[#2d2d32] dark:text-slate-400">
              No conversations yet.
            </div>
          )}
          {orderedSessions.map(session => (
            <button
              key={session.sessionId}
              type="button"
              onClick={() => setSelectedSessionId(session.sessionId)}
              className={`group relative flex w-full flex-col gap-1 rounded-xl border border-transparent px-3 py-3 text-left transition ${
                selectedSessionId === session.sessionId
                  ? 'border-[#d5d9e4] bg-[#f4f6fb] shadow-sm dark:border-[#2d2d32] dark:bg-[#202123]'
                  : 'text-slate-600 hover:bg-[#f5f7fb] hover:text-slate-800 dark:text-slate-300 dark:hover:bg-[#2a2b31] dark:hover:text-slate-100'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="line-clamp-2 text-sm font-medium">
                  {deriveTitle(session.entries)}
                </span>
                {session.hasDraft && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300">
                    Draft
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-500">
                <span>
                  {session.status === 'completed'
                    ? 'Completed'
                    : session.status === 'collecting'
                    ? 'Collecting details'
                    : 'In progress'}
                </span>
                <span aria-hidden="true">•</span>
                <span>{formatTimestamp(session.updatedAt)}</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  className="text-slate-500 transition hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400"
                  onClick={e => {
                    e.stopPropagation();
                    handleDeleteSession(session.sessionId);
                  }}
                >
                  Delete
                </button>
                {session.hasDraft && (
                  <button
                    type="button"
                    className="text-slate-600 transition hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400"
                    onClick={e => {
                      e.stopPropagation();
                      handleDownloadDraft(session.sessionId);
                    }}
                    disabled={downloadingSession === session.sessionId}
                  >
                    {downloadingSession === session.sessionId ? 'Downloading…' : 'Download'}
                  </button>
                )}
              </div>
            </button>
          ))}
        </nav>
        <div className="mt-4 rounded-2xl border border-[#e4e7ef] bg-white px-3 py-3 text-sm text-slate-600 shadow-sm dark:border-[#2d2d32] dark:bg-[#202123] dark:text-slate-200">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Logged in as
              </span>
              <span className="font-medium">{user?.name ?? user?.email ?? 'You'}</span>
            </div>
            <ThemeToggle className="shrink-0" />
          </div>
          <button
            type="button"
            onClick={logout}
            className="mt-3 w-full rounded-md border border-[#e4e7ef] bg-[#f7f9fd] px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-white dark:border-[#2d2d32] dark:bg-[#2a2b31] dark:text-slate-200 dark:hover:bg-[#34343a]"
          >
            Logout
          </button>
        </div>
      </aside>

      <main className="flex flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[#e4e7ef] bg-[#f9fafc] px-6 py-4 dark:border-[#26262a] dark:bg-[#1f1f22]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
              FileMyRTI
            </p>
            <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">
              RTI Guidance Assistant
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle className="md:hidden" />
            <div className="flex items-center gap-3 rounded-full border border-[#e4e7ef] bg-white px-3 py-1.5 text-sm text-slate-600 shadow-sm dark:border-[#2d2d32] dark:bg-[#202123] dark:text-slate-200">
              <span>{user?.name ?? user?.email ?? 'You'}</span>
              <button
                type="button"
                className="rounded-full border border-[#e4e7ef] px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-400 hover:text-slate-700 dark:border-[#2d2d32] dark:text-slate-200 dark:hover:border-[#3a3a40]"
                onClick={logout}
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        {(error || globalNotice) && (
          <div
            className={`border-b px-4 py-3 text-sm ${
              error
                ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-[#3b1f23] dark:text-red-200'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-[#123229] dark:text-emerald-200'
            }`}
          >
            <div className="mx-auto max-w-3xl">{error || globalNotice}</div>
          </div>
        )}

        <div className="border-b border-[#e4e7ef] bg-[#f9fafc] px-4 py-3 text-sm text-slate-500 dark:border-[#26262a] dark:bg-[#1f1f22] md:hidden">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Conversation
          </label>
          <select
            value={mobileSessionValue}
            onChange={e => {
              const value = e.target.value;
              if (value === NEW_SESSION_SENTINEL) {
                startNewConversation();
              } else {
                setSelectedSessionId(value);
              }
            }}
            className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 dark:border-[#2d2d32] dark:bg-[#202123] dark:text-slate-100 dark:focus:border-[#3a3a40] dark:focus:ring-[#3a3a40]"
          >
            <option value={NEW_SESSION_SENTINEL}>+ New chat</option>
            {orderedSessions.map(session => (
              <option key={session.sessionId} value={session.sessionId}>
                {deriveTitle(session.entries)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            <div
              ref={messageListRef}
              className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6"
              aria-live="polite"
            >
              {loading && (
                <div className="rounded-lg border border-black/10 bg-white px-4 py-4 text-center text-sm text-slate-500 shadow-sm dark:border-[#2d2d32] dark:bg-[#202123] dark:text-slate-300">
                  Loading your conversations…
                </div>
              )}

              {showEmptyState && (
                <div className="rounded-lg border border-black/10 bg-white px-6 py-8 text-center text-sm leading-relaxed text-slate-500 shadow-sm dark:border-[#2d2d32] dark:bg-[#202123] dark:text-slate-300">
                  Start a new chat to ask RTI-specific questions or request a draft application. When
                  you are ready, type your message below and press Send.
                </div>
              )}

              {!loading &&
                currentSession?.entries.map(entry => (
                  <div
                    key={entry.id}
                    className={`flex ${
                      entry.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`w-full max-w-[82%] space-y-3 rounded-2xl border px-5 py-4 text-sm leading-relaxed shadow-sm ${
                        entry.role === 'user'
                          ? 'border-[#d5d9e4] bg-white text-slate-900 dark:border-[#2d2d32] dark:bg-[#111214] dark:text-slate-100'
                          : 'border-[#e7eaf3] bg-white text-slate-900 dark:border-[#2d2d32] dark:bg-[#202123] dark:text-slate-100'
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{entry.text}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-500">
                        {entry.role === 'user' ? 'You' : 'FileMyRTI'} · {formatTimestamp(entry.timestamp)}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          <div className="border-t border-black/10 bg-[#f7f7f8] px-4 py-6 dark:border-[#26262a] dark:bg-[#1f1f22]">
            <form
              onSubmit={handleSend}
              className="mx-auto flex max-w-3xl flex-col gap-3 rounded-xl border border-black/10 bg-white p-4 shadow-md dark:border-[#2d2d32] dark:bg-[#202123]"
            >
              <textarea
                className="h-32 w-full resize-none rounded-lg border border-black/10 bg-[#f7f7f8] px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200 dark:border-[#2d2d32] dark:bg-[#1f1f22] dark:text-slate-100 dark:focus:border-[#3a3a40] dark:focus:ring-[#3a3a40]"
                placeholder="Ask about RTI procedures, timelines, fees, or say “Draft an RTI application…”"
                value={message}
              onChange={e => setMessage(e.target.value)}
              disabled={sending}
            />
            <div className="flex flex-col items-end gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-400 dark:text-slate-500">
                FileMyRTI responds only to queries about India&apos;s Right to Information Act.
              </p>
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-full bg-[#10a37f] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0f8d6d] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#10a37f] dark:hover:bg-[#0f8d6d]"
                disabled={disableSend}
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
