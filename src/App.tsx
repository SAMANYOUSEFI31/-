import React, { 
  useState, 
  useEffect, 
  useMemo, 
  useCallback, 
  useRef 
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Cycle, DailyLog, SystemSettings, UserProfile, AdminUserItem, OfflineQueueItem } from './types';
import { createInitialSystemState, GUEST_USER_PROFILE } from './data/initialData';
import { computeCycleMetrics, createEmptyCycleMetrics } from './engine/bushidoCalculations';
import { getLogicalTodayDate, addDaysToDate } from './utils/dateUtils';
import { applyAccentTheme } from './utils/themeUtils';
import { 
  loadStoredSystemState, 
  saveSystemStateDebounced, 
  flushPendingStorageSave, 
  cancelPendingStorageSave,
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
  migrateLegacyGlobalQueue,
  enqueueOfflineMutation,
  isGuestQueueOwner,
  shouldQueueOfflineMutation
} from './utils/storageUtils';
import { 
  createSyncOrchestrator, 
  SyncTrigger, 
  SyncOrchestrator,
  SyncRunOutcome,
  bindBootAuthAndRequestSync
} from './utils/syncOrchestrator';
import {
  IMPERSONATOR_TOKEN_KEY,
  IMPERSONATING_USER_KEY,
  validateAdminTokenForExit,
  processExitImpersonationOutcome,
  buildExitImpersonationSuccessState,
  buildExitImpersonationRevokedState,
  executeLogoutDuringImpersonation
} from './utils/impersonationUtils';
import { Navbar } from './components/Navbar';
import { BattlefieldView } from './components/BattlefieldView';
import { CycleDashboardView } from './components/CycleDashboardView';
import { ArchivesView } from './components/ArchivesView';
import { ProfileSettingsView } from './components/ProfileSettingsView';
import { AdminView } from './components/AdminView';
import { AutopsyModal } from './components/AutopsyModal';
import { PaymentModal } from './components/PaymentModal';
import { AuthModal } from './components/AuthModal';
import { CreateCycleModal } from './components/CreateCycleModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useBodyScrollLock } from './utils/useBodyScrollLock';
import { Toast, ToastItem, ToastType } from './components/Toast';
import { toPersianDigits } from './utils/numberUtils';
import { RotateCcw, Eye, ShieldCheck } from 'lucide-react';
import './styles/tokens.css';

