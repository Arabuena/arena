// Stockfish Worker: conecta ao engine WASM e retorna melhor lance (UCI)
let engine = null;
let ready = false;
let pending = null;

async function initEngine(){
  if (engine) return;
  try {
    // Garanta que o Emscripten encontre o arquivo WASM correto
    // O build "lite single" do npm usa um nome gerado. Temos
    // "stockfish-17.1-lite-single-03e3232.wasm" na raiz.
    // O locateFile substitui o caminho padrão (p.ex. "stockfish.wasm").
    const wasmName = (typeof self.sfWasmFile === 'string' && self.sfWasmFile.length)
      ? self.sfWasmFile
      : 'stockfish-17.1-lite-single-03e3232.wasm';
    const baseOrigin = (typeof self.sfWasmOrigin === 'string' && self.sfWasmOrigin.length)
      ? self.sfWasmOrigin
      : ((self.location && self.location.origin) ? self.location.origin : '');
    const wasmAbs = baseOrigin ? (baseOrigin.replace(/\/$/, '') + '/' + wasmName) : wasmName;
    const stockfishJsAbs = baseOrigin ? (baseOrigin.replace(/\/$/, '') + '/stockfish.js') : 'stockfish.js';
    self.Module = self.Module || {};
    // Prefetch WASM e injetar bytes diretamente para evitar resolução incorreta de URL
    try {
      const res = await fetch(wasmAbs, { method: 'GET' });
      if (!res || !res.ok) {
        throw new Error('wasm_fetch_status_' + (res ? res.status : 'null'));
      }
      const bin = await res.arrayBuffer();
      const u8 = new Uint8Array(bin);
      // Verificar magic word 00 61 73 6d
      const magic = (u8.length>=4) ? [u8[0],u8[1],u8[2],u8[3]] : [];
      const isWasm = magic.length===4 && magic[0]===0x00 && magic[1]===0x61 && magic[2]===0x73 && magic[3]===0x6d;
      if (!isWasm) {
        try { postMessage({ error: 'engine_init_failed', detail: 'wasm_magic_mismatch:'+magic.join(','), wasm: wasmAbs }); } catch(_){}
        engine = null;
        return;
      }
      self.Module.wasmBinary = u8;
      self.Module.wasmBinaryFile = wasmAbs;
    } catch (e) {
      try { postMessage({ error: 'engine_init_failed', detail: 'wasm_fetch_failed: ' + String(e && e.message || e), wasm: wasmAbs }); } catch(_){}
      engine = null;
      return;
    }
    self.Module.locateFile = function(path, dir){
      try {
        if (typeof path === 'string') {
          // Se já for absoluto (http/https/blob), respeitar
          if (/^(?:https?:\/\/|blob:)/.test(path)) return path;
          // Para o WASM, sempre usar nossa URL absoluta configurada
          if (path.endsWith('.wasm')) return wasmAbs;
        }
      } catch(_){}
      return (dir ? dir + path : path);
    };
    // Reportar motivo de abort/erro de compilação
    self.Module.onAbort = function(reason){
      try { postMessage({ error: 'engine_init_failed', detail: String(reason||'abort'), wasm: wasmAbs }); } catch(_){}
    };

    importScripts(stockfishJsAbs); // precisa existir na raiz
    const opts = {
      locateFile: function(path, dir){
        try {
          if (typeof path === 'string') {
            if (/^(?:https?:\/\/|blob:)/.test(path)) return path;
            if (path.endsWith('.wasm')) return wasmAbs;
          }
        } catch(_){}
        return (dir ? dir + path : path);
      },
      onAbort: function(reason){
        try { postMessage({ error: 'engine_init_failed', detail: String(reason||'abort'), wasm: wasmAbs }); } catch(_){}
      },
      // Passar bytes WASM diretamente nas opções para o Emscripten
      wasmBinary: u8,
      wasmBinaryFile: wasmAbs
    };
    engine = (typeof Stockfish === 'function') ? Stockfish(opts)
            : (typeof self.Stockfish === 'function') ? self.Stockfish(opts)
            : null;
  } catch (e) {
    postMessage({ error: 'missing_stockfish_js', detail: String(e && e.message || e) });
    engine = null;
    return;
  }
  if (!engine) { postMessage({ error: 'engine_init_failed' }); return; }

  engine.onmessage = (msg) => {
    try {
      if (typeof msg !== 'string') msg = String(msg || '');
      
      // Log para debug (visível no console)
      if (msg.includes('info depth')) {
        console.log('Stockfish:', msg);
      }
      
      if (msg.includes('readyok')) {
        ready = true;
        console.log('Stockfish: Engine ready');
        if (pending) { runSearch(pending); pending = null; }
      }
      if (msg.includes('bestmove')) {
        const m = msg.match(/bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/i);
        console.log('Stockfish bestmove:', m ? m[1] : 'none');
        postMessage(m ? { uci: m[1], engine: 'stockfish' } : { error: 'no_bestmove' });
      }
    } catch(_){}
  };

  // Handshake UCI e opções melhoradas
  engine.postMessage('uci');
  engine.postMessage('setoption name Skill Level value 20');
  engine.postMessage('setoption name Hash value 128'); // Aumentado para 128MB
  engine.postMessage('setoption name Threads value 1');
  engine.postMessage('setoption name Contempt value 0');
  engine.postMessage('setoption name Move Overhead value 100'); // Reduz overhead de tempo
  engine.postMessage('isready');
}

function runSearch(msg){
  if (!engine) { postMessage({ error: 'no_engine' }); return; }
  const fen = msg.fen;
  const movetime = Number(msg.movetimeMs)
    ? Math.max(800, Number(msg.movetimeMs))
    : Math.max(1200, Number(msg.budgetMs)||1500);
  engine.postMessage('ucinewgame');
  engine.postMessage('position fen ' + fen);
  engine.postMessage('go movetime ' + movetime);
}

onmessage = async (ev) => {
  const msg = ev.data || {};
  // Configuração inicial enviada pelo frontend
  if (msg && msg.__cfg) {
    try {
      const cfg = msg.__cfg || {};
      if (typeof cfg.sfWasmFile === 'string' && cfg.sfWasmFile.length) self.sfWasmFile = cfg.sfWasmFile;
      if (typeof cfg.sfWasmOrigin === 'string' && cfg.sfWasmOrigin.length) self.sfWasmOrigin = cfg.sfWasmOrigin;
      postMessage({ cfg_ok: true });
    } catch(_) {}
    return;
  }
  if (!msg.fen) { postMessage({ error: 'no_fen' }); return; }
  if (!engine) await initEngine();
  if (!engine) { postMessage({ error: 'engine_init_failed' }); return; }
  if (!ready) { pending = msg; return; }
  runSearch(msg);
};