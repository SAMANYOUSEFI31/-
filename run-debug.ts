import { isValidLogResponse } from './src/utils/offlineQueueUtils.js';
console.log(isValidLogResponse({
  date: '1405-01-02',
  cycleId: 'cyc_test',
  revision: 2,
  wakeUp: true,
  workout: true,
  study: false,
  journal: false,
  hardTask: false,
  specialMission: false
}, '1405-01-02'));
