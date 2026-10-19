const mongoose = require('mongoose')

const ReportSchema = new mongoose.Schema({
  reporterName:    { type: String, trim: true, default: 'مستخدم المنصة' },
  reporterPhone:   { type: String, trim: true, default: '' },
  targetType:      { type: String, enum: ['product', 'supplier'], required: true },
  targetId:        { type: mongoose.Schema.Types.ObjectId, required: true },
  targetName:      { type: String, required: true },
  reason:          { 
    type: String, 
    required: true, 
    enum: ['fake_product', 'copyright_infringement', 'incorrect_pricing', 'fraud', 'other'] 
  },
  details:         { type: String, trim: true, default: '' },
  status:          { 
    type: String, 
    enum: ['pending', 'investigating', 'resolved', 'dismissed'], 
    default: 'pending' 
  },
  resolutionNotes: { type: String, default: '' },
  resolvedAt:      Date,
  createdAt:       { type: Date, default: Date.now }
})

ReportSchema.index({ status: 1, createdAt: -1 })

module.exports = mongoose.model('Report', ReportSchema)
