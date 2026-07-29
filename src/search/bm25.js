// Standard Okapi BM25, with a title-weighting twist: a term match in the
// title counts several times more than the same match in the body, since a
// title hit is a much stronger relevance signal.
//
// score(D, Q) = sum over query terms t of:
//   IDF(t) * ( tf(t,D) * (k1 + 1) ) / ( tf(t,D) + k1 * (1 - b + b * |D| / avgdl) )
//
// where tf(t,D) = tf_body(t,D) + TITLE_BOOST * tf_title(t,D)

const K1 = 1.5;   // term-frequency saturation - higher = tf matters more before saturating
const B = 0.75;   // length normalization strength - 0 = ignore doc length, 1 = fully normalize
const TITLE_BOOST = 4; // a title occurrence counts as this many body occurrences

function idf(totalDocs, docFreq) {
  // +1 inside the log keeps this non-negative even when a term appears in
  // almost every document (the classic BM25 IDF can go negative otherwise).
  return Math.log(1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5));
}

/**
 * @param {string[]} queryTerms - deduplicated, already-stemmed query terms
 * @param {Map<string, Map<number, {tfBody:number, tfTitle:number}>>} postingsByTerm
 *   term -> documentId -> term frequencies in that document
 * @param {Map<number, number>} docLengths - documentId -> body token count
 * @param {number} totalDocs
 * @param {number} avgDocLength
 * @returns {Map<number, number>} documentId -> BM25 score
 */
function scoreDocuments(queryTerms, postingsByTerm, docLengths, totalDocs, avgDocLength) {
  const scores = new Map();
  const safeAvgLen = avgDocLength > 0 ? avgDocLength : 1;

  for (const term of queryTerms) {
    const docsForTerm = postingsByTerm.get(term);
    if (!docsForTerm || docsForTerm.size === 0) continue;

    const docFreq = docsForTerm.size;
    const termIdf = idf(totalDocs, docFreq);

    for (const [documentId, freqs] of docsForTerm.entries()) {
      const tf = (freqs.tfBody || 0) + TITLE_BOOST * (freqs.tfTitle || 0);
      if (tf <= 0) continue;

      const docLen = docLengths.get(documentId) || safeAvgLen;
      const denom = tf + K1 * (1 - B + B * (docLen / safeAvgLen));
      const termScore = termIdf * ((tf * (K1 + 1)) / denom);

      scores.set(documentId, (scores.get(documentId) || 0) + termScore);
    }
  }

  return scores;
}

module.exports = { scoreDocuments, idf, K1, B, TITLE_BOOST };
