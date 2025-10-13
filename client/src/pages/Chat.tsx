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
const LAST_SESSION_STORAGE_KEY = 'filemyrti:lastSessionId';

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
    if (typeof window === 'undefined') return;
    if (!selectedSessionId || selectedSessionId === NEW_SESSION_SENTINEL || !sessions[selectedSessionId]) {
      try {
        window.localStorage.removeItem(LAST_SESSION_STORAGE_KEY);
      } catch {
        // ignore storage access errors
      }
      return;
    }
    try {
      window.localStorage.setItem(LAST_SESSION_STORAGE_KEY, selectedSessionId);
    } catch {
      // ignore storage access errors
    }
  }, [selectedSessionId, sessions]);

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

        // Always start with a new session on page load/refresh
        setSelectedSessionId(NEW_SESSION_SENTINEL);
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
    <div className="flex h-screen bg-gray-50 text-gray-900">
      {/* Sidebar - optimized for large screens */}
      <aside className="hidden xl:flex xl:w-64 xl:flex-col xl:fixed xl:inset-y-0 xl:z-50">
        <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-white border-r border-gray-200 px-6 pb-4">
          <div className="flex h-16 shrink-0 items-center">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white text-lg font-bold shadow-lg">
                RTI
              </div>
              <div>
                <span className="text-xl font-bold text-gray-900">RTI Dost</span>
                <p className="text-xs text-gray-500">AI Assistant</p>
              </div>
            </div>
          </div>

          <nav className="flex flex-1 flex-col">
            <ul role="list" className="flex flex-1 flex-col gap-y-6">
              <li>
                <button
                  type="button"
                  onClick={startNewConversation}
                  className="group -mx-2 flex gap-x-3 rounded-xl p-3 text-sm leading-6 font-semibold text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 text-lg font-medium group-hover:bg-indigo-200">
                    +
                  </span>
                  <span className="text-base">New chat</span>
                </button>
              </li>

              {orderedSessions.length > 0 && (
                <li>
                  <div className="text-xs font-semibold leading-6 text-gray-400 uppercase tracking-wider mb-3">Recent conversations</div>
                  <ul role="list" className="-mx-2 space-y-1">
                    {orderedSessions.slice(0, 8).map((session) => (
                      <li key={session.sessionId}>
                        <button
                          type="button"
                          onClick={() => setSelectedSessionId(session.sessionId)}
                          className="group flex gap-x-3 rounded-lg p-3 text-sm leading-6 font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors w-full text-left"
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500 group-hover:bg-gray-200">
                            💬
                          </span>
                          <span className="truncate text-sm">{deriveTitle(session.entries)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              )}
            </ul>
          </nav>

          <div className="flex items-center gap-x-4 px-3 py-4 border-t border-gray-200">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 to-gray-300 text-sm font-semibold text-gray-700">
              {user?.pictureUrl ? (
                <img src={user.pictureUrl} alt={user.name ?? 'User avatar'} className="h-full w-full rounded-full object-cover" />
              ) : (
                userInitial
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">{user?.name}</div>
              <div className="text-xs text-gray-500 truncate">{user?.email}</div>
            </div>
            <button
              type="button"
              onClick={logout}
              className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex flex-1 flex-col xl:pl-64">
        {/* Header */}
        <div className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-x-4 border-b border-gray-200 bg-white px-4 shadow-sm sm:gap-x-6 sm:px-6 lg:px-8">
          <button type="button" className="-m-2.5 p-2.5 text-gray-700 xl:hidden">
            <span className="sr-only">Open sidebar</span>
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <div className="h-6 w-px bg-gray-200 xl:hidden" />
          <div className="flex flex-1 gap-x-4 self-stretch lg:gap-x-6">
            <div className="relative flex flex-1">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  >
                    <span>RTI-Dost1.0</span>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-x-4 lg:gap-x-6">
              <button
                type="button"
                onClick={startNewConversation}
                className="inline-flex items-center justify-center rounded-lg bg-indigo-600 p-3 text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 transition-colors"
                title="Temporary Chat"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  {/* Segmented chat bubble - outer frame */}
                  <rect x="4" y="4" width="16" height="16" rx="3" ry="3" fill="none" stroke="currentColor" strokeWidth="2" />
                  {/* Inner segments */}
                  <rect x="6" y="6" width="12" height="2" rx="1" fill="currentColor" />
                  <rect x="6" y="16" width="12" height="2" rx="1" fill="currentColor" />
                  <rect x="4" y="8" width="2" height="8" rx="1" fill="currentColor" />
                  <rect x="18" y="8" width="2" height="8" rx="1" fill="currentColor" />
                  {/* Inner structure */}
                  <rect x="7" y="10" width="2" height="4" rx="1" fill="currentColor" />
                  <rect x="15" y="10" width="2" height="4" rx="1" fill="currentColor" />
                  <rect x="10" y="14" width="4" height="2" rx="1" fill="currentColor" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Chat area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {(error || globalNotice) && (
            <div className={`border-b px-6 py-3 text-sm ${error
              ? 'border-red-100 bg-red-50 text-red-600'
              : 'border-green-100 bg-green-50 text-green-600'
              }`}>
              <div className="mx-auto max-w-4xl">{error || globalNotice}</div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
              {loading && (
                <div className="flex items-center justify-center py-16">
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"></div>
                    <div className="text-sm text-gray-500">Loading...</div>
                  </div>
                </div>
              )}

              {showEmptyState && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 mb-6">
                    <svg className="h-8 w-8 text-indigo-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-semibold text-gray-900 mb-2">Welcome to RTI Dost</h3>
                  <p className="text-lg text-gray-600 max-w-md mb-8">Your AI assistant for Right to Information in India. Ask me anything about RTI!</p>

                  {/* Centered input box for empty state */}
                  <div className="w-full max-w-2xl">
                    <form onSubmit={handleSend} className="relative">
                      <div className="flex items-center gap-3 rounded-xl shadow-sm ring-1 ring-inset ring-gray-300 focus-within:ring-2 focus-within:ring-indigo-600 bg-white p-3">
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:text-gray-500 transition-colors"
                          disabled={sending}
                        >
                          <PaperclipIcon className="h-4 w-4" />
                          <span className="sr-only">Attach a file</span>
                        </button>

                        <input
                          type="text"
                          name="message"
                          id="message"
                          className="flex-1 border-0 bg-transparent text-gray-900 placeholder:text-gray-400 focus:ring-0 focus:outline-none text-sm leading-6"
                          placeholder="Message RTI Dost..."
                          value={message}
                          onChange={e => setMessage(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (!disableSend) {
                                handleSend(e);
                              }
                            }
                          }}
                          disabled={sending}
                        />

                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:text-gray-500 transition-colors"
                          disabled={sending}
                        >
                          <MicrophoneIcon className="h-4 w-4" />
                          <span className="sr-only">Voice input</span>
                        </button>

                        <button
                          type="submit"
                          className="inline-flex items-center gap-x-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          disabled={disableSend}
                        >
                          {sending ? (
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          ) : (
                            <SendIcon className="h-4 w-4" />
                          )}
                          Send
                        </button>
                      </div>
                    </form>
                    <p className="mt-2 text-xs text-gray-500 text-center">
                      RTI Dost responds only to queries about India's Right to Information Act. Press Enter to send.
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-6">
                {!loading && currentSession?.entries.map((entry) => (
                  <div
                    key={entry.id}
                    className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-4xl rounded-2xl px-6 py-4 ${entry.role === 'user'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200'
                        }`}
                    >
                      <div className="whitespace-pre-wrap text-base leading-relaxed">{entry.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Input area - only show when not in empty state */}
          {!showEmptyState && (
            <div className="border-t border-gray-200 bg-white px-4 py-4 sm:px-6 lg:px-8">
              <div className="mx-auto max-w-4xl">
                <form onSubmit={handleSend} className="relative">
                  <div className="flex items-center gap-3 rounded-xl shadow-sm ring-1 ring-inset ring-gray-300 focus-within:ring-2 focus-within:ring-indigo-600 bg-white p-3">
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:text-gray-500 transition-colors"
                      disabled={sending}
                    >
                      <PaperclipIcon className="h-4 w-4" />
                      <span className="sr-only">Attach a file</span>
                    </button>

                    <input
                      type="text"
                      name="message"
                      id="message"
                      className="flex-1 border-0 bg-transparent text-gray-900 placeholder:text-gray-400 focus:ring-0 focus:outline-none text-sm leading-6"
                      placeholder="Message RTI Dost..."
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (!disableSend) {
                            handleSend(e);
                          }
                        }
                      }}
                      disabled={sending}
                    />

                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:text-gray-500 transition-colors"
                      disabled={sending}
                    >
                      <MicrophoneIcon className="h-4 w-4" />
                      <span className="sr-only">Voice input</span>
                    </button>

                    <button
                      type="submit"
                      className="inline-flex items-center gap-x-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      disabled={disableSend}
                    >
                      {sending ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        <SendIcon className="h-4 w-4" />
                      )}
                      Send
                    </button>
                  </div>
                </form>
                <p className="mt-2 text-xs text-gray-500 text-center">
                  RTI Dost responds only to queries about India's Right to Information Act. Press Enter to send.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
