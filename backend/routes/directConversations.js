const router=require('express').Router()
const rateLimit=require('express-rate-limit')
const {authenticate,requireRole}=require('../middleware/auth')
const {asyncHandler}=require('../middleware/errorHandler')
const service=require('../services/directConversation')
router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');res.vary('Authorization');next()})
router.use(authenticate,requireRole('buyer','supplier'))
const writeBudget=rateLimit({windowMs:15*60*1000,max:30,keyGenerator:req=>req.supplier.id,
  standardHeaders:true,legacyHeaders:false,handler:(_req,res)=>res.status(429).json({message:'Conversation write limit reached'})})
// Avoid passing message payloads or database error internals to the global logger.
const handle=fn=>asyncHandler(async(req,res)=>{
  try{await fn(req,res)}catch(e){
    if([400,404,409,503].includes(e.status))return res.status(e.status).json({message:e.status===503?'Conversation temporarily unavailable':e.message})
    return res.status(503).json({message:'Conversation temporarily unavailable'})
  }
})
router.get('/',handle(async(req,res)=>res.json(await service.list(req.supplier,req.query))))
router.get('/:id',handle(async(req,res)=>res.json(await service.detail(req.params.id,req.supplier))))
router.post('/',requireRole('buyer'),writeBudget,handle(async(req,res)=>{
  const result=await service.start(req.supplier,service.parse(req.body,true))
  res.status(result.replayed?200:201).json(result)
}))
router.post('/:id/messages',writeBudget,handle(async(req,res)=>{
  if(!service.validId(req.params.id))return res.status(404).json({message:'Conversation unavailable'})
  const result=await service.append(req.params.id,req.supplier,service.parse(req.body))
  res.status(result.replayed?200:201).json(result)
}))
module.exports=router
