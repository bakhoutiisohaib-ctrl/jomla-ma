// Synthetic image response contract for existing App scope tests.
export function visualFixture(products,page=1){
 const rows=products.map(p=>({...p,matchType:'exact',matchBasis:'exact_image',similarityScore:1}));
 return {visualVersion:'v49-1',queryQuality:'sufficient_detail',analysisMode:'local_visual_vectors',visualIdentityVerified:false,products:rows,total:rows.length,exactCount:rows.length,similarCount:0,pagination:{page,limit:12,total:rows.length,pages:Math.ceil(rows.length/12)},visualSearch:{adapter:'local_feature_vectors',version:'local-color-spatial-edge-v1',exactMeaning:'same_image_bytes_not_verified_product_identity',scoreMeaning:'feature_vector_cosine_similarity_not_probability',minScore:0.82,indexedCandidates:rows.length,unindexedCount:0,staleCount:0},externalDiscovery:{enabled:false},sourcingOffer:{canRequestSourcing:rows.length===0}};
}
