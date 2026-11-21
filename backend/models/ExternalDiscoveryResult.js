const mongoose = require('mongoose')

const ExternalDiscoveryResultSchema = new mongoose.Schema({
  query:            { type: String, required: true, trim: true },
  provider:         { type: String, enum: ['brave'], required: true },
  termsReference:   { type: String, required: true },
  queriedAt:        { type: Date, required: true },
  results: [{
    title: { type: String, required: true },
    url: { type: String, required: true },
    description: String,
    sourceName: { type: String, required: true },
    external: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false }
  }],
  detectedCategory: { type: String, default: 'عام' },
  isAvailableInCatalog: { type: Boolean, default: false },
  externalSources: [{
    sourceName:   { type: String, required: true },
    sourceType:   { type: String, enum: ['search_engine', 'public_directory', 'b2b_reference'], default: 'search_engine' },
    searchUrl:    { type: String, required: true },
    isVerified:   { type: Boolean, default: false } // دائماً false لأنها مصادر خارجية غير موثقة
  }],
  disclaimer:       { type: String, default: 'روابط مرجعية استكشافية من مصادر عامة لا تمثل مخزوناً موثقاً أو ضماناً تجارياً من Jomla.ma' },
  createdAt:        { type: Date, default: Date.now }
})

ExternalDiscoveryResultSchema.index({ query: 1, createdAt: -1 })

module.exports = mongoose.model('ExternalDiscoveryResult', ExternalDiscoveryResultSchema)
