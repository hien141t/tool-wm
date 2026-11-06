// Isolated Node smoke test; no WM website, no betting and no external requests.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const window = { dispatchEvent() {}, location: { origin: 'https://example.test' } };
const context = { window, console, Date, Math, Map, Set, Promise, setTimeout, clearTimeout, AbortController };
vm.runInNewContext(fs.readFileSync(__dirname + '/cloud-ai-client.js', 'utf8'), context);
const c = Object.create(window.WMBaccaratAIEngine.prototype);
Object.assign(c, {
  currentFilterMode:'FLASH', modelVersion:'test', cachedPredictions:new Map(),
  _forecastIdentityByTable:new Map(), observedRoundsCache:new Map(),
  bridgeConnected:true, licenseActive:true, stats:{},
  lastEvaluationTime:0, _lastEvalSignature:'', _isEvaluatingBatch:false,
  isCloudHealthy:()=>true, onStatsChange:()=>{}
});
let calls=[];
c.callBridge=async (action,payload)=>{
  calls.push({action,payload});
  if(action==='evaluate'){
    return {ok:true,status:200,data:{ok:true,active:true,modelVersion:'test',predictions:Object.fromEntries(
      payload.tables.map(t=>[t.id,{predicted:'PASS',shouldBet:false,confidence:0.4}])
    )}};
  }
  if(action==='observe') return {ok:true,status:200,data:{ack:true,status:'COMMITTED',totalRounds:123}};
  throw Error(action)
};
(async()=>{
  const tableId='wm_classic_bac_13',shoe='my_live_shoe_13';
  const history='BBPPBPBPBBPBBPBPBPBPBPBP'.split('');
  const t={id:tableId,name:'Bac 13',shoe,round:128,history};
  await c.evaluateTablesBatch([t]);
  const predCall=calls.find(x=>x.action==='evaluate');
  assert(predCall, 'evaluate called');
  assert.strictEqual(predCall.payload.tables[0].id,tableId);
  assert.strictEqual(predCall.payload.tables[0].shoeId,shoe);
  assert.strictEqual(predCall.payload.tables[0].roundId,'128');
  assert.strictEqual(predCall.payload.tables[0].nextRoundId,'128');
  await c.observeRound(tableId,'Bac 13',history.slice(1),'B',shoe,
    {authoritativeShoeId:shoe,roundIndex:127});
  const obsCall=calls.find(x=>x.action==='observe');
  assert(obsCall,'observe called');
  assert.strictEqual(obsCall.payload.table_id,predCall.payload.tables[0].id);
  assert.strictEqual(obsCall.payload.shoe_id,predCall.payload.tables[0].shoeId);
  assert.strictEqual(obsCall.payload.round_id,predCall.payload.tables[0].roundId);
  assert(!c._forecastIdentityByTable.has(tableId),'clears resolved forecast');
  console.log('PASS: pre-outcome forecast IDs == observed outcome IDs despite shifted window and stale DOM round');
})().catch(e=>{console.error(e);process.exitCode=1});
