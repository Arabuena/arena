// Chess AI Worker: computes best move without blocking the UI
// Receives: { g, color, level, enp }
// Responds: { x, y, m } or { move: null }

let deadlineMs = 0;
function timeUp(){ return deadlineMs>0 && Date.now()>=deadlineMs; }

// Endgame tuning constants
const CHECK_BONUS = 50;
const MATE_THREAT_BONUS = 40;

function inB(x,y){ return x>=0 && x<8 && y>=0 && y<8; }
function clone(s){ return s.map(r=>r.map(c=> c ? {t:c.t,c:c.c,m:!!c.m} : null)); }

function pseudoOn(s,x,y){
  const p=s[y][x],ms=[]; if(!p) return ms;
  const add=(nx,ny)=>{ if(!inB(nx,ny)) return; const q=s[ny][nx]; if(!q) ms.push({x:nx,y:ny}); else if(q.c!==p.c) ms.push({x:nx,y:ny,cap:true}); };
  if(p.t==='N'){
    for(const[dx,dy]of[[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]) add(x+dx,y+dy);
  }else if(p.t==='B'||p.t==='R'||p.t==='Q'){
    const dirs=[]; if(p.t!=='R') dirs.push([1,1],[1,-1],[-1,1],[-1,-1]); if(p.t!=='B') dirs.push([1,0],[-1,0],[0,1],[0,-1]);
    for(const[dx,dy]of dirs){ let nx=x+dx, ny=y+dy; while(inB(nx,ny)&&!s[ny][nx]){ ms.push({x:nx,y:ny}); nx+=dx; ny+=dy; } if(inB(nx,ny)&&s[ny][nx]&&s[ny][nx].c!==p.c) ms.push({x:nx,y:ny,cap:true}); }
  }else if(p.t==='K'){
    for(const[dx,dy]of[[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]) add(x+dx,y+dy);
  }else if(p.t==='P'){
    const dir=p.c==='white'?1:-1;
    for(const dx of[-1,1]){
      const cx=x+dx, cy=y+dir;
      if(inB(cx,cy)&&s[cy][cx]&&s[cy][cx].c!==p.c) ms.push({x:cx,y:cy,cap:true});
      if(enp && enp.forColor===p.c && enp.x===cx && enp.y===cy){ if(inB(cx,y)&&s[y][cx]&&s[y][cx].t==='P'&&s[y][cx].c!==p.c){ ms.push({x:cx,y:cy,cap:true,ep:true}); } }
    }
    const nx=x,ny=y+dir; if(inB(nx,ny)&&!s[ny][nx]){ ms.push({x:nx,y:ny}); const sy=p.c==='white'?1:6; const ny2=y+2*dir; if(y===sy&&inB(nx,ny2)&&!s[ny2][nx]&&!s[ny][nx]) ms.push({x:nx,y:ny2}); }
  }
  return ms;
}

function attacked(s,color,x,y){
  const opp = color==='white'?'black':'white';
  for(let yy=0;yy<8;yy++) for(let xx=0;xx<8;xx++){
    const p=s[yy][xx]; if(!p||p.c!==opp) continue;
    let at=[];
    if(p.t==='K'){
      for(const [dx,dy] of [[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]){ const nx=xx+dx, ny=yy+dy; if(inB(nx,ny)) at.push({x:nx,y:ny}); }
    }else{
      at = pseudoOn(s,xx,yy);
      at = at.filter(m=>!m.castle);
      if(p.t==='P') at = at.filter(m=>m.cap);
    }
    if(at.some(m=>m.x===x && m.y===y)) return true;
  }
  return false;
}

function isCheck(s,color){ let kx=-1,ky=-1; for(let y=0;y<8;y++) for(let x=0;x<8;x++){ const p=s[y][x]; if(p&&p.c===color&&p.t==='K'){ kx=x; ky=y; } } const opp=color==='white'?'black':'white'; for(let y=0;y<8;y++) for(let x=0;x<8;x++){ const p=s[y][x]; if(!p||p.c!==opp) continue; let at=pseudoOn(s,x,y); if(p.t==='P') at = at.filter(m=>m.cap); if(at.some(m=>m.x===kx&&m.y===ky)) return true; } return false; }

function legalOn(s,x,y){
  const p=s[y][x]; let ms=pseudoOn(s,x,y);
  if(p && p.t==='K'){
    const hasMoved=!!p.m; const rank=y;
    if(!hasMoved && x===4 && (rank===0||rank===7) && !isCheck(s,p.c)){
      const rookK=s[rank][7]; if(rookK && rookK.t==='R' && rookK.c===p.c && !rookK.m){ if(!s[rank][5] && !s[rank][6] && !attacked(s,p.c,5,rank) && !attacked(s,p.c,6,rank)) ms.push({x:6,y:rank,castle:'K'}); }
      const rookQ=s[rank][0]; if(rookQ && rookQ.t==='R' && rookQ.c===p.c && !rookQ.m){ if(!s[rank][1] && !s[rank][2] && !s[rank][3] && !attacked(s,p.c,3,rank) && !attacked(s,p.c,2,rank)) ms.push({x:2,y:rank,castle:'Q'}); }
    }
  }
  return ms.filter(m=>{ const c=clone(s); apply(c,x,y,m); return !isCheck(c,p.c); });
}

function allLegal(s,color){ let ms=[]; for(let y=0;y<8;y++) for(let x=0;x<8;x++){ const p=s[y][x]; if(p&&p.c===color){ const lm=legalOn(s,x,y); for(const m of lm) ms.push({x,y,m}); } } return ms; }

function apply(s,x,y,m){ const p=s[y][x]; s[y][x]=null; if(m.ep){ const dir=(p.c==='white'?1:-1); const cy=m.y - dir; const cx=m.x; if(s[cy][cx] && s[cy][cx].t==='P') s[cy][cx]=null; } if(m.castle){ s[m.y][m.x]=p; if(s[m.y][m.x]) s[m.y][m.x].m=true; if(m.castle==='K'){ const r=s[m.y][7]; s[m.y][7]=null; s[m.y][5]=r; if(s[m.y][5]) s[m.y][5].m=true; } else if(m.castle==='Q'){ const r=s[m.y][0]; s[m.y][0]=null; s[m.y][3]=r; if(s[m.y][3]) s[m.y][3].m=true; } } else { s[m.y][m.x]=p; if(s[m.y][m.x]) s[m.y][m.x].m=true; } if(p.t==='P' && ((p.c==='white'&&m.y===7) || (p.c==='black'&&m.y===0))){ const tp=m.promote||'Q'; s[m.y][m.x]={t:tp,c:p.c}; } }

function order(ms){ return ms.slice().sort((a,b)=>((b.m.cap?1:0)-(a.m.cap?1:0))); }

function evalS(s){ const val={P:100,N:320,B:320,R:500,Q:900,K:0}; let score=0,mobB=0,mobW=0; for(let y=0;y<8;y++) for(let x=0;x<8;x++){ const p=s[y][x]; if(!p) continue; score+= p.c==='black'? val[p.t] : -val[p.t]; if(p.c==='black') mobB += pseudoOn(s,x,y).length; else mobW += pseudoOn(s,x,y).length; } return score + 0.1*(mobB - mobW); }

function compDepth(s){ let pcs=0; for(let y=0;y<8;y++) for(let x=0;x<8;x++) if(s[y][x]) pcs++; if(pcs<=10) return 4; if(pcs<=18) return 3; return 2; }

function minimax(s,d,a,b,max){ const color=max?'black':'white'; const ms=allLegal(s,color); if(d===0||ms.length===0){ if(ms.length===0) return {score:max?-9999:9999}; return {score:evalS(s)} } let best=null; if(max){ let me=-1e9; for(const mv of order(ms)){ const c=clone(s); apply(c,mv.x,mv.y,mv.m); const r=minimax(c,d-1,a,b,false); if(r.score>me){ me=r.score; best=mv; } a=Math.max(a,me); if(b<=a) break; } return {score:me,best}; } else { let mi=1e9; for(const mv of order(ms)){ const c=clone(s); apply(c,mv.x,mv.y,mv.m); const r=minimax(c,d-1,a,b,true); if(r.score<mi){ mi=r.score; best=mv; } b=Math.min(b,mi); if(b<=a) break; } return {score:mi,best}; } }

// Tal-style
function evalAgg(s){
  // Avaliação agressiva: material + mobilidade reforçada + segurança do rei + controle de centro + avanço de peões
  const val={P:100,N:320,B:330,R:510,Q:900,K:0};
  let score=0, mobB=0, mobW=0;
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    const p=s[y][x]; if(!p) continue;
    // material
    score += (p.c==='black'? val[p.t] : -val[p.t]);
    // mobilidade bruta
    const mlen = pseudoOn(s,x,y).length;
    if(p.c==='black') mobB += mlen; else mobW += mlen;
    // centro: bonus por proximidade ao centro
    const cx = Math.abs(3.5 - x), cy = Math.abs(3.5 - y); const centerBonus = Math.max(0, 3 - (cx+cy));
    score += (p.c==='black'? +centerBonus*2 : -centerBonus*2);
    // avanço de peões
    if(p.t==='P'){
      if(p.c==='black') score += (6 - y) * 5; else score -= (y - 1) * 5;
    }
    // penalização por peças penduradas (atacadas e mal defendidas)
    const opp = p.c==='black' ? 'white' : 'black';
    const def = countDefenders(s, p.c, x, y);
    const att = countAttackers(s, opp, x, y);
    if(att.count > 0 && def.count === 0){
      const penalty = (valMap[p.t] || 0) * 0.6;
      score += (p.c==='black' ? -penalty : +penalty);
    } else if(att.count > 0 && def.count > 0){
      // SEE simples: se menor atacante adversário cobre a troca, penaliza um pouco
      const myVal = valMap[p.t] || 0;
      if(att.minVal <= myVal){
        const penalty = (myVal - att.minVal) * 0.4 + 40;
        score += (p.c==='black' ? -penalty : +penalty);
      }
    }
  }
  // segurança do rei: bônus por colocar o rei adversário em xeque
  const inCheckWhite = isCheck(s,'white');
  const inCheckBlack = isCheck(s,'black');
  if(inCheckWhite) score += CHECK_BONUS;
  if(inCheckBlack) score -= CHECK_BONUS;
  // bônus de rede de mate: reduzir casas seguras do rei adversário
  function kingPos(side){
    for(let y=0;y<8;y++) for(let x=0;x<8;x++){ const p=s[y][x]; if(p&&p.c===side&&p.t==='K') return {x,y}; }
    return null;
  }
  const wK=kingPos('white');
  const bK=kingPos('black');
  function safeSquaresAround(kx,ky, defenderSide){
    let safe=0;
    const dirs=[[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
    for(const [dx,dy] of dirs){
      const nx=kx+dx, ny=ky+dy;
      if(nx<0||nx>7||ny<0||ny>7) continue;
      const occ=s[ny][nx];
      if(occ && occ.c===defenderSide) continue;
      if(!attacked(s, defenderSide, nx, ny)) safe++;
    }
    return safe;
  }
  if(wK){ const safeW = safeSquaresAround(wK.x, wK.y, 'white'); score += (8 - safeW) * 6; }
  if(bK){ const safeB = safeSquaresAround(bK.x, bK.y, 'black'); score -= (8 - safeB) * 6; }
  // ameaça de mate: pouca mobilidade do lado em xeque recebe bônus extra
  const wm = allLegal(s, 'white').length;
  const bm = allLegal(s, 'black').length;
  if(inCheckWhite && wm <= 3) score += MATE_THREAT_BONUS;
  if(inCheckBlack && bm <= 3) score -= MATE_THREAT_BONUS;
  // mobilidade reforçada
  score += 0.2 * (mobB - mobW);
  return score;
}

function isSacrificeMove(s, mv){
  const valMap={P:100,N:320,B:330,R:510,Q:900,K:10000};
  const mover = s[mv.y][mv.x]; if(!mover) return false;
  const myVal = valMap[mover.t]||0;
  const victim = s[mv.m.y][mv.m.x];
  const victimVal = victim ? (valMap[victim.t]||0) : 0;
  const c=clone(s); apply(c, mv.x, mv.y, mv.m);
  const opp = mover.c==='black' ? 'white' : 'black';
  let att=0, def=0, minAtt=Infinity;
  for(let yy=0; yy<8; yy++) for(let xx=0; xx<8; xx++){
    const p=c[yy][xx]; if(!p) continue;
    const ps=pseudoOn(c,xx,yy);
    for(const m of ps){
      if(m.x===mv.m.x && m.y===mv.m.y){
        if(p.c===opp){ att++; const v=(valMap[p.t]||0); if(v<minAtt) minAtt=v; }
        else def++;
        break;
      }
    }
  }
  const willLoseNet = att>def && minAtt < myVal;
  return (myVal > victimVal) && willLoseNet;
}

// Avalia se o lance deixa a peça pendurada (insegura) após jogar
function isMoveUnsafeGlobal(s, mv){
  const valMap={P:100,N:320,B:330,R:510,Q:900,K:10000};
  const c = clone(s); apply(c, mv.x, mv.y, mv.m);
  const mover = s[mv.y][mv.x]; if(!mover) return false;
  const my = mover.c; const opp = my==='black' ? 'white' : 'black';
  let att=0, def=0, minAtt=Infinity;
  for(let yy=0; yy<8; yy++) for(let xx=0; xx<8; xx++){
    const p=c[yy][xx]; if(!p) continue;
    const ps=pseudoOn(c,xx,yy);
    for(const m of ps){
      if(m.x===mv.m.x && m.y===mv.m.y){
        if(p.c===opp){ att++; const v=valMap[p.t]||0; if(v<minAtt) minAtt=v; }
        else def++;
        break;
      }
    }
  }
  if(att===0) return false; // não está atacada
  if(def===0) return true;  // sem defesa alguma
  const myVal = valMap[mover.t]||0;
  return minAtt <= myVal; // SEE simplificado: pior atacante não é mais caro que a peça movida
}

// Heurística: um sacrifício só é aceitável se criar ameaça concreta de mate
function isMateThreatSacrifice(s, mv, color){
  const c = clone(s); apply(c, mv.x, mv.y, mv.m);
  const opp = color==='black' ? 'white' : 'black';
  const isChk = isCheck(c, opp);
  if(!isChk) return false;
  // ameaça: pouca mobilidade ou redução substancial de casas seguras ao redor do rei
  const oppMoves = allLegal(c, opp).length;
  if(oppMoves <= 3) return true;
  // localizar rei adversário
  let kx=-1, ky=-1;
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){ const p=c[y][x]; if(p&&p.c===opp&&p.t==='K'){ kx=x; ky=y; break; } }
  if(kx>=0){
    // estimar casas seguras antes/depois
    let bkx=-1,bky=-1; for(let y=0;y<8;y++) for(let x=0;x<8;x++){ const p=s[y][x]; if(p&&p.c===opp&&p.t==='K'){ bkx=x; bky=y; break; } }
    const dirs=[[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
    const safeCount=(board,KX,KY,def)=>{
      let safe=0; for(const [dx,dy] of dirs){ const nx=KX+dx, ny=KY+dy; if(nx<0||nx>7||ny<0||ny>7) continue; const occ=board[ny][nx]; if(occ && occ.c===def) continue; if(!attacked(board, def, nx, ny)) safe++; }
      return safe;
    };
    const before = (bkx>=0) ? safeCount(s, bkx, bky, opp) : 8;
    const after = safeCount(c, kx, ky, opp);
    if(before - after >= 2) return true;
  }
  return false;
}

// Logs do Tal no worker (não bloqueia, apenas informa se o frontend escutar)
function logTalW(msg, data){
  try{ postMessage({ type: 'talDebug', msg, data }); }catch(_){ }
}

// Worker message handler: recebe estado e retorna lance do Tal
onmessage = async function(e){
  try{
    const data = e && e.data ? e.data : {};
    const s = data.g ? data.g.map(r=>r.map(c=> c? {t:c.t,c:c.c,m:!!c.m} : null)) : null;
    enp = data.enp || null;
    const color = data.color || 'black';
    const lvl = data.level || 'medio';
    const budgetMs = Math.max(200, +data.budgetMs || 1200);
    deadlineMs = Date.now() + (budgetMs - 50);
    if(!s){ postMessage({ move: null }); return; }
    // book/tablebase primeiro
    let mv=null, src=null;
    let pcs=0; for(let y=0;y<8;y++) for(let x=0;x<8;x++) if(s[y][x]) pcs++;
    // livro pessoal aprendido (preferência máxima)
    try{
      const pmap = data.learnBook || null;
      if(!mv && pmap && typeof pmap==='object'){
        const entries = Object.entries(pmap);
        if(entries.length){
          entries.sort((a,b)=> (b[1]||0) - (a[1]||0));
          const topUci = entries[0][0];
          const pm = findLegalMoveByUCI(s, color, topUci);
          if(pm){ mv=pm; src='pbook'; }
        }
      }
    }catch(_){ /* ignore */ }
    if(!mv && pcs<=7){ try{ mv = await fetchTablebaseMove(s, color); if(mv) src='tablebase'; }catch(_){} }
    if(!mv && pcs>=24){ try{ mv = await fetchLichessBookMove(s, color); if(mv) src='book'; }catch(_){} }
    // busca principal
    if(!mv){
      const baseDepth = pcs<=10 ? 6 : (pcs<=18 ? 5 : 4);
      const best = searchTalIterative(s, color, baseDepth);
      if(best){ mv=best; src='search'; }
    }
    if(mv) postMessage({ x: mv.x, y: mv.y, m: mv.m, src });
    else postMessage({ move: null });
  }catch(_){ postMessage({ move: null }); }
};

function orderTal(ms, s, color){
  // Priorizar cheques fortemente, depois capturas por MVV-LVA, depois demais
  const valMap={P:100,N:320,B:330,R:510,Q:900,K:10000};
  // Casas seguras do rei adversário: reduzir é progresso de mate
  function kingPos(side){
    for(let y=0;y<8;y++) for(let x=0;x<8;x++){ const p=s[y][x]; if(p&&p.c===side&&p.t==='K') return {x,y}; }
    return null;
  }
  const opp = color==='black'?'white':'black';
  const oppK = kingPos(opp);
  function safeAround(cBoard, kx, ky, defender){
    let safe=0;
    const dirs=[[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
    for(const [dx,dy] of dirs){ const nx=kx+dx, ny=ky+dy; if(nx<0||nx>7||ny<0||ny>7) continue; const occ=cBoard[ny][nx]; if(occ && occ.c===defender) continue; if(!attacked(cBoard, defender, nx, ny)) safe++; }
    return safe;
  }
  // Detecta cenário KRRK (duas torres vs rei): lado atual tem 2 torres e oponente só rei
  function countPieces(side){
    const c={K:0,Q:0,R:0,B:0,N:0,P:0};
    for(let y=0;y<8;y++) for(let x=0;x<8;x++){ const p=s[y][x]; if(p&&p.c===side){ c[p.t]++; } }
    return c;
  }
  const mine=countPieces(color); const his=countPieces(opp);
  const pcsTotal = mine.K+mine.Q+mine.R+mine.B+mine.N+mine.P + his.K+his.Q+his.R+his.B+his.N+his.P;
  const isKRRK = (mine.R>=2 && mine.Q===0 && mine.B===0 && mine.N===0) && (his.K===1 && his.Q===0 && his.R===0 && his.B===0 && his.N===0 && his.P===0);
  const baseSafe = oppK ? safeAround(s, oppK.x, oppK.y, opp) : 8;
  function mvv(mv){
    const victim = s[mv.m.y][mv.m.x];
    const attacker = s[mv.y][mv.x];
    const vv = victim ? valMap[victim.t] : 0;
    const av = attacker ? valMap[attacker.t] : 0;
    return vv - av;
  }
  function isMoveUnsafe(mv){
    const c = clone(s); apply(c, mv.x, mv.y, mv.m);
    const mover = s[mv.y][mv.x]; if(!mover) return false;
    const my = mover.c, opp = my==='black'?'white':'black';
    let att=0, def=0, minAtt=Infinity;
    for(let yy=0;yy<8;yy++) for(let xx=0;xx<8;xx++){
      const p=c[yy][xx]; if(!p) continue;
      const ps=pseudoOn(c,xx,yy);
      for(const m of ps){
        if(m.x===mv.m.x && m.y===mv.m.y){
          if(p.c===opp){ att++; const v=valMap[p.t]||0; if(v<minAtt) minAtt=v; }
          else def++;
          break;
        }
      }
    }
    if(att===0) return false;
    if(def===0) return true;
    const myVal = valMap[mover.t]||0;
    return minAtt <= myVal; // SEE simplificado
  }
  // Heurística de escadinha: em KRRK, preferir lances de torre que alinham em arquivo/rank com rei adversário e reduzem casas seguras
  function ladderScore(mv){
    if(!isKRRK || !oppK) return 0;
    const mover = s[mv.y][mv.x]; if(!mover || mover.t!=='R') return 0;
    const cBoard=clone(s); apply(cBoard,mv.x,mv.y,mv.m);
    const rx=mv.m.x, ry=mv.m.y;
    const sameFile = (rx===oppK.x);
    const sameRank = (ry===oppK.y);
    if(!sameFile && !sameRank) return 0;
    const dist = sameFile ? Math.abs(ry - oppK.y) : Math.abs(rx - oppK.x);
    if(dist<=1) return 0; // evitar contato direto com rei
    const safeAfter = safeAround(cBoard, oppK.x, oppK.y, opp);
    const reduction = baseSafe - safeAfter;
    if(reduction<=0) return 0;
    const givesChk = isCheck(cBoard, opp);
    // prêmio maior se dá cheque e reduz espaço; menor se só reduz
    return reduction*3 + (givesChk?2:0);
  }
  // Anti-repetição: em finais (≤10 peças), despriorizar lances de rei que não trazem progresso
  function kingNoProgress(mv){
    if(pcsTotal>10 || !oppK) return false;
    const mover = s[mv.y][mv.x]; if(!mover || mover.t!=='K') return false;
    if(mv.m.cap) return false;
    const cBoard=clone(s); apply(cBoard,mv.x,mv.y,mv.m);
    const givesChk = isCheck(cBoard, opp);
    if(givesChk) return false;
    const safeAfter = safeAround(cBoard, oppK.x, oppK.y, opp);
    // se não reduz casas seguras do rei adversário, é movimento passivo de rei
    return safeAfter >= baseSafe;
  }
  return ms.slice().sort((a,b)=>{
    // Primeiro: evitar lances inseguros (não sacrificar peças valiosas só para checar)
    const aUnsafe = isMoveUnsafe(a)?1:0;
    const bUnsafe = isMoveUnsafe(b)?1:0;
    if(aUnsafe!==bUnsafe) return aUnsafe - bUnsafe;
    const aCheck=givesCheckOn(s,a);
    const bCheck=givesCheckOn(s,b);
    if(aCheck!==bCheck) return bCheck - aCheck; // cheques primeiro
    const ac=a.m.cap?1:0, bc=b.m.cap?1:0;
    if(ac!==bc) return bc - ac; // capturas depois
    // Progresso de rede de mate: preferir reduzir casas seguras do rei adversário
    if(oppK){
      const cA=clone(s); apply(cA,a.x,a.y,a.m);
      const cB=clone(s); apply(cB,b.x,b.y,b.m);
      const safeA = safeAround(cA, oppK.x, oppK.y, opp);
      const safeB = safeAround(cB, oppK.x, oppK.y, opp);
      if(safeA!==safeB) return safeA - safeB; // menores casas seguras primeiro
    }
    // Em KRRK, subir lances com padrão de escadinha
    const la = ladderScore(a);
    const lb = ladderScore(b);
    if(la!==lb) return lb - la; // maior score primeiro
    // Anti-repetição: rebaixar lances de rei sem progresso em finais
    const aNoProg = kingNoProgress(a)?1:0;
    const bNoProg = kingNoProgress(b)?1:0;
    if(aNoProg!==bNoProg) return aNoProg - bNoProg;
    // Sacrifícios sem cheque: colocar depois de lances não-sacrifício
    const aSac = isSacrificeMove(s,a) && !aCheck;
    const bSac = isSacrificeMove(s,b) && !bCheck;
    if(aSac!==bSac) return (aSac?1:0) - (bSac?1:0);
    // Evitar “dança” de rei: lances de rei sem cheque nem captura por último
    const aIsKing = !!(s[a.y][a.x]) && s[a.y][a.x].t==='K';
    const bIsKing = !!(s[b.y][b.x]) && s[b.y][b.x].t==='K';
    const aPassiveKing = aIsKing && !a.m.cap && !aCheck ? 1 : 0;
    const bPassiveKing = bIsKing && !b.m.cap && !bCheck ? 1 : 0;
    if(aPassiveKing!==bPassiveKing) return aPassiveKing - bPassiveKing;
    // killers e histórico
    let aKill=0, bKill=0;
    const ksA = killerMoves.flat().filter(Boolean);
    for(const k of ksA){
      if(k.m && k.m.x===a.m.x && k.m.y===a.m.y && k.x===a.x && k.y===a.y) aKill++;
      if(k.m && k.m.x===b.m.x && k.m.y===b.m.y && k.x===b.x && k.y===b.y) bKill++;
    }
    if(aKill!==bKill) return bKill - aKill;
    const aHist = historyScores[color+'|'+a.m.x+'|'+a.m.y]||0;
    const bHist = historyScores[color+'|'+b.m.x+'|'+b.m.y]||0;
    if(aHist!==bHist) return bHist - aHist;
    // MVV-LVA em capturas
    if(ac && bc){
      const diff=mvv(b)-mvv(a);
      if(diff!==0) return diff;
    }
    const cA=clone(s); apply(cA,a.x,a.y,a.m);
    const cB=clone(s); apply(cB,b.x,b.y,b.m);
    const mobA=allLegal(cA,color).length;
    const mobB=allLegal(cB,color).length;
    return mobB - mobA;
  });
}

function minimaxTal(s, d, a, b, max, ply=0){
  const color = max ? 'black' : 'white';
  const key = posKey(s, color);
  const tt = TT.get(key);
  if(tt && tt.depth >= d){
    if(tt.flag==='EXACT') return { score: tt.score, best: tt.best };
    if(tt.flag==='LOWER') a = Math.max(a, tt.score);
    else if(tt.flag==='UPPER') b = Math.min(b, tt.score);
    if(a>=b) return { score: tt.score, best: tt.best };
  }
  const ms = allLegal(s, color);
  if(ms.length===0){
    const losing = isCheck(s, color);
    const score = losing ? (-MATE_SCORE + ply) : 0;
    return { score };
  }
  if(d===0){
    const qs = qSearch(s, a, b, max);
    return { score: qs };
  }
  let best=null;
  if(max){
    let me=-1e9, moveIndex=0;
    for(const mv of orderTal(ms, s, color)){
      const c=clone(s); apply(c, mv.x, mv.y, mv.m);
      const opp = 'white';
      const isChk = isCheck(c, opp);
      const isCap = !!mv.m.cap;
      const mover = s[mv.y][mv.x];
      // Bloquear capivaradas: lances inseguros que não criam ameaça de mate
      const unsafe = isMoveUnsafeGlobal(s, mv);
      const mateSac = isMateThreatSacrifice(s, mv, color);
      if(unsafe && !mateSac){ logTalW('Capivarada bloqueada', { piece: mover && mover.t, from: {x: mv.x, y: mv.y}, to: {x: mv.m.x, y: mv.m.y}, check: isChk }); moveIndex++; continue; }
      // Sacrifícios pesados sem cheque continuam bloqueados
      const isBlockedSac = mover && (mover.t==='Q' || mover.t==='B' || mover.t==='R') && isSacrificeMove(s, mv) && !isChk;
      if(isBlockedSac){ logTalW('Sacrifício pesado sem cheque bloqueado', { piece: mover.t, from: {x: mv.x, y: mv.y}, to: {x: mv.m.x, y: mv.m.y} }); moveIndex++; continue; }
      const isSac = isSacrificeMove(s, mv) && !isChk;
      const oppMob = allLegal(c, opp).length;
      let nextDepth = d - 1 + (isChk ? (oppMob<=3 ? 2 : 1) : 0);
      if(!isChk && !isCap && d>=3 && moveIndex>=3) nextDepth = Math.max(1, nextDepth - 1);
      if(isSac && d>=3) nextDepth = Math.max(1, nextDepth - 2);
      const r=minimaxTal(c, nextDepth, a, b, false, ply+1);
      if(r.score>me){ me=r.score; best=mv; }
      a=Math.max(a, me);
      if(a>=b){
        if(!isCap && !isChk){
          killerMoves[ply] = killerMoves[ply] || [];
          if(!killerMoves[ply][0]) killerMoves[ply][0]=mv;
          else if(!killerMoves[ply][1]) killerMoves[ply][1]=mv;
          const hk = color+'|'+mv.m.x+'|'+mv.m.y;
          historyScores[hk] = (historyScores[hk]||0) + (d*d);
        }
        TT.set(key, { depth: d, score: me, best, flag: 'LOWER' });
        return { score: me, best };
      }
      moveIndex++;
    }
    TT.set(key, { depth: d, score: me, best, flag: 'EXACT' });
    return { score: me, best };
  } else {
    let mi=1e9, moveIndex=0;
    for(const mv of orderTal(ms, s, color)){
      const c=clone(s); apply(c, mv.x, mv.y, mv.m);
      const opp = 'black';
      const isChk = isCheck(c, opp);
      const isCap = !!mv.m.cap;
      const mover = s[mv.y][mv.x];
      // Bloquear capivaradas: lances inseguros que não criam ameaça de mate
      const unsafe = isMoveUnsafeGlobal(s, mv);
      const mateSac = isMateThreatSacrifice(s, mv, color);
      if(unsafe && !mateSac){ logTalW('Capivarada bloqueada', { piece: mover && mover.t, from: {x: mv.x, y: mv.y}, to: {x: mv.m.x, y: mv.m.y}, check: isChk }); moveIndex++; continue; }
      // Sacrifícios pesados sem cheque continuam bloqueados
      const isBlockedSac = mover && (mover.t==='Q' || mover.t==='B' || mover.t==='R') && isSacrificeMove(s, mv) && !isChk;
      if(isBlockedSac){ logTalW('Sacrifício pesado sem cheque bloqueado', { piece: mover.t, from: {x: mv.x, y: mv.y}, to: {x: mv.m.x, y: mv.m.y} }); moveIndex++; continue; }
      const isSac = isSacrificeMove(s, mv) && !isChk;
      const oppMob = allLegal(c, opp).length;
      let nextDepth = d - 1 + (isChk ? (oppMob<=3 ? 2 : 1) : 0);
      if(!isChk && !isCap && d>=3 && moveIndex>=3) nextDepth = Math.max(1, nextDepth - 1);
      if(isSac && d>=3) nextDepth = Math.max(1, nextDepth - 2);
      const r=minimaxTal(c, nextDepth, a, b, true, ply+1);
      if(r.score<mi){ mi=r.score; best=mv; }
      b=Math.min(b, mi);
      if(a>=b){
        if(!isCap && !isChk){
          killerMoves[ply] = killerMoves[ply] || [];
          if(!killerMoves[ply][0]) killerMoves[ply][0]=mv;
          else if(!killerMoves[ply][1]) killerMoves[ply][1]=mv;
          const hk = color+'|'+mv.m.x+'|'+mv.m.y;
          historyScores[hk] = (historyScores[hk]||0) + (d*d);
        }
        TT.set(key, { depth: d, score: mi, best, flag: 'UPPER' });
        return { score: mi, best };
      }
      moveIndex++;
    }
    TT.set(key, { depth: d, score: mi, best, flag: 'EXACT' });
    return { score: mi, best };
  }
}

// Heurísticas e Tabela de Transposição para Tal
const MATE_SCORE = 100000;
const TT = new Map(); // key -> { depth, score, best, flag } ; flags: 'EXACT','LOWER','UPPER'
const killerMoves = []; // por ply: [mv1, mv2]
const historyScores = Object.create(null); // "color|x|y" -> score
function posKey(s, side){
  let b = '';
  for (let y=0; y<8; y++) for (let x=0; x<8; x++){
    const p = s[y][x];
    b += p ? (p.c[0] + p.t + (p.m ? '1' : '0')) : '.';
  }
  const ep = enp ? (enp.x + ',' + enp.y + ',' + enp.forColor) : '-';
  return b + '|' + side + '|' + ep;
}

// FEN helpers para Explorer/Tablebase
function pieceToFENChar(p){
  if(!p) return null;
  const ch = p.t; // 'P','N','B','R','Q','K'
  return p.c==='white' ? ch : ch.toLowerCase();
}
function getCastlingRights(s){
  let rights='';
  // White
  const wK = s[0][4];
  const wRk = s[0][7];
  const wRq = s[0][0];
  if(wK && wK.t==='K' && wK.c==='white' && !wK.m){
    if(wRk && wRk.t==='R' && wRk.c==='white' && !wRk.m) rights+='K';
    if(wRq && wRq.t==='R' && wRq.c==='white' && !wRq.m) rights+='Q';
  }
  // Black
  const bK = s[7][4];
  const bRk = s[7][7];
  const bRq = s[7][0];
  if(bK && bK.t==='K' && bK.c==='black' && !bK.m){
    if(bRk && bRk.t==='R' && bRk.c==='black' && !bRk.m) rights+='k';
    if(bRq && bRq.t==='R' && bRq.c==='black' && !bRq.m) rights+='q';
  }
  return rights || '-';
}
function toFEN(s, side){
  // ranks de 8->1: y=7 até y=0
  const ranks=[];
  for(let y=7; y>=0; y--){
    let run=0, rank='';
    for(let x=0; x<8; x++){
      const ch = pieceToFENChar(s[y][x]);
      if(!ch){ run++; }
      else {
        if(run>0){ rank += String(run); run=0; }
        rank += ch;
      }
    }
    if(run>0) rank += String(run);
    ranks.push(rank);
  }
  const board = ranks.join('/');
  const active = side==='black' ? 'b' : 'w';
  const castle = getCastlingRights(s);
  const ep = enp ? String.fromCharCode(97 + enp.x) + String(enp.y + 1) : '-';
  return `${board} ${active} ${castle} ${ep} 0 1`;
}
// UCI helpers
function uciToCoords(uci){
  // e2e4, e7e8q
  if(!uci || uci.length < 4) return null;
  const fx = uci.charCodeAt(0) - 97;
  const fy = (uci.charCodeAt(1) - 48) - 1;
  const tx = uci.charCodeAt(2) - 97;
  const ty = (uci.charCodeAt(3) - 48) - 1;
  const promo = uci.length>=5 ? uci[4].toUpperCase() : null; // 'Q','R','B','N'
  if(fx<0||fx>7||tx<0||tx>7||fy<0||fy>7||ty<0||ty>7) return null;
  return { fx, fy, tx, ty, promo };
}
function findLegalMoveByUCI(s, color, uci){
  const cc = uciToCoords(uci);
  if(!cc) return null;
  const ms = allLegal(s, color);
  for(const mv of ms){
    if(mv.x===cc.fx && mv.y===cc.fy && mv.m.x===cc.tx && mv.m.y===cc.ty){
      // promoção: se houver, adaptar (nos seus dados, promo pode estar em mv.m.prom)
      if(cc.promo){
        if(!mv.m.prom || mv.m.prom !== cc.promo) continue;
      }
      return mv;
    }
  }
  return null;
}
// Fetch do Explorer
async function fetchLichessBookMove(s, color){
  try{
    const fen = toFEN(s, color);
    const url = `https://explorer.lichess.ovh/lichess?fen=${encodeURIComponent(fen)}&moves=20`;
    const res = await fetch(url, { method: 'GET' });
    if(!res.ok) return null;
    const data = await res.json();
    const moves = (data && data.moves) || [];
    if(!moves.length) return null;
    // escolhe o mais jogado
    moves.sort((a,b)=>((b.white||0)+(b.black||0)) - ((a.white||0)+(a.black||0)));
    const uci = moves[0].uci || moves[0].sanUci || null;
    if(!uci) return null;
    return findLegalMoveByUCI(s, color, uci);
  }catch(_){ return null; }
}
// Fetch da Tablebase
async function fetchTablebaseMove(s, color){
  try{
    const fen = toFEN(s, color);
    const url = `https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(fen)}`;
    const res = await fetch(url, { method: 'GET' });
    if(!res.ok) return null;
    const data = await res.json();
    const moves = (data && data.moves) || [];
    if(!moves.length) return null;
    // Ordena conforme categoria da tablebase:
    // win: menor distância ao mate
    // loss: maior distância (prolonga)
    // draw: mantém ordem
    let sorted = moves.slice();
    const metric = (m)=>{
      if(m && typeof m.dttz === 'number') return m.dttz;
      if(m && typeof m.dtz === 'number') return m.dtz;
      return 9999;
    };
    if(data && data.category === 'win'){
      sorted.sort((a,b)=> metric(a) - metric(b));
    } else if(data && data.category === 'loss'){
      sorted.sort((a,b)=> metric(b) - metric(a));
    } else {
      // draw ou desconhecido: mantém como veio
    }
    for(const m of sorted){
      const uci = m && m.uci;
      if(!uci) continue;
      const pm = findLegalMoveByUCI(s, color, uci);
      if(pm) return pm;
    }
    return null;
  }catch(_){ return null; }
}

// Chess AI Worker: computes best move without blocking the UI
// Receives: { g, color, level, enp }
// Responds: { x, y, m } or { move: null }

let enp = null; // {x,y,forColor}

function inB(x,y){ return x>=0 && x<8 && y>=0 && y<8; }
function clone(s){ return s.map(r=>r.map(c=> c ? {t:c.t,c:c.c,m:!!c.m} : null)); }

function pseudoOn(s,x,y){
  const p=s[y][x],ms=[]; if(!p) return ms;
  const add=(nx,ny)=>{ if(!inB(nx,ny)) return; const q=s[ny][nx]; if(!q) ms.push({x:nx,y:ny}); else if(q.c!==p.c) ms.push({x:nx,y:ny,cap:true}); };
  if(p.t==='N'){
    for(const[dx,dy]of[[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]) add(x+dx,y+dy);
  }else if(p.t==='B'||p.t==='R'||p.t==='Q'){
    const dirs=[]; if(p.t!=='R') dirs.push([1,1],[1,-1],[-1,1],[-1,-1]); if(p.t!=='B') dirs.push([1,0],[-1,0],[0,1],[0,-1]);
    for(const[dx,dy]of dirs){ let nx=x+dx, ny=y+dy; while(inB(nx,ny)&&!s[ny][nx]){ ms.push({x:nx,y:ny}); nx+=dx; ny+=dy; } if(inB(nx,ny)&&s[ny][nx]&&s[ny][nx].c!==p.c) ms.push({x:nx,y:ny,cap:true}); }
  }else if(p.t==='K'){
    for(const[dx,dy]of[[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]) add(x+dx,y+dy);
  }else if(p.t==='P'){
    const dir=p.c==='white'?1:-1;
    for(const dx of[-1,1]){
      const cx=x+dx, cy=y+dir;
      if(inB(cx,cy)&&s[cy][cx]&&s[cy][cx].c!==p.c) ms.push({x:cx,y:cy,cap:true});
      if(enp && enp.forColor===p.c && enp.x===cx && enp.y===cy){ if(inB(cx,y)&&s[y][cx]&&s[y][cx].t==='P'&&s[y][cx].c!==p.c){ ms.push({x:cx,y:cy,cap:true,ep:true}); } }
    }
    const nx=x,ny=y+dir; if(inB(nx,ny)&&!s[ny][nx]){ ms.push({x:nx,y:ny}); const sy=p.c==='white'?1:6; const ny2=y+2*dir; if(y===sy&&inB(nx,ny2)&&!s[ny2][nx]&&!s[ny][nx]) ms.push({x:nx,y:ny2}); }
  }
  return ms;
}

function attacked(s,color,x,y){
  const opp = color==='white'?'black':'white';
  for(let yy=0;yy<8;yy++) for(let xx=0;xx<8;xx++){
    const p=s[yy][xx]; if(!p||p.c!==opp) continue;
    let at=[];
    if(p.t==='K'){
      for(const [dx,dy] of [[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]){ const nx=xx+dx, ny=yy+dy; if(inB(nx,ny)) at.push({x:nx,y:ny}); }
    }else{
      at = pseudoOn(s,xx,yy);
      at = at.filter(m=>!m.castle);
      if(p.t==='P') at = at.filter(m=>m.cap);
    }
    if(at.some(m=>m.x===x && m.y===y)) return true;
  }
  return false;
}

function isCheck(s,color){ let kx=-1,ky=-1; for(let y=0;y<8;y++) for(let x=0;x<8;x++){ const p=s[y][x]; if(p&&p.c===color&&p.t==='K'){ kx=x; ky=y; } } const opp=color==='white'?'black':'white'; for(let y=0;y<8;y++) for(let x=0;x<8;x++){ const p=s[y][x]; if(!p||p.c!==opp) continue; let at=pseudoOn(s,x,y); if(p.t==='P') at = at.filter(m=>m.cap); if(at.some(m=>m.x===kx&&m.y===ky)) return true; } return false; }

function legalOn(s,x,y){
  const p=s[y][x]; let ms=pseudoOn(s,x,y);
  if(p && p.t==='K'){
    const hasMoved=!!p.m; const rank=y;
    if(!hasMoved && x===4 && (rank===0||rank===7) && !isCheck(s,p.c)){
      const rookK=s[rank][7]; if(rookK && rookK.t==='R' && rookK.c===p.c && !rookK.m){ if(!s[rank][5] && !s[rank][6] && !attacked(s,p.c,5,rank) && !attacked(s,p.c,6,rank)) ms.push({x:6,y:rank,castle:'K'}); }
      const rookQ=s[rank][0]; if(rookQ && rookQ.t==='R' && rookQ.c===p.c && !rookQ.m){ if(!s[rank][1] && !s[rank][2] && !s[rank][3] && !attacked(s,p.c,3,rank) && !attacked(s,p.c,2,rank)) ms.push({x:2,y:rank,castle:'Q'}); }
    }
  }
  return ms.filter(m=>{ const c=clone(s); apply(c,x,y,m); return !isCheck(c,p.c); });
}

function allLegal(s,color){ let ms=[]; for(let y=0;y<8;y++) for(let x=0;x<8;x++){ const p=s[y][x]; if(p&&p.c===color){ const lm=legalOn(s,x,y); for(const m of lm) ms.push({x,y,m}); } } return ms; }

function apply(s,x,y,m){ const p=s[y][x]; s[y][x]=null; if(m.ep){ const dir=(p.c==='white'?1:-1); const cy=m.y - dir; const cx=m.x; if(s[cy][cx] && s[cy][cx].t==='P') s[cy][cx]=null; } if(m.castle){ s[m.y][m.x]=p; if(s[m.y][m.x]) s[m.y][m.x].m=true; if(m.castle==='K'){ const r=s[m.y][7]; s[m.y][7]=null; s[m.y][5]=r; if(s[m.y][5]) s[m.y][5].m=true; } else if(m.castle==='Q'){ const r=s[m.y][0]; s[m.y][0]=null; s[m.y][3]=r; if(s[m.y][3]) s[m.y][3].m=true; } } else { s[m.y][m.x]=p; if(s[m.y][m.x]) s[m.y][m.x].m=true; } if(p.t==='P' && ((p.c==='white'&&m.y===7) || (p.c==='black'&&m.y===0))){ const tp=m.promote||'Q'; s[m.y][m.x]={t:tp,c:p.c}; } }

function order(ms){ return ms.slice().sort((a,b)=>((b.m.cap?1:0)-(a.m.cap?1:0))); }

function evalS(s){ const val={P:100,N:320,B:320,R:500,Q:900,K:0}; let score=0,mobB=0,mobW=0; for(let y=0;y<8;y++) for(let x=0;x<8;x++){ const p=s[y][x]; if(!p) continue; score+= p.c==='black'? val[p.t] : -val[p.t]; if(p.c==='black') mobB += pseudoOn(s,x,y).length; else mobW += pseudoOn(s,x,y).length; } return score + 0.1*(mobB - mobW); }

function compDepth(s){ let pcs=0; for(let y=0;y<8;y++) for(let x=0;x<8;x++) if(s[y][x]) pcs++; if(pcs<=10) return 4; if(pcs<=18) return 3; return 2; }

function minimax(s,d,a,b,max){ const color=max?'black':'white'; const ms=allLegal(s,color); if(d===0||ms.length===0){ if(ms.length===0) return {score:max?-9999:9999}; return {score:evalS(s)} } let best=null; if(max){ let me=-1e9; for(const mv of order(ms)){ const c=clone(s); apply(c,mv.x,mv.y,mv.m); const r=minimax(c,d-1,a,b,false); if(r.score>me){ me=r.score; best=mv; } a=Math.max(a,me); if(b<=a) break; } return {score:me,best}; } else { let mi=1e9; for(const mv of order(ms)){ const c=clone(s); apply(c,mv.x,mv.y,mv.m); const r=minimax(c,d-1,a,b,true); if(r.score<mi){ mi=r.score; best=mv; } b=Math.min(b,mi); if(b<=a) break; } return {score:mi,best}; } }

// Tal-style
function evalAgg(s){
  // Avaliação agressiva: material + mobilidade reforçada + segurança do rei + controle de centro + avanço de peões
  const val={P:100,N:320,B:330,R:510,Q:900,K:0};
  let score=0, mobB=0, mobW=0;
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    const p=s[y][x]; if(!p) continue;
    // material
    score += (p.c==='black'? val[p.t] : -val[p.t]);
    // mobilidade bruta
    const mlen = pseudoOn(s,x,y).length;
    if(p.c==='black') mobB += mlen; else mobW += mlen;
    // centro: bonus por proximidade ao centro
    const cx = Math.abs(3.5 - x), cy = Math.abs(3.5 - y); const centerBonus = Math.max(0, 3 - (cx+cy));
    score += (p.c==='black'? +centerBonus*2 : -centerBonus*2);
    // avanço de peões
    if(p.t==='P'){
      if(p.c==='black') score += (6 - y) * 5; else score -= (y - 1) * 5;
    }
    // penalização por peças penduradas (atacadas e mal defendidas)
    const opp = p.c==='black' ? 'white' : 'black';
    const def = countDefenders(s, p.c, x, y);
    const att = countAttackers(s, opp, x, y);
    if(att.count > 0 && def.count === 0){
      const penalty = (valMap[p.t] || 0) * 0.6;
      score += (p.c==='black' ? -penalty : +penalty);
    } else if(att.count > 0 && def.count > 0){
      // SEE simples: se menor atacante adversário cobre a troca, penaliza um pouco
      const myVal = valMap[p.t] || 0;
      if(att.minVal <= myVal){
        const penalty = (myVal - att.minVal) * 0.4 + 40;
        score += (p.c==='black' ? -penalty : +penalty);
      }
    }
  }
  // segurança do rei: bônus por colocar o rei adversário em xeque
  const inCheckWhite = isCheck(s,'white');
  const inCheckBlack = isCheck(s,'black');
  if(inCheckWhite) score += CHECK_BONUS;
  if(inCheckBlack) score -= CHECK_BONUS;
  // ameaça de mate: pouca mobilidade do lado em xeque recebe bônus extra
  const wm = allLegal(s, 'white').length;
  const bm = allLegal(s, 'black').length;
  if(inCheckWhite && wm <= 3) score += MATE_THREAT_BONUS;
  if(inCheckBlack && bm <= 3) score -= MATE_THREAT_BONUS;
  // mobilidade reforçada
  score += 0.2 * (mobB - mobW);
  return score;
}

function searchTalIterative(s, color, baseDepth){
  // limpa heurísticas por pesquisa
  for(let i=0;i<64;i++) killerMoves[i]=[null,null];
  for(const k of Object.keys(historyScores)) delete historyScores[k];
  let best=null;
  let lastScore=0;
  for(let d=1; d<=baseDepth; d++){
    if(timeUp()) break;
    // aspiration window em torno do último score
    let alpha = lastScore - 200, beta = lastScore + 200;
    let r = minimaxTal(s, d, alpha, beta, (color==='black'), 0);
    // se falhar alto/baixo, abre a janela
    if(r && typeof r.score==='number' && (r.score<=alpha || r.score>=beta)){
      r = minimaxTal(s, d, -1e9, 1e9, (color==='black'), 0);
    }
    if(r && r.best) best = r.best;
    if(r && typeof r.score==='number') lastScore = r.score;
  }
  return best;
}