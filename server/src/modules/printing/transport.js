// Getting the bytes to the printer.
//
// Three ways, because the three desks will not have the same hardware:
//   reseau  — an Ethernet/Wi-Fi printer, raw socket on port 9100. The one to
//             prefer: nothing to install, works from any machine on the LAN.
//   windows — a USB printer installed on the machine running this server; the
//             bytes are pushed into its spool queue as a RAW job.
//   fichier — write the bytes to a file. For diagnosing a layout without
//             wasting paper, and for a printer mapped to a COM/LPT port.
//
// Note what is NOT here: a native USB module. node-thermal-printer can drive one
// through @thiagoelg/node-printer, but that package compiles C++ at install time
// and needs Visual Studio — unrealistic on a shop counter PC. The Windows
// spooler route below reaches exactly the same printers with nothing to build.
import net from 'node:net';
import { spawn } from 'node:child_process';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, errors } from '../../lib/AppError.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PS_SCRIPT = join(__dirname, 'raw-print.ps1');

// A PowerShell failure arrives as a multi-line block that opens with the script
// path and buries the real cause inside nested quotes:
//   ...\raw-print.ps1 : Exception calling "SendFile" with "3" argument(s):
//   "OpenPrinter a echoue (code Windows 1801)"
// Only that last part is worth showing - 1801 means the printer name is wrong,
// which is something the user can actually act on.
function cleanPsError(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  const inner = flat.match(/argument\(s\): "([^"]+)"/);
  if (inner) return inner[1];
  return flat.replace(/^\S+\.ps1 : /, '').slice(0, 200);
}

// Run a PowerShell script and collect its output. -NoProfile keeps a user's
// profile from printing banners into stdout; -NonInteractive makes sure it can
// never sit waiting for an answer nobody will type.
function powershell(args, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], { windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { ps.kill(); reject(new Error('PowerShell : délai dépassé.')); }, timeout);
    ps.stdout.on('data', (d) => { out += d; });
    ps.stderr.on('data', (d) => { err += d; });
    ps.on('error', (e) => { clearTimeout(timer); reject(e); });
    ps.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(cleanPsError(err || out) || `PowerShell a quitte avec le code ${code}.`));
    });
  });
}

// Printers installed on the machine running the server, for the settings page.
// Returns [] rather than throwing on a non-Windows host — the caller shows an
// empty list and the name can still be typed by hand.
export async function listWindowsPrinters() {
  if (process.platform !== 'win32') return [];
  try {
    const json = await powershell([
      '-Command',
      'Get-Printer | Select-Object Name,DriverName,PortName,Shared,@{n="Status";e={$_.PrinterStatus.ToString()}} | ConvertTo-Json -Compress',
    ]);
    if (!json) return [];
    const parsed = JSON.parse(json);
    // ConvertTo-Json emits an object, not an array, when there is exactly one.
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

// ── reseau ──────────────────────────────────────────────────────────
export function sendTcp(buffer, { hote, port = 9100, timeout = 8000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: hote, port: Number(port) });
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      socket.destroy();
      err ? reject(err) : resolve(`${buffer.length} octets envoyés à ${hote}:${port}`);
    };
    socket.setTimeout(timeout);
    socket.on('timeout', () => finish(new Error(`Aucune réponse de ${hote}:${port}.`)));
    socket.on('error', (e) => finish(new Error(`Connexion impossible à ${hote}:${port} — ${e.code || e.message}.`)));
    socket.on('connect', () => {
      // The printer never answers, so the write draining IS the confirmation:
      // end() flushes, and 'close' means the bytes left this machine.
      socket.end(buffer, () => finish());
    });
  });
}

// ── windows ─────────────────────────────────────────────────────────
export async function sendWindowsPrinter(buffer, { imprimante, docName = 'Swift Cargo' }) {
  if (process.platform !== 'win32') {
    throw errors.conflict("L'impression par file d'attente Windows n'est disponible que sous Windows.");
  }
  if (!imprimante) throw errors.validation([{ field: 'imprimante', message: 'Aucune imprimante sélectionnée.' }]);

  // The bytes go through a temp file: passing a binary blob on a PowerShell
  // command line would be mangled by the console code page.
  const dir = await mkdtemp(join(tmpdir(), 'swift-cargo-print-'));
  const file = join(dir, 'ticket.bin');
  await writeFile(file, buffer);
  try {
    const out = await powershell(['-File', PS_SCRIPT, '-PrinterName', imprimante, '-FilePath', file, '-DocName', docName]);
    return `${buffer.length} octets envoyés à « ${imprimante} » (${out}).`;
  } finally {
    await unlink(file).catch(() => {});
  }
}

// ── fichier ─────────────────────────────────────────────────────────
export async function sendToFile(buffer, { fichier }) {
  if (!fichier) throw errors.validation([{ field: 'fichier', message: 'Aucun chemin de fichier configuré.' }]);
  await writeFile(fichier, buffer);
  return `${buffer.length} octets écrits dans ${fichier}`;
}

// Is the configured destination reachable right now? Used by the settings page
// so a wrong address is caught before someone tries to print a real bon.
export async function probe(cfg) {
  if (cfg.mode === 'reseau') {
    if (!cfg.hote) return { ok: false, message: 'Adresse de l’imprimante non renseignée.' };
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: cfg.hote, port: Number(cfg.port) || 9100 });
      const done = (ok, message) => { socket.destroy(); resolve({ ok, message }); };
      socket.setTimeout(3000);
      socket.on('timeout', () => done(false, `Aucune réponse de ${cfg.hote}:${cfg.port}.`));
      socket.on('error', (e) => done(false, `Injoignable — ${e.code || e.message}.`));
      socket.on('connect', () => done(true, `Imprimante joignable sur ${cfg.hote}:${cfg.port}.`));
    });
  }
  if (cfg.mode === 'windows') {
    if (!cfg.imprimante) return { ok: false, message: 'Aucune imprimante sélectionnée.' };
    const found = (await listWindowsPrinters()).find((p) => p.Name === cfg.imprimante);
    if (!found) return { ok: false, message: `« ${cfg.imprimante} » ne figure pas parmi les imprimantes installées.` };
    return { ok: true, message: `Imprimante « ${found.Name} » installée (${found.Status || 'état inconnu'}).` };
  }
  if (cfg.mode === 'fichier') {
    return cfg.fichier ? { ok: true, message: `Les tickets seront écrits dans ${cfg.fichier}.` } : { ok: false, message: 'Aucun chemin de fichier configuré.' };
  }
  return { ok: false, message: 'Impression directe désactivée — les documents passent par le navigateur.' };
}

// One entry point: pick the transport from the configured mode.
//
// A printer that is off, unplugged or at the wrong address is an everyday event,
// not a bug in the server — so the failure is turned into a normal 409 carrying
// the reason, instead of reaching the client as « Erreur interne du serveur ».
export async function send(buffer, cfg, docName) {
  try {
    switch (cfg.mode) {
      case 'reseau': return await sendTcp(buffer, cfg);
      case 'windows': return await sendWindowsPrinter(buffer, { ...cfg, docName });
      case 'fichier': return await sendToFile(buffer, cfg);
      default:
        throw errors.conflict("L'impression directe n'est pas configurée. Ouvrez Paramètres → Impression.");
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('PRINTER_UNREACHABLE', `Impression impossible : ${err.message}`, { status: 409 });
  }
}
