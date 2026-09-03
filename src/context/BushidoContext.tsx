import React, { 
  createContext, 
  useContext, 
  useState, 
  useEffect, 
  useMemo, 
  useCallback, 
  useRef, 
  ReactNode 
} from 'react';
import { 
  Cycle, 
  DailyLog, 
  SystemSettings, 
  UserProfile, 
  AdminUserItem, 
  CycleMetrics,
  HabitKey,
  FailureReason,
  FailureTime
} from '../types';
import { createInitialSystemState, GUEST_USER_PROFILE } from '../data/initialData';
import { computeCycleMetrics } from '../engine/bushidoCalculations';
import { getLogicalTodayDate, addDaysToDate } from '../utils/dateUtils';
import { applyAccentTheme } from '../utils/themeUtils';
import { toPersianDigits } from '../utils/numberUtils';
import { 
  loadStoredSystemState, 
  saveSystemStateDebounced, 
  flushPendingStorageSave, 
  STORAGE_KEY, 
  TOKEN_KEY,
  DEMO_CONSUMED_KEY,
  getScopedStorageKey,
  getScopedDemoConsumedKey,
  getActiveAccountId,
  setActiveAccountId,
  safeGetLocalStorage,
  safeSetLocalStorage,
  safeRemoveLocalStorage,
  safeGetSessionStorage,
  safeSetSessionStorage,
  safeRemoveSessionStorage,
  resolveBackendSyncDecision
} from '../utils/storageUtils';

const OFFLINE_QUEUE_KEY = 'bushido_offline_queue';

interface OfflineQueueItem {
  id: string;
  type: 'UPDATE_LOG' | 'UPDATE_CYCLE' | 'CREATE_CYCLE';
  payload: any;
  timestamp: number;
}

const getOfflineQueue = (): OfflineQueueItem[] => {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveOfflineQueue = (queue: OfflineQueueItem[]) => {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.warn('Failed to persist offline queue:', err);
  }
};

const addToOfflineQueue = (item: Omit<OfflineQueueItem, 'id' | 'timestamp'>) => {
  const queue = getOfflineQueue();
  const newItem: OfflineQueueItem = {
    ...item,
    id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: Date.now()
  };
  queue.push(newItem);
  saveOfflineQueue(queue);
};

const parseApiError = async (res: Response): Promise<string> => {
  try {
    const data = await res.json();
    if (data?.messageFa) return data.messageFa;
    if (data?.error?.messageFa) return data.error.messageFa;
    if (data?.error) return typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
    if (data?.message) return data.message;
  } catch {
    // Fallback if response body isn't JSON
  }
  return `خطای سرور با کد ${res.status}`;
};

export interface BushidoContextType {
  authToken: string | null;
  systemState: {
    cycles: Cycle[];
    logs: DailyLog[];
    settings: SystemSettings;
    userProfile: UserProfile;
  };
  user: UserProfile;
  logs: DailyLog[];
  activeCycleId: string;
  selectedDate: string;
  activeTab: string;
  currentCycle: Cycle | null;
  cycleMetrics: CycleMetrics | null;
  impersonatingUser: AdminUserItem | null;
  autopsyTargetLog: DailyLog | null;
  isPaymentModalOpen: boolean;
  isAuthModalOpen: boolean;
  isResetConfirmOpen: boolean;
  appToastMessage: string | null;

  // Autopsy Lock & UX Transparency
  isAutopsyLocked: boolean;
  unresolvedAutopsyLog: DailyLog | null;

  // Navigation & Date
  selectDate: (date: string) => void;
  setActiveTab: (tab: string) => void;
  setActiveCycleId: (id: string) => void;

  // Actions
  updateLog: (log: DailyLog) => Promise<void>;
  updateCycle: (cycle: Cycle) => Promise<void>;
  deleteCycle: (cycleId: string) => Promise<void>;
  createNewCycle: (title: string, startDate: string, targetTheme: string) => Promise<void>;
  updateUserProfile: (profile: UserProfile) => Promise<void>;
  updateSettings: (settings: SystemSettings) => Promise<void>;
  syncOfflineDataToServer: () => Promise<void>;
  exportData: () => void;
  confirmResetData: () => void;
  importData: (jsonStr: string) => void;

  // Direct Helper Shortcuts
  toggleHabit: (date: string, habitKey: HabitKey) => Promise<void>;
  submitAutopsy: (
    logDate: string, 
    failureReason: FailureReason, 
    failureTime: FailureTime, 
    autopsyNotes: string, 
    countermeasure: string
  ) => Promise<void>;
  freezeDay: (date: string) => Promise<void>;

