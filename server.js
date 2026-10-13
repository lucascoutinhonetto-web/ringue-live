// Ringue da Live — escuta os presentes do TikTok LIVE e manda socos pra tela do ringue.
// Tudo na mesma pasta: server.js, package.json, index.html, vermelho.png, verde.png
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector');

// ===== CONFIGURAÇÃO (variáveis de ambiente no site de hospedagem) =====
const USUARIO = (process.env.TIKTOK_USER || '').replace('@', '').trim(); // seu @ sem o @
const GIFTS_A = lista(process.env.GIFTS_A || 'Rose,5655');  // presentes do VERMELHO (nome ou ID)
const GIFTS_B = lista(process.env.GIFTS_B || '');           // presentes do VERDE. Vazio = qualquer outro
const PORTA = process.env.PORT || 3000;

function lista(s) { return s.split(',').map(x => x.trim().toLowerCase()).filter(Boolean); }

// ===== Servidor web: entrega os arquivos da MESMA pasta =====
const TIPOS = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const PERMITIDOS = ['index.html', 'vermelho.png', 'verde.png', 'vermelho.webp', 'verde.webp', 'fundo.jpg'];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/saude') return res.end('ok');
  if (p === '/status') return res.end(JSON.stringify({ usuario: USUARIO, estado }));
  if (p === '/soco') { // teste manual: /soco?lado=a  ou  /soco?lado=b
    const lado = url.searchParams.get('lado') === 'b' ? 'b' : 'a';
    enviar({ tipo: 'soco', lado, qtd: 1, quem: 'teste', presente: 'teste' });
    return res.end('soco ' + lado);
  }

  const arq = p === '/' ? 'index.html' : path.basename(p);
  if (!PERMITIDOS.includes(arq)) { res.statusCode = 404; return res.end('nao achei'); }
  fs.readFile(path.join(__dirname, arq), (err, dados) => {
    if (err) { res.statusCode = 404; return res.end('nao achei ' + arq); }
    res.setHeader('Content-Type', TIPOS[path.extname(arq)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(dados);
  });
});

// ===== WebSocket: liga o servidor à tela do ringue =====
const wss = new WebSocketServer({ server });
let estado = 'iniciando';

function enviar(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}
function status(texto) { estado = texto; console.log('[status]', texto); enviar({ tipo: 'status', texto }); }

wss.on('connection', ws => ws.send(JSON.stringify({ tipo: 'status', texto: estado })));
// ping a cada 25s pra conexão não cair por inatividade
setInterval(() => wss.clients.forEach(c => { try { c.ping(); } catch {} }), 25000);

// ===== TikTok: conecta e reconecta SEM duplicar =====
let conn = null;
let timerReconexao = null;
let conectando = false;

function agendar(segundos, motivo) {
  if (timerReconexao) return;           // já tem uma reconexão marcada → não duplica
  status(`${motivo} Tentando de novo em ${segundos}s...`);
  timerReconexao = setTimeout(() => { timerReconexao = null; conectarTikTok(); }, segundos * 1000);
}

function limparConexao() {
  if (!conn) return;
  try { conn.removeAllListeners(); } catch {}
  try { conn.disconnect(); } catch {}
  conn = null;
}

async function conectarTikTok() {
  if (!USUARIO) return status('Falta configurar TIKTOK_USER no site de hospedagem.');
  if (conectando) return;
  conectando = true;
  limparConexao();

  conn = new TikTokLiveConnection(USUARIO, { processInitialData: false });
  conn.on(WebcastEvent.GIFT, aoPresente);
  conn.on(WebcastEvent.STREAM_END, () => { limparConexao(); agendar(30, 'Live encerrada.'); });
  conn.on(ControlEvent.DISCONNECTED, () => { limparConexao(); agendar(10, 'Desconectou.'); });
  conn.on(ControlEvent.ERROR, e => console.log('[erro]', e?.info || e?.message || e));

  try {
    status(`Procurando a live de @${USUARIO}...`);
    const info = await conn.connect();
    status(`Conectado na live de @${USUARIO}`);
    console.log('roomId', info?.roomId);
  } catch (e) {
    console.log('[falha]', e?.message || e);
    limparConexao();
    agendar(30, `@${USUARIO} não está ao vivo ainda.`);
  } finally {
    conectando = false;
  }
}

function ladoDoPresente(nome, id) {
  const n = String(nome).toLowerCase(), i = String(id);
  if (GIFTS_A.includes(n) || GIFTS_A.includes(i)) return 'a';
  if (GIFTS_B.length === 0) return 'b';
  if (GIFTS_B.includes(n) || GIFTS_B.includes(i)) return 'b';
  return null;
}

function aoPresente(d) {
  const tipo = d.giftDetails?.giftType ?? d.giftType;
  if (tipo === 1 && !d.repeatEnd) return;           // combo ainda rolando: espera terminar
  const nome = d.giftDetails?.giftName || d.giftName || '';
  const lado = ladoDoPresente(nome, d.giftId);
  if (!lado) return;
  const qtd = Math.min(Math.max(d.repeatCount || 1, 1), 50);
  const quem = d.user?.nickname || d.user?.uniqueId || d.nickname || d.uniqueId || '';
  console.log(`[presente] ${quem} -> ${nome} x${qtd} (lado ${lado})`);
  enviar({ tipo: 'soco', lado, qtd, quem, presente: nome });
}

// Nunca deixa o servidor morrer por erro inesperado
process.on('uncaughtException', e => { console.log('[crash evitado]', e?.message); agendar(15, 'Erro inesperado.'); });
process.on('unhandledRejection', e => { console.log('[crash evitado]', e?.message || e); });

server.listen(PORTA, () => { console.log('Ringue rodando na porta', PORTA); conectarTikTok(); });
