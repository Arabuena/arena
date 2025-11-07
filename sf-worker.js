// Stockfish Worker: conecta ao engine WASM e retorna melhor lance (UCI)
let engine = null;
let ready = false;
let pending = null;
let lastEval = null; // { type: 'cp'|'mate', value: number }
let lastFen = null;  // FEN da pesquisa atual
let useBook = true;  // usar livro de aberturas online
// Config dinâmica de opções
let sfHashMB = 256;
let sfThreads = 1;
let sfContempt = 0;
let sfMoveOverhead = 100;
let sfPonder = false;
let sfMultiPV = 1;
let sfSkillLevel = 20;
let sfLimitStrength = false;
let sfElo = null;

async function initEngine(){
  if (engine) return;
  try {
    // Buffer para os bytes do WASM (precisa existir fora do bloco de fetch)
    let u8 = null;
    // Pré-compilação opcional do módulo (referenciado depois na criação de opts)
    let preMod = null;
    // Modo multi-parte: sinal para deixar o loader buscar vários .wasm
    const multipart = (self && self.sfWasmFile === '__multipart__');
    // Preferir o artefato lite-single do pacote 17.1
    const candidates = [];
    if (!multipart && typeof self.sfWasmFile === 'string' && self.sfWasmFile.length) {
      candidates.push(self.sfWasmFile);
    }
    candidates.push('stockfish-17.1-lite-single-03e3232.wasm');
    candidates.push('stockfish.wasm');

    const baseOrigin = (typeof self.sfWasmOrigin === 'string' && self.sfWasmOrigin.length)
      ? self.sfWasmOrigin
      : ((self.location && self.location.origin) ? self.location.origin : '');

    function abs(u){ return baseOrigin ? (baseOrigin.replace(/\/$/, '') + '/' + u) : u; }
    // Construir lista de candidatos absolutos e definir wasmAbs padrão
    const absCandidates = candidates.map(abs);
    let wasmAbs = absCandidates[0] || abs('stockfish.wasm');
    const stockfishJsAbs = baseOrigin ? (baseOrigin.replace(/\/$/, '') + '/stockfish.js') : 'stockfish.js';
    self.Module = self.Module || {};
    // Se bytes foram enviados pelo frontend, use-os e pule fetch
    if (self.Module && self.Module.wasmBinary instanceof Uint8Array) {
      const mb = self.Module.wasmBinary;
      const magic = (mb.length>=4) ? [mb[0],mb[1],mb[2],mb[3]] : [];
      const isWasm = magic.length===4 && magic[0]===0x00 && magic[1]===0x61 && magic[2]===0x73 && magic[3]===0x6d;
      if (isWasm) {
        u8 = mb;
        self.Module.wasmBinaryFile = self.Module.wasmBinaryFile || wasmAbs;
      }
    }
    // Prefetch WASM e injetar bytes diretamente com fallback
    if (!multipart) {
    try {
      const fetchWasm = async (url) => {
        const res = await fetch(url, { method: 'GET' });
        if (!res || !res.ok) {
          throw new Error('wasm_fetch_status_' + (res ? res.status : 'null'));
        }
        const bin = await res.arrayBuffer();
        return new Uint8Array(bin);
      };
      // 1) Se não recebemos bytes, tenta cada candidato absoluto até achar um WASM válido
      if(!u8){
        for(const url of absCandidates){
          try{
            const tryBytes = await fetchWasm(url);
            const m = (tryBytes.length>=4) ? [tryBytes[0],tryBytes[1],tryBytes[2],tryBytes[3]] : [];
            const ok = m.length===4 && m[0]===0x00 && m[1]===0x61 && m[2]===0x73 && m[3]===0x6d;
            if(ok && tryBytes.length>=4096){
              u8 = tryBytes;
              wasmAbs = url;
              break;
            }
          }catch(_){ /* tenta próximo */ }
        }
      }
      let magic = (u8.length>=4) ? [u8[0],u8[1],u8[2],u8[3]] : [];
      let isWasm = magic.length===4 && magic[0]===0x00 && magic[1]===0x61 && magic[2]===0x73 && magic[3]===0x6d;
      try { console.log('SF dbg prefetch len', (u8 ? u8.length : 0), 'magic', magic); } catch(_){}
      // 2) Fallback: se bytes não forem WASM (ex.: 404 "Not Found"), tenta relativo
      if (!isWasm) {
        // Tenta fallback relativo preferindo lite-single da 17.1 antes de stockfish.wasm genérico
        const relFallbacks = [
          'stockfish-17.1-lite-single-03e3232.wasm',
          'stockfish.wasm'
        ];
        for(const fb of relFallbacks){
          try {
            const u8fb = await fetchWasm(fb);
            const m2 = (u8fb.length>=4) ? [u8fb[0],u8fb[1],u8fb[2],u8fb[3]] : [];
            const ok2 = m2.length===4 && m2[0]===0x00 && m2[1]===0x61 && m2[2]===0x73 && m2[3]===0x6d;
            if (ok2 && u8fb.length>=4096) { u8 = u8fb; magic = m2; isWasm = true; wasmAbs = abs(fb); self.Module.wasmBinaryFile = wasmAbs; break; }
          } catch(_){ /* tenta próximo */ }
        }
      }
      if (!isWasm) {
        try { postMessage({ error: 'engine_init_failed', detail: 'wasm_magic_mismatch:'+magic.join(','), wasm: wasmAbs }); } catch(_){}
        engine = null;
        return;
      }
      if (!u8 || u8.length < 4096) {
        try { postMessage({ error: 'engine_init_failed', detail: 'wasm_too_small_len_'+(u8?u8.length:0), wasm: wasmAbs }); } catch(_){}
        engine = null;
        return;
      }
      self.Module.wasmBinary = u8;
      self.Module.wasmBinaryFile = self.Module.wasmBinaryFile || wasmAbs;
      try { console.log('SF dbg chosen wasmAbs:', wasmAbs); } catch(_){}
      // Forçar uso do binário já carregado, evitando instantiationStreaming
      // Pré-compila o módulo para garantir que o Emscripten não reprocessa bytes truncados
      try {
        preMod = await WebAssembly.compile(u8);
        try { console.log('SF dbg precompile ok', { len: u8.length }); } catch(_){}
      } catch(e){
        try { postMessage({ error: 'engine_init_failed', detail: 'precompile_err:'+String(e&&e.message||e) }); } catch(_){}
      }
      if (preMod) {
        try { self.Module.wasmModule = preMod; } catch(_){}
      }

      // NOVO: instanciar de forma síncrona e retornar exports
      self.Module.instantiateWasm = function(imports, successCallback){
        try {
          try { console.log('SF dbg instantiateWasm using preMod', { len: (u8?u8.length:0) }); } catch(_){}
          const mod = preMod || new WebAssembly.Module(u8 instanceof Uint8Array ? u8 : new Uint8Array(u8));
          const inst = new WebAssembly.Instance(mod, imports);
          try { successCallback(inst); } catch(_){}
          // Retorna exports imediatamente para satisfazer o loader do Emscripten
          return inst.exports;
        } catch(e){
          try { postMessage({ error: 'engine_init_failed', detail: 'instantiate_throw:'+String(e&&e.message||e) }); } catch(_){}
          return {};
        }
      };
    } catch (e) {
      try { postMessage({ error: 'engine_init_failed', detail: 'wasm_fetch_failed: ' + String(e && e.message || e), wasm: wasmAbs }); } catch(_){}
      engine = null;
      return;
    }
    }
    self.Module.locateFile = function(path, dir){
      try {
        if (typeof path === 'string') {
          // Se já for absoluto (http/https/blob), respeitar
          if (/^(?:https?:\/\/|blob:)/.test(path)) return path;
          // Para o WASM, sempre usar nossa URL absoluta configurada
          if (path.endsWith('.wasm')) return (self.Module && self.Module.wasmBinaryFile) ? self.Module.wasmBinaryFile : wasmAbs;
        }
      } catch(_){}
      return (dir ? dir + path : path);
    };
    // Reportar motivo de abort/erro de compilação
    self.Module.onAbort = function(reason){
      try { postMessage({ error: 'engine_init_failed', detail: String(reason||'abort'), wasm: wasmAbs }); } catch(_){}
    };
    // Desabilitar streaming para binário único; em multi-parte deixar o loader controlar
    if (!multipart) {
      try { self.WebAssembly = self.WebAssembly || {}; self.WebAssembly.instantiateStreaming = undefined; } catch(_){}
    }
    // Debug: reportar caminhos e interceptar fetch/instantiate para entender a origem do erro
    try {
      try { console.log('SF dbg wasmAbs:', wasmAbs, 'sfJs:', stockfishJsAbs); } catch(_){}
      // Log de mapeamento do locateFile (apenas para .wasm)
      const prevLocate = self.Module.locateFile;
      self.Module.locateFile = function(path, dir){
        try {
          if (typeof path === 'string' && path.endsWith('.wasm')) {
            if (multipart) {
              const outMp = abs(path);
              try { console.log('SF dbg locateFile multipart', { in: path, out: outMp }); } catch(_){}
              return outMp;
            } else {
              const out = (self.Module && self.Module.wasmBinaryFile) ? self.Module.wasmBinaryFile : wasmAbs;
              try { console.log('SF dbg locateFile', { in: path, out: out }); } catch(_){}
              return out;
            }
          }
        } catch(_){}
        try {
          if (typeof prevLocate === 'function') return prevLocate(path, dir);
        } catch(_){}
        return (dir ? dir + path : path);
      };
      // Intercepta fetch de .wasm para logar URL
      const _fetch = self.fetch;
      if (typeof _fetch === 'function') {
        self.fetch = function(url, opts){
          try {
            const u = String(url||'');
            if (u.includes('.wasm')) { try { console.log('SF dbg fetch', u); } catch(_){} }
          } catch(_){}
          return _fetch.apply(self, arguments);
        };
      }
      // Intercepta WebAssembly.instantiate e força uso do buffer correto quando input for inválido/truncado
      if (!multipart && self.WebAssembly && typeof self.WebAssembly.instantiate === 'function'){
        const _inst = self.WebAssembly.instantiate;
        self.WebAssembly.instantiate = function(modOrBytes, imports){
          try {
            let v = null;
            // Normaliza para Uint8Array quando possível
            if (modOrBytes instanceof Uint8Array) {
              v = modOrBytes;
            } else if (modOrBytes instanceof ArrayBuffer) {
              v = new Uint8Array(modOrBytes);
            } else if (modOrBytes && modOrBytes.buffer && typeof modOrBytes.byteLength === 'number') {
              v = new Uint8Array(modOrBytes.buffer, modOrBytes.byteOffset || 0, modOrBytes.byteLength);
            }
            // Se os bytes forem pequenos ou magic inválido, substitui pelo u8 completo
            let useOverride = false;
            if (v) {
              const len = v.length >>> 0;
              const magic = len>=4 ? [v[0],v[1],v[2],v[3]] : [];
              const ok = magic.length===4 && magic[0]===0x00 && magic[1]===0x61 && magic[2]===0x73 && magic[3]===0x6d;
              if (!ok || len < 4096) { useOverride = true; try { console.log('SF dbg instantiate override', { len, magic }); } catch(_){} }
            } else {
              if (!modOrBytes || !(modOrBytes instanceof WebAssembly.Module)) { useOverride = true; try { console.log('SF dbg instantiate override (no bytes)'); } catch(_){} }
            }
            if (useOverride) {
              const bytes = (u8 && u8.length) ? u8 : (self.Module && self.Module.wasmBinary instanceof Uint8Array ? self.Module.wasmBinary : null);
              if (bytes && bytes.length>=4) {
                return _inst.call(self.WebAssembly, bytes, imports);
              }
            }
          } catch(_){ }
          return _inst.apply(self.WebAssembly, arguments);
        };
      }
      // Também intercepta WebAssembly.compile para evitar módulos compilados de bytes truncados
      if (!multipart && self.WebAssembly && typeof self.WebAssembly.compile === 'function'){
        const _comp = self.WebAssembly.compile;
        self.WebAssembly.compile = function(modOrBytes){
          try {
            let v = null;
            if (modOrBytes instanceof Uint8Array) {
              v = modOrBytes;
            } else if (modOrBytes instanceof ArrayBuffer) {
              v = new Uint8Array(modOrBytes);
            } else if (modOrBytes && modOrBytes.buffer && typeof modOrBytes.byteLength === 'number') {
              v = new Uint8Array(modOrBytes.buffer, modOrBytes.byteOffset || 0, modOrBytes.byteLength);
            }
            let useOverride = false;
            if (v) {
              const len = v.length >>> 0;
              const magic = len>=4 ? [v[0],v[1],v[2],v[3]] : [];
              const ok = magic.length===4 && magic[0]===0x00 && magic[1]===0x61 && magic[2]===0x73 && magic[3]===0x6d;
              if (!ok || len < 4096) { useOverride = true; try { console.log('SF dbg compile override', { len, magic }); } catch(_){} }
            } else {
              useOverride = true;
              try { console.log('SF dbg compile override (no bytes)'); } catch(_){}
            }
            if (useOverride) {
              const bytes = (u8 && u8.length) ? u8 : (self.Module && self.Module.wasmBinary instanceof Uint8Array ? self.Module.wasmBinary : null);
              if (bytes && bytes.length>=4) {
                return _comp.call(self.WebAssembly, bytes);
              }
            }
          } catch(_){ }
          return _comp.apply(self.WebAssembly, arguments);
        };
      }
      // Intercepta WebAssembly.Module (construtor) para substituir bytes inválidos/truncados
      if (!multipart && self.WebAssembly && typeof self.WebAssembly.Module === 'function'){
        const _Mod = self.WebAssembly.Module;
        self.WebAssembly.Module = function(modOrBytes){
          try {
            let v = null;
            if (modOrBytes instanceof Uint8Array) {
              v = modOrBytes;
            } else if (modOrBytes instanceof ArrayBuffer) {
              v = new Uint8Array(modOrBytes);
            } else if (modOrBytes && modOrBytes.buffer && typeof modOrBytes.byteLength === 'number') {
              v = new Uint8Array(modOrBytes.buffer, modOrBytes.byteOffset || 0, modOrBytes.byteLength);
            }
            let useOverride = false;
            if (v) {
              const len = v.length >>> 0;
              const magic = len>=4 ? [v[0],v[1],v[2],v[3]] : [];
              const ok = magic.length===4 && magic[0]===0x00 && magic[1]===0x61 && magic[2]===0x73 && magic[3]===0x6d;
              if (!ok || len < 4096) { useOverride = true; try { console.log('SF dbg Module override', { len, magic }); } catch(_){} }
            } else {
              useOverride = true; try { console.log('SF dbg Module override (no bytes)'); } catch(_){}
            }
            if (useOverride) {
              const bytes = (u8 && u8.length) ? u8 : (self.Module && self.Module.wasmBinary instanceof Uint8Array ? self.Module.wasmBinary : null);
              if (bytes && bytes.length>=4) {
                return new _Mod(bytes);
              }
            }
          } catch(_){ }
          return new _Mod(modOrBytes);
        };
        try { self.WebAssembly.Module.prototype = _Mod.prototype; } catch(_){}
      }
      // Interceptar XMLHttpRequest para servir bytes locais do WASM (caso o loader use XHR)
      try {
        const XHR = self.XMLHttpRequest;
        if (!multipart && XHR && XHR.prototype) {
          const _open = XHR.prototype.open;
          const _send = XHR.prototype.send;
          XHR.prototype.open = function(method, url, async, user, password){
            try { this.__wasm_url = String(url||''); } catch(_){ }
            return _open.apply(this, arguments);
          };
          XHR.prototype.send = function(body){
            try {
              const u = String(this.__wasm_url||'');
              if (u.includes('.wasm')) {
                const bytes = (u8 && u8.buffer) ? u8.buffer.slice(0) : (self.Module && self.Module.wasmBinary && self.Module.wasmBinary.buffer) ? self.Module.wasmBinary.buffer.slice(0) : null;
                if (bytes) {
                  try { console.log('SF dbg xhr intercept', u, 'len', bytes.byteLength); } catch(_){}
                  // Simular resposta pronta
                  try { this.responseType = 'arraybuffer'; } catch(_){}
                  this.status = 200;
                  this.readyState = 4;
                  this.response = bytes;
                  try { this.responseText = ''; } catch(_){}
                  try { if (typeof this.onload === 'function') this.onload(); } catch(_){}
                  try { if (typeof this.onreadystatechange === 'function') this.onreadystatechange(); } catch(_){}
                  return;
                }
              }
            } catch(_){ }
            return _send.apply(this, arguments);
          };
        }
      } catch(_){ }
    } catch(_){}
    // Segunda camada: forçar qualquer fetch de .wasm a usar bytes locais
    try {
      const prevFetch = self.fetch;
      if (!multipart && typeof prevFetch === 'function') {
        self.fetch = function(url, opts){
          try {
            const u = String(url||'');
            if (u.includes('.wasm')) {
              const bytes = (u8 && u8.buffer) ? u8.buffer.slice(0) : (self.Module && self.Module.wasmBinary && self.Module.wasmBinary.buffer) ? self.Module.wasmBinary.buffer.slice(0) : null;
              if (bytes) {
                const resp = new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/wasm' } });
                try { postMessage({ dbg_fetch_intercept: u, dbg_bytes_len: bytes.byteLength }); } catch(_){}
                return Promise.resolve(resp);
              }
            }
          } catch(_){ }
          return prevFetch.apply(self, arguments);
        };
      }
    } catch(_){ }
    importScripts(stockfishJsAbs); // precisa existir na raiz
    const opts = multipart
      ? {
        locateFile: function(path, dir){
          try {
            if (typeof path === 'string') {
              if (/^(?:https?:\/\/|blob:)/.test(path)) return path;
              if (path.endsWith('.wasm')) return abs(path);
            }
          } catch(_){}
          return (dir ? dir + path : path);
        },
        onAbort: function(reason){
          try { postMessage({ error: 'engine_init_failed', detail: String(reason||'abort'), wasm: 'multipart' }); } catch(_){}
        }
      }
      : {
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
        wasmBinaryFile: wasmAbs,
        wasmModule: preMod
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
      
      // Log para debug (visível no console) e captura de avaliação
      if (msg.includes('info depth')) {
        console.log('Stockfish:', msg);
        try{
          const m = msg.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
          if(m){ lastEval = { type: m[1], value: parseInt(m[2]) }; }
        }catch(_){ /* silencioso */ }
      }
      
      if (msg.includes('readyok')) {
        ready = true;
        console.log('Stockfish: Engine ready');
        if (pending) { runSearch(pending); pending = null; }
      }
      if (msg.includes('bestmove')) {
        const m = msg.match(/bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/i);
        console.log('Stockfish bestmove:', m ? m[1] : 'none');
        // Converte avaliação para ponto de vista das Brancas
        let evalOut = null;
        try{
          if(lastEval && lastFen){
            const turn = String(lastFen).split(' ')[1] || 'w';
            if(lastEval.type === 'cp'){
              const cp = lastEval.value;
              const whiteCp = (turn === 'w') ? cp : -cp;
              evalOut = { type: 'cp', cp, whiteCp };
            } else if(lastEval.type === 'mate'){
              const mate = lastEval.value; // positivo => lado a mover dá mate
              const whiteMate = (turn === 'w') ? mate : -mate;
              evalOut = { type: 'mate', mate, whiteMate };
            }
          }
        }catch(_){ evalOut = null; }
        postMessage(m ? { uci: m[1], engine: 'stockfish', eval: evalOut, fen: lastFen } : { error: 'no_bestmove' });
      }
    } catch(_){}
  };

  // Handshake UCI e opções melhoradas
  engine.postMessage('uci');
  applyOptions();
  engine.postMessage('isready');
}

