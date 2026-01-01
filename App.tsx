
import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { AuthPage } from './components/AuthPage';
import { SettingsModal } from './components/SettingsModal';
import { Workspace } from './components/Workspace';
import { User, ChatSession, Message, AppView } from './types';
import { sendMessageToGemini } from './services/geminiService';
import { Terminal, Code, Cpu, ShieldCheck, Plus, Sparkles, Menu } from 'lucide-react';
import { supabase } from './services/supabase';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [view, setView] = useState<AppView>('chat');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-hide sidebar on small screens
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setIsSidebarOpen(false);
      } else {
        setIsSidebarOpen(true);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setUser({
          email: session.user.email || '',
          name: session.user.user_metadata.full_name || 'User'
        });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setUser({
          email: session.user.email || '',
          name: session.user.user_metadata.full_name || 'User'
        });
      } else {
        setUser(null);
        setSessions([]);
        setCurrentSessionId(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const fetchSessions = async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) {
        console.error("Error fetching sessions:", error);
      } else {
        setSessions(data as ChatSession[]);
        if (data.length > 0 && !currentSessionId) {
          setCurrentSessionId(data[0].id);
        }
      }
    };

    fetchSessions();
  }, [user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, currentSessionId, isLoading, view]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const saveSessionToSupabase = async (session: ChatSession) => {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) return;

    try {
      const { error } = await supabase
        .from('sessions')
        .upsert({
          id: session.id,
          user_id: currentUser.id,
          title: session.title,
          messages: session.messages,
          updated_at: new Date().toISOString()
        });

      if (error) throw error;
    } catch (err) {
      console.error("Error saving to Supabase:", err);
    }
  };

  const handleNewChat = () => {
    setView('chat');
    const id = crypto.randomUUID();
    const newSession: ChatSession = {
      id,
      title: 'New Chat',
      messages: [],
      updatedAt: Date.now(),
    };
    setCurrentSessionId(id);
    setSessions(prev => [newSession, ...prev]);
    saveSessionToSupabase(newSession);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const currentSession = sessions.find(s => s.id === currentSessionId);

  const handleSendMessage = async (content: string) => {
    let activeSessionId = currentSessionId;
    
    if (!activeSessionId) {
      activeSessionId = crypto.randomUUID();
      const newSession: ChatSession = {
        id: activeSessionId,
        title: content.slice(0, 30) + '...',
        messages: [],
        updatedAt: Date.now(),
      };
      setSessions([newSession, ...sessions]);
      setCurrentSessionId(activeSessionId);
      await saveSessionToSupabase(newSession);
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    const targetSession = sessions.find(s => s.id === activeSessionId) || {
      id: activeSessionId,
      title: content.slice(0, 30),
      messages: [],
      updatedAt: Date.now()
    };

    const updatedSession = {
      ...targetSession,
      messages: [...targetSession.messages, userMessage],
      updatedAt: Date.now(),
      title: targetSession.messages.length === 0 ? content.slice(0, 30) : targetSession.title
    };

    setSessions(prev => prev.map(s => s.id === activeSessionId ? updatedSession : s));
    setIsLoading(true);

    try {
      const aiResponseText = await sendMessageToGemini(updatedSession.messages, content);

      const aiMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: aiResponseText,
        timestamp: Date.now(),
      };

      const finalSession = {
        ...updatedSession,
        messages: [...updatedSession.messages, aiMessage],
        updatedAt: Date.now()
      };

      setSessions(prev => prev.map(s => s.id === activeSessionId ? finalSession : s));
      await saveSessionToSupabase(finalSession);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div className="flex h-screen w-full bg-gray-950 overflow-hidden text-gray-100">
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={(id) => { 
          setView('chat'); 
          setCurrentSessionId(id);
          if (window.innerWidth < 768) setIsSidebarOpen(false);
        }}
        onNewChat={handleNewChat}
        user={user}
        onSignOut={handleSignOut}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenWorkspace={() => {
          setView('workspace');
          if (window.innerWidth < 768) setIsSidebarOpen(false);
        }}
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      <main className={`flex-1 flex flex-col h-full overflow-hidden relative transition-all duration-300 ${isSidebarOpen && window.innerWidth >= 768 ? 'ml-0' : 'ml-0'}`}>
        {view === 'workspace' ? (
          <Workspace onBack={() => setView('chat')} />
        ) : (
          <>
            {/* Main Chat Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gray-950/80 backdrop-blur-md border-b border-gray-800 sticky top-0 z-20">
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                  className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-400 transition-colors"
                  aria-label="Toggle Sidebar"
                >
                  <Menu size={20} />
                </button>
                <div className="hidden sm:block">
                   <Terminal className="text-indigo-500" size={20} />
                </div>
                <h1 className="text-sm font-semibold text-gray-300 truncate max-w-[150px] sm:max-w-[300px] md:max-w-none">
                  {currentSession?.title || 'CodeGPT Assistant'}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleNewChat}
                  className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-400"
                >
                  <Plus size={20} />
                </button>
                <div className="flex items-center gap-1.5 px-2 py-1 bg-indigo-600/10 text-indigo-400 rounded-full text-[10px] font-bold border border-indigo-500/20">
                  <Sparkles size={10} />
                  PRO
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {(!currentSession || currentSession.messages.length === 0) ? (
                <div className="h-full flex flex-col items-center justify-center p-8 space-y-12">
                  <div className="text-center space-y-4">
                    <div className="w-16 h-16 bg-indigo-600 rounded-2xl mx-auto flex items-center justify-center shadow-indigo-500/20 shadow-2xl">
                      <Terminal className="text-white" size={32} />
                    </div>
                    <h1 className="text-4xl font-bold tracking-tight text-white">CodeGPT</h1>
                    <p className="text-gray-400 max-w-sm mx-auto text-sm leading-relaxed">
                      Your high-end coding partner. Specialized for all stacks.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl w-full">
                    <div className="p-6 bg-gray-900/40 border border-gray-800 hover:border-indigo-500/50 transition-all rounded-2xl space-y-3 group cursor-pointer" onClick={() => handleSendMessage("Create a fastify server with typescript")}>
                      <Code className="text-emerald-400 group-hover:scale-110 transition-transform" size={24} />
                      <h3 className="font-medium text-white text-sm">Create Backend</h3>
                      <p className="text-[11px] text-gray-500">Fastify, Node, or Go server boilerplates.</p>
                    </div>
                    <div className="p-6 bg-gray-900/40 border border-gray-800 hover:border-indigo-500/50 transition-all rounded-2xl space-y-3 group cursor-pointer" onClick={() => handleSendMessage("Refactor this React code for performance")}>
                      <Cpu className="text-indigo-400 group-hover:scale-110 transition-transform" size={24} />
                      <h3 className="font-medium text-white text-sm">Refactor</h3>
                      <p className="text-[11px] text-gray-500">Optimize logic and improve scalability.</p>
                    </div>
                    <div className="p-6 bg-gray-900/40 border border-gray-800 hover:border-indigo-500/50 transition-all rounded-2xl space-y-3 group cursor-pointer" onClick={() => handleSendMessage("Help me debug this stacktrace")}>
                      <ShieldCheck className="text-rose-400 group-hover:scale-110 transition-transform" size={24} />
                      <h3 className="font-medium text-white text-sm">Debug Logic</h3>
                      <p className="text-[11px] text-gray-500">Solve cryptic errors and memory leaks.</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="pb-32">
                  {currentSession.messages.map((msg) => (
                    <ChatMessage key={msg.id} message={msg} />
                  ))}
                  {isLoading && (
                    <div className="w-full py-8 bg-gray-800/20">
                      <div className="max-w-3xl mx-auto flex gap-6 px-4 md:px-0">
                        <div className="w-8 h-8 rounded shrink-0 bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-500">
                          <Terminal size={18} />
                        </div>
                        <div className="flex gap-1.5 items-center mt-3">
                          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            <ChatInput onSend={handleSendMessage} disabled={isLoading} />
          </>
        )}
      </main>

      {/* Mobile Backdrop */}
      {isSidebarOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-30" 
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        userEmail={user.email}
      />
    </div>
  );
};

export default App;
