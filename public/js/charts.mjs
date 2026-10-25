// ============================================================
// Gráficos em SVG puro (sem biblioteca), funções PURAS: recebem os dados
// EXATAMENTE como a API /api/graficos devolve e devolvem HTML/SVG em texto.
// Não recalculam a distribuição: o ângulo de cada fatia usa o `percentual`
// entregue pela API e o comprimento de cada barra usa o `pesoKg` entregue
// (só a escala visual da barra — proporção ao maior valor — é feita aqui).
// Nenhum estilo inline (a página tem CSP sem 'unsafe-inline' em estilos):
// cores vão em atributos SVG e o resto em classes do CSS.
// ============================================================

import { corMaterial, esc, formatarInteiro, formatarKg, formatarPercentual } from './format.mjs';

const CX = 100;
const CY = 100;
const RAIO = 92;

const ehNumeroFinito = (n) => typeof n === 'number' && Number.isFinite(n);

/** true se todos os itens têm os campos esperados (nunca desenha dado inválido). */
export function pizzaValida(pizza) {
  return Array.isArray(pizza) && pizza.every((f) => f && typeof f.material === 'string' && ehNumeroFinito(f.pesoKg) && ehNumeroFinito(f.percentual) && f.percentual > 0);
}
export function barrasValidas(barras) {
  return Array.isArray(barras) && barras.every((b) => b && typeof b.material === 'string' && ehNumeroFinito(b.pesoKg) && b.pesoKg > 0);
}

function ponto(anguloRad) {
  return [CX + RAIO * Math.cos(anguloRad), CY + RAIO * Math.sin(anguloRad)];
}

const rotuloFatia = (f) => `${f.material}: ${formatarKg(f.pesoKg)} (${formatarPercentual(f.percentual)})`;

/** Caminhos das fatias: começa no topo (−90°) e segue no sentido horário. */
export function fatiasDaPizza(pizza) {
  const inicioTopo = -Math.PI / 2;
  let acumulado = 0;
  return pizza.map((f, i) => {
    const a0 = inicioTopo + (Math.min(acumulado, 100) / 100) * 2 * Math.PI;
    acumulado += f.percentual;
    const ultima = i === pizza.length - 1;
    const a1 = inicioTopo + ((ultima ? 100 : Math.min(acumulado, 100)) / 100) * 2 * Math.PI;
    return { item: f, indice: i, a0, a1, cor: corMaterial(i) };
  });
}

export function svgPizza(pizza) {
  if (!pizzaValida(pizza) || pizza.length === 0) return '';
  let corpo;
  if (pizza.length === 1) {
    const f = pizza[0];
    corpo = `<circle class="fatia" cx="${CX}" cy="${CY}" r="${RAIO}" fill="${corMaterial(0)}"><title>${esc(rotuloFatia(f))}</title></circle>`;
  } else {
    corpo = fatiasDaPizza(pizza)
      .map(({ item, a0, a1, cor }) => {
        const [x0, y0] = ponto(a0);
        const [x1, y1] = ponto(a1);
        const grande = a1 - a0 > Math.PI ? 1 : 0;
        const d = `M ${CX} ${CY} L ${x0.toFixed(3)} ${y0.toFixed(3)} A ${RAIO} ${RAIO} 0 ${grande} 1 ${x1.toFixed(3)} ${y1.toFixed(3)} Z`;
        return `<path class="fatia" d="${d}" fill="${cor}"><title>${esc(rotuloFatia(item))}</title></path>`;
      })
      .join('');
  }
  return `<svg class="pizza" viewBox="0 0 200 200" role="img" aria-label="Gráfico de pizza: distribuição do peso por material">${corpo}</svg>`;
}

/** Legenda da pizza: cor, material, peso e percentual (valores da API). */
export function legendaPizza(pizza) {
  if (!pizzaValida(pizza)) return '';
  const itens = pizza
    .map(
      (f, i) => `<li class="legenda-item">
        <svg class="amostra" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="2" fill="${corMaterial(i)}"/></svg>
        <span class="legenda-nome">${esc(f.material)}</span>
        <span class="legenda-valor">${esc(formatarKg(f.pesoKg))} · ${esc(formatarPercentual(f.percentual))}</span>
      </li>`
    )
    .join('');
  return `<ul class="legenda">${itens}</ul>`;
}