function applyOptions(){
  try{
    const hashMB = (typeof sfHashMB==='number' && sfHashMB>0) ? sfHashMB : 256;
    const threads = (typeof sfThreads==='number' && sfThreads>0) ? sfThreads : 1;
    const contempt = (typeof sfContempt==='number') ? sfContempt : 0;
    const moveOverhead = (typeof sfMoveOverhead==='number' && sfMoveOverhead>=0) ? sfMoveOverhead : 100;
    const ponder = !!sfPonder;
    const multipv = (typeof sfMultiPV==='number' && sfMultiPV>=1) ? sfMultiPV : 1;
    const skill = (typeof sfSkillLevel==='number' && sfSkillLevel>=0) ? sfSkillLevel : 20;
    const limitStrength = !!sfLimitStrength;
    const elo = (typeof sfElo==='number' && sfElo>0) ? sfElo : null;
    if(engine){
      engine.postMessage('setoption name Skill Level value ' + skill);
      engine.postMessage('setoption name Hash value ' + hashMB);
      engine.postMessage('setoption name Threads value ' + threads);
      engine.postMessage('setoption name Contempt value ' + contempt);
      engine.postMessage('setoption name Move Overhead value ' + moveOverhead);
      engine.postMessage('setoption name Ponder value ' + (ponder ? 'true' : 'false'));
      engine.postMessage('setoption name MultiPV value ' + multipv);
      engine.postMessage('setoption name UCI_LimitStrength value ' + (limitStrength ? 'true' : 'false'));
      if(elo) engine.postMessage('setoption name UCI_Elo value ' + elo);
    }
  }catch(_){ /* silencioso */ }
}

