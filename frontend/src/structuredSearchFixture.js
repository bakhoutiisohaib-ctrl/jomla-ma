// Synthetic response fixture for App request-wiring tests, not a parser.
export function structuredFixture(body,products,overrides={}){
 const f={version:'v49-1',terms:[],categoryPath:null,city:null,excludedCities:[],excludedTerms:[],quantity:null,unit:null,moq:null,moqStrict:false,minPrice:null,maxPrice:null,strictMin:false,strictMax:false,budget:null,currency:null,sort:null,verified:null,delivery:false,issues:[],raw:body.query,removed:body.intentRemovals||[],removable:[]};
 const total=products.length;
 return {products,total,pagination:{page:body.page,limit:12,total,pages:Math.ceil(total/12)},searchIntent:f,searchPriceContext:{basis:'base',quantity:null},searchAlternatives:[],sourcingOffer:{canRequestSourcing:total===0},...overrides};
}
