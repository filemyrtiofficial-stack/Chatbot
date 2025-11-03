import { useEffect, useMemo, useRef, useState, type FormEvent, type SVGProps } from 'react';
import { ApiError, api, resolveApiUrl } from '../api';
import { useAuth } from '../context/AuthContext';
import { HumanTalkNavButton } from '../components/HumanTalkWidget';

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

function WaveAnimation() {
  return (
    <div className="wave-container">
      <div className="wave-flow"></div>
      <div className="wave-bars">
        <div className="wave-bar-small" style={{ animationDelay: '0ms' }}></div>
        <div className="wave-bar-medium" style={{ animationDelay: '100ms' }}></div>
        <div className="wave-bar-large" style={{ animationDelay: '200ms' }}></div>
        <div className="wave-bar-medium" style={{ animationDelay: '300ms' }}></div>
        <div className="wave-bar-small" style={{ animationDelay: '400ms' }}></div>
        <div className="wave-bar-large" style={{ animationDelay: '500ms' }}></div>
        <div className="wave-bar-medium" style={{ animationDelay: '600ms' }}></div>
        <div className="wave-bar-small" style={{ animationDelay: '700ms' }}></div>
        <div className="wave-bar-medium" style={{ animationDelay: '800ms' }}></div>
        <div className="wave-bar-large" style={{ animationDelay: '900ms' }}></div>
        <div className="wave-bar-small" style={{ animationDelay: '1000ms' }}></div>
        <div className="wave-bar-medium" style={{ animationDelay: '1100ms' }}></div>
      </div>
    </div>
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [selectedModel, setSelectedModel] = useState('RTI-Dost');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | any>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const [hasStartedConversation, setHasStartedConversation] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);

  const showEmptyState =
    selectedSessionId === NEW_SESSION_SENTINEL &&
    !hasStartedConversation;

  const availableModels = [
    'RTI-Dost',

  ];

  const filteredModels = availableModels.filter(model =>
    model.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

  // Auto-show sidebar on desktop screens
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(min-width: 1024px)');

    // Set initial state
    if (mediaQuery.matches) {
      setSidebarOpen(true);
    }

    // Listen for changes
    const handleChange = (e: MediaQueryListEvent) => {
      setSidebarOpen(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  // Auto-focus textarea on component mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
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

  // Auto-focus textarea when empty state changes or when starting conversation
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [showEmptyState, hasStartedConversation]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      const dropdown = target.closest('[data-dropdown]');
      if (isModelDropdownOpen && !dropdown) {
        setIsModelDropdownOpen(false);
        setSearchQuery('');
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

  // File attachment functions
  const handleFileAttach = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.gif';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        setAttachedFile(file);
      }
    };
    input.click();
  };

  const removeAttachedFile = () => {
    setAttachedFile(null);
  };

  // Microphone recording functions
  const startRecording = async () => {
    try {
      // Check if speech recognition is available
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          console.log('Speech recognition started');
          setIsRecording(true);
        };

        recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          console.log('Speech recognition result:', transcript);
          setMessage(prev => prev + (prev ? ' ' : '') + transcript);
        };

        recognition.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          setIsRecording(false);

          // Show specific error messages
          switch (event.error) {
            case 'no-speech':
              alert('No speech detected. Please try again.');
              break;
            case 'audio-capture':
              alert('Microphone not found. Please check your microphone.');
              break;
            case 'not-allowed':
              alert('Microphone permission denied. Please allow microphone access.');
              break;
            case 'network':
              alert('Network error. Please check your internet connection.');
              break;
            default:
              alert('Speech recognition failed. Please try again.');
          }
        };

        recognition.onend = () => {
          console.log('Speech recognition ended');
          setIsRecording(false);
        };

        // Start speech recognition
        recognition.start();
        setMediaRecorder(recognition); // Store recognition instance

      } else {
        // Fallback: try to get microphone access for recording
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        const chunks: BlobPart[] = [];

        recorder.ondataavailable = (e) => {
          chunks.push(e.data);
        };

        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'audio/wav' });
          console.log('Audio recorded:', blob);
          setMessage(prev => prev + (prev ? ' ' : '') + '[Voice message recorded - speech recognition not available]');
          stream.getTracks().forEach(track => track.stop());
        };

        recorder.start();
        setMediaRecorder(recorder);
        setIsRecording(true);
      }

    } catch (error) {
      console.error('Error accessing microphone:', error);
      setIsRecording(false);
      alert('Could not access microphone. Please check permissions and try again.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      if (mediaRecorder.stop) {
        // It's a MediaRecorder
        mediaRecorder.stop();
      } else if (mediaRecorder.abort) {
        // It's a SpeechRecognition
        mediaRecorder.abort();
      }
      setIsRecording(false);
      setMediaRecorder(null);
    }
  };

  const mobileSessionValue =
    selectedSessionId && selectedSessionId !== NEW_SESSION_SENTINEL
      ? selectedSessionId
      : NEW_SESSION_SENTINEL;

  const userInitial = (user?.name?.trim()?.[0] ?? user?.email?.trim()?.[0] ?? 'R').toUpperCase();

  return (
    <>

      <div className={`flex h-screen transition-colors duration-200 ${isDarkMode
        ? 'text-gray-100 bg-gray-900'
        : 'text-gray-900 bg-white'
        }`}>
        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black bg-opacity-50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar - responsive design */}
        <aside className={`${sidebarOpen ? 'flex' : 'hidden'} lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:z-50 lg:w-64`}>
          <div className={`flex h-full flex-col border-r transition-colors duration-200 ${isDarkMode
            ? 'border-gray-800 bg-gray-800'
            : 'border-gray-200 bg-gray-50'
            }`}>
            {/* Sticky Header */}
            <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center justify-between bg-inherit" style={{ paddingLeft: '18px', paddingRight: '18px' }}>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center">
                  <img
                    src="/logo/image.png"
                    alt="File My RTI Logo"
                    className="object-contain"
                    style={{ width: '1.5rem', height: '1.5rem' }}
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
                className={`flex items-center justify-center p-2 transition-colors ${isDarkMode
                  ? 'text-gray-400 hover:text-gray-200'
                  : 'text-gray-600 hover:text-gray-900'
                  }`}
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

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-6 py-4 pb-6">
              <nav className="flex flex-col">
                <ul role="list" className="flex flex-col gap-y-2">
                  <li>
                    <button
                      type="button"
                      onClick={startNewConversation}
                      className={`group flex items-center rounded-lg p-0 text-sm leading-5 font-medium transition-colors duration-200 w-full text-left ${isDarkMode
                        ? 'text-gray-300 hover:bg-gray-700 hover:text-white'
                        : 'text-gray-700 hover:bg-gray-200 hover:text-gray-900'
                        }`}
                    >
                      <span className="truncate text-sm">New chat</span>
                    </button>
                  </li>

                  {orderedSessions.length > 0 && (
                    <li>
                      <div className={`text-xs font-semibold leading-6 uppercase tracking-wider mb-2 transition-colors duration-200 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'
                        }`}>Chats</div>
                      <ul role="list" className="-mx-2 space-y-0.5">
                        {orderedSessions.map((session) => (
                          <li key={session.sessionId}>
                            <div className={`group flex items-center rounded-lg p-2 text-sm leading-5 font-medium transition-colors duration-200 ${isDarkMode
                              ? 'text-gray-300 hover:bg-gray-700 hover:text-white'
                              : 'text-gray-700 hover:bg-gray-200 hover:text-gray-900'
                              }`}>
                              <button
                                type="button"
                                onClick={() => setSelectedSessionId(session.sessionId)}
                                className="flex-1 text-left truncate"
                              >
                                <span className="truncate text-sm">{deriveTitle(session.entries)}</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteSession(session.sessionId);
                                }}
                                className={`ml-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${isDarkMode
                                  ? 'text-gray-400 hover:text-red-400 hover:bg-gray-600'
                                  : 'text-gray-500 hover:text-red-500 hover:bg-gray-300'
                                  }`}
                                title="Delete conversation"
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                </svg>
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </li>
                  )}
                </ul>
              </nav>
            </div>

            {/* Sticky Footer */}
            <div className={`sticky bottom-0 z-10 flex items-center gap-x-3 px-4 sm:px-6 py-2 border-t bg-inherit transition-colors duration-200 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
              }`}>
              <div className={`flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-gradient-to-br text-xs sm:text-sm font-semibold transition-colors duration-200 ${isDarkMode
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
                <div className={`text-xs sm:text-sm font-semibold truncate transition-colors duration-200 ${isDarkMode ? 'text-white' : 'text-gray-900'
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
        <div className={`flex flex-1 flex-col min-h-0 ${sidebarOpen ? 'lg:pl-64' : ''}`}>
          {/* Header */}
          <div className={`sticky top-0 z-40 flex h-12 shrink-0 items-center gap-x-2 px-2 sm:px-3 sm:gap-x-4 lg:px-8 lg:gap-x-6 transition-colors duration-200 ${isDarkMode ? 'bg-gray-900' : 'bg-white'
            }`}>
            <button
              type="button"
              className={`-m-1.5 p-1.5 lg:hidden transition-colors duration-200 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}
              onClick={() => setSidebarOpen(true)}
            >
              <span className="sr-only">Open sidebar</span>
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            <div className={`h-6 w-px lg:hidden transition-colors duration-200 ${isDarkMode ? 'bg-gray-600' : 'bg-gray-200'
              }`} />

            {/* Show sidebar toggle in navbar when sidebar is closed */}
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => {
                  console.log('Navbar toggle clicked, opening sidebar');
                  setSidebarOpen(true);
                }}
                className={`hidden lg:flex items-center justify-center p-2 transition-colors duration-200 ${isDarkMode
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

            <div className="flex flex-1 gap-x-1 self-stretch lg:gap-x-6 min-w-0">
              <div className="relative hidden sm:flex flex-1 min-w-0 overflow-hidden">
                <div className="flex items-center gap-1 -ml-1 lg:gap-2 lg:-ml-2">
                  <div className="relative" data-dropdown>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsModelDropdownOpen(!isModelDropdownOpen);
                        if (!isModelDropdownOpen) {
                          setSearchQuery('');
                        }
                      }}
                      className={`inline-flex items-center gap-1 lg:gap-2 pl-2 pr-1.5 lg:pl-6 lg:pr-3 py-1.5 lg:py-2 text-xs lg:text-lg font-normal transition-colors duration-200 focus:outline-none ${isDarkMode
                        ? 'text-gray-300 hover:text-gray-100'
                        : 'text-gray-700 hover:text-gray-900'
                        }`}
                    >
                      <span className="hidden sm:inline truncate max-w-[80px] lg:max-w-none">{selectedModel}</span>
                      <span className="sm:hidden truncate max-w-[50px]">{selectedModel.split('-')[0]}</span>
                      <svg className="h-3 w-3 lg:h-4 lg:w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>

                    {isModelDropdownOpen && (
                      <div className={`absolute top-full left-0 mt-1 w-full min-w-[200px] max-h-60 overflow-y-auto rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-50 ${isDarkMode ? 'bg-gray-700' : 'bg-white'
                        }`} data-dropdown>
                        <div className="p-2">
                          <input
                            type="text"
                            placeholder="Search models..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className={`w-full px-3 py-2 text-sm rounded-md border-0 focus:outline-none ${isDarkMode
                              ? 'bg-gray-600 text-gray-200 placeholder-gray-400'
                              : 'bg-gray-50 text-gray-900 placeholder-gray-500'
                              }`}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div className="py-1">
                          {filteredModels.map((model) => (
                            <button
                              key={model}
                              type="button"
                              onClick={() => {
                                setSelectedModel(model);
                                setIsModelDropdownOpen(false);
                                setSearchQuery('');
                              }}
                              className={`flex items-center justify-between w-full text-left px-4 py-2 text-sm transition-colors duration-200 ${model === selectedModel
                                ? isDarkMode
                                  ? 'bg-gray-600 text-white'
                                  : 'bg-gray-100 text-gray-900'
                                : isDarkMode
                                  ? 'text-gray-300 hover:bg-gray-600 hover:text-white'
                                  : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                                }`}
                            >
                              <div className="flex items-center gap-2">
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                                </svg>
                                <span>{model}</span>
                              </div>
                              {model === selectedModel && (
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                </svg>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end ml-auto gap-x-1 lg:gap-x-6 flex-shrink-0">
                <HumanTalkNavButton />
              </div>
            </div>
          </div>

          {/* Chat area */}
          <div className="flex flex-1 flex-col min-h-0 h-full">
            {/* Main content area */}
            <div className="flex-1 overflow-hidden min-h-0">
              {(error || globalNotice) && (
                <div className={`border-b px-4 py-3 text-sm ${error
                  ? 'border-red-100 bg-red-50 text-red-600'
                  : 'border-green-100 bg-green-50 text-green-600'
                  }`}>
                  <div className="mx-auto max-w-3xl">{error || globalNotice}</div>
                </div>
              )}

              <div ref={chatMessagesRef} className={`flex-1 min-h-0 ${showEmptyState ? 'overflow-hidden' : 'overflow-y-auto scroll-smooth'}`} style={{ maxHeight: 'calc(100vh - 200px)', minHeight: '300px' }}>
                <div className={`mx-auto max-w-3xl px-4 py-8 ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
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
                      <div className="mb-8">
                        <h3 className={`text-2xl font-semibold mb-2 transition-colors duration-200 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                          Welcome to RTI-Dost
                        </h3>
                        <p className={`text-sm transition-colors duration-200 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Draft your RTI in seconds — just tell me what you need information about.
                        </p>
                      </div>

                      {/* Centered input box for empty state */}
                      <div className="w-full max-w-2xl">
                        <form onSubmit={e => {
                          e.preventDefault();
                          if (!disableSend) {
                            setHasStartedConversation(true);
                            handleSend(e);
                          }
                        }} className="relative">
                          <div className={`relative flex items-center gap-1 rounded-2xl border shadow-sm transition-all duration-200 ${isDarkMode
                            ? 'border-gray-600 bg-gray-800'
                            : 'border-gray-200 bg-white'
                            }`}>
                            <button
                              type="button"
                              onClick={handleFileAttach}
                              className={`pr-0 pl-1 py-2 rounded-lg transition-colors duration-200 ${isDarkMode
                                ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                                }`}
                              disabled={sending}
                            >
                              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                              </svg>
                            </button>

                            <div className="flex-1 pl-1 pr-4 py-4">
                              <textarea
                                ref={textareaRef}
                                name="message"
                                id="message"
                                rows={1}
                                className={`w-full border-0 bg-transparent resize-none text-base leading-6 placeholder-gray-500 focus:outline-none ${isDarkMode
                                  ? 'text-white'
                                  : 'text-gray-900'
                                  }`}
                                placeholder="Write your RTI — what do you wish to know"
                                value={message}
                                onChange={e => setMessage(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    if (!disableSend) {
                                      setHasStartedConversation(true);
                                      handleSend(e);
                                    }
                                  }
                                }}
                                disabled={sending}
                                style={{ minHeight: '24px', maxHeight: '200px' }}
                              />
                            </div>

                            <div className="flex items-center gap-2 p-2">
                              <button
                                type="button"
                                onClick={isRecording ? stopRecording : startRecording}
                                className={`p-2 rounded-lg transition-colors duration-200 ${isRecording
                                  ? isDarkMode ? 'text-red-400 hover:text-red-300 hover:bg-gray-700' : 'text-red-500 hover:text-red-600 hover:bg-gray-100'
                                  : isDarkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                                  }`}
                                disabled={sending}
                              >
                                {isRecording ? (
                                  <WaveAnimation />
                                ) : (
                                  <MicrophoneIcon className="h-5 w-5" />
                                )}
                              </button>

                              <button
                                type="submit"
                                className={`p-2 rounded-lg transition-colors duration-200 ${disableSend
                                  ? isDarkMode ? 'text-gray-600' : 'text-gray-400'
                                  : isDarkMode ? 'text-gray-300 hover:text-white hover:bg-gray-700' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
                                  }`}
                                disabled={disableSend}
                              >
                                {sending ? (
                                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                                ) : (
                                  <SendIcon className="h-5 w-5" />
                                )}
                              </button>
                            </div>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}

                  <div className="space-y-6 pb-8">
                    {!loading && currentSession?.entries.map((entry) => (
                      <div key={entry.id} className="group">
                        <div className="flex gap-4 max-w-3xl mx-auto">
                          {/* Avatar */}
                          <div className="flex-shrink-0">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${entry.role === 'user'
                              ? 'bg-blue-500 text-white'
                              : isDarkMode
                                ? 'bg-gray-700 text-gray-300'
                                : 'bg-gray-200 text-gray-600'
                              }`}>
                              {entry.role === 'user' ? (
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                                </svg>
                              ) : (
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-6-3a2 2 0 11-4 0 2 2 0 014 0zm-2 4a5 5 0 00-4.546 2.916A5.986 5.986 0 0010 16a5.986 5.986 0 004.546-2.084A5 5 0 0010 11z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                          </div>

                          {/* Message content */}
                          <div className="flex-1 min-w-0">
                            <div className={`prose prose-sm max-w-none ${isDarkMode ? 'prose-invert' : ''
                              }`}>
                              <div className={`whitespace-pre-wrap leading-relaxed ${isDarkMode ? 'text-gray-100' : 'text-gray-900'
                                }`}>
                                {entry.text}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Input area - only show when not in empty state */}
            {!showEmptyState && (
              <div className={`border-t transition-colors duration-200 ${isDarkMode
                ? 'border-gray-700 bg-gray-800'
                : 'border-gray-200 bg-white'
                }`}>
                <div className="max-w-3xl mx-auto px-4 py-4">
                  <form onSubmit={e => {
                    e.preventDefault();
                    if (!disableSend) {
                      setHasStartedConversation(true);
                      handleSend(e);
                    }
                  }} className="relative">
                    <div className={`relative flex items-center gap-1 rounded-2xl border shadow-sm transition-all duration-200 ${isDarkMode
                      ? 'border-gray-600 bg-gray-800'
                      : 'border-gray-200 bg-white'
                      }`}>
                      <button
                        type="button"
                        onClick={handleFileAttach}
                        className={`pr-0 pl-1 py-2 rounded-lg transition-colors duration-200 ${isDarkMode
                          ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                          }`}
                        disabled={sending}
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                      </button>

                      <div className="flex-1 pl-1 pr-4 py-4">
                        <textarea
                          ref={textareaRef}
                          name="message"
                          id="message"
                          rows={1}
                          className={`w-full border-0 bg-transparent resize-none text-base leading-6 placeholder-gray-500 focus:outline-none ${isDarkMode
                            ? 'text-white'
                            : 'text-gray-900'
                            }`}
                          placeholder="Message RTI Dost..."
                          value={message}
                          onChange={e => setMessage(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              if (!disableSend) {
                                setHasStartedConversation(true);
                                handleSend(e);
                              }
                            }
                          }}
                          disabled={sending}
                          style={{ minHeight: '24px', maxHeight: '200px' }}
                        />
                      </div>

                      <div className="flex items-center gap-2 p-2">
                        <button
                          type="button"
                          onClick={isRecording ? stopRecording : startRecording}
                          className={`p-2 rounded-lg transition-colors duration-200 ${isRecording
                            ? isDarkMode ? 'text-red-400 hover:text-red-300 hover:bg-gray-700' : 'text-red-500 hover:text-red-600 hover:bg-gray-100'
                            : isDarkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                            }`}
                          disabled={sending}
                        >
                          {isRecording ? (
                            <WaveAnimation />
                          ) : (
                            <MicrophoneIcon className="h-5 w-5" />
                          )}
                        </button>

                        <button
                          type="submit"
                          className={`p-2 rounded-lg transition-colors duration-200 ${disableSend
                            ? isDarkMode ? 'text-gray-600' : 'text-gray-400'
                            : isDarkMode ? 'text-gray-300 hover:text-white hover:bg-gray-700' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
                            }`}
                          disabled={disableSend}
                        >
                          {sending ? (
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                          ) : (
                            <SendIcon className="h-5 w-5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Simple footer text - always at bottom */}
            <div className={`px-4 py-3 text-center transition-colors duration-200 ${isDarkMode ? 'text-gray-400 bg-gray-900' : 'text-gray-500 bg-white'}`}>
              <div className="text-xs space-y-2">
                <div>
                  © 2025 FileMyRTI.com | Built by Ranazonai Tech |
                  <button
                    type="button"
                    onClick={() => setShowPrivacyModal(true)}
                    className="hover:underline ml-1"
                  >
                    Privacy Policy
                  </button>
                </div>

              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Terms & Conditions Modal */}
      {showTermsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => setShowTermsModal(false)}
          />
          <div className={`relative max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg shadow-xl ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <div className="sticky top-0 flex items-center justify-between p-6 border-b bg-inherit">
              <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                FileMyRTI AI Bot — Terms & Conditions
              </h2>
              <button
                onClick={() => setShowTermsModal(false)}
                className={`p-2 rounded-lg transition-colors duration-200 ${isDarkMode
                  ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                <strong>Effective Date:</strong> 9th Sep 2025
              </p>

              <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                Welcome to FileMyRTI AI Bot ("we," "our," "us"). By using our AI-powered RTI drafting service available at filemyrti.com, you agree to the following Terms & Conditions. Please read carefully before proceeding.
              </p>

              <div className="space-y-4">
                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    1. Nature of Service
                  </h3>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    FileMyRTI AI Bot is a technology-enabled drafting assistant that helps users prepare Right to Information (RTI) applications.
                  </p>
                  <ul className={`text-sm mt-2 space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <li>• We are not a government portal and are not affiliated with any government department.</li>
                    <li>• The service provides draft RTI applications in legally accepted formats which you can:</li>
                    <li className="ml-4">- Download and file yourself, or</li>
                    <li className="ml-4">- Request us to file on your behalf (paid service).</li>
                  </ul>
                </div>

                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    2. Eligibility
                  </h3>
                  <ul className={`text-sm space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <li>• Only Indian citizens are legally permitted to file RTI applications under the RTI Act, 2005.</li>
                    <li>• By using this service, you confirm that you are an Indian citizen.</li>
                  </ul>
                </div>

                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    3. User Responsibilities
                  </h3>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    You agree to provide accurate and truthful information (name, address, email, phone number, details of your RTI request).
                  </p>
                  <p className={`text-sm mt-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    You agree not to misuse the service for:
                  </p>
                  <ul className={`text-sm mt-2 space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <li>• Submitting false or fraudulent information.</li>
                    <li>• Requesting information outside the scope of the RTI Act (e.g., personal questions, reasons, opinions, or exempted information under Section 8).</li>
                    <li>• Non-RTI related conversations (the bot is limited to RTI drafting only).</li>
                  </ul>
                </div>

                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    4. Drafting Limitations
                  </h3>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    The AI Bot uses advanced language models to generate RTI drafts. However:
                  </p>
                  <ul className={`text-sm mt-2 space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <li>• Drafts are suggestions and may require review for accuracy.</li>
                    <li>• You are responsible for ensuring correctness before submission.</li>
                    <li>• We do not guarantee acceptance of every RTI application by the concerned Public Authority.</li>
                  </ul>
                </div>

                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    5. Filing on Your Behalf
                  </h3>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    If you opt for paid filing:
                  </p>
                  <ul className={`text-sm mt-2 space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <li>• Payment will be processed securely through Razorpay or similar gateways.</li>
                    <li>• Once confirmed, an Application Number will be generated and sent to your email.</li>
                    <li>• We commit to filing your RTI with the appropriate Public Information Officer (PIO) within 24 hours (excluding Sundays/holidays).</li>
                  </ul>
                </div>

                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    6. Refunds & Cancellations
                  </h3>
                  <ul className={`text-sm space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <li>• Draft downloads are free.</li>
                    <li>• Paid filing service is non-refundable once the application is submitted to the authority.</li>
                    <li>• If your payment is processed but filing cannot be completed due to reasons attributable to us, a full refund will be issued.</li>
                  </ul>
                </div>

                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    7. Limitation of Liability
                  </h3>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    We are not liable for:
                  </p>
                  <ul className={`text-sm mt-2 space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <li>• Delays or failures by government departments in responding to RTI applications.</li>
                    <li>• Rejection of RTI applications by the PIO.</li>
                    <li>• Losses arising from user-provided incorrect/incomplete information.</li>
                  </ul>
                </div>

                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    8. Intellectual Property
                  </h3>
                  <ul className={`text-sm space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <li>• All content, design, and technology of FileMyRTI are protected by copyright and intellectual property laws.</li>
                    <li>• You may use drafts generated solely for your personal RTI purposes.</li>
                  </ul>
                </div>

                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    9. Modifications
                  </h3>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    We reserve the right to update these Terms & Conditions at any time. Updates will be posted on this page with a revised effective date.
                  </p>
                </div>

                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    10. Governing Law
                  </h3>
                  <ul className={`text-sm space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <li>• These Terms shall be governed by and construed in accordance with the laws of India.</li>
                    <li>• Jurisdiction: Hyderabad, Telangana.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Privacy Policy Modal */}
      {showPrivacyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => setShowPrivacyModal(false)}
          />
          <div className={`relative max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg shadow-xl ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <div className="sticky top-0 flex items-center justify-between p-6 border-b bg-inherit">
              <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                FileMyRTI AI Bot — Privacy Policy
              </h2>
              <button
                onClick={() => setShowPrivacyModal(false)}
                className={`p-2 rounded-lg transition-colors duration-200 ${isDarkMode
                  ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                <strong>Effective Date:</strong> 9th Sep 2025
              </p>

              <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                At FileMyRTI, your privacy is important to us. This Privacy Policy explains how we collect, use, and safeguard your data when you use our AI Bot.
              </p>

              <div className="space-y-4">
                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    1. Information We Collect
                  </h3>
                  <ul className={`text-sm space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <li>• <strong>Personal Information:</strong> Name, email, phone number, postal address (for drafting RTI applications).</li>
                    <li>• <strong>RTI Application Details:</strong> Information you request under RTI (application numbers, department names, etc.).</li>
                    <li>• <strong>Payment Information:</strong> Processed securely via third-party gateways (we do not store card/UPI details).</li>
                    <li>• <strong>Usage Data:</strong> Device type, IP address, browser type, and interaction logs for security and analytics.</li>
                  </ul>
                </div>

                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    2. How We Use Your Information
                  </h3>
                  <ul className={`text-sm space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <li>• To generate RTI drafts accurately.</li>
                    <li>• To process and confirm payments (if you choose paid filing).</li>
                    <li>• To file your RTI with the correct authority.</li>
                    <li>• To send confirmation emails, updates, and tracking numbers.</li>
                    <li>• To improve our AI bot's accuracy and user experience.</li>
                  </ul>
                </div>

                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    3. Data Sharing
                  </h3>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    We do not sell or rent your personal data.
                  </p>
                  <p className={`text-sm mt-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    Your details are shared only with:
                  </p>
                  <ul className={`text-sm mt-2 space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <li>• The relevant government authority (for filing your RTI).</li>
                    <li>• Payment gateways (for secure transaction processing).</li>
                    <li>• Internal staff/RTI experts who handle filing are bound by strict confidentiality.</li>
                  </ul>
                </div>

                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    4. Data Security
                  </h3>
                  <ul className={`text-sm space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <li>• All data is encrypted during transmission (HTTPS/TLS).</li>
                    <li>• Stored data is protected with access controls and periodic audits.</li>
                    <li>• Draft RTI chats may be anonymized and used for service improvement.</li>
                  </ul>
                </div>

                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    5. Your Rights
                  </h3>
                  <ul className={`text-sm space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <li>• You may request deletion of your account and data at any time by contacting us.</li>
                    <li>• You may request a copy of your stored RTI drafts and submissions.</li>
                  </ul>
                </div>

                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    6. Data Retention
                  </h3>
                  <ul className={`text-sm space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <li>• RTI drafts and user details are retained for 90 days to allow tracking and appeals, after which they may be deleted or anonymized.</li>
                    <li>• Payment and legal compliance data may be retained as per applicable laws.</li>
                  </ul>
                </div>

                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    7. Third-Party Links
                  </h3>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    Our platform may contain links to official government RTI portals or blogs. We are not responsible for the privacy practices of external sites.
                  </p>
                </div>

                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    8. Changes to Policy
                  </h3>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    We may update this Privacy Policy periodically. Changes will be posted on this page with the revised date.
                  </p>
                </div>

                <div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    9. Contact Us
                  </h3>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    For questions or requests about this policy, contact:
                  </p>
                  <ul className={`text-sm mt-2 space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <li>• 📧 admin@filemyrti.com</li>
                    <li>• 📍 Hyderabad, Telangana, India</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
