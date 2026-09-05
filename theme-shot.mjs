import { chromium } from "playwright";
const OUT="/tmp/claude-0/-home-user-weddings-and-birdays/92862ec2-133b-5033-a397-d186f55e49ca/scratchpad";
const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args:["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"]});
const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,permissions:["camera"]});
const page=await ctx.newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message));
await page.goto("http://localhost:3232/",{waitUntil:"networkidle"});
await page.evaluate(async()=>{
  const open=indexedDB.open("hotwheels",1);
  const db=await new Promise((res,rej)=>{open.onsuccess=()=>res(open.result);open.onerror=()=>rej(open.error);});
  const now=Date.now(); const tx=db.transaction("cars","readwrite");
  [{id:"t1",name:"'67 Camaro",series:"HW Muscle Mania",seriesNumber:"3/10",collectorNumber:"112/250",year:2024,toyNumber:"HTB29",color:"metallic blue",treasureHunt:"none",quantity:3,estimate:{low:2,high:5,at:now}},
   {id:"t2",name:"Bone Shaker",series:"HW Hot Trucks",year:2023,toyNumber:"HKG42",color:"matte black",treasureHunt:"sth",quantity:1,value:45},
   {id:"t3",name:"Twin Mill",series:"HW Exotics",year:2024,toyNumber:"HRY18",color:"spectraflame green",treasureHunt:"th",quantity:2,estimate:{low:6,high:14,at:now}},
  ].forEach(c=>tx.objectStore("cars").put({condition:"carded",source:"photo",addedAt:now,updatedAt:now,...c}));
  await new Promise(r=>{tx.oncomplete=r;});
});
await page.reload({waitUntil:"networkidle"}); await page.waitForTimeout(900);
await page.screenshot({path:`${OUT}/20-home.png`});
await page.goto("http://localhost:3232/stats",{waitUntil:"networkidle"}); await page.waitForTimeout(900);
await page.screenshot({path:`${OUT}/21-stats.png`,fullPage:true});
await page.goto("http://localhost:3232/scan",{waitUntil:"networkidle"}); await page.waitForTimeout(1800);
await page.screenshot({path:`${OUT}/22-scan.png`});
await page.goto("http://localhost:3232/car/t3",{waitUntil:"networkidle"}); await page.waitForTimeout(700);
await page.screenshot({path:`${OUT}/23-detail.png`});
console.log(errs.length?`ERRORS: ${errs.join("; ")}`:"no page errors");
await browser.close();
