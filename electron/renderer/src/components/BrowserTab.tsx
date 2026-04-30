import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Terminal } from 'lucide-react';

interface OutputLine { text: string; type: string }

interface Props {
  projectRoot: string | null;
}

export default function BrowserTab({ projectRoot }: Props) {
  const [command, setCommand] = useState(() => localStorage.getItem('startCommand') ?? 'npm run dev');
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [inputUrl, setInputUrl] = useState('http://localhost:3000');
  const [browserUrl, setBrowserUrl] = useState('about:blank');
  const [showTerminal, setShowTerminal] = useState(false);
  const outputEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.api.onShellOutput((data, type) => {
      setOutput(prev => [...prev, { text: data, type }]);
      // auto-detect port from output lines like ":3000", "localhost:5173", etc.
      const m = data.match(/https?:\/\/localhost:(\d+)/i) ?? data.match(/localhost:(\d{4,5})/i) ?? data.match(/ on port (\d{4,5})/i);
      if (m) {
        const detected = `http://localhost:${m[1]}`;
        setInputUrl(detected);
        setBrowserUrl(detected);
      }
    });
    window.api.onShellDone(code => {
      setIsRunning(false);
      setOutput(prev => [...prev, { text: `\nProcess exited (code ${code ?? '?'})\n`, type: 'info' }]);
    });
    return () => window.api.offShell();
  }, []);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [output]);

  function run() {
    if (!projectRoot || isRunning) return;
    localStorage.setItem('startCommand', command);
    setOutput([{ text: `$ ${command}\n`, type: 'info' }]);
    setIsRunning(true);
    setShowTerminal(true);
    window.api.runShell(projectRoot, command);
  }

  async function stop() {
    await window.api.killShell();
    setIsRunning(false);
  }

  function navigate() {
    setBrowserUrl(inputUrl);
  }

  return (
    <div className="browser-view">
      {/* start command bar */}
      <div className="browser-command-bar">
        <span className="browser-label"><Play size={12} strokeWidth={0} fill="currentColor" /></span>
        <input
          className="browser-command-input"
          value={command}
          onChange={e => setCommand(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') run(); }}
          placeholder="npm run dev"
          disabled={isRunning}
        />
        {isRunning ? (
          <button className="browser-stop-btn" onClick={stop}><Square size={10} strokeWidth={0} fill="currentColor" /> Stop</button>
        ) : (
          <button className="browser-run-btn" onClick={run} disabled={!projectRoot}>
            Run
          </button>
        )}
        <button
          className={`browser-terminal-btn ${showTerminal ? 'active' : ''}`}
          onClick={() => setShowTerminal(v => !v)}
          title="Toggle terminal output"
        >
          <Terminal size={13} strokeWidth={2} />
        </button>
      </div>

      {/* url bar */}
      <div className="browser-bar">
        <input
          className="browser-url-input"
          value={inputUrl}
          onChange={e => setInputUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') navigate(); }}
          placeholder="http://localhost:3000"
        />
        <button className="browser-go-btn" onClick={navigate}>Go</button>
      </div>

      {/* terminal output */}
      {showTerminal && (
        <div className="browser-terminal">
          {output.map((line, i) => (
            <span key={i} className={`term-${line.type}`}>{line.text}</span>
          ))}
          <div ref={outputEndRef} />
        </div>
      )}

      {/* preview */}
      {browserUrl === 'about:blank' ? (
        <div className="browser-placeholder">
          <div className="browser-placeholder-text">
            <span>Run your project and the preview will appear here</span>
            {!projectRoot && <span className="browser-hint">Open a project folder first</span>}
          </div>
        </div>
      ) : (
        <iframe
          src={browserUrl}
          className="browser-frame"
          title="App preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
        />
      )}
    </div>
  );
}
