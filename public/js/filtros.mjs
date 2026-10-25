// ============================================================
// Estado dos filtros — SOMENTE os valores escolhidos, em memória.
// Não interpreta, não valida e não aplica filtro algum: quem interpreta
// e valida (inclusive o período padrão = mês atual) é o backend.
// Nada é gravado em armazenamento do navegador: recarregar a página
// volta ao estado vazio (e, portanto, ao mês atual do backend).
// Os mesmos valores valem para Dashboard, Histórico e Gráficos.
// ============================================================

export const CAMPOS_FILTRO = Object.freeze(['materialId', 'categoria', 'dataInicial', 'dataFinal']);

const estado = { materialId: '', categoria: '', dataInicial: '', dataFinal: '' };

export function obterFiltros() {
  return { ...estado };
}

export function definirFiltros(novos = {}) {
  for (const campo of CAMPOS_FILTRO) {
    if (novos[campo] !== undefined) estado[campo] = typeof novos[campo] === 'string' ? novos[campo] : '';
  }
}

export function limparFiltros() {
  for (const campo of CAMPOS_FILTRO) estado[campo] = '';
}

/** Parâmetros de query: apenas os campos preenchidos (o backend trata "não informado"). */
export function paraQuery(filtros = estado) {
  const q = {};
  for (const campo of CAMPOS_FILTRO) {
    if (typeof filtros[campo] === 'string' && filtros[campo] !== '') q[campo] = filtros[campo];
  }
  return q;
}

export function haDatasInformadas(filtros = estado) {
  return filtros.dataInicial !== '' || filtros.dataFinal !== '';
}
