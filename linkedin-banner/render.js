const {chromium}=require('/opt/node22/lib/node_modules/playwright');
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const pg=await b.newPage({viewport:{width:1584,height:396}});
 await pg.goto('file://'+process.cwd()+'/banner.html');
 await pg.waitForTimeout(300);
 await pg.screenshot({path:'banner-estatico.png'});
 const N=45;
 for(let i=0;i<N;i++){await pg.evaluate(t=>setT(t),i/N);await pg.screenshot({path:`/tmp/f${String(i).padStart(3,'0')}.png`});}
 await b.close();
})();
