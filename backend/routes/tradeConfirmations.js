const router=require('express').Router()
const { authenticate, requireRole }=require('../middleware/auth')
const { asyncHandler }=require('../middleware/errorHandler')
const service=require('../services/tradeConfirmation')
router.use(authenticate,requireRole('buyer','supplier'))
router.use((req,res,next)=>{res.set('Cache-Control','private, no-store');next()})
router.get('/',asyncHandler(async(req,res)=>{
  const page=Number(req.query.page||1)
  if(!Number.isSafeInteger(page)||page<1||page>10000)return res.status(400).json({message:'رقم الصفحة غير صحيح'})
  res.json(await service.list(req.supplier,req.query.kind||'rfq',page,12))
}))
router.post('/:kind/:id/:offerId',asyncHandler(async(req,res)=>{
  if(!req.body||Object.keys(req.body).length!==1||req.body.confirmed!==true)return res.status(400).json({message:'يلزم الإقرار الصريح بإتمام التعامل'})
  res.json({actorId:req.supplier.id,role:req.supplier.role,trade:await service.confirm(req.params.kind,req.params.id,req.params.offerId,req.supplier)})
}))
const dispute=require('../services/tradeConfirmationDispute')
router.get('/:kind/:id/:offerId/dispute',asyncHandler(async(req,res)=>{
  res.json(await dispute.get(req.params.kind,req.params.id,req.params.offerId,req.supplier))
}))
router.post('/:kind/:id/:offerId/dispute',asyncHandler(async(req,res)=>{
  if(!req.body||Object.keys(req.body).length!==1||typeof req.body.details!=='string'||req.body.details.trim().length<3||req.body.details.length>2000)return res.status(400).json({message:'Invalid dispute details'})
  const result=await dispute.submit(req.params.kind,req.params.id,req.params.offerId,req.supplier,req.body.details.trim())
  res.status(result.replayed?200:201).json(result)
}))
module.exports=router
