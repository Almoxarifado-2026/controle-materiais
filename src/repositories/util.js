'use strict';

// ============================================================
// Funções puras compartilhadas pelas implementações (sem banco, sem SDK).
// ============================================================

/** Regra de duplicidade do nome do material (idêntica à do domínio legado: NFC + minúsculas pt-BR). */
const chaveNome = (nome) => nome.normalize('NFC').toLocaleLowerCase('pt-BR');

/**
 * Comparação por bytes UTF-8 — a mesma ordem do collation BINARY do SQLite
 * (ORDER BY nome) e da ordenação de strings do Firestore. Não usa locale.
 * (O operador < do JavaScript compara unidades UTF-16 e difere para caracteres
 * fora do plano básico.)
 */
function compararUtf8(a, b) {
  return Buffer.compare(Buffer.from(String(a), 'utf8'), Buffer.from(String(b), 'utf8'));
}

/**
 * Comparação de IDs: IDs só com dígitos (SQLite e documentos migrados) são
 * comparados numericamente; os demais (IDs automáticos do Firestore) por bytes.
 */
function compararIds(a, b) {
  const sa = String(a);
  const sb = String(b);
  if (/^[0-9]+$/.test(sa) && /^[0-9]+$/.test(sb)) {
    const x = BigInt(sa);
    const y = BigInt(sb);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return compararUtf8(sa, sb);
}

/**
 * ID de documento Firestore derivado da chave de nome. IDs de documento não
 * aceitam "/", nem "." ou "..", nem o padrão reservado __x__. Por isso a chave
 * normalizada é codificada em percent-encoding e "." e "_" também são
 * escapados: o resultado nunca contém "/", "." nem "_". Mantém legibilidade
 * para nomes simples (ex.: "ferro" -> "ferro"). Máximo ~1,4 KB para nome de
 * 120 caracteres (limite do Firestore: 1500 bytes).
 */
function chaveParaIdDocumento(chave) {
  return encodeURIComponent(chave).replace(/\./g, '%2E').replace(/_/g, '%5F');
}

function dividirEmLotes(itens, tamanho) {
  const lotes = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

module.exports = { chaveNome, compararUtf8, compararIds, chaveParaIdDocumento, dividirEmLotes };
