// ============================================================
// Formatação PURA de apresentação (sem regra de negócio, sem DOM).
// Nada aqui altera o valor de origem: só decide como ele é mostrado.
// Nunca devolve "undefined", "null", "NaN" ou "Infinity" como texto.
// ============================================================

const MAPA_HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa texto para uso seguro em HTML (conteúdo e atributos). */
export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => MAPA_HTML[c]);
}

/** Texto para exibição: vazio/ausente vira "—" (nunca "null"/"undefined"). */
export function texto(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  return esc(valor);
}

const nf3 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const nf6 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 });
const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nfInt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** "1.234,5 kg". Só apresentação: até 3 casas (até 6 se o valor for pequeno demais para aparecer). */
export function formatarKg(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  let s = nf3.format(n);
  if (n !== 0 && /^-?0$/.test(s)) s = nf6.format(n);
  if (n > 0 && s === '0') return '<0,000001 kg'; // positivo menor que a menor casa exibida: nunca mostrar "0 kg"
  return `${s} kg`;
}

export function formatarInteiro(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return nfInt.format(n);
}

/** "60,0%". Valor positivo que arredondaria para 0,0 aparece como "<0,1%". */
export function formatarPercentual(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  if (n > 0 && n < 0.05) return '<0,1%';
  return `${nf1.format(n)}%`;
}

/** "2026-09-21" -> "21/09/2026" (manipulação de texto; não cria objeto Date). */
export function formatarData(iso) {
  const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

/** Data local de hoje em YYYY-MM-DD (só para pré-preencher o campo de data do formulário). */
export function hojeIso(agora = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}

/** ISO 8601 completo ("2026-09-22T20:10:00.000Z") -> "22/09/2026 20:10" no horário local do navegador (Sprint 8: data/hora de backups). */
export function formatarDataHora(iso) {
  const d = typeof iso === 'string' && iso !== '' ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Bytes -> "B"/"KB"/"MB" (Sprint 8: tamanho de arquivos de backup). Só apresentação, sem arredondar o valor de origem. */
export function formatarBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${nfInt.format(n)} B`;
  if (n < 1024 * 1024) return `${nfInt.format(n / 1024)} KB`;
  return `${nf1.format(n / (1024 * 1024))} MB`;
}

/** Cor determinística por posição (ângulo áureo): posições vizinhas sempre distintas. */
export function corPorIndice(i) {
  const hue = Math.round((i * 137.508) % 360);
  const luz = 42 + ((i * 7) % 12);
  return `hsl(${hue}, 58%, ${luz}%)`;
}

/** "68,5" — número em pt-BR sem unidade (até 3 casas), para colunas cujo cabeçalho já diz a unidade. */
export function formatarNumero(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return nf3.format(n);
}

// Paleta fixa do redesenho do Dashboard: as 5 primeiras posições seguem o layout de referência
// (azul, verde, laranja, roxo, cinza); depois vêm mais 5 tons bem distintos e, a partir daí, a
// sequência determinística de corPorIndice. A posição é a ordem em que a API devolve os
// materiais (maior peso primeiro), então o mesmo material tem a mesma cor em todos os gráficos.
const PALETA_MATERIAIS = Object.freeze(['#3b82f6', '#22a35a', '#f5a524', '#8b5cf6', '#7b8481', '#ef4444', '#14b8a6', '#ec4899', '#a16207', '#6366f1']);

export function corMaterial(i) {
  return i >= 0 && i < PALETA_MATERIAIS.length ? PALETA_MATERIAIS[i] : corPorIndice(i);
}

const nf2 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
/** "59,31 kg" — peso com no máximo 2 casas, para indicadores de resumo (ex.: média). Valor positivo minúsculo cai no formatarKg. */
export function formatarKgResumo(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const s = nf2.format(n);
  if (n !== 0 && /^-?0$/.test(s)) return formatarKg(n);
  return `${s} kg`;
}