/** Barras horizontais: uma linha por material; comprimento proporcional ao maior peso recebido. */
export function htmlBarras(barras) {
  if (!barrasValidas(barras) || barras.length === 0) return '';
  const maior = Math.max(...barras.map((b) => b.pesoKg));
  const linhas = barras
    .map((b, i) => {
      const largura = Math.max((b.pesoKg / maior) * 100, 0.5); // barra minúscula continua visível
      return `<li class="barra-linha">
        <span class="barra-nome" title="${esc(b.material)}">${esc(b.material)}</span>
        <svg class="barra-trilho" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="${esc(`${b.material}: ${formatarKg(b.pesoKg)}`)}">
          <rect class="barra-fundo" width="100" height="10" rx="1"/>
          <rect class="barra-valor-svg" width="${largura.toFixed(3)}" height="10" rx="1" fill="${corMaterial(i)}"/>
        </svg>
        <span class="barra-valor">${esc(formatarKg(b.pesoKg))}</span>
      </li>`;
    })
    .join('');
  return `<ul class="barras" aria-label="Gráfico de barras: peso total por material">${linhas}</ul>`;
}

// ------------------------------------------------------------
// Evolução temporal (Sprint 10) — peso total por período (dia/mês/ano).
// Mesmo princípio dos gráficos acima: função PURA, recebe os pontos
// EXATAMENTE como GET /api/dashboard/evolucao devolve (chave + pesoKg já
// somados pelo backend) e só calcula a proporção visual de cada barra.
// É um gráfico de BARRAS verticais — uma coluna por balde de tempo —, o
// mesmo tipo já usado acima para peso por material, só que agrupado por
// período em vez de por material.
// ------------------------------------------------------------

/** true se todos os pontos têm {chave: string, pesoKg: número finito >= 0} (zero é balde sem lançamento). */
export function evolucaoValida(pontos) {
  return Array.isArray(pontos) && pontos.length > 0 && pontos.every((p) => p && typeof p.chave === 'string' && ehNumeroFinito(p.pesoKg) && p.pesoKg >= 0);
}

/** Só reformata o texto da chave (já resolvida pelo backend) — não recalcula nenhuma data. */
function rotuloBalde(chave, granularidade) {
  if (granularidade === 'dia') {
    const [, mes, dia] = chave.split('-');
    return `${dia}/${mes}`;
  }
  if (granularidade === 'mes') {
    const [ano, mes] = chave.split('-');
    return `${mes}/${ano}`;
  }
  return chave; // ano: a chave já é 'YYYY'
}

/**
 * Barras verticais: uma coluna por balde de tempo; altura proporcional ao maior peso recebido.
 * Sprint 11 (refinamento): os RÓTULOS de data ficam numa linha de eixo SEPARADA, com no máximo
 * MAX_ROTULOS textos (sempre incluindo o primeiro e o último balde), em vez de um rótulo preso a
 * cada coluna — com muitos baldes (ex.: visão Mês, ~30 dias) uma coluna tem só alguns pixels de
 * largura em telas pequenas, e um rótulo "DD/MM" (5 caracteres) preso a ela ficava cortado a 1
 * caractere ilegível. Desacoplar rótulo de coluna resolve isso sem precisar de estilo inline
 * (a página tem CSP sem 'unsafe-inline' em estilos): o eixo é uma linha flex comum
 * (justify-content: space-between), cada rótulo com sua largura natural.
 */
export function htmlBarrasEvolucao(pontos, granularidade) {
  if (!evolucaoValida(pontos)) return '';
  const maior = Math.max(...pontos.map((p) => p.pesoKg));
  const n = pontos.length;
  const colunas = pontos
    .map((p) => {
      const alturaPct = maior > 0 ? Math.max((p.pesoKg / maior) * 100, p.pesoKg > 0 ? 2 : 0) : 0;
      const rotulo = rotuloBalde(p.chave, granularidade);
      return `<li class="evolucao-coluna">
        <svg class="evolucao-barra-svg" viewBox="0 0 10 100" preserveAspectRatio="none" role="img" aria-label="${esc(`${rotulo}: ${formatarKg(p.pesoKg)}`)}">
          <rect class="evolucao-fundo" width="10" height="100" rx="1"/>
          <rect class="evolucao-valor" width="10" height="${alturaPct.toFixed(3)}" y="${(100 - alturaPct).toFixed(3)}" rx="1"/>
        </svg>
      </li>`;
    })
    .join('');

  const MAX_ROTULOS = 6;
  const passo = n <= MAX_ROTULOS ? 1 : Math.ceil((n - 1) / (MAX_ROTULOS - 1));
  const indices = [];
  for (let i = 0; i < n; i += passo) indices.push(i);
  if (indices[indices.length - 1] !== n - 1) indices.push(n - 1);
  const eixo = indices.map((i) => `<span class="evolucao-eixo-item">${esc(rotuloBalde(pontos[i].chave, granularidade))}</span>`).join('');

  return `<div class="evolucao">
    <ul class="evolucao-barras" aria-label="Gráfico de barras: evolução do peso no período">${colunas}</ul>
    <div class="evolucao-eixo">${eixo}</div>
  </div>`;
}