// Fallbacks online: Lichess Explorer (book) e Cloud Eval (motor forte via API)
async function fetchBookMoveGlobal(f){
  try{
    const url = `https://explorer.lichess.ovh/lichess?fen=${encodeURIComponent(f)}&moves=20`;
    const res = await fetch(url, { method: 'GET' });
    if(!res.ok) return null;
    const data = await res.json();
    const moves = (data && data.moves) || [];
    if(!moves.length) return null;
    moves.sort((a,b)=>((b.white||0)+(b.black||0)) - ((a.white||0)+(a.black||0)));
    const uci = moves[0].uci || moves[0].sanUci || null;
    return uci || null;
  }catch(_){ return null; }
}

async function fetchCloudEvalBestMove(f){
  try{
    const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(f)}&multiPv=1`;
    const res = await fetch(url, { method: 'GET' });
    if(!res.ok) return null;
    const data = await res.json();
    const pvs = (data && data.pvs) || [];
    if(Array.isArray(pvs) && pvs.length){
      const pv = pvs[0] || {};
      const movesStr = pv.moves || pv.m || '';
      if(typeof movesStr === 'string' && movesStr.length){
        const first = movesStr.trim().split(/\s+/)[0] || null;
        if(first) return first;
      }
      if(pv.best) return pv.best;
    }
    return null;
  }catch(_){ return null; }
}

function runSearch(msg){
  if (!engine) { postMessage({ error: 'no_engine' }); return; }
  const fen = msg.fen;
  lastFen = fen;
  const movetime = Number(msg.movetimeMs)
    ? Math.max(2000, Number(msg.movetimeMs))
    : Math.max(2000, Number(msg.budgetMs)||3000);

  // Book de aberturas online (Lichess Explorer) para início de jogo
  function countPiecesFromFEN(f){
    try{
      const board = String(f||'').split(' ')[0]||'';
      let c=0; for(const ch of board){ if(/[prnbqkPRNBQK]/.test(ch)) c++; }
      return c;
    }catch(_){ return 32; }
  }
  async function fetchBookMove(f){
    try{
      const url = `https://explorer.lichess.ovh/lichess?fen=${encodeURIComponent(f)}&moves=20`;
      const res = await fetch(url, { method: 'GET' });
      if(!res.ok) return null;
      const data = await res.json();
      const moves = (data && data.moves) || [];
      if(!moves.length) return null;
      moves.sort((a,b)=>((b.white||0)+(b.black||0)) - ((a.white||0)+(a.black||0)));
      const uci = moves[0].uci || moves[0].sanUci || null;
      return uci || null;
    }catch(_){ return null; }
  }
  const fullmoveStr = String(fen||'').split(' ')[5] || '1';
  const fullmove = parseInt(fullmoveStr)||1;
  const pcs = countPiecesFromFEN(fen);
  const earlyGame = (fullmove <= 12) && (pcs >= 24);

  // Tentar livro primeiro; se acharmos, retornamos UCI imediatamente
  if(useBook && earlyGame){
    fetchBookMove(fen).then(uci=>{
      if(uci){ postMessage({ uci, engine: 'book', eval: null, fen }); return; }
      // Sem book: seguir com busca normal
      engine.postMessage('ucinewgame');
      engine.postMessage('position fen ' + fen);
      engine.postMessage('go movetime ' + movetime);
    }).catch(_=>{
      engine.postMessage('ucinewgame');
      engine.postMessage('position fen ' + fen);
      engine.postMessage('go movetime ' + movetime);
    });
    return;
  }

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
      // Permitir envio dos bytes do WASM pelo frontend para evitar resolução incorreta
      if (cfg.wasmBytes) {
        try {
          const ab = (cfg.wasmBytes instanceof ArrayBuffer) ? cfg.wasmBytes : null;
          const bytes = ab ? new Uint8Array(ab) : (cfg.wasmBytes instanceof Uint8Array ? cfg.wasmBytes : null);
          if (bytes && bytes.length>=4) {
            const magic = [bytes[0],bytes[1],bytes[2],bytes[3]];
            const isWasm = magic[0]===0x00 && magic[1]===0x61 && magic[2]===0x73 && magic[3]===0x6d;
            if (isWasm) {
              self.Module = self.Module || {};
              self.Module.wasmBinary = bytes;
              self.Module.wasmBinaryFile = (typeof self.sfWasmFile==='string' && self.sfWasmFile.length) ? self.sfWasmFile : 'stockfish.wasm';
            } else {
              postMessage({ error: 'engine_init_failed', detail: 'cfg_wasm_magic_mismatch:'+magic.join(',') });
            }
          }
        } catch(_){ /* silencioso */ }
      }
      if (typeof cfg.useBook !== 'undefined') useBook = !!cfg.useBook;
      if (typeof cfg.hashMb === 'number') sfHashMB = cfg.hashMb;
      if (typeof cfg.threads === 'number') sfThreads = cfg.threads;
      if (typeof cfg.contempt === 'number') sfContempt = cfg.contempt;
      if (typeof cfg.moveOverhead === 'number') sfMoveOverhead = cfg.moveOverhead;
      if (typeof cfg.ponder !== 'undefined') sfPonder = !!cfg.ponder;
      if (typeof cfg.multipv === 'number') sfMultiPV = cfg.multipv;
      if (typeof cfg.skill === 'number') sfSkillLevel = cfg.skill;
      if (typeof cfg.limitStrength !== 'undefined') sfLimitStrength = !!cfg.limitStrength;
      if (typeof cfg.elo === 'number') sfElo = cfg.elo;
      postMessage({ cfg_ok: true });
      // Se o engine já existir, aplicar imediatamente
      applyOptions();
    } catch(_) {}
    return;
  }
  if (!msg.fen) { postMessage({ error: 'no_fen' }); return; }
  if (!engine) await initEngine();
  if (!engine) {
    // Fallback forte via API: tenta book e depois cloud eval
    try{
      const fen = String(msg.fen||'');
      let uci = null;
      if (useBook) {
        try { uci = await fetchBookMoveGlobal(fen); } catch(_){ uci=null; }
      }
      if(!uci){
        try { uci = await fetchCloudEvalBestMove(fen); } catch(_){ uci=null; }
      }
      if(uci){ postMessage({ uci, engine: 'cloud', eval: null, fen }); return; }
    }catch(_){ }
    postMessage({ error: 'engine_init_failed' });
    return;
  }
  if (!ready) { pending = msg; return; }
  runSearch(msg);
};