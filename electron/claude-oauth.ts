import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { shell, BrowserWindow } from 'electron';

function findClaudeBinary(): string {
  const extDir = path.join(os.homedir(), '.vscode', 'extensions');
  if (fs.existsSync(extDir)) {
    const dirs = fs.readdirSync(extDir)
      .filter(d => d.startsWith('anthropic.claude-code-'))
      .sort()
      .reverse();
    for (const d of dirs) {
      const bin = path.join(extDir, d, 'resources', 'native-binary', 'claude');
      if (fs.existsSync(bin)) return bin;
    }
  }
  throw new Error('Claude Code binary not found. Install the Claude Code VS Code extension.');
}

function getAuthUrl(proc: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(
      () => reject(new Error('Timeout: binary did not print auth URL')),
      15_000
    );
    proc.stdout!.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const match = buf.match(/https?:\/\/\S+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      if (code !== 0) { clearTimeout(timer); reject(new Error(`Binary exited (${code}) before URL`)); }
    });
  });
}

function waitingHTML(authUrl: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#1e1e1e;color:#e0e0e0;
  display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{text-align:center;padding:2rem;max-width:440px;width:100%}
h2{margin:0 0 .4rem;font-size:1.05rem}
p{color:#888;font-size:.83rem;margin:0 0 1rem;line-height:1.5}
.spinner{width:32px;height:32px;border:3px solid #444;border-top-color:#b87140;border-radius:50%;
  animation:spin .8s linear infinite;margin:0 auto 1rem}
@keyframes spin{to{transform:rotate(360deg)}}
.open{display:inline-block;padding:.55rem 1.2rem;border-radius:8px;border:none;
  background:#b87140;color:#fff;font-size:.85rem;cursor:pointer;margin-bottom:1rem}
.open:hover{background:#cc8248}
.url-row{display:flex;gap:.4rem;margin-bottom:.8rem}
.url-input{flex:1;padding:.5rem;border-radius:6px;border:1px solid #444;background:#2a2a2a;
  color:#888;font-size:.72rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.copy-btn{padding:.5rem .75rem;border-radius:6px;border:1px solid #555;background:#2a2a2a;
  color:#aaa;font-size:.78rem;cursor:pointer;white-space:nowrap}
.copy-btn:hover{background:#3a3a3a}
.sep{color:#555;font-size:.75rem;margin:.6rem 0}
input[type=text]{width:100%;padding:.65rem;border-radius:6px;border:1px solid #444;
  background:#2a2a2a;color:#fff;font-size:.9rem;margin-bottom:.7rem;text-align:center}
.ok{display:block;width:100%;padding:.65rem;border-radius:6px;border:none;
  background:#3a3a3a;color:#ccc;font-size:.88rem;cursor:pointer}
.ok:hover{background:#4a4a4a}
.back{display:block;width:100%;padding:.5rem;border-radius:6px;border:none;
  background:transparent;color:#666;font-size:.82rem;cursor:pointer;margin-top:.4rem}
.back:hover{color:#aaa}
.status{margin-top:.7rem;font-size:.82rem;min-height:1.1rem}
</style></head><body>
<div class="box">
  <div class="spinner"></div>
  <h2>Aguardando autorização…</h2>
  <p>Complete o login no browser.<br>Se o browser não abriu:</p>
  <div class="url-row">
    <input class="url-input" type="text" value="${authUrl.replace(/"/g, '&quot;')}" readonly />
    <button class="copy-btn" onclick="copyUrl()">Copiar</button>
  </div>
  <button class="open" onclick="openBrowser()">Abrir no Browser</button>
  <div class="sep">— se o redirect não funcionou, cole o código abaixo —</div>
  <input type="text" id="inp" placeholder="código de autorização (opcional)" />
  <button class="ok" onclick="go()">Confirmar código</button>
  <button class="back" onclick="window.location.href='koda-cancel://'">Cancelar</button>
  <div class="status" id="st"></div>
</div>
<script>
var AUTH_URL=${JSON.stringify(authUrl)};
function openBrowser(){ window.location.href='koda-open-url://'+encodeURIComponent(AUTH_URL); }
function copyUrl(){
  navigator.clipboard.writeText(AUTH_URL)
    .then(function(){st('URL copiada!','#4caf50')})
    .catch(function(){st('Não foi possível copiar','#f44336')});
}
function go(){
  var raw=(document.getElementById('inp').value||'').trim();
  if(!raw){st('Cole o código primeiro.','#f44336');return}
  var code=raw;
  try{var u=new URL(raw);var q=u.searchParams.get('code');if(q)code=q;}catch(e){}
  if(!code){st('Código inválido.','#f44336');return}
  st('Verificando...','#888');
  window.location.href='koda-submit://?c='+encodeURIComponent(code);
}
function st(msg,color){var el=document.getElementById('st');el.textContent=msg;el.style.color=color}
document.getElementById('inp').addEventListener('keydown',function(e){if(e.key==='Enter')go()});
</script>
</body></html>`;
}

export async function startClaudeLogin(): Promise<void> {
  const binaryPath = findClaudeBinary();

  const proc = spawn(binaryPath, ['auth', 'login'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Get URL from binary stdout before showing the window
  let authUrl: string;
  try {
    authUrl = await getAuthUrl(proc);
  } catch (err) {
    proc.kill();
    throw err;
  }

  return new Promise<void>((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 420,
      resizable: false,
      title: 'Login com Claude — KODA',
      webPreferences: { nodeIntegration: false, contextIsolation: false },
    });

    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (proc) try { proc.kill(); } catch {}
      try { win.destroy(); } catch {}
      if (err) reject(err);
      else resolve();
    };

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(waitingHTML(authUrl))}`);

    // Primary: binary auto-completes via its local redirect server
    proc.on('close', (exitCode) => {
      if (exitCode === 0) done();
      else if (exitCode !== null) done(new Error(`Token exchange failed (exit ${exitCode})`));
    });
    proc.on('error', (err) => done(err));

    win.webContents.on('will-navigate', (e, url) => {
      e.preventDefault();

      if (url.startsWith('koda-open-url://')) {
        shell.openExternal(decodeURIComponent(url.slice('koda-open-url://'.length)));
        return;
      }

      if (url.startsWith('koda-submit://') && !settled) {
        const code = decodeURIComponent(new URL(url).searchParams.get('c') ?? '');
        if (code) {
          try { proc.stdin!.write(code + '\n'); proc.stdin!.end(); } catch {}
        }
        return;
      }

      if (url.startsWith('koda-cancel://')) {
        done(new Error('Login cancelado pelo usuário'));
      }
    });

    win.on('closed', () => {
      if (!settled) done(new Error('Login cancelado pelo usuário'));
    });

    setTimeout(() => done(new Error('Timeout: login não completado em 5 minutos')), 5 * 60 * 1000);
  });
}
