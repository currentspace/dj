import { useState } from "react";

interface TestResult {
  data: any;
  error?: string;
  success: boolean;
}

export function TestPage() {
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [chatMessage, setChatMessage] = useState(
    "Hi! Can you help me create a chill playlist?"
  );
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const apiBase = import.meta.env.DEV ? "http://localhost:8787" : "";

  const runTest = async (testName: string, testFn: () => Promise<any>) => {
    setLoading((prev) => ({ ...prev, [testName]: true }));

    try {
      const data = await testFn();
      setResults((prev) => ({
        ...prev,
        [testName]: { data, success: true },
      }));
    } catch (error) {
      setResults((prev) => ({
        ...prev,
        [testName]: {
          data: null,
          error: error instanceof Error ? error.message : "Unknown error",
          success: false,
        },
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [testName]: false }));
    }
  };

  const testHealth = () =>
    runTest("health", async () => {
      const response = await fetch(`${apiBase}/health`);
      return response.json();
    });

  const testEnv = () =>
    runTest("env", async () => {
      const response = await fetch(`${apiBase}/api/test/env`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });

  const testAnthropicDirect = () =>
    runTest("anthropic", async () => {
      const response = await fetch(`${apiBase}/api/test/anthropic`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });

  const testChat = () =>
    runTest("chat", async () => {
      if (!chatMessage.trim()) throw new Error("Please enter a message");

      const response = await fetch(`${apiBase}/api/chat/message`, {
        body: JSON.stringify({
          conversationHistory: [],
          message: chatMessage.trim(),
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });

  const testSpotifyAuthUrl = () =>
    runTest("spotify-auth", async () => {
      const response = await fetch(`${apiBase}/api/spotify/auth-url`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });

  const renderResult = (testName: string) => {
    const result = results[testName];
    const isLoading = loading[testName];

    if (isLoading) {
      return <div className="result loading">Testing...</div>;
    }

    if (!result) {
      return <div className="result">Click button to test</div>;
    }

    return (
      <div className={`result ${result.success ? "success" : "error"}`}>
        {result.success ? (
          <pre>{JSON.stringify(result.data, null, 2)}</pre>
        ) : (
          <div>Error: {result.error}</div>
        )}
      </div>
    );
  };

  return (
    <div className="test-page">
      <div className="test-header">
        <h1>🧪 DJ Worker API Tests</h1>
        <p>
          Test the worker functionality locally without Spotify authentication
        </p>
      </div>

      <div className="test-section">
        <h2>Health Check</h2>
        <button disabled={loading.health} onClick={testHealth}>
          Test Health Endpoint
        </button>
        {renderResult("health")}
      </div>

      <div className="test-section">
        <h2>Environment Variables</h2>
        <button disabled={loading.env} onClick={testEnv}>
          Check Environment
        </button>
        {renderResult("env")}
      </div>

      <div className="test-section">
        <h2>Direct Anthropic API Test</h2>
        <button disabled={loading.anthropic} onClick={testAnthropicDirect}>
          Test Anthropic API
        </button>
        {renderResult("anthropic")}
      </div>

      <div className="test-section">
        <h2>Chat with AI (Langchain + Anthropic)</h2>
        <div className="chat-test">
          <textarea
            onChange={(e) => setChatMessage(e.target.value)}
            placeholder="Type a message to test the AI chat..."
            rows={3}
            value={chatMessage}
          />
          <button
            disabled={loading.chat || !chatMessage.trim()}
            onClick={testChat}
          >
            Send Chat Message
          </button>
        </div>
        {renderResult("chat")}
      </div>

      <div className="test-section">
        <h2>Spotify Auth URL (No Auth Required)</h2>
        <button disabled={loading["spotify-auth"]} onClick={testSpotifyAuthUrl}>
          Get Spotify Auth URL
        </button>
        {renderResult("spotify-auth")}
      </div>

      <style>{`
        .test-page {
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
        }

        .test-header {
          text-align: center;
          margin-bottom: 2rem;
        }

        .test-header h1 {
          color: #1db954;
          margin-bottom: 0.5rem;
        }

        .test-section {
          margin: 2rem 0;
          padding: 1.5rem;
          background: #2a2a2a;
          border-radius: 12px;
          border: 1px solid #333;
        }

        .test-section h2 {
          margin-top: 0;
          color: #e0e0e0;
          font-size: 1.2rem;
        }

        button {
          background: #1db954;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.9rem;
          margin: 5px;
          transition: all 0.2s ease;
        }

        button:hover:not(:disabled) {
          background: #1ed760;
          transform: translateY(-1px);
        }

        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }

        textarea {
          width: 100%;
          min-height: 80px;
          background: #333;
          color: white;
          border: 1px solid #555;
          border-radius: 6px;
          padding: 10px;
          font-family: inherit;
          resize: vertical;
          margin-bottom: 10px;
        }

        textarea:focus {
          outline: none;
          border-color: #1db954;
        }

        .chat-test {
          display: flex;
          flex-direction: column;
        }

        .result {
          background: #333;
          padding: 15px;
          border-radius: 6px;
          margin-top: 15px;
          border-left: 4px solid #555;
        }

        .result.loading {
          border-left-color: #ffa500;
          color: #ffa500;
        }

        .result.error {
          border-left-color: #ff4444;
          background: #2a1a1a;
          color: #ff8888;
        }

        .result.success {
          border-left-color: #1db954;
          background: #1a2a1a;
        }

        .result pre {
          white-space: pre-wrap;
          word-wrap: break-word;
          margin: 0;
          font-size: 0.85rem;
          color: #e0e0e0;
        }
      `}</style>
    </div>
  );
}
