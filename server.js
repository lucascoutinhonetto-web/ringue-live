// Ringue da Live — escuta os presentes do TikTok LIVE e manda socos pra tela do ringue.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const TTL = require('tiktok-live-connector');

// ===== CONFIGURAÇÃO (variáveis de ambiente) =====
const USUARIO = (process.env.TIKTOK_USER || '').replace('@', '');   // seu @ do TikTok, sem o @
const GIFTS_A = lista(process.env.GIFTS_A || 'Rose,5655');                // presentes que fazem o lado A (vermelho) socar
const GIFTS_B = lista(process.env.GIFTS_B || '');                    // presentes do lado B (azul). Vazio = qualquer outro presente
const PORTA = process.env.PORT || 3000;

function lista(s) { return s.split(',').map(x => x.trim().toLowerCase()).filter(Boolean); }

// ===== Servidor web (serve a tela do ringue) =====
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/saude') return res.end('ok');
  if (url.pathname === '/soco') {                // teste: /soco?lado=a  ou  /soco?lado=b
    enviar({ tipo: 'soco', lado: url.searchParams.get('lado') === 'b' ? 'b' : 'a', qtd: 1, quem: 'teste' });
    return res.end('soco enviado');
  }
  fs.readFile(path.join(__dirname, 'index.html'), (err, html) => {
    if (err) { res.statusCode = 500; return res.end('erro'); }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  });
});

const wss = new WebSocketServer({ server });
let ultimoStatus = 'iniciando...';
wss.on('connection', ws => ws.send(JSON.stringify({ tipo: 'status', texto: ultimoStatus })));
function enviar(msg) {
  const s = JSON.stringify(msg);
  wss.clients.forEach(c => c.readyState === 1 && c.send(s));
}
function status(t) { ultimoStatus = t; console.log(t); enviar({ tipo: 'status', texto: t }); }

server.listen(PORTA, () => console.log('Ringue rodando na porta ' + PORTA));

// ===== Conexão com o TikTok LIVE =====
function ladoDoPresente(nome) {
  const n = (nome || '').toLowerCase();
  if (GIFTS_A.includes(n)) return 'a';
  if (GIFTS_B.length === 0 || GIFTS_B.includes(n)) return 'b';
  return null;
}

function aoPresente(d) {
  // Presentes em sequência (combo): só conta quando o combo termina
  const tipo = d.giftDetails?.giftType ?? d.giftType;
  if (tipo === 1 && !d.repeatEnd) return;
  const nome = d.giftDetails?.giftName || d.giftName || '';
  // aceita nome do presente ou o ID (ex.: Rosa = 5655)
  const lado = ladoDoPresente(nome) === 'a' || GIFTS_A.includes(String(d.giftId)) ? 'a'
             : (GIFTS_B.includes(String(d.giftId)) ? 'b' : ladoDoPresente(nome));
  if (!lado) return;
  const qtd = Math.max(1, d.repeatCount || 1);
  const quem = d.uniqueId || d.user?.uniqueId || '';
  console.log(`🎁 ${quem} mandou ${qtd}x ${nome} → lado ${lado.toUpperCase()}`);
  enviar({ tipo: 'soco', lado, qtd, quem });
}

function conectarTikTok() {
  if (!USUARIO) return status('Defina TIKTOK_USER (seu @ do TikTok)');

  // Compatível com a versão nova (TikTokLiveConnection) e a antiga (WebcastPushConnection)
  const Classe = TTL.TikTokLiveConnection || TTL.WebcastPushConnection;
  const conn = new Classe(USUARIO);
  const EV = TTL.WebcastEvent || {};
  const evGift = EV.GIFT || 'gift';
  const evFim = EV.STREAM_END || 'streamEnd';

  conn.connect()
    .then(() => status('Conectado na live de @' + USUARIO + ' ✅'))
    .catch(e => {
      status('Live de @' + USUARIO + ' não encontrada. Tentando de novo em 30s...');
      console.log(e?.message || e);
      setTimeout(conectarTikTok, 30000);
    });

  conn.on(evGift, aoPresente);
  conn.on(evFim, () => { status('Live encerrada. Aguardando...'); setTimeout(conectarTikTok, 30000); });
  conn.on('disconnected', () => { status('Desconectou. Reconectando em 15s...'); setTimeout(conectarTikTok, 15000); });
}

conectarTikTok();
