import { useEffect, useMemo, useRef, useState, type FormEvent, type SVGProps } from 'react';
import { ApiError, api, resolveApiUrl } from '../api';
import { useAuth } from '../context/AuthContext';

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

type IconProps = SVGProps<SVGSVGElement>;

function PaperclipIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M21.44 11.05l-8.26 8.26a5 5 0 01-7.07-7.07l9.19-9.19a3.5 3.5 0 014.95 4.95l-8.49 8.49a2 2 0 01-2.83-2.83l7.07-7.07" />
    </svg>
  );
}

function MicrophoneIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3z" />
      <path d="M19 11v1a7 7 0 01-14 0v-1" />
      <path d="M12 19v3" />
    </svg>
  );
}

function SendIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 4l16 8-16 8 4-8-4-8z" />
      <path d="M20 12H8" />
    </svg>
  );
}

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
  return trimmed.length > 42 ? `${trimmed.slice(0, 42)}...` : trimmed;
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
          await logout();
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
        await logout();
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
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      }

      if (data.draftAvailable) {
        await refreshApplications();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
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
        await logout();
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to delete conversation.');
    }
  }

  async function handleDownloadDraft(sessionId: string) {
    try {
      setDownloadingSession(sessionId);
      const res = await fetch(
        resolveApiUrl(`/api/chat/application/${encodeURIComponent(sessionId)}/download`),
        {
          credentials: 'include',
        }
      );
      if (!res.ok) {
        if (res.status === 401) {
          await logout();
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

  const userInitial = (user?.name?.trim()?.[0] ?? user?.email?.trim()?.[0] ?? 'R').toUpperCase();

  return (
    <div className="flex min-h-screen bg-[#f9fafb] text-slate-900">
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white/80 backdrop-blur md:flex">
        <div className="px-6 pt-8">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-2xl text-white shadow-sm">🤖</div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">RTI DOST</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">Conversations</p>
            </div>
          </div>
        </div>
        <div className="px-6 pt-6">
          <button
            type="button"
            onClick={startNewConversation}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-white/95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300"
          >
            <span className="text-base leading-none">+</span>
            New Chat
          </button>
        </div>
        <div className="mt-8 flex items-center justify-between px-6 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
          <span>Previous 7 days</span>
          <button
            type="button"
            onClick={refreshApplications}
            className="text-slate-400 transition hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300"
          >
            Refresh
          </button>
        </div>
        <nav className="mt-4 flex-1 overflow-y-auto px-4 pb-6">
          {orderedSessions.length === 0 && !loading && (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-white/70 px-4 py-6 text-center text-sm text-slate-500">
              No conversations yet. Start a new chat to begin.
            </div>
          )}
          {orderedSessions.map(session => {
            const isActive = selectedSessionId === session.sessionId;
            return (
              <div
                key={session.sessionId}
                className={`group mb-3 rounded-2xl border transition ${
                  isActive
                    ? 'border-slate-900/15 bg-white shadow-sm'
                    : 'border-transparent bg-transparent hover:border-slate-200 hover:bg-white/80'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedSessionId(session.sessionId)}
                  className="w-full rounded-2xl px-4 pt-4 text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="line-clamp-2 text-sm font-medium text-slate-900">
                      {deriveTitle(session.entries)}
                    </span>
                    {session.hasDraft && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                        Draft
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
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
                </button>
                <div className="flex items-center gap-3 px-4 pb-4 pt-2 text-xs text-slate-500">
                  <button
                    type="button"
                    className="font-medium transition hover:text-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-200"
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
                      className="font-medium transition hover:text-sky-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-200"
                      onClick={e => {
                        e.stopPropagation();
                        handleDownloadDraft(session.sessionId);
                      }}
                      disabled={downloadingSession === session.sessionId}
                    >
                      {downloadingSession === session.sessionId ? 'Downloading...' : 'Download draft'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-slate-200 px-6 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-sm font-semibold text-slate-600">
              {user?.pictureUrl ? (
                <img src={user.pictureUrl} alt={user.name ?? 'User avatar'} className="h-full w-full object-cover" />
              ) : (
                userInitial
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{user?.name}</p>
              <p className="truncate text-xs text-slate-500">{user?.email}</p>
            </div>
            <button
              type="button"
              onClick={logout}
              className="text-xs font-semibold text-slate-500 transition hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300"
            >
              Logout
            </button>
          </div>
        </div>
      </aside>
      <main className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-20 flex flex-col gap-4 border-b border-slate-200 bg-[#f9fafb]/85 px-6 py-5 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-3xl shadow-sm">🤖</div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">RTI-Dost</p>
              <h1 className="mt-1 text-lg font-semibold text-slate-900">
                Your assistant for Right to Information in India
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={startNewConversation}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-white md:hidden"
            >
              <span className="text-base leading-none">+</span>
              New Chat
            </button>
          </div>
        </header>
        {(error || globalNotice) && (
          <div
            className={`border-b px-6 py-3 text-sm ${
              error
                ? 'border-red-100 bg-red-50 text-red-600'
                : 'border-emerald-100 bg-emerald-50 text-emerald-700'
            }`}
          >
            <div className="mx-auto max-w-3xl">{error || globalNotice}</div>
          </div>
        )}
        <div className="border-b border-slate-200 px-6 py-4 md:hidden">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
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
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          >
            <option value={NEW_SESSION_SENTINEL}>+ New chat</option>
            {orderedSessions.map(session => (
              <option key={session.sessionId} value={session.sessionId}>
                {deriveTitle(session.entries)}
              </option>
            ))}
          </select>
        </div>
        <div className="relative flex flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4">
            <div
              ref={messageListRef}
              className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5 py-10"
              aria-live="polite"
            >
              {loading && (
                <div className="mx-auto w-full max-w-sm rounded-3xl border border-dashed border-slate-200 bg-white/80 px-4 py-5 text-center text-sm text-slate-500 shadow-sm">
                  Loading your conversations...
                </div>
              )}
              {showEmptyState && (
                <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 rounded-3xl border border-dashed border-slate-200 bg-white/90 px-8 py-12 text-center shadow-sm">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#eef2ff] text-3xl">🙌</div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-semibold text-slate-900">Namaste! I&apos;m RTI Dost</h2>
                    <p className="text-sm leading-relaxed text-slate-500">
                      I can help you draft RTI applications, understand the RTI Act, and find answers to your RTI-related questions.
                    </p>
                  </div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Ask your first question below
                  </p>
                </div>
              )}
              {!loading &&
                currentSession?.entries.map(entry => (
                  <div
                    key={entry.id}
                    className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-3xl px-5 py-4 text-sm leading-relaxed shadow-sm ${
                        entry.role === 'user'
                          ? 'bg-slate-900 text-white'
                          : 'border border-slate-200 bg-white text-slate-800'
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{entry.text}</div>
                      <div className={`mt-3 text-xs ${entry.role === 'user' ? 'text-white/70' : 'text-slate-400'}`}>
                        {entry.role === 'user' ? 'You' : 'RTI Dost'} • {formatTimestamp(entry.timestamp)}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
          <div className="border-t border-slate-200 bg-[#f9fafb] px-4 py-6">
            <form onSubmit={handleSend} className="mx-auto w-full max-w-3xl space-y-3">
              <div className="flex items-end gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition focus-within:border-slate-400 focus-within:shadow-md focus-within:ring-2 focus-within:ring-slate-200">
                <button
                  type="button"
                  className="text-slate-400 transition hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300"
                  aria-label="Attach a file"
                  disabled={sending}
                >
                  <PaperclipIcon className="h-5 w-5" />
                </button>
                <textarea
                  ref={textareaRef}
                  className="max-h-48 min-h-[48px] flex-1 resize-none border-0 bg-transparent text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:outline-none"
                  placeholder="Message RTI Dost"
                  value={message}
                  onChange={e => {
                    setMessage(e.target.value);
                    if (textareaRef.current) {
                      textareaRef.current.style.height = 'auto';
                      const { scrollHeight } = textareaRef.current;
                      textareaRef.current.style.height = `${Math.min(scrollHeight, 192)}px`;
                    }
                  }}
                  disabled={sending}
                  rows={1}
                />
                <button
                  type="button"
                  className="text-slate-400 transition hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300"
                  aria-label="Start voice input"
                  disabled
                >
                  <MicrophoneIcon className="h-5 w-5" />
                </button>
                <button
                  type="submit"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                  disabled={disableSend}
                >
                  {sending ? (
                    <span className="flex h-4 w-4 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
                  ) : (
                    <SendIcon className="h-4 w-4" />
                  )}
                  <span className="sr-only">Send message</span>
                </button>
              </div>
              <p className="text-xs text-slate-500">
                FileMyRTI responds only to queries about India&apos;s Right to Information Act.
              </p>
            </form>
            <footer className="mx-auto mt-10 flex w-full max-w-3xl flex-col items-center gap-3 border-t border-slate-200 pt-4 text-xs text-slate-500 sm:flex-row sm:justify-between">
              <span>RTI-Dost: AI assistant for drafting RTIs.</span>
              <div className="flex items-center gap-4">
                <a
                  href="https://filemyrti.com/privacy-policy"
                  target="_blank"
                  rel="noreferrer"
                  className="transition hover:text-slate-700"
                >
                  Privacy Policy
                </a>
                <a
                  href="https://filemyrti.com/terms-of-service"
                  target="_blank"
                  rel="noreferrer"
                  className="transition hover:text-slate-700"
                >
                  Terms of Service
                </a>
              </div>
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
}