  // Auth & Admin
  handleAuthSuccess: (token: string, user: UserProfile) => void;
  handleQuickLogin: (role: 'admin' | 'test_user') => Promise<void>;
  handleImpersonateUser: (user: AdminUserItem) => Promise<void>;
  handleExitImpersonation: () => Promise<void>;
  handleLogout: () => void;
  refreshUserProfile: () => Promise<void>;

  // Modal & Toast Controls
  openAutopsy: (log: DailyLog) => void;
  closeAutopsy: () => void;
  openPaymentModal: () => void;
  closePaymentModal: () => void;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  openResetConfirm: () => void;
  closeResetConfirm: () => void;
  showAppToast: (message: string) => void;
  closeAppToast: () => void;
}

const BushidoContext = createContext<BushidoContextType | null>(null);

export const BushidoProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [authToken, setAuthToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });

  const [impersonatingUser, setImpersonatingUser] = useState<AdminUserItem | null>(null);
  const [impersonatorAdminToken, setImpersonatorAdminToken] = useState<string | null>(null);

  const [systemState, setSystemState] = useState<{
    cycles: Cycle[];
    logs: DailyLog[];
    settings: SystemSettings;
    userProfile: UserProfile;
  }>(() => {
    const token = safeGetLocalStorage(TOKEN_KEY);
    const activeAcc = getActiveAccountId();
    return loadStoredSystemState(token ? activeAcc : null);
  });

  const [activeCycleId, setActiveCycleId] = useState<string>(() => {
    return systemState.cycles[0]?.id || 'cycle-1';
  });

  const [selectedDate, setSelectedDate] = useState<string>(() => getLogicalTodayDate());
  const [activeTab, setActiveTab] = useState<string>('battlefield');
  const [autopsyTargetLog, setAutopsyTargetLog] = useState<DailyLog | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [appToastMessage, setAppToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | number | null>(null);

  const showAppToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current as NodeJS.Timeout);
      toastTimeoutRef.current = null;
    }
    setAppToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setAppToastMessage(null);
      toastTimeoutRef.current = null;
    }, 2500);
  }, []);

  const closeAppToast = useCallback(() => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current as NodeJS.Timeout);
      toastTimeoutRef.current = null;
    }
    setAppToastMessage(null);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current as NodeJS.Timeout);
        toastTimeoutRef.current = null;
      }
    };
  }, []);

  const selectDate = useCallback((newDate: string) => {
    setSelectedDate(newDate);

    const matchedCycle = systemState.cycles.find(c => {
      const end = c.endDate || addDaysToDate(c.startDate, 89);
      return newDate >= c.startDate && newDate <= end;
    });

    if (matchedCycle && matchedCycle.id !== activeCycleId) {
      setActiveCycleId(matchedCycle.id);
    }
  }, [systemState.cycles, activeCycleId]);

  useEffect(() => {
    saveSystemStateDebounced(systemState, systemState.userProfile?.id, 350);
    const theme = systemState.userProfile?.accentTheme || systemState.settings?.accentTheme || 'amber';
    applyAccentTheme(theme);
  }, [systemState]);

  useEffect(() => {
    const initDefaultAdminIfNeeded = async () => {
      const currentToken = safeGetLocalStorage(TOKEN_KEY);
      const isExplicitLogout = sessionStorage.getItem('bushido_explicit_logout') === 'true';
      if (!currentToken && !isExplicitLogout) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          const res = await fetch('/api/auth/quick-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'admin' }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (res.ok) {
            const data = await res.json();
            if (data.token && data.user) {
              safeSetLocalStorage(TOKEN_KEY, data.token);
              setActiveAccountId(data.user.id);
              setAuthToken(data.token);
              setSystemState(prev => ({
                ...prev,
                userProfile: {
                  ...prev.userProfile,
                  ...data.user,
                  isVip: Boolean(data.user.isVip),
                  isAdmin: Boolean(data.user.isAdmin)
                }
              }));
            }
          }
        } catch (err) {
          // In production or when test shortcuts are disabled, quick-login will fail gracefully without spinning
        }
      }
    };

    initDefaultAdminIfNeeded();
  }, []);

  const refreshUserProfile = useCallback(async () => {
    if (!authToken) return;
    try {
      const res = await fetch('/api/auth/me', {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.user) {
          setSystemState(prev => ({
            ...prev,
            userProfile: {
              ...prev.userProfile,
              ...data.user,
              isVip: Boolean(data.user.isVip),
              isAdmin: Boolean(data.user.isAdmin)
            }
          }));
        }
      }
    } catch (err) {
      console.warn('Refresh user profile error:', err);
    }
  }, [authToken]);

  useEffect(() => {
    let isCancelled = false;

    const fetchBackendData = async () => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (authToken) {
          headers['Authorization'] = `Bearer ${authToken}`;
        }

        let fetchedUserProfile: Partial<UserProfile> | null = null;
        if (authToken) {
          const userRes = await fetch('/api/auth/me', { headers }).catch(() => null);
          if (userRes) {
            if (userRes.ok) {
              const userData = await userRes.json();
              if (userData?.user) {
                setActiveAccountId(userData.user.id);
                fetchedUserProfile = {
                  ...userData.user,
                  isVip: Boolean(userData.user.isVip),
                  isAdmin: Boolean(userData.user.isAdmin)
                };
              }
            } else if (userRes.status === 401) {
              safeRemoveLocalStorage(TOKEN_KEY);
              setActiveAccountId(null);
              setAuthToken(null);
            }
          }
        }

        if (isCancelled) return;

        let apiCycles: Cycle[] | null = null;
        const cyclesRes = await fetch('/api/cycles', { headers }).catch(() => null);
        if (cyclesRes && cyclesRes.ok) {
          const cyclesData = await cyclesRes.json();
          const cyclesList = Array.isArray(cyclesData) ? cyclesData : (cyclesData?.cycles || []);
          if (Array.isArray(cyclesList)) {
            apiCycles = cyclesList;
          }
        }

        if (isCancelled) return;

        let apiLogs: DailyLog[] | null = null;
        const logsRes = await fetch('/api/logs', { headers }).catch(() => null);
        if (logsRes && logsRes.ok) {
          const logsData = await logsRes.json();
          const logsList = Array.isArray(logsData) ? logsData : (logsData?.logs || []);
          if (Array.isArray(logsList)) {
            apiLogs = logsList;
          }
        }

        if (isCancelled) return;

        const activeUserId = fetchedUserProfile?.id || (authToken ? getActiveAccountId() : null);
        const scopedDemoKey = getScopedDemoConsumedKey(activeUserId);
        const isDemoConsumed = safeGetLocalStorage(scopedDemoKey) === 'true';
        const syncDecision = resolveBackendSyncDecision({
          apiCycles,
          apiLogs,
          isDemoConsumed
        });

        if (syncDecision.shouldMarkDemoConsumed) {
          safeSetLocalStorage(scopedDemoKey, 'true');
        }

        const { nextCycles, nextLogs, nextActiveCycleId } = syncDecision;

        if (fetchedUserProfile || nextCycles !== null || nextLogs !== null) {
          setSystemState(prev => ({
            ...prev,
            userProfile: fetchedUserProfile ? { ...prev.userProfile, ...fetchedUserProfile } : prev.userProfile,
            cycles: nextCycles !== null ? nextCycles : prev.cycles,
            logs: nextLogs !== null ? nextLogs : prev.logs
          }));

          if (nextActiveCycleId) {
            setActiveCycleId(prev => {
              if (!prev || (nextCycles && !nextCycles.some(c => c.id === prev))) {
                return nextActiveCycleId!;
              }
              return prev;
            });
          }
        }
      } catch (err) {
        console.warn('Backend sync warning (running in offline/local fallback):', err);
      }
    };

    fetchBackendData();
    return () => {
      isCancelled = true;
    };
  }, [authToken]);

  const currentCycle = useMemo(() => {
    return systemState.cycles.find(c => c.id === activeCycleId) || systemState.cycles[0] || null;
  }, [systemState.cycles, activeCycleId]);

  const logicalToday = getLogicalTodayDate();

  const cycleMetrics = useMemo(() => {
    if (!currentCycle) return null;
    return computeCycleMetrics(currentCycle, systemState.logs, systemState.cycles, logicalToday);
  }, [currentCycle, systemState.logs, systemState.cycles, logicalToday]);

  const unresolvedAutopsyLog = useMemo(() => {
    if (!currentCycle) return null;
    return systemState.logs.find(l => {
      if (l.cycleId !== currentCycle.id && l.date < currentCycle.startDate) return false;
      if (l.date > logicalToday) return false;
      const coreCount = (l.wakeUp ? 1 : 0) + (l.workout ? 1 : 0) + (l.study ? 1 : 0) + (l.journal ? 1 : 0) + (l.hardTask ? 1 : 0);
      const isFailedDay = coreCount === 0;
      const isAutopsyMissing = !l.failureReason || !l.countermeasure;
      return isFailedDay && isAutopsyMissing;
    }) || null;
  }, [currentCycle, systemState.logs, logicalToday]);

  const isAutopsyLocked = useMemo(() => {
    return unresolvedAutopsyLog !== null;
  }, [unresolvedAutopsyLog]);

  const updateLog = useCallback(async (updatedLog: DailyLog) => {
    const optimisticLog: DailyLog = { ...updatedLog, isSynced: false };
    setSystemState(prev => {
      const existingIdx = prev.logs.findIndex(l => l.date === updatedLog.date);
      let newLogs: DailyLog[];
      if (existingIdx >= 0) {
        newLogs = [...prev.logs];
        newLogs[existingIdx] = optimisticLog;
      } else {
        newLogs = [...prev.logs, optimisticLog];
      }
      return {
        ...prev,
        logs: newLogs
      };
    });

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      addToOfflineQueue({ type: 'UPDATE_LOG', payload: updatedLog });
      return;
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await fetch('/api/logs', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...updatedLog,
          cycleId: updatedLog.cycleId || activeCycleId
        })
      });

      if (res.ok) {
        setSystemState(prev => ({
          ...prev,
          logs: prev.logs.map(l => l.date === updatedLog.date ? { ...l, isSynced: true } : l)
        }));
      } else {
        const errorMsg = await parseApiError(res);
        console.warn('API Error updating log:', errorMsg);
        addToOfflineQueue({ type: 'UPDATE_LOG', payload: updatedLog });
      }
    } catch (e) {
      console.warn('Failed to sync log to server backend, added to offline queue:', e);
      addToOfflineQueue({ type: 'UPDATE_LOG', payload: updatedLog });
    }
  }, [authToken, activeCycleId]);

  const updateCycle = useCallback(async (updatedCycle: Cycle) => {
    const optimisticCycle: Cycle = { ...updatedCycle, isSynced: false };
    setSystemState(prev => ({
      ...prev,
      cycles: prev.cycles.map(c => (c.id === updatedCycle.id ? optimisticCycle : c))
    }));

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      addToOfflineQueue({ type: 'UPDATE_CYCLE', payload: updatedCycle });
      return;
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await fetch(`/api/cycles/${updatedCycle.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(updatedCycle)
      });

      if (res.ok) {
        setSystemState(prev => ({
          ...prev,
          cycles: prev.cycles.map(c => (c.id === updatedCycle.id ? { ...c, isSynced: true } : c))
        }));
      } else {
        const errorMsg = await parseApiError(res);
        console.warn('API Error updating cycle:', errorMsg);
        addToOfflineQueue({ type: 'UPDATE_CYCLE', payload: updatedCycle });
      }
    } catch (e) {
      console.warn('Failed to sync cycle update to server, added to offline queue:', e);
      addToOfflineQueue({ type: 'UPDATE_CYCLE', payload: updatedCycle });
    }
  }, [authToken]);

  const deleteCycle = useCallback(async (cycleId: string) => {
    safeSetLocalStorage(DEMO_CONSUMED_KEY, 'true');
    const remainingCycles = systemState.cycles.filter(c => c.id !== cycleId);

    setSystemState(prev => ({
      ...prev,
      cycles: prev.cycles.filter(c => c.id !== cycleId),
      logs: prev.logs.filter(l => l.cycleId !== cycleId)
    }));

    if (activeCycleId === cycleId && remainingCycles.length > 0) {
      setActiveCycleId(remainingCycles[0].id);
      setSelectedDate(remainingCycles[0].startDate);
    }

    try {
      const headers: Record<string, string> = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      await fetch(`/api/cycles/${cycleId}`, {
        method: 'DELETE',
        headers
      });
    } catch (e) {
      console.warn('Failed to sync cycle deletion to server:', e);
    }
  }, [authToken, activeCycleId, systemState.cycles]);

  const createNewCycle = useCallback(async (title: string, startDate: string, targetTheme: string) => {
    safeSetLocalStorage(DEMO_CONSUMED_KEY, 'true');
    const newCycle: Cycle = {
      id: `cycle-${Date.now()}`,
      title,
      startDate,
      endDate: addDaysToDate(startDate, 89),
      targetTheme,
      inheritedStreak: cycleMetrics?.pureStreak || 0,
      isArchived: false,
      reportRead: false,
      isSynced: false
    };

    setSystemState(prev => ({
      ...prev,
      cycles: [...prev.cycles, newCycle]
    }));
    setActiveCycleId(newCycle.id);
    setSelectedDate(startDate);
    setActiveTab('battlefield');

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      addToOfflineQueue({ type: 'CREATE_CYCLE', payload: newCycle });
      return;
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await fetch('/api/cycles', {
        method: 'POST',
        headers,
        body: JSON.stringify(newCycle)
      });

      if (res.ok) {
        setSystemState(prev => ({
          ...prev,
          cycles: prev.cycles.map(c => (c.id === newCycle.id ? { ...c, isSynced: true } : c))
        }));
      } else {
        const errorMsg = await parseApiError(res);
        console.warn('API Error creating cycle:', errorMsg);
        addToOfflineQueue({ type: 'CREATE_CYCLE', payload: newCycle });
      }
    } catch (e) {
      console.warn('Failed to save cycle to server, added to offline queue:', e);
      addToOfflineQueue({ type: 'CREATE_CYCLE', payload: newCycle });
    }
  }, [authToken, cycleMetrics?.pureStreak]);

  const syncOfflineDataToServer = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }

    const currentToken = authToken || localStorage.getItem(TOKEN_KEY);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    let syncedItemsCount = 0;

    const queue = getOfflineQueue();
    if (queue.length > 0) {
      const remainingQueue: OfflineQueueItem[] = [];
      for (const item of queue) {
        try {
          if (item.type === 'UPDATE_LOG') {
            const res = await fetch('/api/logs', {
              method: 'POST',
              headers,
              body: JSON.stringify(item.payload)
            });
            if (res.ok) {
              syncedItemsCount++;
              setSystemState(prev => ({
                ...prev,
                logs: prev.logs.map(l => l.date === item.payload.date ? { ...l, isSynced: true } : l)
              }));
            } else {
              remainingQueue.push(item);
            }
          } else if (item.type === 'UPDATE_CYCLE' || item.type === 'CREATE_CYCLE') {
            const endpoint = item.type === 'CREATE_CYCLE' ? '/api/cycles' : `/api/cycles/${item.payload.id}`;
            const method = item.type === 'CREATE_CYCLE' ? 'POST' : 'PUT';
            const res = await fetch(endpoint, {
              method,
              headers,
              body: JSON.stringify(item.payload)
            });
            if (res.ok) {
              syncedItemsCount++;
              setSystemState(prev => ({
                ...prev,
                cycles: prev.cycles.map(c => c.id === item.payload.id ? { ...c, isSynced: true } : c)
              }));
            } else {
              remainingQueue.push(item);
            }
          }
        } catch (err) {
          remainingQueue.push(item);
        }
      }
      saveOfflineQueue(remainingQueue);
    }

    const unsyncedLogs = systemState.logs.filter(l => l.isSynced === false);
    if (unsyncedLogs.length > 0) {
      for (const log of unsyncedLogs) {
        try {
          const res = await fetch('/api/logs', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              ...log,
              cycleId: log.cycleId || activeCycleId
            })
          });
          if (res.ok) {
            syncedItemsCount++;
            setSystemState(prev => ({
              ...prev,
              logs: prev.logs.map(l => l.date === log.date ? { ...l, isSynced: true } : l)
            }));
          }
        } catch (err) {
          console.warn('[Sync Queue] Failed to push offline log:', log.date, err);
        }
      }
    }

    if (syncedItemsCount > 0) {
      showAppToast(`همگام‌سازی ابری با موفقیت انجام شد (${toPersianDigits(syncedItemsCount)} تغییر ذخیره شد).`);
    }
  }, [authToken, activeCycleId, systemState.logs, showAppToast]);

  useEffect(() => {
    const handleOnline = () => {
      console.log('[Bushido Sync] Device is back online. Syncing pending offline queues...');
      syncOfflineDataToServer();
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [syncOfflineDataToServer]);

  const updateUserProfile = useCallback(async (updatedProfile: UserProfile) => {
    setSystemState(prev => ({
      ...prev,
      userProfile: updatedProfile
    }));

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      await fetch('/api/user/profile', {
        method: 'PUT',
        headers,
        body: JSON.stringify(updatedProfile)
      });
    } catch (e) {
      console.warn('Failed to sync user profile:', e);
    }
  }, [authToken]);

  const updateSettings = useCallback(async (updatedSettings: SystemSettings) => {
    setSystemState(prev => ({
      ...prev,
      settings: updatedSettings
    }));
  }, []);

  const toggleHabit = useCallback(async (date: string, habitKey: HabitKey) => {
    const existingLog = systemState.logs.find(l => l.date === date) || {
      id: `log-${date}`,
      cycleId: activeCycleId,
      date,
      createdAt: new Date().toISOString(),
      wakeUp: false,
      workout: false,
      study: false,
      journal: false,
      hardTask: false,
      specialMission: false
    };

    const updatedLog: DailyLog = {
      ...existingLog,
      [habitKey]: !existingLog[habitKey],
      isSynced: false
    };

    await updateLog(updatedLog);
  }, [systemState.logs, activeCycleId, updateLog]);

  const submitAutopsy = useCallback(async (
    logDate: string, 
    failureReason: FailureReason, 
    failureTime: FailureTime, 
    autopsyNotes: string, 
    countermeasure: string
  ) => {
    const existingLog = systemState.logs.find(l => l.date === logDate) || {
      id: `log-${logDate}`,
      cycleId: activeCycleId,
      date: logDate,
      createdAt: new Date().toISOString(),
      wakeUp: false,
      workout: false,
      study: false,
      journal: false,
      hardTask: false,
      specialMission: false
    };

    const updatedLog: DailyLog = {
      ...existingLog,
      failureReason,
      failureTime,
      autopsyNotes,
      countermeasure,
      isSynced: false
    };

    await updateLog(updatedLog);
    setAutopsyTargetLog(null);
    showAppToast('کالبدشکافی با موفقیت ثبت شد و قفل سامانه برطرف گردید.');
  }, [systemState.logs, activeCycleId, updateLog, showAppToast]);

  const freezeDay = useCallback(async (date: string) => {
    const existingLog = systemState.logs.find(l => l.date === date) || {
      id: `log-${date}`,
      cycleId: activeCycleId,
      date,
      createdAt: new Date().toISOString(),
      wakeUp: false,
      workout: false,
      study: false,
      journal: false,
      hardTask: false,
      specialMission: false
    };

    const updatedLog: DailyLog = {
      ...existingLog,
      notes: (existingLog.notes ? existingLog.notes + ' ' : '') + '[فریز اضطراری روز]',
      isSynced: false
    };

    await updateLog(updatedLog);
    showAppToast('ریتم روز با موفقیت فریز شد.');
  }, [systemState.logs, activeCycleId, updateLog, showAppToast]);

  const exportData = useCallback(() => {
    const data = {
      cycles: systemState.cycles,
      logs: systemState.logs,
      settings: systemState.settings,
      userProfile: systemState.userProfile,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bushido-discipline-backup-${logicalToday}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [systemState, logicalToday]);

  const confirmResetData = useCallback(() => {
    safeRemoveLocalStorage(DEMO_CONSUMED_KEY);
    flushPendingStorageSave();
    const fresh = createInitialSystemState();
    setSystemState(fresh);
    setActiveCycleId(fresh.cycles[0].id);
    setSelectedDate(getLogicalTodayDate());
    setIsResetConfirmOpen(false);
    showAppToast('داده‌های سامانه با موفقیت به مقادیر اولیه بوشیدو بازنشانی شد.');
  }, [showAppToast]);

  const importData = useCallback((dataStr: string) => {
    try {
      const parsed = JSON.parse(dataStr);
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray(parsed.cycles) &&
        Array.isArray(parsed.logs) &&
        parsed.settings &&
        typeof parsed.settings === 'object'
      ) {
        if (!parsed.userProfile || typeof parsed.userProfile !== 'object') {
          parsed.userProfile = createInitialSystemState().userProfile;
        }

        parsed.cycles = parsed.cycles.filter((c: any) => c && typeof c === 'object' && typeof c.id === 'string' && typeof c.startDate === 'string');
        parsed.logs = parsed.logs.filter((l: any) => l && typeof l === 'object' && typeof l.date === 'string');

        if (parsed.cycles.length === 0) {
          showAppToast('فایل پشتیبان باید حداقل دارای یک چرخه معتبر باشد.');
          return;
        }

        safeSetLocalStorage(DEMO_CONSUMED_KEY, 'true');
        flushPendingStorageSave();
        setSystemState(parsed);
        setActiveCycleId(parsed.cycles[0].id);
        showAppToast('اطلاعات پشتیبان با موفقیت بازیابی شد.');
      } else {
        showAppToast('فرمت ساختار فایل پشتیبان نامعتبر است.');
      }
    } catch {
      showAppToast('خطا در تجزیه فایل JSON.');
    }
  }, [showAppToast]);

  const handleAuthSuccess = useCallback((token: string, user: UserProfile) => {
    flushPendingStorageSave();
    safeRemoveSessionStorage('bushido_explicit_logout');
    safeSetLocalStorage(TOKEN_KEY, token);
    setActiveAccountId(user.id);
    setAuthToken(token);

    const userLocalState = loadStoredSystemState(user.id);
    setSystemState({
      ...userLocalState,
      userProfile: user
    });
    if (userLocalState.cycles.length > 0) {
      setActiveCycleId(userLocalState.cycles[0].id);
    }
    showAppToast(`با موفقیت وارد حساب «${user.name || 'کاربر'}» شدید.`);
  }, [showAppToast]);

  const handleQuickLogin = useCallback(async (role: 'admin' | 'test_user') => {
    try {
      flushPendingStorageSave();
      safeRemoveSessionStorage('bushido_explicit_logout');
      let data: any = null;
      let isExplicitlyRejected = false;

      try {
        const res = await fetch('/api/auth/quick-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role })
        });
        if (res.ok) {
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            data = await res.json();
          }
        } else {
          isExplicitlyRejected = true;
          const errText = await parseApiError(res);
          showAppToast(errText || 'ورود سریع در محیط عملیاتی غیرفعال است.');
          return;
        }
      } catch (err) {
        console.warn('Backend quick-login fetch warning:', err);
      }

      if (isExplicitlyRejected) return;

      if (data && data.token && data.user) {
        safeSetLocalStorage(TOKEN_KEY, data.token);
        setActiveAccountId(data.user.id);
        setAuthToken(data.token);
        const userLocalState = loadStoredSystemState(data.user.id);
        setSystemState({
          ...userLocalState,
          userProfile: {
            ...userLocalState.userProfile,
            ...data.user,
            isVip: Boolean(data.user.isVip),
            isAdmin: Boolean(data.user.isAdmin)
          }
        });
        if (userLocalState.cycles.length > 0) {
          setActiveCycleId(userLocalState.cycles[0].id);
        }
        showAppToast(role === 'admin' ? 'به عنوان مدیر ارشد سیستم وارد شدید.' : 'به عنوان کاربر تستی وارد شدید.');
        return;
      }

      if (!import.meta.env.DEV) {
        showAppToast('امکان ورود سریع در این محیط وجود ندارد.');
        return;
      }

      const fallbackToken = `mock-token-${role}-${Date.now()}`;
      const fallbackUser: UserProfile = role === 'admin' ? {
        id: 'admin-master-001',
        name: 'فرمانده ارشد سامورایی (مدیر)',
        email: 'admin@bushido.app',
        phoneNumber: '09375454050',
        tier: 'vip_samurai',
        isVip: true,
        isAdmin: true,
        vipSince: new Date().toISOString(),
        vipExpiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
        paymentRefId: 'REF-ADMIN-MASTER-001',
        activeCycleLimit: 999
      } : {
        id: 'test-user-001',
        name: 'کاربر آزمایشی بوشیدو (دید کاربر)',
        email: 'test@bushido.app',
        phoneNumber: '09121111111',
        tier: 'free',
        isVip: false,
        isAdmin: false,
        vipSince: undefined,
        vipExpiresAt: undefined,
        paymentRefId: undefined,
        activeCycleLimit: 1
      };

      safeSetLocalStorage(TOKEN_KEY, fallbackToken);
      setActiveAccountId(fallbackUser.id);
      setAuthToken(fallbackToken);
      const fallbackLocalState = loadStoredSystemState(fallbackUser.id);
      setSystemState({
        ...fallbackLocalState,
        userProfile: fallbackUser
      });
      if (fallbackLocalState.cycles.length > 0) {
        setActiveCycleId(fallbackLocalState.cycles[0].id);
      }
      showAppToast(role === 'admin' ? 'به عنوان مدیر ارشد سیستم وارد شدید.' : 'به عنوان کاربر تستی وارد شدید.');
    } catch (e) {
      console.error('Quick login error:', e);
      showAppToast('ورود با تنظیمات پیش‌فرض انجام شد.');
    }
  }, [showAppToast]);

  const handleImpersonateUser = useCallback(async (targetUser: AdminUserItem) => {
    try {
      const currentToken = authToken || safeGetLocalStorage(TOKEN_KEY);
      if (!currentToken) return;

      flushPendingStorageSave();

      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        },
        body: JSON.stringify({ targetUserId: targetUser.id })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.token && data.user) {
          setImpersonatorAdminToken(currentToken);
          setImpersonatingUser(targetUser);
          safeSetLocalStorage(TOKEN_KEY, data.token);
          setActiveAccountId(data.user.id);
          setAuthToken(data.token);
          const targetLocalState = loadStoredSystemState(data.user.id);
          setSystemState({
            ...targetLocalState,
            userProfile: {
              ...targetLocalState.userProfile,
              ...data.user,
              isVip: Boolean(data.user.isVip),
              isAdmin: Boolean(data.user.isAdmin)
            }
          });
          if (targetLocalState.cycles.length > 0) {
            setActiveCycleId(targetLocalState.cycles[0].id);
          }
          setActiveTab('battlefield');
          showAppToast(`در حال شبیه‌سازی و مشاهده سامانه از دید: «${data.user.name}»`);
        } else {
          showAppToast('خطا در دریافت اطلاعات شبیه‌سازی کاربر');
        }
      } else {
        const errorMsg = await parseApiError(res);
        showAppToast(errorMsg);
      }
    } catch (e) {
      console.error('Impersonate user error:', e);
      showAppToast('خطا در برقراری ارتباط با سرور');
    }
  }, [authToken, showAppToast]);

  const handleExitImpersonation = useCallback(async () => {
    if (!impersonatorAdminToken) return;
    try {
      flushPendingStorageSave();
      safeSetLocalStorage(TOKEN_KEY, impersonatorAdminToken);
      setAuthToken(impersonatorAdminToken);
      setImpersonatingUser(null);
      const res = await fetch('/api/auth/me', {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${impersonatorAdminToken}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setActiveAccountId(data.user.id);
          const adminLocalState = loadStoredSystemState(data.user.id);
          setSystemState({
            ...adminLocalState,
            userProfile: {
              ...adminLocalState.userProfile,
              ...data.user,
              isVip: Boolean(data.user.isVip),
              isAdmin: Boolean(data.user.isAdmin)
            }
          });
          if (adminLocalState.cycles.length > 0) {
            setActiveCycleId(adminLocalState.cycles[0].id);
          }
        }
      }
      setImpersonatorAdminToken(null);
      setActiveTab('admin');
      showAppToast('به حساب مدیریت بازگشتید.');
    } catch (e) {
      console.error('Exit impersonation error:', e);
    }
  }, [impersonatorAdminToken, showAppToast]);

  const handleLogout = useCallback(() => {
    flushPendingStorageSave();
    safeRemoveLocalStorage(TOKEN_KEY);
    setActiveAccountId(null);
    safeSetSessionStorage('bushido_explicit_logout', 'true');
    setAuthToken(null);
    setImpersonatingUser(null);
    setImpersonatorAdminToken(null);
    const guestState = loadStoredSystemState(null);
    setSystemState(guestState);
    setActiveCycleId(guestState.cycles[0]?.id || 'cycle-1');
    setIsAuthModalOpen(false);
    showAppToast('با موفقیت از حساب کاربری خارج شدید.');
  }, [showAppToast]);

  const openAutopsy = useCallback((log: DailyLog) => setAutopsyTargetLog(log), []);
  const closeAutopsy = useCallback(() => setAutopsyTargetLog(null), []);
  const openPaymentModal = useCallback(() => setIsPaymentModalOpen(true), []);
  const closePaymentModal = useCallback(() => setIsPaymentModalOpen(false), []);
  const openAuthModal = useCallback(() => setIsAuthModalOpen(true), []);
  const closeAuthModal = useCallback(() => setIsAuthModalOpen(false), []);
  const openResetConfirm = useCallback(() => setIsResetConfirmOpen(true), []);
  const closeResetConfirm = useCallback(() => setIsResetConfirmOpen(false), []);

  const value: BushidoContextType = {
    authToken,
    systemState,
    user: systemState.userProfile,
    logs: systemState.logs,
    activeCycleId,
    selectedDate,
    activeTab,
    currentCycle,
    cycleMetrics,
    impersonatingUser,
    autopsyTargetLog,
    isPaymentModalOpen,
    isAuthModalOpen,
    isResetConfirmOpen,
    appToastMessage,

    isAutopsyLocked,
    unresolvedAutopsyLog,

    selectDate,
    setActiveTab,
    setActiveCycleId,

    updateLog,
    updateCycle,
    deleteCycle,
    createNewCycle,
    updateUserProfile,
    updateSettings,
    syncOfflineDataToServer,
    exportData,
    confirmResetData,
    importData,

    toggleHabit,
    submitAutopsy,
    freezeDay,

    handleAuthSuccess,
    handleQuickLogin,
    handleImpersonateUser,
    handleExitImpersonation,
    handleLogout,
    refreshUserProfile,

    openAutopsy,
    closeAutopsy,
    openPaymentModal,
    closePaymentModal,
    openAuthModal,
    closeAuthModal,
    openResetConfirm,
    closeResetConfirm,
    showAppToast,
    closeAppToast
  };

  return <BushidoContext.Provider value={value}>{children}</BushidoContext.Provider>;
};

export const useBushido = (): BushidoContextType => {
  const context = useContext(BushidoContext);
  if (!context) {
    throw new Error('useBushido must be used within a BushidoProvider');
  }
  return context;
};
