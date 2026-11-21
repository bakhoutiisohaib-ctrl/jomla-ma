// Not registered with schema.index(): application autoIndex must never
// provision this deployment prerequisite on an existing database.
const definition = {
  key: { buyerId: 1, 'creationReceipt.key': 1 },
  options: { name: 'sourcing_creation_buyer_key', unique: true,
    partialFilterExpression: { 'creationReceipt.key': { $type: 'string' } } }
}
function matches(index) {
  return index?.name === definition.options.name && index.unique === true && !index.sparse &&
    (!index.collation || index.collation.locale === 'simple') &&
    JSON.stringify(Object.entries(index.key || {})) === JSON.stringify(Object.entries(definition.key)) &&
    JSON.stringify(index.partialFilterExpression) === JSON.stringify(definition.options.partialFilterExpression)
}
async function inspect(collection) {
  const indexes = await collection.indexes({ readPreference: 'primary' })
  return matches(indexes.find(index => index.name === definition.options.name))
}
module.exports = { definition, matches, inspect }
