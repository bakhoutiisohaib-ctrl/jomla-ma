const mongoose = require('mongoose')

const ReportSchema = new mongoose.Schema({
  reporterName:    { type: String, trim: true, default: 'مستخدم المنصة' },
  reporterPhone:   { type: String, trim: true, default: '' },
  targetType:      { type: String, enum: ['product', 'supplier', 'trade_confirmation'], required: true },
  targetId:        { type: mongoose.Schema.Types.ObjectId, required: true },
  targetName:      { type: String, required: true },
  reason:          { 
    type: String, 
    required: true, 
    enum: ['fake_product', 'copyright_infringement', 'incorrect_pricing', 'fraud', 'other', 'confirmation_dispute']
  },
  details:         { type: String, trim: true, default: '' },
  status:          { 
    type: String, 
    enum: ['pending', 'investigating', 'resolved', 'dismissed'], 
    default: 'pending' 
  },
  resolutionClaim: { type: new mongoose.Schema({ hash: String, token: String, auditId: mongoose.Schema.Types.ObjectId,
    actorId: mongoose.Schema.Types.ObjectId, action: String, resolutionNotes: String, moderationAction: String, leaseUntil: Date }, { _id: false }), default: undefined },
  resolutionNotes: { type: String, default: '' },
  resolvedAt:      Date,
  resolvedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  reporterId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  tradeDispute: { type: new mongoose.Schema({ kind: {type:String,enum:['rfq','sourcing']}, sourceId: mongoose.Schema.Types.ObjectId, offerId: mongoose.Schema.Types.ObjectId, role: {type:String,enum:['buyer','supplier']} }, { _id:false }), default:undefined },
  moderationAction: { type: String, enum: ['none', 'hide_product', 'suspend_supplier'], default: 'none' },
  createdAt:       { type: Date, default: Date.now }
})

ReportSchema.index({ status: 1, createdAt: -1 })

module.exports = mongoose.model('Report', ReportSchema)
