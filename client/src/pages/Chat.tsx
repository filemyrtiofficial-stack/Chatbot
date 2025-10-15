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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [selectedModel, setSelectedModel] = useState('Dost1.0');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const [hasStartedConversation, setHasStartedConversation] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Function to scroll to bottom
  const scrollToBottom = () => {
    if (chatMessagesRef.current) {
      requestAnimationFrame(() => {
        if (chatMessagesRef.current) {
          chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
        }
      });
    }
  };

  const availableModels = [
    'Dost1.0',
    'Dost1.1',
    'Dost1.2',
    'Dost1.3',
    'Dost1.4',
    'Dost1.5',
    'Dost2.0',
    'Dost2.1',
    'Dost2.2',
    'Dost2.3',
    'Dost3.0',
    'Dost3.1',
    'Dost3.2',
    'Dost4.0',
    'Dost Pro',
    'Dost Lite',
    'Dost Advanced',
    'Dost Enterprise',
    'Dost Beta',
    'Dost Alpha'
  ];

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

  // System appearance detection
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    // Set initial state
    setIsDarkMode(mediaQuery.matches);

    // Listen for changes
    const handleChange = (e: MediaQueryListEvent) => {
      setIsDarkMode(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  // Auto-resize textarea - ChatGPT-like behavior
  useEffect(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Set height to scrollHeight, but respect min/max constraints
      const scrollHeight = textarea.scrollHeight;
      const minHeight = 24; // 24px minimum height
      const maxHeight = 200; // 200px maximum height
      const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
      textarea.style.height = `${newHeight}px`;
    }
  }, [message]);

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    if (currentSession?.entries && currentSession.entries.length > 0) {
      scrollToBottom();
    }
  }, [currentSession?.entries]);

  // Scroll to bottom when sending a message
  useEffect(() => {
    if (sending) {
      scrollToBottom();
    }
  }, [sending]);

  // Scroll to bottom when conversation starts
  useEffect(() => {
    if (hasStartedConversation) {
      scrollToBottom();
    }
  }, [hasStartedConversation]);

  // Scroll to bottom when message is cleared (after sending)
  useEffect(() => {
    if (message === '' && hasStartedConversation) {
      scrollToBottom();
    }
  }, [message, hasStartedConversation]);

  // Check if user has accepted terms
  useEffect(() => {
    const hasAcceptedTerms = localStorage.getItem('rti-dost-terms-accepted');
    if (!hasAcceptedTerms) {
      setShowTermsModal(true);
    } else {
      setTermsAccepted(true);
    }
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      const dropdown = target.closest('[data-dropdown]');
      if (isModelDropdownOpen && !dropdown) {
        setIsModelDropdownOpen(false);
      }
    };

    if (isModelDropdownOpen) {
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isModelDropdownOpen]);

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
    setHasStartedConversation(false);
  }

  function handleAcceptTerms() {
    localStorage.setItem('rti-dost-terms-accepted', 'true');
    setTermsAccepted(true);
    setShowTermsModal(false);
  }

  function handleRejectTerms() {
    // Redirect to logout or show message
    alert('You must accept the terms and conditions to use RTI Dost.');
    // You can also redirect to logout or home page
    // window.location.href = '/logout';
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
      setHasStartedConversation(true);

      // Scroll to bottom after sending message
      setTimeout(() => scrollToBottom(), 100);

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
    selectedSessionId === NEW_SESSION_SENTINEL &&
    !hasStartedConversation;

  const mobileSessionValue =
    selectedSessionId && selectedSessionId !== NEW_SESSION_SENTINEL
      ? selectedSessionId
      : NEW_SESSION_SENTINEL;

  const userInitial = (user?.name?.trim()?.[0] ?? user?.email?.trim()?.[0] ?? 'R').toUpperCase();

  return (
    <>
      {/* Terms and Conditions Modal */}
      {showTermsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className={`mx-4 max-w-2xl rounded-lg p-6 shadow-xl transition-colors duration-200 ${isDarkMode
            ? 'bg-gray-800 text-gray-100'
            : 'bg-white text-gray-900'
            }`}>
            <div className="mb-6">
              <h2 className={`text-2xl font-bold mb-4 transition-colors duration-200 ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>Terms and Conditions</h2>

              <div className={`max-h-96 overflow-y-auto text-sm leading-relaxed transition-colors duration-200 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'
                }`}>
                <p className="mb-4">
                  Welcome to RTI Dost, an AI-powered assistant designed to help you draft Right to Information (RTI) applications in India.
                </p>

                <h3 className={`font-semibold mb-2 transition-colors duration-200 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>1. Service Description</h3>
                <p className="mb-4">
                  RTI Dost provides AI assistance for drafting RTI applications. The service is designed to help users understand RTI procedures and create well-structured applications.
                </p>

                <h3 className={`font-semibold mb-2 transition-colors duration-200 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>2. User Responsibilities</h3>
                <p className="mb-4">
                  Users are responsible for verifying all information provided in their RTI applications. RTI Dost is a tool to assist in drafting, not a substitute for legal advice.
                </p>

                <h3 className={`font-semibold mb-2 transition-colors duration-200 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>3. Data Privacy</h3>
                <p className="mb-4">
                  We respect your privacy and handle your data in accordance with our Privacy Policy. Your conversations and RTI drafts are processed securely.
                </p>

                <h3 className={`font-semibold mb-2 transition-colors duration-200 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>4. Limitation of Liability</h3>
                <p className="mb-4">
                  RTI Dost is provided "as is" without warranties. We are not liable for any outcomes resulting from the use of drafted RTI applications.
                </p>

                <h3 className={`font-semibold mb-2 transition-colors duration-200 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>5. Acceptance</h3>
                <p className="mb-4">
                  By using RTI Dost, you agree to these terms and conditions. If you do not agree, please discontinue use of the service.
                </p>
              </div>
            </div>

            <div className="flex gap-4 justify-end">
              <button
                onClick={handleRejectTerms}
                className={`px-6 py-2 rounded-lg font-medium transition-colors duration-200 ${isDarkMode
                  ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
              >
                I Don't Accept
              </button>
              <button
                onClick={handleAcceptTerms}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors duration-200"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`flex h-screen transition-colors duration-200 ${isDarkMode
        ? 'text-gray-100'
        : 'text-gray-900'
        }`} style={{ backgroundColor: isDarkMode ? '#212121' : '#FFFFFF' }}>
        {/* Sidebar - optimized for large screens */}
        <aside className={`${sidebarOpen ? 'flex' : 'hidden'} xl:w-64 xl:flex-col xl:fixed xl:inset-y-0 xl:z-50`}>
          <div className={`flex grow flex-col gap-y-5 overflow-y-auto border-r transition-colors duration-200 ${isDarkMode
            ? 'border-gray-800'
            : 'border-gray-200'
            }`} style={{ backgroundColor: isDarkMode ? '#181818' : '#F7F7F8' }}>
            <div className="flex h-12 shrink-0 items-center justify-between px-6">
              <div className="flex items-center justify-center">
                <div className="flex h-12 w-12 items-center justify-center">
                  <img
                    src="/logo/image.png"
                    alt="File My RTI Logo"
                    className="h-10 w-10 object-contain"
                  />
                </div>
              </div>

              {/* Sidebar toggle button */}
              <button
                type="button"
                onClick={() => {
                  console.log('Sidebar toggle clicked, current state:', sidebarOpen);
                  setSidebarOpen(!sidebarOpen);
                }}
                className="flex items-center justify-center p-2 text-gray-600 hover:text-gray-900 transition-colors"
                title="Close sidebar"
              >
                <svg className="h-5 w-6" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  {/* Rounded rectangle outline */}
                  <rect x="1" y="1" width="22" height="14" rx="3" ry="3" fill="none" stroke="currentColor" />
                  {/* Vertical divider line */}
                  <line x1="7" y1="1" x2="7" y2="15" stroke="currentColor" />
                  {/* Hamburger lines in left section */}
                  <line x1="3" y1="5" x2="5" y2="5" stroke="currentColor" strokeLinecap="round" />
                  <line x1="3" y1="8" x2="5" y2="8" stroke="currentColor" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <nav className="flex flex-1 flex-col px-6">
              <ul role="list" className="flex flex-1 flex-col gap-y-2">
                <li>
                  <button
                    type="button"
                    onClick={startNewConversation}
                    className={`group flex gap-x-3 rounded-lg p-2 text-sm leading-5 font-medium transition-colors duration-200 w-full text-left ${isDarkMode
                      ? 'text-gray-300 hover:bg-gray-700 hover:text-white'
                      : 'text-gray-700 hover:bg-gray-200 hover:text-gray-900'
                      }`}
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors duration-200 ${isDarkMode
                      ? 'bg-gray-600 text-gray-400 group-hover:bg-gray-500'
                      : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200'
                      }`}>
                      +
                    </span>
                    <span className="truncate text-sm">New chat</span>
                  </button>
                </li>

                {orderedSessions.length > 0 && (
                  <li>
                    <div className={`text-xs font-semibold leading-6 uppercase tracking-wider mb-2 transition-colors duration-200 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'
                      }`}>Chats</div>
                    <ul role="list" className="-mx-2 space-y-0.5">
                      {orderedSessions.slice(0, 8).map((session) => (
                        <li key={session.sessionId}>
                          <button
                            type="button"
                            onClick={() => setSelectedSessionId(session.sessionId)}
                            className={`group flex rounded-lg p-2 text-sm leading-5 font-medium transition-colors duration-200 w-full text-left ${isDarkMode
                              ? 'text-gray-300 hover:bg-gray-700 hover:text-white'
                              : 'text-gray-700 hover:bg-gray-200 hover:text-gray-900'
                              }`}
                          >
                            <span className="truncate text-sm">{deriveTitle(session.entries)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                )}
              </ul>
            </nav>

            <div className={`flex items-center gap-x-4 px-6 py-2 border-t transition-colors duration-200 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
              }`}>
              <div className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br text-sm font-semibold transition-colors duration-200 ${isDarkMode
                ? 'from-gray-600 to-gray-700 text-gray-200'
                : 'from-gray-200 to-gray-300 text-gray-700'
                }`}>
                {user?.pictureUrl ? (
                  <img src={user.pictureUrl} alt={user.name ?? 'User avatar'} className="h-full w-full rounded-full object-cover" />
                ) : (
                  userInitial
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-semibold truncate transition-colors duration-200 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{user?.name}</div>
                <div className={`text-xs truncate transition-colors duration-200 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                  }`}>{user?.email}</div>
              </div>
              <button
                type="button"
                onClick={logout}
                className={`text-xs transition-colors duration-200 ${isDarkMode
                  ? 'text-gray-400 hover:text-gray-200'
                  : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                Logout
              </button>
            </div>
          </div>
        </aside>

        {/* Main content area */}
        <div className={`flex flex-1 flex-col min-h-0 ${sidebarOpen ? 'xl:pl-64' : ''}`}>
          {/* Header */}
          <div className={`sticky top-0 z-40 flex h-12 shrink-0 items-center gap-x-4 px-4 sm:gap-x-6 sm:px-6 lg:px-8 transition-colors duration-200 ${isDarkMode ? '' : 'bg-white'
            }`} style={{ backgroundColor: isDarkMode ? '#212121' : undefined }}>
            <button type="button" className={`-m-2.5 p-2.5 xl:hidden transition-colors duration-200 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              <span className="sr-only">Open sidebar</span>
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            <div className={`h-6 w-px xl:hidden transition-colors duration-200 ${isDarkMode ? 'bg-gray-600' : 'bg-gray-200'
              }`} />

            {/* Show sidebar toggle in navbar when sidebar is closed */}
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => {
                  console.log('Navbar toggle clicked, opening sidebar');
                  setSidebarOpen(true);
                }}
                className={`hidden xl:flex items-center justify-center p-2 transition-colors duration-200 ${isDarkMode
                  ? 'text-gray-400 hover:text-gray-200'
                  : 'text-gray-600 hover:text-gray-900'
                  }`}
                title="Open sidebar"
              >
                <svg className="h-5 w-6" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  {/* Rounded rectangle outline */}
                  <rect x="1" y="1" width="22" height="14" rx="3" ry="3" fill="none" stroke="currentColor" />
                  {/* Vertical divider line */}
                  <line x1="7" y1="1" x2="7" y2="15" stroke="currentColor" />
                  {/* Hamburger lines in left section */}
                  <line x1="3" y1="5" x2="5" y2="5" stroke="currentColor" strokeLinecap="round" />
                  <line x1="3" y1="8" x2="5" y2="8" stroke="currentColor" strokeLinecap="round" />
                </svg>
              </button>
            )}

            <div className="flex flex-1 gap-x-4 self-stretch lg:gap-x-6">
              <div className="relative flex flex-1">
                <div className="flex items-center gap-2 -ml-2">
                  <div className="relative" data-dropdown>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        console.log('Dropdown button clicked, current state:', isModelDropdownOpen);
                        setIsModelDropdownOpen(!isModelDropdownOpen);
                      }}
                      className={`inline-flex items-center gap-2 pl-6 pr-3 py-2 text-lg font-normal transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${isDarkMode
                        ? 'text-gray-300 hover:text-gray-100'
                        : 'text-gray-700 hover:text-gray-900'
                        }`}
                    >
                      <span>RTI-Dost</span>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>

                    {isModelDropdownOpen && (
                      <div className={`absolute top-full left-0 mt-1 w-full min-w-[140px] max-h-60 overflow-y-auto rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-50 ${isDarkMode ? 'bg-gray-700' : 'bg-white'
                        }`} data-dropdown>
                        <div className="py-1">
                          {availableModels.map((model) => (
                            <button
                              key={model}
                              type="button"
                              onClick={() => {
                                setSelectedModel(model);
                                setIsModelDropdownOpen(false);
                              }}
                              className={`block w-full text-left px-4 py-2 text-sm transition-colors duration-200 ${model === selectedModel
                                ? isDarkMode
                                  ? 'bg-gray-600 text-white'
                                  : 'bg-gray-100 text-gray-900'
                                : isDarkMode
                                  ? 'text-gray-300 hover:bg-gray-600 hover:text-white'
                                  : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                                }`}
                            >
                              {model}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-x-4 lg:gap-x-6">
              </div>
            </div>
          </div>

          {/* Chat area */}
          <div className="flex flex-1 flex-col min-h-0 h-full">
            {/* Main content area */}
            <div className="flex-1 overflow-hidden min-h-0">
              {(error || globalNotice) && (
                <div className={`border-b px-6 py-3 text-sm ${error
                  ? 'border-red-100 bg-red-50 text-red-600'
                  : 'border-green-100 bg-green-50 text-green-600'
                  }`}>
                  <div className="mx-auto max-w-4xl">{error || globalNotice}</div>
                </div>
              )}

              <div ref={chatMessagesRef} className="flex-1 overflow-y-auto scroll-smooth min-h-0" style={{ maxHeight: 'calc(100vh - 200px)', minHeight: '400px' }}>
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
                    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                      <h3 className={`text-4xl font-semibold mb-8 transition-colors duration-200 ${isDarkMode ? 'text-white' : 'text-gray-900'
                        }`}>Welcome to RTI Dost</h3>

                      {/* Centered input box for empty state */}
                      <div className="mx-auto px-4 sm:px-6 lg:px-8" style={{ width: '850px' }}>
                        <form onSubmit={e => {
                          e.preventDefault();
                          if (!disableSend) {
                            setHasStartedConversation(true);
                            handleSend(e);
                          }
                        }} className="relative">
                          <div className={`flex items-end gap-3 rounded-2xl shadow-sm ring-1 ring-inset p-4 transition-colors duration-200 ${isDarkMode
                            ? 'ring-gray-600 focus-within:ring-2 focus-within:ring-gray-500'
                            : 'ring-gray-300 focus-within:ring-2 focus-within:ring-indigo-600 bg-white'
                            }`} style={{ backgroundColor: isDarkMode ? '#1a1a1a' : undefined }}>
                            <button
                              type="button"
                              className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-200 ${isDarkMode
                                ? 'text-gray-400 hover:text-gray-200'
                                : 'text-gray-600 hover:text-gray-800'
                                }`}
                              disabled={sending}
                            >
                              <PaperclipIcon className="h-5 w-5" />
                              <span className="sr-only">Attach a file</span>
                            </button>

                            <textarea
                              ref={textareaRef}
                              name="message"
                              id="message"
                              rows={1}
                              className={`flex-1 border-0 bg-transparent focus:ring-0 focus:outline-none text-sm leading-6 resize-none transition-all duration-200 overflow-hidden text-left flex items-center ${isDarkMode
                                ? 'text-gray-100 placeholder:text-gray-500'
                                : 'text-gray-900 placeholder:text-gray-400'
                                }`}
                              placeholder="Message RTI Dost..."
                              value={message}
                              onChange={e => setMessage(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  if (!disableSend) {
                                    // Set conversation started immediately to move input to bottom
                                    setHasStartedConversation(true);
                                    handleSend(e);
                                  }
                                }
                              }}
                              disabled={sending}
                              style={{ minHeight: '30px', maxHeight: '200px' }}
                            />

                            <button
                              type="button"
                              className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-200 ${isDarkMode
                                ? 'text-gray-400 hover:text-gray-200'
                                : 'text-gray-600 hover:text-gray-800'
                                }`}
                              disabled={sending}
                            >
                              <MicrophoneIcon className="h-5 w-5" />
                              <span className="sr-only">Voice input</span>
                            </button>

                            <button
                              type="submit"
                              className={`inline-flex items-center justify-center rounded-lg p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 transition-all duration-200 ${isDarkMode
                                ? disableSend ? 'text-gray-600 cursor-not-allowed' : 'text-gray-300 hover:text-white hover:bg-gray-600 cursor-pointer'
                                : disableSend ? 'text-gray-400 cursor-not-allowed' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100 cursor-pointer'
                                }`}
                              disabled={disableSend}
                              title="Send"
                            >
                              {sending ? (
                                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                              ) : (
                                <SendIcon className="h-5 w-5" />
                              )}
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}

                  <div className="space-y-6 pb-8">
                    {!loading && currentSession?.entries.map((entry) => (
                      <div
                        key={entry.id}
                        className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-4xl rounded-2xl px-6 py-4 ${entry.role === 'user'
                            ? 'text-gray-900'
                            : isDarkMode ? 'text-gray-100' : 'bg-white text-gray-900'
                            }`}
                          style={{
                            backgroundColor: entry.role === 'user'
                              ? '#F7F7F8'
                              : isDarkMode
                                ? '#212121'
                                : undefined
                          }}
                        >
                          <div className="whitespace-pre-wrap text-base leading-relaxed">{entry.text}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Input area - only show when not in empty state */}
            {!showEmptyState && (
              <div className={`transition-colors duration-200 ${isDarkMode ? '' : 'bg-white'
                }`} style={{ backgroundColor: isDarkMode ? '#212121' : undefined }}>
                <div className="mx-auto px-4 py-4 sm:px-6 lg:px-8" style={{ width: '850px' }}>
                  <form onSubmit={e => {
                    e.preventDefault();
                    if (!disableSend) {
                      setHasStartedConversation(true);
                      handleSend(e);
                    }
                  }} className="relative">
                    <div className={`flex items-end gap-3 rounded-2xl shadow-sm ring-1 ring-inset p-4 transition-colors duration-200 ${isDarkMode
                      ? 'ring-gray-600 focus-within:ring-2 focus-within:ring-gray-500'
                      : 'ring-gray-300 focus-within:ring-2 focus-within:ring-indigo-600 bg-white'
                      }`} style={{ backgroundColor: isDarkMode ? '#1a1a1a' : undefined }}>
                      <button
                        type="button"
                        className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-200 ${isDarkMode
                          ? 'text-gray-400 hover:text-gray-200'
                          : 'text-gray-600 hover:text-gray-800'
                          }`}
                        disabled={sending}
                      >
                        <PaperclipIcon className="h-5 w-5" />
                        <span className="sr-only">Attach a file</span>
                      </button>

                      <textarea
                        ref={textareaRef}
                        name="message"
                        id="message"
                        rows={1}
                        className={`flex-1 border-0 bg-transparent focus:ring-0 focus:outline-none text-sm leading-6 resize-none transition-all duration-200 overflow-hidden text-left flex items-center ${isDarkMode
                          ? 'text-gray-100 placeholder:text-gray-500'
                          : 'text-gray-900 placeholder:text-gray-400'
                          }`}
                        placeholder="Message RTI Dost..."
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (!disableSend) {
                              // Set conversation started immediately to move input to bottom
                              setHasStartedConversation(true);
                              handleSend(e);
                            }
                          }
                        }}
                        disabled={sending}
                        style={{ minHeight: '32px', maxHeight: '200px' }}
                      />

                      <button
                        type="button"
                        className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-200 ${isDarkMode
                          ? 'text-gray-400 hover:text-gray-200'
                          : 'text-gray-600 hover:text-gray-800'
                          }`}
                        disabled={sending}
                      >
                        <MicrophoneIcon className="h-5 w-5" />
                        <span className="sr-only">Voice input</span>
                      </button>

                      <button
                        type="submit"
                        className={`inline-flex items-center justify-center rounded-lg p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 transition-all duration-200 ${isDarkMode
                          ? disableSend ? 'text-gray-600 cursor-not-allowed' : 'text-gray-300 hover:text-white hover:bg-gray-600 cursor-pointer'
                          : disableSend ? 'text-gray-400 cursor-not-allowed' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100 cursor-pointer'
                          }`}
                        disabled={disableSend}
                        title="Send"
                      >
                        {sending ? (
                          <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        ) : (
                          <SendIcon className="h-5 w-5" />
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Simple footer text - always at bottom */}
            <div className={`px-6 py-3 text-center transition-colors duration-200 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              <div className="text-xs">
                RTI-DOST AI assistance for drafting RTIs. Privacy Policy • Terms & Conditions
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
