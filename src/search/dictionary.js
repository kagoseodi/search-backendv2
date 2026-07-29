const axios = require('axios');

/**
 * For a single-word query, fetches a real definition from the free
 * dictionaryapi.dev API and formats it as a result card. The frontend
 * detects this card by title containing "Definition & Meaning" and gives
 * it special styling - that's an existing frontend behavior, unchanged here.
 */
async function fetchDictionaryDefinition(word) {
  try {
    const response = await axios.get(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      { timeout: 4000, validateStatus: (s) => s === 200 || s === 404 }
    );
    if (response.status !== 200) return null;

    const entry = Array.isArray(response.data) ? response.data[0] : null;
    if (!entry) return null;

    const meanings = entry.meanings || [];
    const firstMeaning = meanings[0];
    const definitionText = firstMeaning?.definitions?.[0]?.definition;
    if (!definitionText) return null;

    const partOfSpeech = firstMeaning.partOfSpeech || '';
    const phonetic = entry.phonetic || entry.phonetics?.find((p) => p.text)?.text || '';

    return {
      id: `dict-${word}-${Date.now()}`,
      url: `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(word)}`,
      title: `${entry.word} (${partOfSpeech}) - Definition & Meaning`,
      snippet: `Definition: ${definitionText}${phonetic ? ` Pronunciation: ${phonetic}` : ''}`,
      score: 100
    };
  } catch (err) {
    console.warn('[Dictionary] Lookup failed:', err.message);
    return null;
  }
}

module.exports = { fetchDictionaryDefinition };
