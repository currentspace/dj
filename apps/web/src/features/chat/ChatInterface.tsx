import { useState, useRef, useEffect } from 'react';
import type { ChatMessage, ChatResponse } from '@dj/shared-types';

interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  external_urls: {
    spotify: string;
  };
  images: Array<{
    url: string;
    height: number;
    width: number;
  }>;
  tracks: {
    total: number;
  };
  public: boolean;
  owner: {
    display_name: string;
  };
}

interface ChatInterfaceProps {
  selectedPlaylist: SpotifyPlaylist;
  onPlaylistModified?: () => void;
}

export function ChatInterface({ selectedPlaylist, onPlaylistModified }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: `Hey! I'm your AI DJ assistant. I can help you modify "${selectedPlaylist.name}" by adding or removing songs. Tell me what you'd like to add or remove, or ask me to suggest similar tracks!`
    }
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setIsLoading(true);

    // Add user message immediately
    const newMessages = [...messages, { role: 'user' as const, content: userMessage }];
    setMessages(newMessages);

    try {
      const response = await fetch('/api/chat/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(localStorage.getItem('spotify_token') && {
            'Authorization': `Bearer ${localStorage.getItem('spotify_token')}`
          })
        },
        body: JSON.stringify({
          message: userMessage,
          conversationHistory: messages,
          selectedPlaylistId: selectedPlaylist.id,
          mode: 'edit' // Indicate this is playlist editing mode
        })
      });

      if (!response.ok) {
        throw new Error(`Chat failed: ${response.statusText}`);
      }

      const chatResponse: ChatResponse = await response.json();

      // Update messages with the full conversation history
      setMessages(chatResponse.conversationHistory);

      // If playlist was modified, notify parent component
      if (chatResponse.playlistModified && onPlaylistModified) {
        onPlaylistModified();
      }

    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Something went wrong';

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `Sorry, I encountered an error: ${errorMessage}. Please try again!`
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="chat-interface">
      <div className="chat-header">
        <h2>🎵 Editing: {selectedPlaylist.name}</h2>
        <p>Chat with your AI DJ to add or remove songs from this playlist</p>
      </div>

      <div className="chat-messages">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`message ${message.role === 'user' ? 'user-message' : 'assistant-message'}`}
          >
            <div className="message-content">
              {message.content}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="message assistant-message">
            <div className="message-content loading">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
              Thinking about your music...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input">
        <div className="input-container">
          <textarea
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Add or remove songs... (e.g., 'Add some Taylor Swift songs' or 'Remove the slow songs')"
            rows={2}
            disabled={isLoading}
            className="message-input"
          />
          <button
            onClick={sendMessage}
            disabled={!inputMessage.trim() || isLoading}
            className="send-button"
          >
            {isLoading ? '⏳' : '🎵'}
          </button>
        </div>
      </div>

      <style>{`
        .chat-interface {
          display: flex;
          flex-direction: column;
          height: 600px;
          border: 1px solid #333;
          border-radius: 12px;
          overflow: hidden;
          background: #1a1a1a;
        }

        .chat-header {
          padding: 1rem;
          background: linear-gradient(135deg, #1db954 0%, #1ed760 100%);
          color: white;
          text-align: center;
        }

        .chat-header h2 {
          margin: 0 0 0.5rem 0;
          font-size: 1.25rem;
        }

        .chat-header p {
          margin: 0;
          opacity: 0.9;
          font-size: 0.875rem;
        }

        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .message {
          display: flex;
          max-width: 80%;
        }

        .user-message {
          align-self: flex-end;
        }

        .assistant-message {
          align-self: flex-start;
        }

        .message-content {
          padding: 0.75rem 1rem;
          border-radius: 18px;
          line-height: 1.4;
        }

        .user-message .message-content {
          background: #1db954;
          color: white;
        }

        .assistant-message .message-content {
          background: #333;
          color: #e0e0e0;
        }

        .loading {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .typing-indicator {
          display: flex;
          gap: 3px;
        }

        .typing-indicator span {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: #1db954;
          animation: typing 1.4s infinite ease-in-out;
        }

        .typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
        .typing-indicator span:nth-child(2) { animation-delay: -0.16s; }

        @keyframes typing {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }

        .chat-input {
          padding: 1rem;
          border-top: 1px solid #333;
          background: #1a1a1a;
        }

        .input-container {
          display: flex;
          gap: 0.5rem;
          align-items: flex-end;
        }

        .message-input {
          flex: 1;
          padding: 0.75rem;
          border: 1px solid #333;
          border-radius: 12px;
          background: #2a2a2a;
          color: white;
          resize: none;
          font-family: inherit;
          font-size: 0.875rem;
        }

        .message-input:focus {
          outline: none;
          border-color: #1db954;
        }

        .message-input::placeholder {
          color: #666;
        }

        .send-button {
          padding: 0.75rem 1rem;
          border: none;
          border-radius: 12px;
          background: #1db954;
          color: white;
          font-size: 1.2rem;
          cursor: pointer;
          transition: all 0.2s ease;
          min-width: 48px;
        }

        .send-button:hover:not(:disabled) {
          background: #1ed760;
          transform: translateY(-1px);
        }

        .send-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }

        .chat-messages::-webkit-scrollbar {
          width: 6px;
        }

        .chat-messages::-webkit-scrollbar-track {
          background: #1a1a1a;
        }

        .chat-messages::-webkit-scrollbar-thumb {
          background: #333;
          border-radius: 3px;
        }

        .chat-messages::-webkit-scrollbar-thumb:hover {
          background: #444;
        }
      `}</style>
    </div>
  );
}