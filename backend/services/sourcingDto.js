const id = value => value == null ? undefined : String(value)
const pick = (value, fields) => Object.fromEntries(fields.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]))
function snapshotDto(snapshot) {
  if (!snapshot || snapshot.version !== 1) return undefined
  return { version: 1, pricedAt: snapshot.pricedAt,
    request: { ...pick(snapshot.request, ['productName', 'category', 'quantity', 'unit', 'buyerCity', 'targetPrice', 'imageUrl', 'notes']), id: id(snapshot.request?.id) },
    offer: { ...pick(snapshot.offer, ['supplierName', 'unitPrice', 'totalPrice', 'currency', 'deliveryDays', 'paymentTerms', 'notes']),
      supplierId: id(snapshot.offer?.supplierId), actorId: id(snapshot.offer?.actorId) } }
}
function quoteDto(quote) {
  return { ...pick(quote, ['supplierName', 'unitPrice', 'currency', 'deliveryDays', 'paymentTerms', 'notes', 'status', 'createdAt']),
    _id: id(quote._id), supplierId: id(quote.supplierId), actorId: id(quote.actorId),
    ...(quote.commercialSnapshot ? { commercialSnapshot: snapshotDto(quote.commercialSnapshot) } : {}),
    ...(quote.agreement?.version === 1 ? { agreement: { version: 1, source: quote.agreement.source,
      agreedAt: quote.agreement.agreedAt, quoteId: id(quote.agreement.quoteId), snapshot: snapshotDto(quote.agreement.snapshot) } } : {}),
    ...(quote.decisionReceipt?.version === 1 ? { decision: { action: quote.decisionReceipt.action, decidedAt: quote.decisionReceipt.decidedAt } } : {}) }
}
function sourcingDto(doc, actor) {
  const buyer = id(doc.buyerId) === id(actor.id)
  const owner = id(actor.ownerId || actor.id)
  const authorizedSupplier = ['supplier', 'admin'].includes(actor.role) ||
    (actor.role === 'staff' && actor.permissions?.some(p => ['all', 'manage_rfq'].includes(p)))
  const result = { ...pick(doc, ['buyerCity', 'productName', 'category', 'quantity', 'unit', 'targetPrice', 'imageUrl', 'notes', 'status', 'quotesCount', 'createdAt', '__v']),
    _id: id(doc._id), quotes: (doc.quotes || []).filter(q => buyer || (authorizedSupplier && id(q.supplierId) === owner)).map(quoteDto) }
  if (buyer) Object.assign(result, { buyerId: id(doc.buyerId), buyerName: doc.buyerName, buyerPhone: doc.buyerPhone })
  if (doc.operation) {
    result.operation = { kind: doc.operation.kind === 'sourcing_decision' ? 'sourcing_decision' : 'sourcing_offer', phase: 'pending' }
    const op = doc.operation, target = (doc.quotes || []).find(q => id(q._id) === id(op.quoteId))
    if (buyer && op.kind === 'sourcing_decision' && op.version === 1 && op.phase === 'pending' &&
        id(op.parentId) === id(doc._id) && id(op.buyerId) === id(doc.buyerId) &&
        id(op.actor?.id) === id(doc.buyerId) && id(op.actor?.ownerId) === id(doc.buyerId) && op.actor?.role === 'buyer' &&
        target && id(target.supplierId) === id(op.supplierId) && ['accept', 'reject'].includes(op.action) &&
        id(op.commercialSnapshot?.request?.id) === id(doc._id) && id(op.commercialSnapshot?.request?.buyerId) === id(doc.buyerId) &&
        id(op.commercialSnapshot?.offer?.supplierId) === id(target.supplierId)) {
      result.decisionRecovery = { operationId: id(op.id), quoteId: id(op.quoteId), action: op.action, startedAt: op.startedAt,
        requiresReview: op.lastErrorCode === 'SOURCING_DECISION_CONFLICT' }
    }
    if (authorizedSupplier && doc.operation.kind === 'sourcing_offer' && doc.operation.version === 1 &&
        doc.operation.phase === 'pending' && id(doc.operation.supplierId) === owner && id(doc.operation.parentId) === id(doc._id) &&
        id(doc.operation.actor?.ownerId) === owner && id(doc.operation.buyerId) === id(doc.buyerId) &&
        id(doc.operation.commercialSnapshot?.request?.id) === id(doc._id) &&
        id(doc.operation.commercialSnapshot?.request?.buyerId) === id(doc.buyerId) &&
        id(doc.operation.commercialSnapshot?.offer?.supplierId) === owner &&
        id(doc.operation.commercialSnapshot?.offer?.actorId) === id(doc.operation.actor?.id)) {
      result.offerRecovery = { operationId: id(doc.operation.id), startedAt: doc.operation.startedAt,
        requiresReview: doc.operation.lastErrorCode === 'SOURCING_OFFER_CONFLICT',
        input: pick(doc.operation.input, ['unitPrice', 'currency', 'deliveryDays', 'paymentTerms', 'notes']) }
    }
  }
  return result
}
module.exports = { sourcingDto, quoteDto }
