// ── KRONOS · UTILITÁRIOS PUROS ───────────────────────────────────────────────
// Funções sem dependência de estado — podem ser importadas por qualquer módulo
// sem risco de circular dependency

// ── Constantes de tempo ───────────────────────────────────────────────────────
export const MS_PER_DAY  = 86400000;
export const MS_PER_HOUR = 3600000;
export const MS_PER_WEEK = 604800000;

// ── Debounce ──────────────────────────────────────────────────────────────────
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ── Formatadores de tempo/data ────────────────────────────────────────────────
export function fmtDur(ms){
  const s=Math.floor(ms/1000), h=Math.floor(s/3600),
        m=Math.floor((s%3600)/60), sec=s%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

export function fmtTime(ts){
  return new Date(ts).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}

export function fmtDate(d){
  return d.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'});
}

export function fmtShortDate(d){
  return d.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'});
}

// ── Chaves de data ────────────────────────────────────────────────────────────
// Formato: "YYYY-M-D" (mês 0-indexed, igual ao Date.getMonth())
export function dKey(d){
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dateKey(ts){ return dKey(new Date(ts)); }
export function todayKey(){   return dKey(new Date()); }

// ── Segurança / XSS ───────────────────────────────────────────────────────────
// Escapa &, <, >, " e ' — previne XSS em innerHTML e atributos onclick inline
export function escH(s){
  return String(s||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// Valida URLs — bloqueia javascript: e data:, retorna '#' se inválida
export function sanitizeUrl(url){
  try{
    const u = new URL(url);
    return (u.protocol==='http:' || u.protocol==='https:') ? url : '#';
  }catch(e){ return '#'; }
}

// ── Calendário ────────────────────────────────────────────────────────────────
// Retorna array de 6 dias (Seg→Sáb) para a semana offset
export function getWeekDays(offset=0){
  const now=new Date(); now.setHours(0,0,0,0);
  const day=now.getDay();
  const mon=new Date(now);
  mon.setDate(now.getDate()-(day===0?6:day-1)+offset*7);
  return Array.from({length:6},(_,i)=>{
    const d=new Date(mon); d.setDate(mon.getDate()+i); return d;
  });
}

// Retorna semanas (arrays de dias) que cobrem o mês year/month
export function getMonthWeeks(year, month){
  const weeks = [];
  const first = new Date(year, month, 1);
  const last  = new Date(year, month+1, 0);
  let cur = new Date(first);
  const dow = cur.getDay();
  cur.setDate(cur.getDate() - (dow===0?6:dow-1));  // recua para segunda

  while(cur <= last){
    const week = [];
    for(let i=0;i<6;i++){
      week.push(new Date(cur));
      cur.setDate(cur.getDate()+1);
    }
    weeks.push(week);
  }
  return weeks;
}
