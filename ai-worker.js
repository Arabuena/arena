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
  if(inCheckWhite) score += 50;
  if(inCheckBlack) score -= 50;
  // mobilidade reforçada
  score += 0.2 * (mobB - mobW);
  return score;
}

function orderTal(ms,s,color){
  // Priorizar cheques, capturas, killers e histórico; depois MVV-LVA, segurança e mobilidade
  function mvv(mv){
    const victim = s[mv.m.y][mv.m.x];
    const attacker = s[mv.y][mv.x];
    const vv = victim ? valMap[victim.t] : 0;
    const av = attacker ? valMap[attacker.t] : 0;
    return vv - av;
  }
  return ms.slice().sort((a,b)=>{
    const aCheck=givesCheckOn(s,a);
    const bCheck=givesCheckOn(s,b);
    if(aCheck!==bCheck) return bCheck - aCheck;
    const ac=a.m.cap?1:0, bc=b.m.cap?1:0;
    if(ac!==bc) return bc - ac;
    // segurança do destino: evitar lances que deixam peça pendurada
    const aUnsafe = isMoveUnsafe(s, a) ? 1 : 0;
    const bUnsafe = isMoveUnsafe(s, b) ? 1 : 0;
    if(aUnsafe!==bUnsafe) return aUnsafe - bUnsafe;
    // MVV-LVA entre capturas
    if(ac && bc){
      const diff=mvv(b)-mvv(a);
      if(diff!==0) return diff;
    }
    // mobilidade futura
    const cA=clone(s); apply(cA,a.x,a.y,a.m);
    const cB=clone(s); apply(cB,b.x,b.y,b.m);
    const mobA=allLegal(cA,color).length;
    const mobB=allLegal(cB,color).length;
    return mobB - mobA;
  });
}

function searchTalIterative(s, color, baseDepth){
  // limpa heurísticas por pesquisa
  for(let i=0;i<64;i++) killerMoves[i]=[null,null];
  for(const k of Object.keys(historyScores)) delete historyScores[k];
  let best=null;
  for(let d=1; d<=baseDepth; d++){
    const r = minimaxTal(s, d, -1e9, 1e9, (color==='black'), 0);
    if(r && r.best) best = r.best;
  }
  return best;
}

onmessage = function(e){
  try{
    const data = e.data || {};
    const s = data.g ? data.g.map(r=>r.map(c=> c? {t:c.t,c:c.c,m:!!c.m} : null)) : null;
    enp = data.enp || null;
    const color = data.color || 'black';
    const level = data.level || 'medio';
    if(!s){ postMessage({ move: null }); return; }
    let mv=null;
    if(level==='facil'){
      const ms=allLegal(s,color); if(ms.length){ mv = ms[Math.floor(Math.random()*ms.length)]; }
    }else if(level==='medio'){
      const ms=allLegal(s,color); if(ms.length){ let best=ms[0],bs=-1e9; for(const m of ms){ const c=clone(s); apply(c,m.x,m.y,m.m); let sc=evalS(c); sc = (color==='black')? sc : -sc; if(sc>bs){ bs=sc; best=m; } } mv=best; }
    }else if(level==='dificil'){
      const depth = compDepth(s); const r=minimax(s,depth,-1e9,1e9,(color==='black')); if(r && r.best) mv=r.best;
    }else{
      const pcs = s.flat().filter(Boolean).length;
      const depth = pcs<=10?6:(pcs<=18?5:4);
      const best = searchTalIterative(s, color, depth);
      if(best) mv = best;
    }
    if(mv) postMessage({ x: mv.x, y: mv.y, m: mv.m }); else postMessage({ move: null });
  }catch(_){ postMessage({ move: null }); }
};