// ------------------------------------------------------------
// Redesenho do Dashboard — gráficos do layout de referência.
// Mesmos princípios de sempre: funções PURAS, dados EXATAMENTE como a API
// devolve, nada de estilo inline (cores em atributos SVG, resto no CSS).
// ------------------------------------------------------------

/** Passo "redondo" (1, 2, 2,5, 5 × 10^k) para o eixo vertical. */
function passoRedondo(bruto) {
  if (!(bruto > 0)) return 1;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const f = bruto / pot;
  const base = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return base * pot;
}

const fmtEixo = (n) => `${formatarInteiro(n)} kg`;

/**
 * Evolução do peso no período como gráfico de ÁREA (linha + preenchimento + marcadores),
 * como no layout de referência. Recebe os pontos de GET /api/dashboard/evolucao.
 * `acumulado: true` desenha a soma corrente dos mesmos pontos (o total do período no último ponto).
 * `idGradiente` precisa ser único na página (o preenchimento usa um <linearGradient>).
 */
export function htmlAreaEvolucao(pontos, granularidade, { acumulado = false, idGradiente = 'grad-evolucao' } = {}) {
  if (!evolucaoValida(pontos)) return '';
  // Área de desenho mais "quadrada" (520×250) para não ficar achatada no celular; margens folgadas
  // para os rótulos dos eixos nunca encostarem na linha, nos pontos nem na borda do cartão.
  const L = 520; const A = 250;
  const esq = 52; const dir = 26; const topo = 18; const base = 44;
  const larg = L - esq - dir; const alt = A - topo - base;

  let soma = 0;
  const valores = pontos.map((p) => (acumulado ? (soma += p.pesoKg) : p.pesoKg));
  const maior = Math.max(...valores);
  const passo = passoRedondo(maior > 0 ? maior / 4 : 1);
  const teto = Math.max(passo * Math.ceil(maior / passo), passo);
  const n = valores.length;
  const x = (i) => esq + (n === 1 ? larg / 2 : (i * larg) / (n - 1));
  const y = (v) => topo + alt - (v / teto) * alt;

  const grade = [];
  for (let v = 0; v <= teto + passo / 1e6; v += passo) {
    const yy = y(v).toFixed(2);
    grade.push(`<line class="evo-grade" x1="${esq}" x2="${L - dir}" y1="${yy}" y2="${yy}"/>`
      + `<text class="evo-eixo-y" x="${esq - 8}" y="${yy}" dy="0.32em" text-anchor="end">${esc(fmtEixo(v))}</text>`);
  }

  const coords = valores.map((v, i) => [x(i), y(v)]);
  const traco = coords.map(([cx, cy], i) => `${i === 0 ? 'M' : 'L'} ${cx.toFixed(2)} ${cy.toFixed(2)}`).join(' ');
  const yBase = y(0).toFixed(2);
  const area = n === 1
    ? ''
    : `<path class="evo-area" d="${traco} L ${coords[n - 1][0].toFixed(2)} ${yBase} L ${coords[0][0].toFixed(2)} ${yBase} Z" fill="url(#${esc(idGradiente)})"/>`;

  // No máximo ~7 rótulos no eixo X, bem espaçados (sem alternar linhas nem sobrepor).
  const salto = Math.max(1, Math.ceil(n / 7));
  const rotulosX = pontos
    .map((p, i) => (i % salto === 0
      ? `<text class="evo-eixo-x" x="${x(i).toFixed(2)}" y="${A - 10}" text-anchor="middle">${esc(rotuloBalde(p.chave, granularidade))}</text>`
      : ''))
    .join('');

  const raio = n > 20 ? 2.6 : 3.6; // muitos pontos (visão Mês): marcadores menores
  const marcadores = n <= 62
    ? coords.map(([cx, cy], i) => `<circle class="evo-ponto" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${raio}"><title>${esc(`${rotuloBalde(pontos[i].chave, granularidade)}: ${formatarKg(valores[i])}`)}</title></circle>`).join('')
    : '';

  const descricao = acumulado ? 'peso acumulado no período' : 'peso por período';
  return `<svg class="evo-svg" viewBox="0 0 ${L} ${A}" role="img" aria-label="${esc(`Evolução do ${descricao}`)}">
    <defs><linearGradient id="${esc(idGradiente)}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#22a35a" stop-opacity="0.26"/><stop offset="1" stop-color="#22a35a" stop-opacity="0.03"/>
    </linearGradient></defs>
    ${grade.join('')}
    <line class="evo-base" x1="${esq}" x2="${L - dir}" y1="${yBase}" y2="${yBase}"/>
    ${area}
    ${n > 1 ? `<path class="evo-traco" d="${traco}"/>` : ''}
    ${marcadores}
    ${rotulosX}
  </svg>`;
}

