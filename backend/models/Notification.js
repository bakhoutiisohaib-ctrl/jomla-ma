const mongoose = require('mongoose')
const NotificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
  type: { type: String, enum: ['rfq_created', 'offer_received', 'offer_decision', 'message_received', 'sourcing_offer', 'sourcing_decision'], required: true },
  resourceType: { type: String, enum: ['rfq', 'sourcing'], required: true },
  resourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  decisionId: { type: mongoose.Schema.Types.ObjectId },
  readAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
})
NotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 })
const labels = {
  rfq_created: ['طلب عرض سعر جديد', 'Nouvelle demande de devis'],
  offer_received: ['وصل عرض سعر', 'Nouvelle offre de prix'],
  offer_decision: ['تحديث قرار عرض السعر', 'Décision sur une offre'],
  message_received: ['وصلت رسالة جديدة', 'Nouveau message'],
  sourcing_offer: ['وصل عرض توريد', 'Nouvelle offre d’approvisionnement'],
  sourcing_decision: ['تحديث قرار عرض التوريد', 'Décision sur l’approvisionnement']
}
NotificationSchema.virtual('titleAr').get(function () { return labels[this.type]?.[0] || '' })
NotificationSchema.virtual('titleFr').get(function () { return labels[this.type]?.[1] || '' })
NotificationSchema.virtual('bodyAr').get(function () { return 'افتح الطلب لمراجعة التفاصيل: ' + this.resourceId })
NotificationSchema.virtual('bodyFr').get(function () { return 'Ouvrez la demande pour consulter les détails : ' + this.resourceId })
NotificationSchema.set('toJSON', { virtuals: true })
module.exports = mongoose.model('Notification', NotificationSchema)
