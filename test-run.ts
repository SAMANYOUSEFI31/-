import { isValidLogResponse } from './src/utils/offlineQueueUtils.js';

let log = { date: '1405-06-10', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false };

console.log("Check:", isValidLogResponse(log, '1405-06-10'));
