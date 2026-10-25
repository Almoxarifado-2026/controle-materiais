// ============================================================
// Comparação com o período anterior (redesenho do Dashboard).
// Funções PURAS, sem rede e sem DOM. Partem SEMPRE do período que o BACKEND
// já resolveu (filtroAplicado.dataInicial/dataFinal) — nunca decidem qual é o
// período atual. Só derivam, a partir dele, o intervalo imediatamente anterior
// de mesmo tamanho, que é então consultado no MESMO endpoint (/api/dashboard):
// todos os totais continuam sendo calculados pelo backend.
//
// Regras do intervalo anterior:
//  - período formado por meses inteiros (começa no dia 1 e termina no último dia
//    de um mês): os mesmos N meses imediatamente anteriores (setembro -> agosto,
//    mesmo com tamanhos diferentes em dias). 1 mês = "mês anterior"; um ano civil
//    inteiro = "ano anterior".
//  - qualquer outro período: os N dias imediatamente anteriores. 1 dia = "dia
//    anterior"; 7 dias = "semana anterior".
//  - período aberto (sem uma das datas) ou inválido: sem comparação (null).
// ============================================================

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const UM_DIA_MS = 24 * 60 * 60 * 1000;
const p2 = (n) => String(n).padStart(2, '0');

function partes(iso) {
  const m = typeof iso === 'string' ? ISO.exec(iso) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
const utc = ([a, m, d]) => Date.UTC(a, m - 1, d);
const ultimoDia = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate(); // mes: 1..12
function isoDe(t) {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

/** { dataInicial, dataFinal, rotulo } do intervalo anterior, ou null se não houver comparação possível. */
export function periodoAnterior(dataInicial, dataFinal) {
  const ini = partes(dataInicial);
  const fim = partes(dataFinal);
  if (!ini || !fim || utc(ini) > utc(fim)) return null;

  if (ini[2] === 1 && fim[2] === ultimoDia(fim[0], fim[1])) {
    const meses = (fim[0] - ini[0]) * 12 + (fim[1] - ini[1]) + 1;
    const base = ini[0] * 12 + (ini[1] - 1); // mês inicial em "meses absolutos"
    const a0 = Math.floor((base - meses) / 12);
    const m0 = ((base - meses) % 12) + 1;
    const a1 = Math.floor((base - 1) / 12);
    const m1 = ((base - 1) % 12) + 1;
    if (a0 < 1) return null;
    let rotulo = 'período anterior';
    if (meses === 1) rotulo = 'mês anterior';
    else if (meses === 12 && ini[1] === 1) rotulo = 'ano anterior';
    return { dataInicial: `${a0}-${p2(m0)}-01`, dataFinal: `${a1}-${p2(m1)}-${p2(ultimoDia(a1, m1))}`, rotulo };
  }

  const dias = Math.round((utc(fim) - utc(ini)) / UM_DIA_MS) + 1;
  const fimAnterior = utc(ini) - UM_DIA_MS;
  const iniAnterior = fimAnterior - (dias - 1) * UM_DIA_MS;
  if (new Date(iniAnterior).getUTCFullYear() < 1) return null;
  let rotulo = 'período anterior';
  if (dias === 1) rotulo = 'dia anterior';
  else if (dias === 7) rotulo = 'semana anterior';
  return { dataInicial: isoDe(iniAnterior), dataFinal: isoDe(fimAnterior), rotulo };
}

/**
 * Variação percentual de `anterior` para `atual`.
 *  - { tipo: 'sobe' | 'desce' | 'igual', percentual } quando há base de comparação;
 *  - { tipo: 'sem-base' } quando o período anterior é zero e o atual não (não existe % finito);
 *  - { tipo: 'indisponivel' } para qualquer valor não numérico.
 */
export function variacao(atual, anterior) {
  const ok = (n) => typeof n === 'number' && Number.isFinite(n);
  if (!ok(atual) || !ok(anterior)) return { tipo: 'indisponivel' };
  if (anterior === 0) return atual === 0 ? { tipo: 'igual', percentual: 0 } : { tipo: 'sem-base' };
  const percentual = ((atual - anterior) / Math.abs(anterior)) * 100;
  if (Math.abs(percentual) < 0.5) return { tipo: 'igual', percentual: 0 };
  return { tipo: percentual > 0 ? 'sobe' : 'desce', percentual: Math.abs(percentual) };
}