export default function App() {
  const [authToken, setAuthToken] = useState<string | null>(() => {
    return safeGetLocalStorage(TOKEN_KEY);
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
  const [isCreateCycleModalOpen, setIsCreateCycleModalOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastTimeoutRef = useRef<NodeJS.Timeout | number | null>(null);

  useBodyScrollLock(isResetConfirmOpen);

  // UX Standard: Automatically reset scroll to top when switching main tabs
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [activeTab]);

  const showAppToast = useCallback((msg: string, type: ToastType = 'success', duration = 2500) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current as NodeJS.Timeout);
      toastTimeoutRef.current = null;
    }
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    setToasts([{ id, message: msg, type, duration }]);
    toastTimeoutRef.current = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      toastTimeoutRef.current = null;
    }, duration);
  }, []);

  const dismissToast = useCallback((id: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current as NodeJS.Timeout);
      toastTimeoutRef.current = null;
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Cleanup toast timer on unmount
  useEffect(() => {
    migrateLegacyGlobalQueue();
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current as NodeJS.Timeout);
        toastTimeoutRef.current = null;
      }
    };
  }, []);

  const handleSelectDate = useCallback((newDate: string) => {
    setSelectedDate(newDate);

    // Auto switch active cycle if newDate falls into another cycle
    const matchedCycle = systemState.cycles.find(c => {
      const end = c.endDate || addDaysToDate(c.startDate, 89);
      return newDate >= c.startDate && newDate <= end;
    });

    if (matchedCycle && matchedCycle.id !== activeCycleId) {
      setActiveCycleId(matchedCycle.id);
    }
  }, [systemState.cycles, activeCycleId]);

  // Debounced non-blocking async persistence scoped to active account
  useEffect(() => {
    saveSystemStateDebounced(systemState, systemState.userProfile?.id, 350);
    const theme = systemState.userProfile?.accentTheme || systemState.settings?.accentTheme || 'amber';
    applyAccentTheme(theme);
  }, [systemState]);

  const activeAccountRef = useRef<string | null>(systemState.userProfile?.id || null);
  useEffect(() => {
    activeAccountRef.current = systemState.userProfile?.id || null;
  }, [systemState.userProfile?.id]);

  const authTokenRef = useRef<string | null>(authToken);
  useEffect(() => {
    authTokenRef.current = authToken;
  }, [authToken]);

  const showAppToastRef = useRef(showAppToast);
  useEffect(() => {
    showAppToastRef.current = showAppToast;
  }, [showAppToast]);

  const handleAppItemSuccess = useCallback((item: OfflineQueueItem) => {
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
  }, []);

  const handleAppSyncResult = useCallback((outcome: SyncRunOutcome) => {
    if (
      outcome.status === 'COMPLETED' &&
      outcome.syncedCount > 0 &&
      !outcome.stoppedDueToAccountChange &&
      !outcome.stoppedDueToLockLoss &&
      !outcome.stoppedDueToAuth
    ) {
      showAppToastRef.current(
        `همگام‌سازی ابری با موفقیت انجام شد (${toPersianDigits(outcome.syncedCount)} تغییر ذخیره شد).`,
        'success'
      );
    }
  }, []);

  const syncOrchestratorRef = useRef<SyncOrchestrator | null>(null);
  if (!syncOrchestratorRef.current) {
    // Single sync orchestrator gateway delegating to replayAccountOfflineQueue with full coalescing
    syncOrchestratorRef.current = createSyncOrchestrator({
      currentActiveAccountResolver: () => activeAccountRef.current,
      isOnlineResolver: () => typeof navigator === 'undefined' || navigator.onLine,
      defaultItemSuccessCallback: handleAppItemSuccess,
      defaultResultCallback: handleAppSyncResult
    });
  }
  const syncOrchestrator = syncOrchestratorRef.current;

  const requestSync = useCallback((
    trigger: SyncTrigger,
    targetOwnerId?: string | null,
    targetToken?: string | null,
    force = false
  ) => {
    const ownerId = targetOwnerId !== undefined ? targetOwnerId : activeAccountRef.current;
    const token = targetToken !== undefined ? targetToken : (authTokenRef.current || safeGetLocalStorage(TOKEN_KEY));

    return syncOrchestrator.requestSync({
      trigger,
      targetOwnerId: ownerId,
      targetToken: token,
      force,
      currentActiveAccountResolver: () => activeAccountRef.current,
      onItemSuccess: handleAppItemSuccess,
      onResult: handleAppSyncResult
    });
  }, [syncOrchestrator, handleAppItemSuccess, handleAppSyncResult]);

  useEffect(() => {
    let onlineTimer: any = null;
    const handleOnline = () => {
      if (onlineTimer) clearTimeout(onlineTimer);
      onlineTimer = setTimeout(() => {
        requestSync('NETWORK_ONLINE');
      }, 300);
    };
    window.addEventListener('online', handleOnline);
    return () => {
      if (onlineTimer) clearTimeout(onlineTimer);
      window.removeEventListener('online', handleOnline);
    };
  }, [requestSync]);

  // Fetch user profile and backend data on mount or token change (parallelized without duplicate waterfalls)
  useEffect(() => {
    let isCancelled = false;

    const syncBootData = async () => {
      try {
        let currentToken = authToken;
        const isExplicitLogout = safeGetSessionStorage('bushido_explicit_logout') === 'true';

        // 1. If no token and not explicitly logged out, perform quick-login first so we only fetch cycles/logs once with proper auth
        if (!currentToken && !isExplicitLogout) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);
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
                currentToken = data.token;
                safeSetLocalStorage(TOKEN_KEY, data.token);
                setActiveAccountId(data.user.id);
                activeAccountRef.current = data.user.id;
                authTokenRef.current = data.token;
                setAuthToken(data.token);
              }
            }
          } catch (err) {
            console.warn('Auto admin login fallback (running locally):', err);
          }
        }

        if (isCancelled) return;

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (currentToken) {
          headers['Authorization'] = `Bearer ${currentToken}`;
        }

        // 2. Fetch User Profile, Cycles, and Logs CONCURRENTLY in parallel (Promise.all)
        const [userRes, cyclesRes, logsRes] = await Promise.all([
          currentToken ? fetch('/api/auth/me', { headers }).catch(() => null) : Promise.resolve(null),
          fetch('/api/cycles', { headers }).catch(() => null),
          fetch('/api/logs', { headers }).catch(() => null)
        ]);

        if (isCancelled) return;

        let fetchedUserProfile: Partial<UserProfile> | null = null;
        if (userRes) {
          if (userRes.ok) {
            const userData = await userRes.json();
            if (userData?.user) {
              setActiveAccountId(userData.user.id);
              activeAccountRef.current = userData.user.id;
              authTokenRef.current = currentToken;
              fetchedUserProfile = {
                ...userData.user,
                isVip: Boolean(userData.user.isVip),
                isAdmin: Boolean(userData.user.isAdmin)
              };
            }
          } else if (userRes.status === 401) {
            safeRemoveLocalStorage(TOKEN_KEY);
            setActiveAccountId(null);
            activeAccountRef.current = null;
            authTokenRef.current = null;
            setAuthToken(null);
          }
        }

        let apiCycles: Cycle[] | null = null;
        if (cyclesRes && cyclesRes.ok) {
          const cyclesData = await cyclesRes.json();
          const cyclesList = Array.isArray(cyclesData) ? cyclesData : (cyclesData?.cycles || []);
          if (Array.isArray(cyclesList)) {
            apiCycles = cyclesList;
          }
        }

        let apiLogs: DailyLog[] | null = null;
        if (logsRes && logsRes.ok) {
          const logsData = await logsRes.json();
          const logsList = Array.isArray(logsData) ? logsData : (logsData?.logs || []);
          if (Array.isArray(logsList)) {
            apiLogs = logsList;
          }
        }

        if (isCancelled) return;

        const activeUserId = fetchedUserProfile?.id || (currentToken ? getActiveAccountId() : null);
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

        // 3. Batch apply all state updates simultaneously to avoid cascading re-renders
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

        // Replay identity binding: Replay starts after verified auth identity from /api/auth/me
        if (fetchedUserProfile?.id && currentToken) {
          bindBootAuthAndRequestSync({
            verifiedUserId: fetchedUserProfile.id,
            verifiedToken: currentToken,
            activeAccountRef,
            authTokenRef,
            setActiveAccountId,
            requestSync
          });
        }
      } catch (err) {
        console.warn('Backend sync warning (running in offline/local fallback):', err);
      }
    };

    syncBootData();

    return () => {
      isCancelled = true;
    };
  }, [authToken, requestSync]);

  const currentCycle = useMemo(() => {
    return systemState.cycles.find(c => c.id === activeCycleId) || systemState.cycles[0] || null;
  }, [systemState.cycles, activeCycleId]);

  const logicalToday = getLogicalTodayDate();

  const emptyMetrics = useMemo(() => createEmptyCycleMetrics(), []);

  const cycleMetrics = useMemo(() => {
    if (!currentCycle) return emptyMetrics;
    return computeCycleMetrics(currentCycle, systemState.logs, systemState.cycles, logicalToday);
  }, [currentCycle, systemState.logs, systemState.cycles, logicalToday, emptyMetrics]);

  const handleUpdateLog = useCallback(async (updatedLog: DailyLog) => {
    // 1. Optimistic UI update
    setSystemState(prev => {
      const existingIdx = prev.logs.findIndex(l => l.date === updatedLog.date);
      let newLogs: DailyLog[];
      if (existingIdx >= 0) {
        newLogs = [...prev.logs];
        newLogs[existingIdx] = updatedLog;
      } else {
        newLogs = [...prev.logs, updatedLog];
      }
      return {
        ...prev,
        logs: newLogs
      };
    });

    // 2. Authoritative ownership & auth guard
    const ownerId = systemState.userProfile?.id;
    const guard = shouldQueueOfflineMutation({ ownerId, authToken });
    if (!guard.canSendToServer && !guard.shouldQueue) {
      // Guest or tokenless: strictly local client partition. Never queued for server replay.
      return;
    }

    const logPayload = {
      ...updatedLog,
      cycleId: updatedLog.cycleId || activeCycleId
    };

    if (guard.shouldQueue) {
      enqueueOfflineMutation(ownerId, { type: 'UPDATE_LOG', payload: logPayload });
      return;
    }

    try {
      const res = await fetch('/api/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(logPayload)
      });
      if (res.ok) {
        setSystemState(prev => ({
          ...prev,
          logs: prev.logs.map(l => l.date === updatedLog.date ? { ...l, isSynced: true } : l)
        }));
      } else {
        enqueueOfflineMutation(ownerId, { type: 'UPDATE_LOG', payload: logPayload });
      }
    } catch (e) {
      console.warn('Failed to sync log to server backend (added to offline queue):', e);
      enqueueOfflineMutation(ownerId, { type: 'UPDATE_LOG', payload: logPayload });
    }
  }, [authToken, activeCycleId, systemState.userProfile?.id]);

  const handleUpdateCycle = useCallback(async (updatedCycle: Cycle) => {
    setSystemState(prev => ({
      ...prev,
      cycles: prev.cycles.map(c => c.id === updatedCycle.id ? updatedCycle : c)
    }));

    const ownerId = systemState.userProfile?.id;
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
      if (!res.ok) {
        enqueueOfflineMutation(ownerId, { type: 'UPDATE_CYCLE', payload: updatedCycle });
      }
    } catch (e) {
      console.warn('Failed to sync cycle update to server:', e);
      enqueueOfflineMutation(ownerId, { type: 'UPDATE_CYCLE', payload: updatedCycle });
    }
  }, [authToken, systemState.userProfile?.id]);

  const handleDeleteCycle = useCallback(async (cycleId: string) => {
    // Explicit deletion permanently marks starter demo as consumed to prevent re-seeding
    const scopedDemoKey = getScopedDemoConsumedKey(systemState.userProfile?.id);
    safeSetLocalStorage(scopedDemoKey, 'true');

    // 1. Calculate remaining cycles first
    const remainingCycles = systemState.cycles.filter(c => c.id !== cycleId);
    const remainingLogs = systemState.logs.filter(l => l.cycleId !== cycleId);

    if (remainingCycles.length === 0) {
      // When deleting the only remaining cycle, cleanly enter zero-cycle state
      setSystemState(prev => ({
        ...prev,
        cycles: [],
        logs: []
      }));
      setActiveCycleId('');
      showAppToast('چرخه با موفقیت حذف شد. می‌توانید چرخه جدیدی تعریف کنید.', 'info');
    } else {
      setSystemState(prev => ({
        ...prev,
        cycles: remainingCycles,
        logs: remainingLogs
      }));
      if (activeCycleId === cycleId) {
        setActiveCycleId(remainingCycles[0].id);
        setSelectedDate(remainingCycles[0].startDate);
      }
      showAppToast('چرخه مورد نظر با موفقیت حذف شد.', 'success');
    }

    const ownerId = systemState.userProfile?.id;
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
      if (!res.ok && res.status !== 404) {
        enqueueOfflineMutation(ownerId, { type: 'DELETE_CYCLE', payload: { id: cycleId } });
      }
    } catch (e) {
      console.warn('Failed to sync cycle deletion to server:', e);
      enqueueOfflineMutation(ownerId, { type: 'DELETE_CYCLE', payload: { id: cycleId } });
    }
  }, [authToken, activeCycleId, systemState.cycles, systemState.logs, systemState.userProfile?.id, showAppToast]);

  const handleUpdateUserProfile = useCallback(async (updatedProfile: UserProfile) => {
    setSystemState(prev => ({
      ...prev,
      userProfile: updatedProfile
    }));

    const ownerId = systemState.userProfile?.id;
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

  const handleCreateNewCycle = useCallback(async (title: string, startDate: string, targetTheme: string) => {
    // User created their own real cycle; demo is permanently consumed
    const scopedDemoKey = getScopedDemoConsumedKey(systemState.userProfile?.id);
    safeSetLocalStorage(scopedDemoKey, 'true');

    const newCycle: Cycle = {
      id: `cycle-${Date.now()}`,
      title,
      startDate,
      endDate: addDaysToDate(startDate, 89),
      targetTheme,
      inheritedStreak: cycleMetrics?.pureStreak || 0,
      isArchived: false,
      reportRead: false
    };

    setSystemState(prev => {
      // Filter out starter demo cycle & logs so user starts on clean slate
      const nonDemoCycles = prev.cycles.filter(c => c.id !== 'cycle-1' && !c.title.includes('(نمونه)'));
      const nonDemoLogs = prev.logs.filter(l => l.cycleId !== 'cycle-1');
      return {
        ...prev,
        cycles: [...nonDemoCycles, newCycle],
        logs: nonDemoLogs
      };
    });
    setActiveCycleId(newCycle.id);
    setSelectedDate(startDate);
    setActiveTab('battlefield');

    const ownerId = systemState.userProfile?.id;
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
      if (!res.ok) {
        enqueueOfflineMutation(ownerId, { type: 'CREATE_CYCLE', payload: newCycle });
      }
    } catch (e) {
      console.warn('Failed to save cycle to server:', e);
      enqueueOfflineMutation(ownerId, { type: 'CREATE_CYCLE', payload: newCycle });
    }
  }, [authToken, cycleMetrics?.pureStreak, systemState.userProfile?.id]);

  const handleUpdateSettings = useCallback(async (updatedSettings: SystemSettings) => {
    setSystemState(prev => ({
      ...prev,
      settings: updatedSettings
    }));
  }, []);

  const handleExportData = () => {
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
  };

  const handleResetData = () => {
    setIsResetConfirmOpen(true);
  };

  const handleConfirmReset = () => {
    const { freshState, activeCycleId } = resetAccountState(systemState.userProfile);
    setSystemState(freshState);
    setActiveCycleId(activeCycleId);
    setSelectedDate(getLogicalTodayDate());
    setIsResetConfirmOpen(false);
    showAppToast('داده‌های سامانه با موفقیت به مقادیر اولیه بوشیدو بازنشانی شد.');
  };

  const handleImportData = (dataStr: string) => {
    const result = importAccountState(dataStr, systemState.userProfile?.id);
    if (result.success && result.state) {
      setSystemState(result.state);
      setActiveCycleId(result.activeCycleId || result.state.cycles[0]?.id || 'cycle-1');
      showAppToast('اطلاعات پشتیبان با موفقیت بازیابی شد.');
    } else {
      showAppToast(result.errorMessage || 'خطا در بازیابی داده‌ها.', 'error');
    }
  };

  const handleAuthSuccess = (token: string, user: UserProfile) => {
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
    // Explicit binding: Replay verified target user queue through single orchestrator gateway
    activeAccountRef.current = user.id;
    authTokenRef.current = token;
    requestSync('AUTH_SUCCESS', user.id, token);
  };

  const handleQuickLogin = async (role: 'admin' | 'test_user') => {
    try {
      safeRemoveSessionStorage('bushido_explicit_logout');
      const res = await fetch('/api/auth/quick-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
      const data = await res.json();
      if (res.ok && data.token && data.user) {
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
        // Explicit binding: Replay verified target user queue through single orchestrator gateway
        activeAccountRef.current = data.user.id;
        authTokenRef.current = data.token;
        requestSync('QUICK_LOGIN_SUCCESS', data.user.id, data.token);
      } else {
        showAppToast(data.messageFa || data.error || 'ورود سریع در این محیط غیرفعال است.', 'error');
      }
    } catch (e) {
      console.error('Quick login error:', e);
      showAppToast('خطا در برقراری ارتباط با سرور', 'error');
    }
  };

  const handleImpersonateUser = async (targetUser: AdminUserItem) => {
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

      const data = await res.json();
      if (res.ok && data.token && data.user) {
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
        // Explicit binding: Replay target user's queue through single orchestrator gateway
        activeAccountRef.current = data.user.id;
        authTokenRef.current = data.token;
        requestSync('IMPERSONATION_START', data.user.id, data.token);
      } else {
        showAppToast(data.messageFa || data.error || 'خطا در سوییچ به کاربر');
      }
    } catch (e) {
      console.error('Impersonate user error:', e);
      showAppToast('خطا در برقراری ارتباط با سرور');
    }
  };

  const handleExitImpersonation = async () => {
    const adminToken = impersonatorAdminToken || safeGetSessionStorage(IMPERSONATOR_TOKEN_KEY);
    if (!adminToken) return;

    // 1. Read saved Admin token & validate through /api/auth/me BEFORE modifying local state
    const outcome = await validateAdminTokenForExit(adminToken);
    const result = processExitImpersonationOutcome(outcome, systemState);

    if (result.action === 'SUCCESS_TRANSITION') {
      // 2. Validation succeeds:
      // - Transition back to verified Admin account
      // - Replace active token
      // - Clear impersonation metadata
      // - Replay only Admin queue
      // - Display success
      setAuthToken(result.newAuthToken!);
      setImpersonatingUser(null);
      setImpersonatorAdminToken(null);
      if (result.nextSystemState) {
        setSystemState(result.nextSystemState);
      }
      if (result.nextActiveCycleId) {
        setActiveCycleId(result.nextActiveCycleId);
      }

      if (outcome.status === 'SUCCESS') {
        // Replay only the Admin's own queue through single orchestrator gateway
        activeAccountRef.current = outcome.adminUser.id;
        authTokenRef.current = outcome.adminToken;
        requestSync('IMPERSONATION_EXIT', outcome.adminUser.id, outcome.adminToken);

        // Notify server of exit for audit trail (non-authoritative metadata)
        fetch('/api/admin/impersonate/exit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${outcome.adminToken}`
          },
          body: JSON.stringify({ targetUserId: impersonatingUser?.id || null })
        }).catch(() => {});
      }

      setActiveTab('admin');
      showAppToast(result.messageFa);
      return;
    }

    if (result.action === 'REVOKED_SIGN_OUT') {
      // Validation fails due to confirmed auth rejection or invalid Admin identity:
      // - Do NOT display a success message
      // - Clear unsafe authentication and impersonation state
      // - Return to a signed-out state
      // - Require authentication again
      activeAccountRef.current = null;
      authTokenRef.current = null;
      syncOrchestrator.cancelPendingSync();
      setAuthToken(null);
      setImpersonatingUser(null);
      setImpersonatorAdminToken(null);
      if (result.nextSystemState) {
        setSystemState(result.nextSystemState);
      }
      if (result.nextActiveCycleId) {
        setActiveCycleId(result.nextActiveCycleId);
      }

      setIsAuthModalOpen(true);
      showAppToast(result.messageFa);
      return;
    }

    // For PRESERVE_RETRYABLE (TEMPORARY_SERVER_ERROR and NETWORK_ERROR) or NO_OP:
    // - Do NOT destroy the only recoverable Admin token prematurely
    // - Do NOT clear impersonation metadata
    // - Do NOT change active account
    // - Do NOT claim that exit succeeded
    // - Show a retryable Persian error message
    showAppToast(result.messageFa);
  };

  const handleLogout = () => {
    activeAccountRef.current = null;
    authTokenRef.current = null;
    syncOrchestrator.cancelPendingSync();
    const transition = executeLogoutDuringImpersonation(systemState);
    setAuthToken(null);
    setImpersonatingUser(null);
    setImpersonatorAdminToken(null);
    setSystemState(transition.nextState);
    setActiveCycleId(transition.nextActiveCycleId);
    setIsAuthModalOpen(false);
    showAppToast('با موفقیت از حساب کاربری خارج شدید.');
  };

  const dashboardAllTimeSettings = useMemo(() => ({
    allTimeMaxStreak: systemState.settings?.allTimeMaxStreak ?? 0,
    allTimeMaxScore: systemState.settings?.allTimeMaxScore ?? 0,
    allTimeMaxStandardDays: systemState.settings?.allTimeMaxStandardDays ?? 0,
  }), [
    systemState.settings?.allTimeMaxStreak,
    systemState.settings?.allTimeMaxScore,
    systemState.settings?.allTimeMaxStandardDays
  ]);

  const handleDashboardSelectDate = useCallback((d: string) => {
    handleSelectDate(d);
    setActiveTab('battlefield');
  }, [handleSelectDate]);

  const handleDashboardNavigateTab = useCallback((tab: string) => {
    setActiveTab(tab);
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col w-full max-w-full selection:bg-amber-500 selection:text-black">
        {/* Top Banner when Admin is Impersonating a User */}
        {impersonatingUser && (
          <div className="bg-sky-950 border-b border-sky-500/50 py-2.5 px-4 sticky top-0 z-50 shadow-2xl backdrop-blur-md">
            <div className="max-w-7xl w-full mx-auto flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs">
              <div className="flex items-center gap-2 text-sky-200 font-bold">
                <Eye className="w-4 h-4 text-sky-400 animate-pulse shrink-0" />
                <span>
                  حالت شبیه‌سازی کاربر: در حال بررسی سامانه از دید «{impersonatingUser.name}»
                </span>
                <span className="text-[10px] bg-sky-900/80 text-sky-300 border border-sky-500/40 px-2 py-0.5 rounded-md font-mono hidden md:inline-block">
                  {impersonatingUser.id}
                </span>
              </div>
              <button
                onClick={handleExitImpersonation}
                className="bg-sky-500 hover:bg-sky-400 text-zinc-950 font-black text-xs px-3.5 py-1.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-md shrink-0 active:scale-95"
              >
                <ShieldCheck className="w-4 h-4 text-zinc-950" />
                <span>بازگشت به حساب مدیریت</span>
              </button>
            </div>
          </div>
        )}

        {/* Top Hub Bar */}
        <Navbar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          cycles={systemState.cycles}
          currentCycle={currentCycle}
          onSelectCycle={c => setActiveCycleId(c.id)}
          metrics={cycleMetrics}
          settings={systemState.settings}
          userProfile={systemState.userProfile}
          onOpenPaymentModal={() => setIsPaymentModalOpen(true)}
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
          onOpenNewCycleModal={() => setIsCreateCycleModalOpen(true)}
          onDeleteCycle={handleDeleteCycle}
          onOpenDebtAutopsy={() => {
            const firstDebt = systemState.logs.find(l => {
              if (l.date >= logicalToday) return false;
              const habitKeys = ['wakeUp', 'workout', 'study', 'journal', 'hardTask'] as const;
              const isStd = habitKeys.every(k => l[k]);
              const isFrozen = l.failureReason === 'دلایل شخصی';
              const isResolved = !!(l.failureReason && (isFrozen || l.failureTime));
              return !isStd && !isResolved;
            });
            if (firstDebt) {
              setAutopsyTargetLog(firstDebt);
            } else {
              setActiveTab('battlefield');
            }
          }}
        />

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 pt-3 sm:pt-6 pb-32 lg:pb-16 min-w-0">
          <AnimatePresence mode="wait">
              {activeTab === 'battlefield' && (
                <motion.div
                  key="battlefield"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="w-full"
                >
                  <BattlefieldView
                    currentCycle={currentCycle}
                    metrics={cycleMetrics}
                    logs={systemState.logs}
                    selectedDate={selectedDate}
                    nightOwlCutoffHour={systemState.userProfile?.nightOwlCutoffHour ?? systemState.settings?.nightOwlCutoffHour ?? 4}
                    onSelectDate={handleSelectDate}
                    onUpdateLog={handleUpdateLog}
                    onOpenAutopsy={log => setAutopsyTargetLog(log)}
                    onNavigateToArchives={() => setActiveTab('archives')}
                    onOpenCreateCycle={() => setIsCreateCycleModalOpen(true)}
                    onNavigateToHabitsGuide={() => setActiveTab('profile')}
                  />
                </motion.div>
              )}

              {(activeTab === 'dashboard' || activeTab === 'cycle') && (
                <motion.div
                  key="dashboard"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="w-full"
                >
                  <CycleDashboardView
                    currentCycle={currentCycle}
                    metrics={cycleMetrics}
                    logs={systemState.logs}
                    cycles={systemState.cycles}
                    allTimeSettings={dashboardAllTimeSettings}
                    onSelectDate={handleDashboardSelectDate}
                    onNavigateTab={handleDashboardNavigateTab}
                    onOpenCreateCycle={() => setIsCreateCycleModalOpen(true)}
                  />
                </motion.div>
              )}

              {(activeTab === 'archives' || activeTab === 'database' || activeTab === 'court') && (
                <motion.div
                  key="archives"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="w-full"
                >
                  <ArchivesView
                    cycles={systemState.cycles}
                    currentCycle={currentCycle}
                    logs={systemState.logs}
                    metrics={cycleMetrics}
                    onSelectCycle={c => setActiveCycleId(c.id)}
                    onUpdateCycle={handleUpdateCycle}
                    onDeleteCycle={handleDeleteCycle}
                    onSelectDate={d => {
                      handleSelectDate(d);
                      setActiveTab('battlefield');
                    }}
                    onOpenAutopsy={log => setAutopsyTargetLog(log)}
                    onCreateNewCycle={handleCreateNewCycle}
                  />
                </motion.div>
              )}

              {(activeTab === 'profile' || activeTab === 'settings') && (
                <motion.div
                  key="profile"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="w-full"
                >
                  <ProfileSettingsView
                    userProfile={systemState.userProfile}
                    settings={systemState.settings}
                    onUpdateUserProfile={handleUpdateUserProfile}
                    onUpdateSettings={handleUpdateSettings}
                    onOpenPaymentModal={() => setIsPaymentModalOpen(true)}
                    onOpenAuthModal={() => setIsAuthModalOpen(true)}
                    onQuickLogin={handleQuickLogin}
                    onLogout={handleLogout}
                    onResetData={handleResetData}
                    onImportData={handleImportData}
                    onExportData={handleExportData}
                    onNavigateToAdmin={() => setActiveTab('admin')}
                  />
                </motion.div>
              )}

              {activeTab === 'admin' && (
                <motion.div
                  key="admin"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="w-full"
                >
                  <AdminView
                    currentUser={systemState.userProfile}
                    authToken={authToken}
                    onBack={() => setActiveTab('profile')}
                    onImpersonateUser={handleImpersonateUser}
                    onRefreshUserProfile={() => {
                      if (authToken) {
                        fetch('/api/auth/me', {
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${authToken}`
                          }
                        })
                          .then(r => r.json())
                          .then(data => {
                            if (data?.user) {
                              setSystemState(prev => ({
                                ...prev,
                                userProfile: {
                                  ...prev.userProfile,
                                  ...data.user,
                                  isVip: !!data.user.isVip,
                                  isAdmin: !!data.user.isAdmin
                                }
                              }));
                            }
                          })
                          .catch(console.error);
                      }
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
        </main>

        {/* Modals Layer */}
        {/* Autopsy Drawer/Modal */}
        {autopsyTargetLog && (
          <AutopsyModal
            log={autopsyTargetLog}
            cycleTheme={currentCycle?.targetTheme ?? 'amber'}
            allUnresolvedLogs={systemState.logs.filter(l => {
              if (l.date >= logicalToday) return false;
              const habitKeys = ['wakeUp', 'workout', 'study', 'journal', 'hardTask'] as const;
              const isStd = habitKeys.every(k => l[k]);
              const isFrozen = l.failureReason === 'دلایل شخصی';
              const isResolved = !!(l.failureReason && (isFrozen || l.failureTime));
              return !isStd && !isResolved;
            })}
            onSelectLog={nextLog => setAutopsyTargetLog(nextLog)}
            onSave={handleUpdateLog}
            onClose={() => setAutopsyTargetLog(null)}
          />
        )}

        {/* Mock Payment / Subscription Modal */}
        {isPaymentModalOpen && (
          <PaymentModal
            userProfile={systemState.userProfile}
            isOpen={isPaymentModalOpen}
            onClose={() => setIsPaymentModalOpen(false)}
            onUpgradeSuccess={handleUpdateUserProfile}
          />
        )}

        {/* User Auth Modal */}
        {isAuthModalOpen && (
          <AuthModal
            isOpen={isAuthModalOpen}
            onClose={() => setIsAuthModalOpen(false)}
            currentUser={systemState.userProfile?.id ? systemState.userProfile : null}
            onAuthSuccess={handleAuthSuccess}
            onLogout={handleLogout}
          />
        )}

        {/* Create Cycle Modal */}
        {isCreateCycleModalOpen && (
          <CreateCycleModal
            isOpen={isCreateCycleModalOpen}
            existingCycles={systemState.cycles}
            onClose={() => setIsCreateCycleModalOpen(false)}
            onCreateCycle={handleCreateNewCycle}
          />
        )}

        {/* Reset Confirmation Modal */}
        {isResetConfirmOpen && (
          <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-start sm:items-center justify-start sm:justify-center p-3 sm:p-4 pt-[max(1.25rem,calc(env(safe-area-inset-top,0px)+0.75rem))] pb-[max(1.25rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] overscroll-contain overflow-y-auto max-h-[100dvh]">
            <div className="bg-[#1c1c21] border border-red-500/40 rounded-3xl w-full max-w-md p-5 sm:p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150 my-auto">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400 shrink-0">
                  <RotateCcw className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-zinc-100">
                    بازنشانی داده‌های سامانه
                  </h3>
                  <p className="text-xs text-red-400 mt-0.5">
                    بازگشت به مقادیر اولیه سیستم بوشیدو
                  </p>
                </div>
              </div>

              <p className="text-xs text-zinc-300 leading-relaxed bg-[#18181b] border border-zinc-800 rounded-2xl p-4">
                آیا از بازنشانی کلیه داده‌ها، لاگ‌ها و چرخه‌ها به اطلاعات نمونه اولیه سیستم بوشیدو اطمینان دارید؟ تمام تغییرات ثبت‌شده محلی پاک خواهند شد.
              </p>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsResetConfirmOpen(false)}
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="button"
                  onClick={handleConfirmReset}
                  className="bg-red-600 hover:bg-red-500 text-white font-bold px-5 py-2.5 rounded-xl text-xs flex items-center gap-1.5 shadow-lg shadow-red-600/30 transition cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>بله، بازنشانی داده‌ها</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