/** Rosca (donut) da distribuição por material; o centro mostra `textoCentro` (ex.: total em kg). */
export function svgRosca(pizza, textoCentro = '', subCentro = 'Total') {
  if (!pizzaValida(pizza) || pizza.length === 0) return '';
  const RE = 92; const RI = 60;
  const pt = (r, a) => [CX + r * Math.cos(a), CY + r * Math.sin(a)];
  let corpo;
  if (pizza.length === 1) {
    corpo = `<circle class="rosca-fatia" cx="${CX}" cy="${CY}" r="${(RE + RI) / 2}" fill="none" stroke="${corMaterial(0)}" stroke-width="${RE - RI}"><title>${esc(rotuloFatia(pizza[0]))}</title></circle>`;
  } else {
    corpo = fatiasDaPizza(pizza).map(({ item, a0, a1, cor }) => {
      const [x0, y0] = pt(RE, a0); const [x1, y1] = pt(RE, a1);
      const [x2, y2] = pt(RI, a1); const [x3, y3] = pt(RI, a0);
      const g = a1 - a0 > Math.PI ? 1 : 0;
      const d = `M ${x0.toFixed(3)} ${y0.toFixed(3)} A ${RE} ${RE} 0 ${g} 1 ${x1.toFixed(3)} ${y1.toFixed(3)} L ${x2.toFixed(3)} ${y2.toFixed(3)} A ${RI} ${RI} 0 ${g} 0 ${x3.toFixed(3)} ${y3.toFixed(3)} Z`;
      return `<path class="rosca-fatia" d="${d}" fill="${cor}"><title>${esc(rotuloFatia(item))}</title></path>`;
    }).join('');
  }
  const tam = textoCentro.length > 11 ? 15 : textoCentro.length > 8 ? 18 : 21;
  return `<svg class="rosca" viewBox="0 0 200 200" role="img" aria-label="Gráfico de rosca: distribuição do peso por material">
    ${corpo}
    <text class="rosca-total" x="${CX}" y="${CY - 2}" text-anchor="middle" font-size="${tam}">${esc(textoCentro)}</text>
    <text class="rosca-sub" x="${CX}" y="${CY + 18}" text-anchor="middle">${esc(subCentro)}</text>
  </svg>`;
}

/** Legenda em colunas (cor · material · kg · %), alinhada como no layout de referência. */
export function legendaRosca(pizza) {
  if (!pizzaValida(pizza)) return '';
  const itens = pizza.map((f, i) => `<li class="rosca-legenda-item">
      <svg class="ponto-cor" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="${corMaterial(i)}"/></svg>
      <span class="rosca-legenda-nome">${esc(f.material)}</span>
      <span class="rosca-legenda-kg">${esc(formatarKg(f.pesoKg))}</span>
      <span class="rosca-legenda-pct">${esc(formatarPercentual(f.percentual))}</span>
    </li>`).join('');
  return `<ul class="rosca-legenda">${itens}</ul>`;
}

/**
 * "Peso por material": barra + peso + participação. Usa a série `pizza` (já traz pesoKg e
 * percentual calculados pelo backend). modo 'kg': barra proporcional ao maior peso;
 * modo 'percentual': barra = participação no total (0–100%).
 */
export function htmlBarrasMaterial(pizza, modo = 'kg') {
  if (!pizzaValida(pizza) || pizza.length === 0) return '';
  const maior = Math.max(...pizza.map((f) => f.pesoKg));
  const linhas = pizza.map((f, i) => {
    const largura = modo === 'percentual' ? f.percentual : (f.pesoKg / maior) * 100;
    const w = Math.min(Math.max(largura, 0.6), 100);
    return `<li class="pm-linha">
      <span class="pm-nome" title="${esc(f.material)}">${esc(f.material)}</span>
      <svg class="pm-trilho" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="${esc(`${f.material}: ${formatarKg(f.pesoKg)} (${formatarPercentual(f.percentual)})`)}">
        <rect class="pm-fundo" width="100" height="10"/>
        <rect width="${w.toFixed(3)}" height="10" fill="${corMaterial(i)}"/>
      </svg>
      <span class="pm-kg">${esc(formatarKg(f.pesoKg))}</span>
      <span class="pm-pct">${esc(formatarPercentual(f.percentual))}</span>
    </li>`;
  }).join('');
  return `<ul class="pm-lista" aria-label="Peso por material">${linhas}</ul>`;
}
