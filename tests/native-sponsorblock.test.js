const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
test('Shipping-Swift fragt nur Hashprefix ab und übernimmt aktuelle API-Antworten mit exaktem Video-Owner',{skip:process.platform!=='darwin',timeout:70000},t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'langform-sponsorblock-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const source=fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/SponsorBlockService.swift'),'utf8');
  const live=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/qa/player-features-2026-10-11/sponsorblock-live-query.json'),'utf8'));
  assert.equal(live.status,200);assert.ok(live.owner.segments.length>0);assert.equal(live.owner.hash,undefined,'actual API response has no hash property');
  const data=JSON.stringify([live.owner,{videoID:'abcdefghijk',segments:[{category:'sponsor',actionType:'skip',segment:[5,10],videoDuration:100}]}]);
  const harness=`
func check(_ condition: Bool, _ label: String) { if !condition { fatalError(label) } }
check(SponsorBlockService.hash("aQp-iM0bCs4")?.hasPrefix("5f6b") == true, "documented hash")
check(SponsorBlockService.request(for:"invalid") == nil,"invalid ID")
let request = SponsorBlockService.request(for:"aQp-iM0bCs4")!
check(request.url!.host == "sponsor.ajay.app", "fixed HTTPS host")
check(request.url!.scheme == "https", "HTTPS")
check(request.url!.path == "/api/skipSegments/5f6b", "only hashprefix sent")
check(!request.url!.absoluteString.contains("aQp-iM0bCs4"), "no full video ID externally")
check(request.value(forHTTPHeaderField:"Cookie") == nil && request.value(forHTTPHeaderField:"Referer") == nil, "no account cookies or referrer")
let data = Data(${JSON.stringify(Buffer.from(data).toString('base64'))}.utf8)
let payload = Data(base64Encoded: String(data:data,encoding:.utf8)!)!
let segments = SponsorBlockService.segments(from:payload,videoID:"aQp-iM0bCs4")!
check(segments.count == 1, "current API owner without hash")
check((segments.first!["segment"] as! [Double])[1] == 31.861, "real API timing preserved")
check(SponsorBlockService.segments(from:payload,videoID:"lmnopqrstuv")!.isEmpty, "foreign candidates ignored")
check(SponsorBlockService.segments(from:Data("bad json".utf8),videoID:"aQp-iM0bCs4") == nil,"malformed JSON")
check(SponsorBlockService.segments(from:Data(repeating:0,count:1048577),videoID:"aQp-iM0bCs4") == nil,"bounded response")
print("NATIVE_SPONSORBLOCK_CHECKS 10")
`;
  fs.writeFileSync(path.join(temp,'main.swift'),source+harness);
  const compiled=spawnSync('/usr/bin/xcrun',['swiftc',path.join(temp,'main.swift'),'-o',path.join(temp,'probe')],{encoding:'utf8',timeout:50000});
  assert.equal(compiled.status,0,compiled.stderr);
  const result=spawnSync(path.join(temp,'probe'),[],{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/NATIVE_SPONSORBLOCK_CHECKS 10/);
});
