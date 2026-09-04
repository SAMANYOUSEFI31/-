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
  cancelPendingStorageSave,
  STORAGE_KEY, 
  TOKEN_KEY,
  DEMO_CONSUMED_KEY,
  LEGACY_DEMO_CONSUMED_KEY,
  LEGACY_STORAGE_KEY,
  getScopedStorageKey,
  getScopedDemoConsumedKey,
  getActiveAccountId,
  setActiveAccountId,
  normalizeUserId,
  transitionAccountState,
  resetAccountState,
  importAccountState,
  safeGetLocalStorage,
  safeSetLocalStorage,
  safeRemoveLocalStorage,
  safeGetSessionStorage,
  safeSetSessionStorage,
  safeRemoveSessionStorage,
  resolveBackendSyncDecision,
  shouldQueueOfflineMutation
} from '../utils/storageUtils';
import {
  IMPERSONATOR_TOKEN_KEY,
  IMPERSONATING_USER_KEY,
  validateAdminTokenForExit,
  buildExitImpersonationSuccessState,
  buildExitImpersonationRevokedState,
  executeLogoutDuringImpersonation
} from '../utils/impersonationUtils';
import {
  enqueueOfflineMutation,
  getOfflineQueue,
  saveOfflineQueue,
  clearOfflineQueue,
  replayAccountOfflineQueue,
  migrateLegacyGlobalQueue,
  normalizeQueueOwner,
  isGuestQueueOwner
} from '../utils/offlineQueueUtils';

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

  const [impersonatingUser, setImpersonatingUser] = useState<AdminUserItem | null>(() => {
    try {
      const stored = safeGetSessionStorage('bushido_impersonating_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [impersonatorAdminToken, setImpersonatorAdminToken] = useState<string | null>(() => {
    return safeGetSessionStorage('bushido_impersonator_token');
  });

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
  const activeAccountRef = useRef<string | null>(systemState.userProfile?.id || null);

  useEffect(() => {
    activeAccountRef.current = systemState.userProfile?.id || null;
  }, [systemState.userProfile?.id]);

  useEffect(() => {
    // Phase 3B: Safely migrate legacy global queue on startup
    migrateLegacyGlobalQueue();
  }, []);

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

  /**
   * Authoritative Mutation Handlers:
   * Both App.tsx and BushidoContext.tsx share identical ownership and auth guards (shouldQueueOfflineMutation).
   * - Guests / tokenless sessions are strictly local and never queued for server replay.
   * - Authenticated offline sessions enqueue mutations into the owner's partition.
   * - Authenticated online sessions attempt direct API call with automatic queue fallback on network/server error.
   */
  const updateLog = useCallback(async (updatedLog: DailyLog) => {
    const ownerId = systemState.userProfile?.id;
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

    const guard = shouldQueueOfflineMutation({ ownerId, authToken });
    if (!guard.canSendToServer && !guard.shouldQueue) {
      return;
    }

    if (guard.shouldQueue) {
      enqueueOfflineMutation(ownerId, { type: 'UPDATE_LOG', payload: updatedLog });
      return;
    }

    try {
      const res = await fetch('/api/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
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
        enqueueOfflineMutation(ownerId, { type: 'UPDATE_LOG', payload: updatedLog });
      }
    } catch (e) {
      console.warn('Failed to sync log to server backend, added to offline queue:', e);
      enqueueOfflineMutation(ownerId, { type: 'UPDATE_LOG', payload: updatedLog });
    }
  }, [authToken, activeCycleId, systemState.userProfile?.id]);

  const updateCycle = useCallback(async (updatedCycle: Cycle) => {
    const ownerId = systemState.userProfile?.id;
    const optimisticCycle: Cycle = { ...updatedCycle, isSynced: false };
    setSystemState(prev => ({
      ...prev,
      cycles: prev.cycles.map(c => (c.id === updatedCycle.id ? optimisticCycle : c))
    }));

    const guard = shouldQueueOfflineMutation({ ownerId, authToken });
    if (!guard.canSendToServer && !guard.shouldQueue) {
      return;
    }

    if (guard.shouldQueue) {
      enqueueOfflineMutation(ownerId, { type: 'UPDATE_CYCLE', payload: updatedCycle });
      return;
    }

    try {
      const res = await fetch(`/api/cycles/${updatedCycle.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
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
        enqueueOfflineMutation(ownerId, { type: 'UPDATE_CYCLE', payload: updatedCycle });
      }
    } catch (e) {
      console.warn('Failed to sync cycle update to server, added to offline queue:', e);
      enqueueOfflineMutation(ownerId, { type: 'UPDATE_CYCLE', payload: updatedCycle });
    }
  }, [authToken, systemState.userProfile?.id]);

  const deleteCycle = useCallback(async (cycleId: string) => {
    const ownerId = systemState.userProfile?.id;
    const scopedDemoKey = getScopedDemoConsumedKey(ownerId);
    safeSetLocalStorage(scopedDemoKey, 'true');
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

    const guard = shouldQueueOfflineMutation({ ownerId, authToken });
    if (!guard.canSendToServer && !guard.shouldQueue) {
      return;
    }

    if (guard.shouldQueue) {
      enqueueOfflineMutation(ownerId, { type: 'DELETE_CYCLE', payload: { id: cycleId } });
      return;
    }

    try {
      const res = await fetch(`/api/cycles/${cycleId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      if (!res.ok) {
        enqueueOfflineMutation(ownerId, { type: 'DELETE_CYCLE', payload: { id: cycleId } });
      }
    } catch (e) {
      console.warn('Failed to sync cycle deletion to server, added to offline queue:', e);
      enqueueOfflineMutation(ownerId, { type: 'DELETE_CYCLE', payload: { id: cycleId } });
    }
  }, [authToken, activeCycleId, systemState.cycles, systemState.userProfile?.id]);

  const createNewCycle = useCallback(async (title: string, startDate: string, targetTheme: string) => {
    const ownerId = systemState.userProfile?.id;
    const scopedDemoKey = getScopedDemoConsumedKey(ownerId);
    safeSetLocalStorage(scopedDemoKey, 'true');
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

    const guard = shouldQueueOfflineMutation({ ownerId, authToken });
    if (!guard.canSendToServer && !guard.shouldQueue) {
      return;
    }

    if (guard.shouldQueue) {
      enqueueOfflineMutation(ownerId, { type: 'CREATE_CYCLE', payload: newCycle });
      return;
    }

    try {
      const res = await fetch('/api/cycles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
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
        enqueueOfflineMutation(ownerId, { type: 'CREATE_CYCLE', payload: newCycle });
      }
    } catch (e) {
      console.warn('Failed to save cycle to server, added to offline queue:', e);
      enqueueOfflineMutation(ownerId, { type: 'CREATE_CYCLE', payload: newCycle });
    }
  }, [authToken, cycleMetrics?.pureStreak, systemState.userProfile?.id]);

  const syncOfflineDataToServer = useCallback(async (targetOwnerId?: string | null, targetToken?: string | null) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }

    const ownerId = targetOwnerId !== undefined ? targetOwnerId : systemState.userProfile?.id;
    const currentToken = targetToken !== undefined ? targetToken : (authToken || safeGetLocalStorage(TOKEN_KEY));

    // Strengthen replay identity binding:
    // Replay strictly allowed for authenticated accounts with non-empty tokens
    if (!ownerId || !currentToken || isGuestQueueOwner(ownerId)) {
      return;
    }

    const result = await replayAccountOfflineQueue({
      activeAccountId: ownerId,
      authToken: currentToken,
      getCurrentActiveAccountId: () => activeAccountRef.current,
      onItemSuccess: (item) => {
        if (item.type === 'UPDATE_LOG') {
          setSystemState(prev => ({
            ...prev,
            logs: prev.logs.map(l => l.date === item.payload.date ? { ...l, isSynced: true } : l)
          }));
        } else if (item.type === 'UPDATE_CYCLE' || item.type === 'CREATE_CYCLE') {
          setSystemState(prev => ({
            ...prev,
            cycles: prev.cycles.map(c => c.id === item.payload.id ? { ...c, isSynced: true } : c)
          }));
        }
      }
    });

    if (result.syncedCount > 0) {
      showAppToast(`همگام‌سازی ابری با موفقیت انجام شد (${toPersianDigits(result.syncedCount)} تغییر ذخیره شد).`);
    }
  }, [authToken, systemState.userProfile?.id, showAppToast]);

  useEffect(() => {
    const handleOnline = () => {
      syncOfflineDataToServer();
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [syncOfflineDataToServer]);

  const updateUserProfile = useCallback(async (updatedProfile: UserProfile) => {
    const ownerId = systemState.userProfile?.id;
    setSystemState(prev => ({
      ...prev,
      userProfile: updatedProfile
    }));

    const guard = shouldQueueOfflineMutation({ ownerId, authToken });
    if (!guard.canSendToServer && !guard.shouldQueue) {
      return;
    }

    if (guard.shouldQueue) {
      enqueueOfflineMutation(ownerId, { type: 'UPDATE_PROFILE', payload: updatedProfile });
      return;
    }

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(updatedProfile)
      });
      if (!res.ok) {
        enqueueOfflineMutation(ownerId, { type: 'UPDATE_PROFILE', payload: updatedProfile });
      }
    } catch (e) {
      console.warn('Failed to sync user profile:', e);
      enqueueOfflineMutation(ownerId, { type: 'UPDATE_PROFILE', payload: updatedProfile });
    }
  }, [authToken, systemState.userProfile?.id]);

  const updateSettings = useCallback(async (updatedSettings: SystemSettings) => {
    // Architecture Decision (Requirement 3):
    // SystemSettings (such as all-time records, central engine name) are declared local-only client state.
    // User profile settings (nightOwlCutoffHour, accentTheme) are synced via UPDATE_PROFILE.
    // We intentionally DO NOT enqueue UPDATE_SETTINGS into the offline queue to avoid unnecessary / failing sync calls.
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
    const { freshState, activeCycleId } = resetAccountState(systemState.userProfile);
    setSystemState(freshState);
    setActiveCycleId(activeCycleId);
    setSelectedDate(getLogicalTodayDate());
    setIsResetConfirmOpen(false);
    showAppToast('داده‌های سامانه با موفقیت به مقادیر اولیه بوشیدو بازنشانی شد.');
  }, [showAppToast, systemState.userProfile]);

  const importData = useCallback((dataStr: string) => {
    const result = importAccountState(dataStr, systemState.userProfile?.id);
    if (result.success && result.state) {
      setSystemState(result.state);
      setActiveCycleId(result.activeCycleId || result.state.cycles[0]?.id || 'cycle-1');
      showAppToast('اطلاعات پشتیبان با موفقیت بازیابی شد.');
    } else {
      showAppToast(result.errorMessage || 'خطا در بازیابی داده‌ها.');
    }
  }, [showAppToast, systemState.userProfile?.id]);

  const handleAuthSuccess = useCallback((token: string, user: UserProfile) => {
    safeRemoveSessionStorage('bushido_explicit_logout');
    safeSetLocalStorage(TOKEN_KEY, token);
    setAuthToken(token);

    const transition = transitionAccountState({
      currentSystemState: systemState,
      targetUserId: user.id,
      targetUserProfile: user
    });
    setSystemState(transition.nextState);
    if (transition.nextState.cycles.length > 0) {
      setActiveCycleId(transition.nextActiveCycleId);
    }
    showAppToast(`با موفقیت وارد حساب «${user.name || 'کاربر'}» شدید.`);
    // Explicit binding: Replay verified target user queue with target token
    syncOfflineDataToServer(user.id, token);
  }, [systemState, showAppToast, syncOfflineDataToServer]);

  const handleQuickLogin = useCallback(async (role: 'admin' | 'test_user') => {
    try {
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
        setAuthToken(data.token);
        const transition = transitionAccountState({
          currentSystemState: systemState,
          targetUserId: data.user.id,
          targetUserProfile: {
            ...data.user,
            isVip: Boolean(data.user.isVip),
            isAdmin: Boolean(data.user.isAdmin)
          }
        });
        setSystemState(transition.nextState);
        if (transition.nextState.cycles.length > 0) {
          setActiveCycleId(transition.nextActiveCycleId);
        }
        showAppToast(role === 'admin' ? 'به عنوان مدیر ارشد سیستم وارد شدید.' : 'به عنوان کاربر تستی وارد شدید.');
        // Explicit binding: Replay verified target user queue with target token
        syncOfflineDataToServer(data.user.id, data.token);
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
      setAuthToken(fallbackToken);
      const transition = transitionAccountState({
        currentSystemState: systemState,
        targetUserId: fallbackUser.id,
        targetUserProfile: fallbackUser
      });
      setSystemState(transition.nextState);
      if (transition.nextState.cycles.length > 0) {
        setActiveCycleId(transition.nextActiveCycleId);
      }
      showAppToast(role === 'admin' ? 'به عنوان مدیر ارشد سیستم وارد شدید.' : 'به عنوان کاربر تستی وارد شدید.');
      syncOfflineDataToServer(fallbackUser.id, fallbackToken);
    } catch (e) {
      console.error('Quick login error:', e);
      showAppToast('ورود با تنظیمات پیش‌فرض انجام شد.');
    }
  }, [systemState, showAppToast, syncOfflineDataToServer]);

  const handleImpersonateUser = useCallback(async (targetUser: AdminUserItem) => {
    try {
      const currentToken = authToken || safeGetLocalStorage(TOKEN_KEY);
      if (!currentToken) return;

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
          safeSetSessionStorage('bushido_impersonator_token', currentToken);
          safeSetSessionStorage('bushido_impersonating_user', JSON.stringify(targetUser));
          safeSetLocalStorage(TOKEN_KEY, data.token);
          setAuthToken(data.token);
          const transition = transitionAccountState({
            currentSystemState: systemState,
            targetUserId: data.user.id,
            targetUserProfile: {
              ...data.user,
              isVip: Boolean(data.user.isVip),
              isAdmin: Boolean(data.user.isAdmin)
            }
          });
          setSystemState(transition.nextState);
          if (transition.nextState.cycles.length > 0) {
            setActiveCycleId(transition.nextActiveCycleId);
          }
          setActiveTab('battlefield');
          showAppToast(`در حال شبیه‌سازی و مشاهده سامانه از دید: «${data.user.name}»`);
          // Explicit binding: Replay impersonated user queue with impersonated token
          syncOfflineDataToServer(data.user.id, data.token);
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
  }, [authToken, systemState, showAppToast, syncOfflineDataToServer]);

  const handleExitImpersonation = useCallback(async () => {
    const adminToken = impersonatorAdminToken || safeGetSessionStorage(IMPERSONATOR_TOKEN_KEY);
    if (!adminToken) return;

    // 1. Read saved Admin token & validate through /api/auth/me BEFORE modifying local state
    const outcome = await validateAdminTokenForExit(adminToken);

    if (outcome.status === 'SUCCESS') {
      // 2. Validation succeeds:
      // - Transition back to verified Admin account
      // - Replace active token
      // - Clear impersonation metadata
      // - Replay only Admin queue
      // - Display success
      safeSetLocalStorage(TOKEN_KEY, outcome.adminToken);
      setAuthToken(outcome.adminToken);

      safeRemoveSessionStorage(IMPERSONATOR_TOKEN_KEY);
      safeRemoveSessionStorage(IMPERSONATING_USER_KEY);
      setImpersonatingUser(null);
      setImpersonatorAdminToken(null);

      const transition = buildExitImpersonationSuccessState(systemState, outcome.adminUser);
      setSystemState(transition.nextState);
      if (transition.nextState.cycles.length > 0) {
        setActiveCycleId(transition.nextActiveCycleId);
      }

      // Replay only the Admin's own queue
      syncOfflineDataToServer(outcome.adminUser.id, outcome.adminToken);

      setActiveTab('admin');
      showAppToast(outcome.messageFa);

      // Notify server of exit for audit trail
      fetch('/api/admin/impersonate/exit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${outcome.adminToken}`
        },
        body: JSON.stringify({ targetUserId: impersonatingUser?.id || null })
      }).catch(() => {});
      return;
    }

    if (outcome.status === 'AUTH_REVOKED' || outcome.status === 'INVALID_ADMIN_IDENTITY') {
      // Validation fails due to 401, SESSION_REVOKED or invalid Admin identity:
      // - Do NOT display a success message
      // - Clear unsafe authentication and impersonation state
      // - Return to a signed-out state
      // - Require authentication again
      safeRemoveLocalStorage(TOKEN_KEY);
      safeRemoveSessionStorage(IMPERSONATOR_TOKEN_KEY);
      safeRemoveSessionStorage(IMPERSONATING_USER_KEY);
      safeSetSessionStorage('bushido_explicit_logout', 'true');

      setAuthToken(null);
      setImpersonatingUser(null);
      setImpersonatorAdminToken(null);

      const transition = buildExitImpersonationRevokedState(systemState);
      setSystemState(transition.nextState);
      setActiveCycleId(transition.nextActiveCycleId);

      setIsAuthModalOpen(true);
      showAppToast(outcome.messageFa);
      return;
    }

    if (outcome.status === 'NETWORK_ERROR') {
      // Temporary network failure:
      // - Do NOT destroy the only recoverable Admin token prematurely
      // - Do NOT claim that exit succeeded
      // - Keep a safe recoverable state and show an error
      showAppToast(outcome.messageFa);
      return;
    }

    if (outcome.status === 'NO_ADMIN_TOKEN') {
      showAppToast(outcome.messageFa);
      return;
    }
  }, [impersonatorAdminToken, impersonatingUser, systemState, showAppToast, syncOfflineDataToServer]);

  const handleLogout = useCallback(() => {
    const transition = executeLogoutDuringImpersonation(systemState);
    setAuthToken(null);
    setImpersonatingUser(null);
    setImpersonatorAdminToken(null);
    setSystemState(transition.nextState);
    setActiveCycleId(transition.nextActiveCycleId);
    setIsAuthModalOpen(false);
    showAppToast('با موفقیت از حساب کاربری خارج شدید.');
  }, [systemState, showAppToast]);

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
