const mongoose = require('mongoose')

const AnalyticsSchema = new mongoose.Schema({
  event: String,
  meta: Object,
  createdAt: { type: Date, default: Date.now }
})

module.exports = mongoose.model('Analytics', AnalyticsSchema)
