// Read-only checks for protected application sources; writes D0 evidence only.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'reports/phase-d0-evidence');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,''));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const write=(p,data)=>fs.writeFileSync(path.join(out,p),JSON.stringify(data,null,2)+'\n');
const before=read('reports/phase-d0-evidence/before-source-manifest.json');
const protectedFiles=before.files.map(f=>({...f,afterSha256:hash(f.path),unchanged:hash(f.path)===f.sha256}));
const c2=read('reports/phase-c2-evidence/source-manifest.json').files.map(f=>({path:f.path,unchanged:hash(f.path)===f.sha256}));
assert(protectedFiles.every(f=>f.unchanged),'Protected source changed');assert(c2.every(f=>f.unchanged),'C2 deliverable changed');
write('source-integrity.json',{date:'2026-10-21',applicationSourcesChanged:0,protectedFilesChecked:protectedFiles.length,c2FilesChecked:c2.length,protectedFiles,c2Files:c2,scope:'Recorded application source tree and all C2 delivery source hashes; no environment secrets read.'});
const tokens=read('design/phase-d0/design-tokens.json');
function luminance(hex){const c=hex.replace('#','').match(/../g).map(h=>parseInt(h,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
const pairs=[];
for(const[name,theme]of Object.entries(tokens.themes))for(const[role,fg,bg]of[
  ['body on background',theme.ink,theme.background],['secondary on surface',theme.muted,theme.surface],
  ['secondary on soft',theme.muted,theme.soft],['primary button','#FFFFFF',theme.primary],['accent on background',theme.accent,theme.background]]){
  const ratio=contrast(fg,bg);assert(ratio>=4.5,`${name}: ${role}`);pairs.push({theme:name,role,foreground:fg,background:bg,ratio:Number(ratio.toFixed(3)),passesNormalTextAA:true});
}
for(const[name,state]of Object.entries(tokens.semanticStates))if(typeof state==='object'){
  const ratio=contrast(state.ink,state.surface);assert(ratio>=4.5);pairs.push({role:name,foreground:state.ink,background:state.surface,ratio:Number(ratio.toFixed(3)),passesNormalTextAA:true});
}
const runtime=['mockup.html','prototype.js','prototype.css',...fs.readdirSync(path.join(__dirname,'assets')).map(n=>'assets/'+n)].map(p=>({path:'design/phase-d0/'+p,bytes:fs.statSync(path.join(__dirname,p)).size}));
const js=fs.readFileSync(path.join(__dirname,'prototype.js'),'utf8');assert(!/\b(?:fetch\s*\(|XMLHttpRequest\b|WebSocket\b|localStorage\b|sessionStorage\b)/.test(js));
write('contrast-and-payload.json',{date:'2026-10-21',contrast:pairs,minimumSelectedPairRatio:Math.min(...pairs.map(p=>p.ratio)),contrastScope:'Selected palette pairs only, not a full WCAG audit of all rendered elements or states.',runtimeFiles:runtime,totalUncompressedBytes:runtime.reduce((n,p)=>n+p.bytes,0),externalRuntimeResources:0,frameworkDependencies:0,measuredNetworkPerformance:false});
const browser=read('reports/phase-d0-evidence/browser-verification.json');
let primary=0;
for(const theme of ['atlas','medina','horizon'])for(const page of ['home','product','store','supplier'])for(const lang of ['ar','fr'])for(const device of ['desktop','phone']){
  const key=[theme,page,lang,device].join('-'),v=browser.views[key];assert(v,key);assert.equal(v.lang,lang);assert.equal(v.dir,lang==='ar'?'rtl':'ltr');assert.equal(v.innerWidth,device==='phone'?390:1440);assert.equal(v.innerHeight,device==='phone'?844:1000);assert.equal(v.scrollWidth,v.clientWidth,key);assert(v.visibleImages.every(i=>i.loaded),key);assert.equal(v.apiDomReferences,0);assert(fs.statSync(path.join(out,'screens',key+'.jpg')).size>10000);primary++;
}
for(const[key,v]of Object.entries(browser.views)){assert(v.scrollWidth<=v.clientWidth,key);assert(fs.existsSync(path.join(out,'screens',key+'.jpg')),key);}
const i=browser.interactions;
assert.equal(i.search.cards,1);assert(i.search.emptyState);assert.equal(i.search.resetCards,4);
assert(i.compareTray.visible&&i.compareTray.selected==='true');
assert.equal(i.editor.retainedName,'كوب خزفي — نموذج D0');assert.equal(i.editor.retainedPrice,'38');assert(!i.editor.publishEnabledBeforeApproval&&i.editor.publishEnabledAfterApproval);assert(i.editor.result.includes('لم يُحفظ'));
assert(i.rfq.focusContained&&i.rfq.escapeCloses);assert.equal(i.rfq.initialFocus.label,'إغلاق');assert.equal(i.rfq.returnFocus,'اطلب عرض سعر');assert(i.rfq.reviewText.includes('96'));
assert.equal(i.keyboard.firstTab.outline,'solid');assert.equal(i.keyboard.skipTarget,'main');
assert(i.explorer?.themeAndLanguageAndPageCorrect&&i.explorer?.phoneFrameSelected,'Explorer not verified');
assert.deepEqual(browser.standaloneConsoleWarningsOrErrors,[]);
assert(browser.consoleWarningsOrErrors.length<=1&&browser.consoleWarningsOrErrors.every(e=>e.message.includes('MutationObserver')),'Unexpected browser console error');
const screens=Object.keys(browser.views).sort();
let index='# D0 — فهرس لقطات النماذج\n\n21 أكتوبر 2026. كل البيانات اصطناعية. الحاسوب 1440×1000، الهاتف viewport 390×844.\n\n';
const pageNames={home:'الرئيسية',product:'المنتج',store:'المتجر',supplier:'المورد'};
for(const [theme,label]of [['atlas','أطلس'],['medina','المدينة'],['horizon','أفق']]){
  index+=`## ${label}\n\n| الصفحة | حاسوب عربي | حاسوب فرنسي | هاتف عربي | هاتف فرنسي |\n|---|---|---|---|---|\n`;
  for(const page of ['home','product','store','supplier'])index+='| '+pageNames[page]+' | '+[['ar','desktop'],['fr','desktop'],['ar','phone'],['fr','phone']].map(([lang,device])=>`[لقطة](C:/Users/hp/jomla-ma/reports/phase-d0-evidence/screens/${theme}-${page}-${lang}-${device}.jpg)`).join(' | ')+' |\n';
  index+='\n';
}
index+='## لقطات تكميلية\n\n';for(const key of screens.filter(k=>!/^\w+-(home|product|store|supplier)-(ar|fr)-(desktop|phone)$/.test(k)))index+=`- [${key}](C:/Users/hp/jomla-ma/reports/phase-d0-evidence/screens/${key}.jpg)\n`;
fs.writeFileSync(path.join(out,'screens-index.md'),index);
const final={date:'2026-10-21',scope:'D0 design only',completeForReview:true,recommendedDirection:'atlas',primaryVisualCases:primary,totalScreens:screens.length,primaryLayoutsWithHorizontalOverflow:0,applicationSourceChanges:0,protectedSourceFiles:protectedFiles.length,c2SourcesUnchanged:c2.length,applicationApiOrDatabaseUsed:false,newApplicationRegressionOrBuildRun:false,previousC2Results:{backend:273,frontend:110,productionBuild:'Passed in C2, not rerun in D0'},prototypeChecks:{localSearch:true,emptyAndReset:true,compareTray:true,editorStateRetention:true,explicitPublicationApproval:true,skipLink:true,focusLoop:true,escapeAndFocusReturn:true,rfqPreviewWithoutSending:true,explorer:true},runtimeUncompressedBytes:runtime.reduce((n,p)=>n+p.bytes,0),selectedColorPairs:pairs.length,allSelectedPairsNormalTextAA:true,limitations:['Heuristic review, no merchant research','System font fallbacks; proposed brand fonts not bundled','Phone viewport emulation, not physical device QA','Selected palette contrast pairs, not a WCAG certification','One representative product detail and fixed comparison sample','No backend behavior, actual uploads, authentication, transactions, SEO or real network performance tested'],preview:{loopbackOnly:true,url:'http://127.0.0.1:5080/',applicationStarted:false},decision:'Await owner choice and approval before implementation'};
assert(browser.viewportReset);
final.viewportReset=true;
final.console={standaloneWarningsOrErrors:browser.standaloneConsoleWarningsOrErrors.length,galleryDiagnostics:browser.consoleWarningsOrErrors.length,note:'One unattributed MutationObserver diagnostic during rapid iframe switching; recorded in browser-verification.json. Visible frame and standalone view verified.'};
write('final-verification.json',final);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const sources=[...walk(__dirname).map(p=>path.relative(root,p).replaceAll('\\','/')),'reports/phase-d0-premium-design-exploration.md'];
write('source-manifest.json',{date:'2026-10-21',scope:'Standalone D0 design sources and report only',files:sources.map(p=>({path:p,sha256:hash(p)}))});
const report=fs.readFileSync(path.join(root,'reports/phase-d0-premium-design-exploration.md'),'utf8');const links=[...report.matchAll(/\]\((C:\/Users\/hp\/jomla-ma\/[^)]+)\)/g)].map(m=>m[1]);for(const link of links)assert(fs.existsSync(link),'Missing report link: '+link);
console.log(JSON.stringify({protectedSources:protectedFiles.length,c2SourcesUnchanged:c2.length,primaryViews:primary,totalScreens:screens.length,selectedContrastPairs:pairs.length,minimumRatio:Math.min(...pairs.map(p=>p.ratio)),runtimeBytes:final.runtimeUncompressedBytes,reportLinks:links.length,completeForReview:true}));
