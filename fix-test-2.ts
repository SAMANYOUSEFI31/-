import fs from 'fs';

let content = fs.readFileSync('tests/phase-3b3-replay-contract-closure.test.ts', 'utf8');

let start_idx = content.indexOf("    it('active replay loop defers requests when nextRetryAt is in the future unless force is true', async () => {")
let end_idx = content.indexOf("    it('second simulated tab cannot acquire account lease while in-flight heartbeat is active', async () => {")

if (start_idx === -1) console.log("START NOT FOUND");
if (end_idx === -1) console.log("END NOT FOUND");

let new_test = `    it('active replay loop defers requests when nextRetryAt is in the future unless force is true', async () => {
      clearOfflineQueue(testUser);
      // Create item scheduled 10 seconds in future
      const futureTime = Date.now() + 10000;
      const queuedItem = enqueueOfflineMutation(testUser, {
        type: 'UPDATE_LOG',
        payload: { date: '1403-12-16', workout: true }
      });
      // Manually set backoff in storage
      const queue = getOfflineQueue(testUser);
      queue[0].nextRetryAt = futureTime;
      queue[0].retryCount = 2;
      saveOfflineQueue(testUser, queue);

      let netCalls = 0;
      const countingFetch = async (url?: any, init?: any) => {
        netCalls++;
        return { ok: true, status: 200, json: async () => ({ success: true, log: { date: '1403-12-16', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }) } as any;
      };

      // Call replay normal
      const res = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: countingFetch,
        getCurrentActiveAccountId: () => testUser
      });
      
      assert.equal(res.syncedCount, 0, 'Must defer request because of nextRetryAt');
      assert.equal(netCalls, 0, 'No fetch calls made');
      assert.equal(res.remainingQueueCount, 1, 'Item remains in queue');

      // Call replay with force
      const resForce = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: countingFetch,
        getCurrentActiveAccountId: () => testUser,
        forceImmediateReplay: true
      });

      assert.equal(resForce.syncedCount, 1, 'Must sync when force is true');
      assert.equal(netCalls, 1, 'Fetch call made');
      assert.equal(resForce.remainingQueueCount, 0, 'Queue is empty');
    });

`;

if (start_idx !== -1 && end_idx !== -1) {
    content = content.slice(0, start_idx) + new_test + content.slice(end_idx);
    fs.writeFileSync('tests/phase-3b3-replay-contract-closure.test.ts', content);
}
