export function isValidLogResponse(serverLog: any, targetDate: string): boolean {
  return !!serverLog &&
    serverLog.date === targetDate &&
    typeof serverLog.cycleId === 'string' &&
    typeof serverLog.revision === 'number' && Number.isInteger(serverLog.revision) && serverLog.revision > 0 &&
    typeof serverLog.wakeUp === 'boolean' &&
    typeof serverLog.workout === 'boolean';
}

export function isValidCycleResponse(serverCycle: any, targetId: string): boolean {
  return !!serverCycle &&
    serverCycle.id === targetId &&
    typeof serverCycle.revision === 'number' && Number.isInteger(serverCycle.revision) && serverCycle.revision > 0 &&
    typeof serverCycle.title === 'string' &&
    typeof serverCycle.startDate === 'string';
}
