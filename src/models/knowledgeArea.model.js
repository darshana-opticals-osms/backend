const mongoose = require('mongoose');

/**
 * KnowledgeArea Model (ADR-010 Section 9.3.1)
 *
 * Implements the baseline SDS fields (articleId, category, contentTitle)
 * extended with contentBody, keywords, and isActive for backend RAG retrieval.
 */
const knowledgeAreaSchema = new mongoose.Schema(
  {
    // Baseline SDS field: Article_ID
    articleId: {
      type: String,
      required: [true, 'articleId is required.'],
      unique: true,
      trim: true,
      uppercase: true,
    },

    // Baseline SDS field: Category
    category: {
      type: String,
      required: [true, 'category is required.'],
      trim: true,
      uppercase: true,
      index: true,
    },

    // Baseline SDS field: Content_Title
    contentTitle: {
      type: String,
      required: [true, 'contentTitle is required.'],
      trim: true,
    },

    // Approved Schema Extension: Full article text used for RAG prompt context
    contentBody: {
      type: String,
      required: [true, 'contentBody is required.'],
      trim: true,
    },

    // Approved Schema Extension: Keywords indexed for text search retrieval
    keywords: {
      type: [String],
      default: [],
      index: true,
    },

    // Approved Schema Extension: Visibility flag
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Create text index for keyword/text search queries
knowledgeAreaSchema.index({
  keywords: 'text',
  contentTitle: 'text',
  contentBody: 'text',
});

module.exports = mongoose.model('KnowledgeArea', knowledgeAreaSchema);
