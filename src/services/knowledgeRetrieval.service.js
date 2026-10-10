const KnowledgeArea = require('../models/knowledgeArea.model');

/**
 * Knowledge Retrieval Service (ADR-010 Section 8 & 9.2)
 *
 * Responsible for querying approved KnowledgeArea sources via text/keyword search
 * and returning grounded content snippets for RAG prompt context construction.
 */
class KnowledgeRetrievalService {
  /**
   * Retrieves relevant KnowledgeArea articles matching the query or category.
   *
   * @param {Object} params
   * @param {string} [params.query] - Customer question / query string
   * @param {string} [params.category] - Optional category filter (e.g. STORE_INFO)
   * @param {number} [params.limit=3] - Max articles to retrieve
   * @returns {Promise<Array<{articleId: string, category: string, contentTitle: string, contentBody: string}>>}
   */
  static async findRelevantKnowledge({ query, category, limit = 3 }) {
    const filter = { isActive: true };

    if (category) {
      filter.category = String(category).toUpperCase().trim();
    }

    let articles = [];

    // 1. First attempt: If query text is provided, perform keyword/text regex search
    if (query && typeof query === 'string' && query.trim()) {
      const sanitizedQuery = query.trim();
      const terms = sanitizedQuery
        .toLowerCase()
        .replace(/[^\w\s]/gi, '')
        .split(/\s+/)
        .filter((t) => t.length > 2); // filter out very short stop-words

      if (terms.length > 0) {
        // Find articles matching all significant search terms
        const searchConditions = terms.map((term) => ({
          $or: [
            { keywords: { $regex: term, $options: 'i' } },
            { contentTitle: { $regex: term, $options: 'i' } },
            { contentBody: { $regex: term, $options: 'i' } },
          ],
        }));

        articles = await KnowledgeArea.find({
          ...filter,
          $and: searchConditions,
        })
          .limit(limit)
          .lean();

        // Fallback: If all-term match returns zero, match any significant search term
        if (articles.length === 0 && terms.length > 1) {
          articles = await KnowledgeArea.find({
            ...filter,
            $or: terms.map((term) => ({
              $or: [
                { keywords: { $regex: term, $options: 'i' } },
                { contentTitle: { $regex: term, $options: 'i' } },
                { contentBody: { $regex: term, $options: 'i' } },
              ],
            })),
          })
            .limit(limit)
            .lean();
        }
      } else {
        // Fallback for short query (e.g., "hi", "op")
        articles = await KnowledgeArea.find({
          ...filter,
          $or: [
            { keywords: { $regex: sanitizedQuery, $options: 'i' } },
            { contentTitle: { $regex: sanitizedQuery, $options: 'i' } },
            { contentBody: { $regex: sanitizedQuery, $options: 'i' } },
          ],
        })
          .limit(limit)
          .lean();
      }
    } else {
      // If no query string provided, retrieve default active articles in category
      articles = await KnowledgeArea.find(filter).limit(limit).lean();
    }

    return articles.map((doc) => ({
      articleId: doc.articleId,
      category: doc.category,
      contentTitle: doc.contentTitle,
      contentBody: doc.contentBody,
    }));
  }
}

module.exports = KnowledgeRetrievalService;
