import React, { 
  useState, 
  useEffect, 
  useMemo, 
  useCallback, 
  useRef 
} from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Cycle, DailyLog, SystemSettings, UserProfile, AdminUserItem, OfflineQueueItem } from './types';
import { createInitialSystemState, GUEST_USER_PROFILE } from './data/initialData';
import { computeCycleMetrics, createEmptyCycleMetrics, computeDailyProperties } from './engine/bushidoCalculations';
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
  buildExportPayload,
  safeGetLocalStorage,
  safeSetLocalStorage,
  safeRemoveLocalStorage,
  safeGetSessionStorage,
  safeSetSessionStorage,
  safeRemoveSessionStorage,
  resolveBackendSyncDecision,
  migrateLegacyGlobalQueue,
  enqueueOfflineMutation,
  normalizeQueueOwner,
  isGuestQueueOwner,
  shouldQueueOfflineMutation
} from './utils/storageUtils';
import { getOfflineQueue, parseSafeConflictDetails, recordClientConflict } from './utils/offlineQueueUtils';
import {
  applyOptimisticLogUpdate,
  rollbackOptimisticLogUpdate,
  applyOptimisticCycleUpdate,
  rollbackOptimisticCycleUpdate,
  rollbackOptimisticCycleDelete,
  rollbackOptimisticCycleCreate,
  prepareDirectLogPayload,
  prepareDirectCyclePayload,
  verifyActiveAccount,
  applyReplayItemToActiveState,
  executeDirectDailyLogMutation,
  executeDirectCreateCycleMutation,
  executeDirectUpdateCycleMutation,
  executeDirectDeleteCycleMutation
} from './utils/directMutationUtils';
import {
  deriveUnresolvedDebtLogs,
  convertVirtualDebtLogForMutation
} from './utils/debtAutopsyUtils';
import { reconcileBootState } from './utils/syncReconciliation';
import { emitSyncDiagnostic } from './utils/syncDiagnostics';
import { 
  createSyncOrchestrator, 
  SyncTrigger, 
  SyncOrchestrator,
  SyncRunOutcome,
  bindBootAuthAndRequestSync
} from './utils/syncOrchestrator';
import {
  performVisibilityRefetch,
  setupVisibilityRefetchListeners
} from './utils/visibilitySyncUtils';
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
import { DisciplineRulesModal } from './components/DisciplineRulesModal';
import { ResetConfirmationModal } from './components/ResetConfirmationModal';
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
  const [isDisciplineRulesOpen, setIsDisciplineRulesOpen] = useState(false);
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

  const systemStateRef = useRef(systemState);
  useEffect(() => {
    systemStateRef.current = systemState;
  }, [systemState]);

  const latestLogsRef = useRef<DailyLog[]>(systemState.logs);
  useEffect(() => {
    latestLogsRef.current = systemState.logs;
  }, [systemState.logs]);

  // Monotonic local mutation generation tracking per (ownerId:date) to protect rapid successive habit taps from stale rollbacks or older out-of-order server responses
  const logMutationGenerationsRef = useRef<Map<string, number>>(new Map());

  const lastRemotePullTimestampRef = useRef<number>(0);
  const isVisibilityRefetchInFlightRef = useRef<boolean>(false);

  const handleAppItemSuccess = useCallback((item: OfflineQueueItem, serverResult?: any) => {
    if (!verifyActiveAccount(activeAccountRef.current, item.ownerId)) {
      return;
    }
    setSystemState(prev => {
      const nextState = applyReplayItemToActiveState(
        { cycles: prev.cycles, logs: prev.logs },
        item,
        serverResult
      );
      return {
        ...prev,
        cycles: nextState.cycles,
        logs: nextState.logs
      };
    });
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

        // Load only the active owner's offline queue
        const ownerQueue = activeUserId && !isGuestQueueOwner(activeUserId)
          ? getOfflineQueue(activeUserId)
          : [];

        // Safe Boot Reconciliation with Pending Offline Mutations
        const reconciled = reconcileBootState({
          authenticatedOwnerId: activeUserId,
          remoteCycles: apiCycles,
          remoteLogs: apiLogs,
          remoteUserProfile: fetchedUserProfile,
          currentLocalState: {
            cycles: systemState.cycles,
            logs: systemState.logs,
            userProfile: systemState.userProfile
          },
          pendingQueue: ownerQueue,
          isDemoConsumed
        });

        if (isCancelled) return;

        // Revalidate active identity before committing state (prevent stale boot commitment)
        const currentActiveOwner = normalizeQueueOwner(activeAccountRef.current);
        if (activeUserId && currentActiveOwner !== normalizeQueueOwner(activeUserId)) {
          emitSyncDiagnostic({
            eventType: 'RECONCILIATION_DISCARDED_STALE',
            timestamp: Date.now(),
            outcomeStatus: 'DISCARDED_STALE',
            errorCategory: 'ACCOUNT_CHANGE',
            safeReason: 'ACCOUNT_CHANGED'
          });
          console.warn(`[SyncReconciliation] Discarding boot hydration for ${activeUserId}; active account changed to ${currentActiveOwner}`);
          return;
        }

        if (reconciled.shouldMarkDemoConsumed) {
          safeSetLocalStorage(scopedDemoKey, 'true');
        }

        const { cycles: reconciledCycles, logs: reconciledLogs, userProfile: reconciledProfile, nextActiveCycleId } = reconciled;

        // 3. Batch apply all state updates simultaneously to avoid cascading re-renders
        if (reconciledProfile || reconciledCycles !== null || reconciledLogs !== null) {
          setSystemState(prev => ({
            ...prev,
            userProfile: reconciledProfile ? { ...prev.userProfile, ...reconciledProfile } : prev.userProfile,
            cycles: reconciledCycles !== null ? reconciledCycles : prev.cycles,
            logs: reconciledLogs !== null ? reconciledLogs : prev.logs
          }));

          if (nextActiveCycleId) {
            setActiveCycleId(prev => {
              if (!prev || (reconciledCycles && !reconciledCycles.some(c => c.id === prev))) {
                return nextActiveCycleId!;
              }
              return prev;
            });
          }
        }

        // Replay identity binding: Replay starts after verified auth identity from /api/auth/me
        if (fetchedUserProfile?.id && currentToken) {
          lastRemotePullTimestampRef.current = Date.now();
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

  // Remote pull on visibility is for multi-device catch-up, not realtime.
  useEffect(() => {
    const handleVisibilityRefetch = () => {
      performVisibilityRefetch({
        getCurrentActiveOwnerId: () => activeAccountRef.current,
        getCurrentAuthToken: () => authTokenRef.current || safeGetLocalStorage(TOKEN_KEY),
        getCurrentLocalState: () => ({
          cycles: systemStateRef.current.cycles,
          logs: systemStateRef.current.logs,
          userProfile: systemStateRef.current.userProfile
        }),
        onApplyReconciledState: (reconciled, targetOwnerId) => {
          if (!verifyActiveAccount(activeAccountRef.current, targetOwnerId)) {
            return;
          }
          const { cycles: reconciledCycles, logs: reconciledLogs, userProfile: reconciledProfile, nextActiveCycleId } = reconciled;
          if (reconciledProfile || reconciledCycles !== null || reconciledLogs !== null) {
            setSystemState(prev => ({
              ...prev,
              userProfile: reconciledProfile ? { ...prev.userProfile, ...reconciledProfile } : prev.userProfile,
              cycles: reconciledCycles !== null ? reconciledCycles : prev.cycles,
              logs: reconciledLogs !== null ? reconciledLogs : prev.logs
            }));

            if (nextActiveCycleId) {
              setActiveCycleId(prev => {
                if (!prev || (reconciledCycles && !reconciledCycles.some(c => c.id === prev))) {
                  return nextActiveCycleId!;
                }
                return prev;
              });
            }
          }
        },
        requestSyncReplay: async (ownerId, token) => {
          const queue = getOfflineQueue(ownerId);
          if (queue.length > 0) {
            await requestSync('NETWORK_ONLINE', ownerId, token);
          }
        },
        getLastPullTimestamp: () => lastRemotePullTimestampRef.current,
        setLastPullTimestamp: (ts) => {
          lastRemotePullTimestampRef.current = ts;
        },
        isInFlight: () => isVisibilityRefetchInFlightRef.current,
        setIsInFlight: (val) => {
          isVisibilityRefetchInFlightRef.current = val;
        }
      });
    };

    const cleanup = setupVisibilityRefetchListeners({
      onTriggerRefetch: handleVisibilityRefetch
    });

    return cleanup;
  }, [requestSync]);

  const currentCycle = useMemo(() => {
    return systemState.cycles.find(c => c.id === activeCycleId) || systemState.cycles[0] || null;
  }, [systemState.cycles, activeCycleId]);

  const logicalToday = getLogicalTodayDate();

  const emptyMetrics = useMemo(() => createEmptyCycleMetrics(), []);

  const cycleMetrics = useMemo(() => {
    if (!currentCycle) return emptyMetrics;
    return computeCycleMetrics(currentCycle, systemState.logs, systemState.cycles, logicalToday);
  }, [currentCycle, systemState.logs, systemState.cycles, logicalToday, emptyMetrics]);

  // Authoritative list of all past unresolved debt logs in the active cycle for autopsy modal, carousel and navbar
  const unresolvedDebtLogs: DailyLog[] = useMemo(() => {
    return deriveUnresolvedDebtLogs(currentCycle, systemState.logs, logicalToday);
  }, [currentCycle, systemState.logs, logicalToday]);

  const handleUpdateLog = useCallback(async (incomingLog: DailyLog) => {
    const currentLogs = latestLogsRef.current || systemState.logs;
    // Convert virtual placeholder into established DailyLog mutation input before state update or mutation
    const updatedLog = convertVirtualDebtLogForMutation(incomingLog, activeCycleId, currentLogs);

    // 1. Capture confirmed baseline before mutation for truthful rollback
    const existingLog = currentLogs.find(l => l.date === updatedLog.date) || null;
    const previousConfirmedSnapshot = existingLog ? { ...existingLog } : null;

    const ownerId = systemState.userProfile?.id;
    const initialOwner = ownerId;

    // Track monotonic generation for this specific (ownerId:date) to guarantee newer rapid taps are never overwritten
    const genKey = `${normalizeQueueOwner(ownerId)}:${updatedLog.date}`;
    const nextGen = (logMutationGenerationsRef.current.get(genKey) || 0) + 1;
    logMutationGenerationsRef.current.set(genKey, nextGen);
    const thisMutationGen = nextGen;

    // Optimistic UI update: unmark isSynced during in-flight state and sync latestLogsRef immediately
    setSystemState(prev => {
      const { nextLogs } = applyOptimisticLogUpdate(prev.logs, updatedLog);
      latestLogsRef.current = nextLogs;
      return {
        ...prev,
        logs: nextLogs
      };
    });

    const result = await executeDirectDailyLogMutation({
      updatedLog,
      existingLog,
      ownerId,
      authToken,
      activeCycleId,
      activeAccountRef
    });

    if (result.status === 'IGNORED_NO_AUTH_NO_QUEUE' || result.status === 'QUEUED_OFFLINE' || result.status === 'ACCOUNT_SWITCHED') {
      return;
    }

    const currentLatestGen = logMutationGenerationsRef.current.get(genKey) || 0;
    const hasNewerLocalMutation = currentLatestGen > thisMutationGen;

    if (result.status === 'STORAGE_WRITE_FAILED') {
      if (!hasNewerLocalMutation) {
        setSystemState(prev => {
          if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) return prev;
          const nextLogs = rollbackOptimisticLogUpdate(prev.logs, updatedLog.date, previousConfirmedSnapshot);
          latestLogsRef.current = nextLogs;
          return {
            ...prev,
            logs: nextLogs
          };
        });
        showAppToast(result.messageFa || 'خطا در ذخیره‌سازی محلی. تغییرات اعمال نشد.', 'warning');
      }
      return;
    }

    if (result.status === 'INVALID_PRECONDITION') {
      if (!hasNewerLocalMutation) {
        setSystemState(prev => {
          if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) return prev;
          const nextLogs = rollbackOptimisticLogUpdate(prev.logs, updatedLog.date, previousConfirmedSnapshot);
          latestLogsRef.current = nextLogs;
          return {
            ...prev,
            logs: nextLogs
          };
        });
        showAppToast(result.messageFa, 'warning');
      }
      requestSync('MANUAL_FORCE', ownerId, authToken, true);
      return;
    }

    if (result.status === 'SUCCESS') {
      setSystemState(prev => {
        if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) return prev;
        if (hasNewerLocalMutation || result.hasNewerIntent) {
          // A newer local edit is still pending, keep optimistic state with updated server revision
          const nextLogs = prev.logs.map(l => {
            if (l.date === updatedLog.date) {
              return {
                ...l,
                revision: result.serverLog.revision,
                isSynced: false
              };
            }
            return l;
          });
          latestLogsRef.current = nextLogs;
          return {
            ...prev,
            logs: nextLogs
          };
        }
        const nextLogs = prev.logs.map(l => l.date === updatedLog.date ? { ...l, ...result.serverLog, isSynced: true } : l);
        latestLogsRef.current = nextLogs;
        return {
          ...prev,
          logs: nextLogs
        };
      });
      if (hasNewerLocalMutation || result.hasNewerIntent) {
        // Trigger sync to dispatch the newer pending mutation
        requestSync('NETWORK_ONLINE', ownerId, authToken);
      }
      return;
    }

    if (result.status === 'CONFLICT') {
      if (!hasNewerLocalMutation) {
        setSystemState(prev => {
          if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) return prev;
          const nextLogs = rollbackOptimisticLogUpdate(prev.logs, updatedLog.date, previousConfirmedSnapshot);
          latestLogsRef.current = nextLogs;
          return {
            ...prev,
            logs: nextLogs
          };
        });
        showAppToast(result.conflictDetails.messageFa, 'warning');
      }
      requestSync('NETWORK_ONLINE', ownerId, authToken, true);
      return;
    }

    if (result.status === 'INVALID_SUCCESS_RESPONSE') {
      console.warn('[DailyLog Mutation] Invalid success response, state remains unconfirmed:', result.errorMsg);
      return;
    }

    if (result.status === 'FORBIDDEN' || result.status === 'VALIDATION_ERROR' || result.status === 'ENTITY_MISSING') {
      if (!hasNewerLocalMutation) {
        setSystemState(prev => {
          if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) return prev;
          const nextLogs = rollbackOptimisticLogUpdate(prev.logs, updatedLog.date, previousConfirmedSnapshot);
          latestLogsRef.current = nextLogs;
          return {
            ...prev,
            logs: nextLogs
          };
        });
      }
      console.warn('[DailyLog Mutation] Non-retryable error, quarantined and rolled back:', result);
      return;
    }

    if (result.status === 'AUTH_REQUIRED') {
      console.warn('[DailyLog Mutation] Auth required, mutation preserved in queue for re-auth:', result);
      return;
    }

    if (result.status === 'RATE_LIMITED' || result.status === 'SERVER_RETRYABLE' || result.status === 'NETWORK_ERROR') {
      console.warn('[DailyLog Mutation] Preserved in durable write-ahead queue for retry:', result);
      return;
    }
  }, [authToken, activeCycleId, systemState.logs, systemState.userProfile?.id, showAppToast, requestSync]);

  const handleUpdateCycle = useCallback(async (updatedCycle: Cycle) => {
    // 1. Capture confirmed baseline before mutation for truthful rollback
    const existingCycle = systemState.cycles.find(c => c.id === updatedCycle.id) || null;
    const previousConfirmedSnapshot = existingCycle ? { ...existingCycle } : null;

    setSystemState(prev => ({
      ...prev,
      cycles: applyOptimisticCycleUpdate(prev.cycles, updatedCycle).nextCycles
    }));

    const ownerId = systemState.userProfile?.id;
    const initialOwner = ownerId;

    const result = await executeDirectUpdateCycleMutation({
      updatedCycle,
      existingCycle,
      ownerId,
      authToken,
      activeAccountRef
    });

    if (result.status === 'IGNORED_NO_AUTH_NO_QUEUE') {
      return;
    }

    if (result.status === 'STORAGE_WRITE_FAILED') {
      setSystemState(prev => {
        if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) return prev;
        return {
          ...prev,
          cycles: rollbackOptimisticCycleUpdate(prev.cycles, updatedCycle.id, previousConfirmedSnapshot)
        };
      });
      showAppToast(result.messageFa, 'error');
      return;
    }

    if (result.status === 'INVALID_PRECONDITION') {
      setSystemState(prev => {
        if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) return prev;
        return {
          ...prev,
          cycles: rollbackOptimisticCycleUpdate(prev.cycles, updatedCycle.id, previousConfirmedSnapshot)
        };
      });
      showAppToast('نسخه معتبر چرخه یافت نشد. همگام‌سازی مجدد با سرور انجام می‌شود.', 'warning');
      requestSync('MANUAL_FORCE', ownerId, authToken, true);
      return;
    }

    if (result.status === 'QUEUED_OFFLINE') {
      return;
    }

    if (result.status === 'ACCOUNT_SWITCHED') {
      return;
    }

    if (result.status === 'SUCCESS') {
      setSystemState(prev => {
        if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) return prev;
        if (result.hasNewerIntent) {
          return prev;
        }
        return {
          ...prev,
          cycles: prev.cycles.map(c => c.id === updatedCycle.id ? { ...c, ...result.serverCycle, isSynced: true } : c)
        };
      });
      if (result.hasNewerIntent) {
        requestSync('NETWORK_ONLINE', ownerId, authToken);
      }
      return;
    }

    if (result.status === 'CONFLICT') {
      setSystemState(prev => {
        if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) return prev;
        return {
          ...prev,
          cycles: rollbackOptimisticCycleUpdate(prev.cycles, updatedCycle.id, previousConfirmedSnapshot)
        };
      });
      showAppToast(result.conflictDetails.messageFa, 'warning');
      requestSync('NETWORK_ONLINE', ownerId, authToken, true);
      return;
    }

    if (result.status === 'INVALID_SUCCESS_RESPONSE') {
      console.warn('[Cycle Mutation] Invalid success response, state remains unconfirmed:', result.errorMsg);
      return;
    }

    if (result.status === 'FORBIDDEN' || result.status === 'VALIDATION_ERROR' || result.status === 'ENTITY_MISSING') {
      setSystemState(prev => {
        if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) return prev;
        return {
          ...prev,
          cycles: rollbackOptimisticCycleUpdate(prev.cycles, updatedCycle.id, previousConfirmedSnapshot)
        };
      });
      console.warn('[Cycle Mutation] Non-retryable error, quarantined and rolled back:', result);
      return;
    }

    if (result.status === 'AUTH_REQUIRED') {
      console.warn('[Cycle Mutation] Auth required, mutation preserved in queue for re-auth:', result);
      return;
    }

    if (result.status === 'RATE_LIMITED' || result.status === 'SERVER_RETRYABLE' || result.status === 'NETWORK_ERROR') {
      console.warn('[Cycle Mutation] Preserved in durable write-ahead queue for retry:', result);
      return;
    }
  }, [authToken, systemState.cycles, systemState.userProfile?.id, showAppToast, requestSync]);

  const handleDeleteCycle = useCallback(async (cycleId: string) => {
    // Explicit deletion permanently marks starter demo as consumed to prevent re-seeding
    const scopedDemoKey = getScopedDemoConsumedKey(systemState.userProfile?.id);
    safeSetLocalStorage(scopedDemoKey, 'true');

    const targetCycle = systemState.cycles.find(c => c.id === cycleId) || null;
    const targetLogs = systemState.logs.filter(l => l.cycleId === cycleId);
    const previousActiveCycleId = activeCycleId;

    const ownerId = systemState.userProfile?.id;
    const initialOwner = ownerId;

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
    }

    const result = await executeDirectDeleteCycleMutation({
      cycleId,
      existingCycle: targetCycle,
      ownerId,
      authToken,
      activeAccountRef
    });

    if (result.status === 'IGNORED_NO_AUTH_NO_QUEUE') {
      // Unauthenticated / guest state: show success toast directly
      showAppToast(remainingCycles.length === 0 ? 'چرخه با موفقیت حذف شد. می‌توانید چرخه جدیدی تعریف کنید.' : 'چرخه مورد نظر با موفقیت حذف شد.', 'success');
      return;
    }

    if (result.status === 'STORAGE_WRITE_FAILED') {
      setSystemState(prev => {
        if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) return prev;
        const { nextCycles, nextLogs } = rollbackOptimisticCycleDelete(
          prev.cycles,
          prev.logs,
          cycleId,
          targetCycle,
          targetLogs
        );
        return {
          ...prev,
          cycles: nextCycles,
          logs: nextLogs
        };
      });
      if (previousActiveCycleId === cycleId) {
        setActiveCycleId(cycleId);
      }
      showAppToast(result.messageFa, 'error');
      return;
    }

    if (result.status === 'INVALID_PRECONDITION') {
      setSystemState(prev => {
        if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) return prev;
        const { nextCycles, nextLogs } = rollbackOptimisticCycleDelete(
          prev.cycles,
          prev.logs,
          cycleId,
          targetCycle,
          targetLogs
        );
        return {
          ...prev,
          cycles: nextCycles,
          logs: nextLogs
        };
      });
      if (previousActiveCycleId === cycleId) {
        setActiveCycleId(cycleId);
      }
      showAppToast('نسخه معتبر چرخه برای حذف یافت نشد. همگام‌سازی مجدد با سرور انجام می‌شود.', 'warning');
      requestSync('MANUAL_FORCE', ownerId, authToken, true);
      return;
    }

    if (result.status === 'QUEUED_OFFLINE') {
      showAppToast('حذف چرخه در صف آفلاین ذخیره شد و پس از اتصال به سرور اعمال خواهد شد.', 'info');
      return;
    }

    if (result.status === 'ACCOUNT_SWITCHED') {
      return;
    }

    if (result.status === 'SUCCESS') {
      showAppToast(remainingCycles.length === 0 ? 'چرخه با موفقیت حذف شد. می‌توانید چرخه جدیدی تعریف کنید.' : 'چرخه مورد نظر با موفقیت حذف شد.', 'success');
      return;
    }

    if (result.status === 'CONFLICT') {
      setSystemState(prev => {
        if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) return prev;
        const { nextCycles, nextLogs } = rollbackOptimisticCycleDelete(
          prev.cycles,
          prev.logs,
          cycleId,
          targetCycle,
          targetLogs
        );
        return {
          ...prev,
          cycles: nextCycles,
          logs: nextLogs
        };
      });
      if (previousActiveCycleId === cycleId) {
        setActiveCycleId(cycleId);
      }
      showAppToast(result.conflictDetails.messageFa || 'حذف چرخه به دلیل تغییر در دستگاه دیگر رد شد. داده‌های چرخه بازگردانی شدند.', 'error');
      requestSync('NETWORK_ONLINE', ownerId, authToken, true);
      return;
    }

    if (result.status === 'FORBIDDEN' || result.status === 'VALIDATION_ERROR' || result.status === 'ENTITY_MISSING') {
      setSystemState(prev => {
        if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) return prev;
        const { nextCycles, nextLogs } = rollbackOptimisticCycleDelete(
          prev.cycles,
          prev.logs,
          cycleId,
          targetCycle,
          targetLogs
        );
        return {
          ...prev,
          cycles: nextCycles,
          logs: nextLogs
        };
      });
      if (previousActiveCycleId === cycleId) {
        setActiveCycleId(cycleId);
      }
      console.warn('[Delete Cycle Mutation] Non-retryable error, quarantined and rolled back:', result);
      return;
    }

    if (result.status === 'AUTH_REQUIRED') {
      console.warn('[Delete Cycle Mutation] Auth required, mutation preserved in queue for re-auth:', result);
      return;
    }

    if (result.status === 'RATE_LIMITED' || result.status === 'SERVER_RETRYABLE' || result.status === 'NETWORK_ERROR') {
      showAppToast('درخواست حذف چرخه ذخیره شد و پس از رفع اختلال شبکه به سرور ارسال می‌شود.', 'info');
      return;
    }
  }, [authToken, activeCycleId, systemState.cycles, systemState.logs, systemState.userProfile?.id, showAppToast, requestSync]);

  const handleUpdateUserProfile = useCallback(async (updatedProfile: UserProfile) => {
    const previousProfile = systemState.userProfile ? { ...systemState.userProfile } : null;

    setSystemState(prev => ({
      ...prev,
      userProfile: updatedProfile
    }));

    const ownerId = systemState.userProfile?.id;
    const initialOwner = ownerId;
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

      // Post-fetch Account Switch Verification before applying result
      if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) {
        return;
      }

      if (res.ok) {
        // Profile updated successfully
      } else if (res.status === 409 || res.status === 428) {
        const conflictJson = await res.json().catch(() => null);
        const parsedConflict = parseSafeConflictDetails(res.status, conflictJson, 'USER_PROFILE', updatedProfile.id);
        recordClientConflict(ownerId, {
          mutationType: 'UPDATE_PROFILE',
          entityType: parsedConflict.entityType,
          entityId: parsedConflict.entityId,
          conflictType: parsedConflict.conflictType,
          statusCode: parsedConflict.statusCode,
          messageFa: parsedConflict.messageFa,
          clientPayload: updatedProfile
        });

        // Rollback profile on conflict
        setSystemState(prev => {
          if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) return prev;
          return {
            ...prev,
            userProfile: previousProfile || prev.userProfile
          };
        });

        showAppToast(parsedConflict.messageFa, 'warning');
        requestSync('NETWORK_ONLINE', ownerId, authToken, true);
      } else {
        enqueueOfflineMutation(ownerId, { type: 'UPDATE_PROFILE', payload: updatedProfile });
      }
    } catch (e) {
      console.warn('Failed to sync user profile:', e);
      enqueueOfflineMutation(ownerId, { type: 'UPDATE_PROFILE', payload: updatedProfile });
    }
  }, [authToken, systemState.userProfile, showAppToast, requestSync]);

  const handleCreateNewCycle = useCallback(async (title: string, startDate: string, targetTheme: string) => {
    const ownerId = systemState.userProfile?.id;
    const initialOwner = ownerId;
    const scopedDemoKey = getScopedDemoConsumedKey(initialOwner);
    const previousDemoConsumed = safeGetLocalStorage(scopedDemoKey);
    
    // Capture baseline synchronously from current render state before optimistic transition
    const previousCyclesSnapshot: Cycle[] = systemState.cycles.map(c => ({ ...c }));
    const previousLogsSnapshot: DailyLog[] = systemState.logs.map(l => ({ ...l }));
    const previousActiveCycleId = activeCycleId;
    const previousSelectedDate = selectedDate;
    const previousActiveTab = activeTab;

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

    const result = await executeDirectCreateCycleMutation({
      newCycle,
      ownerId,
      authToken,
      activeAccountRef
    });

    const doRollback = () => {
      if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) return;

      if (previousDemoConsumed === null) {
        safeRemoveLocalStorage(scopedDemoKey);
      } else {
        safeSetLocalStorage(scopedDemoKey, previousDemoConsumed);
      }

      setSystemState(prev => {
        const { nextCycles, nextLogs } = rollbackOptimisticCycleCreate(
          prev.cycles,
          prev.logs,
          newCycle.id,
          previousCyclesSnapshot,
          previousLogsSnapshot
        );
        return {
          ...prev,
          cycles: nextCycles,
          logs: nextLogs
        };
      });

      setActiveCycleId(previousActiveCycleId);
      setSelectedDate(previousSelectedDate);
      setActiveTab(previousActiveTab);
    };

    if (result.status === 'IGNORED_NO_AUTH_NO_QUEUE') {
      showAppToast('چرخه جدید با موفقیت ایجاد شد.', 'success');
      return;
    }

    if (result.status === 'STORAGE_WRITE_FAILED') {
      doRollback();
      showAppToast(result.messageFa, 'error');
      return;
    }

    if (result.status === 'INVALID_PRECONDITION') {
      doRollback();
      showAppToast(result.messageFa, 'warning');
      return;
    }

    if (result.status === 'QUEUED_OFFLINE') {
      showAppToast('چرخه جدید در صف آفلاین ذخیره شد و پس از اتصال به سرور همگام می‌شود.', 'info');
      return;
    }

    if (result.status === 'ACCOUNT_SWITCHED') {
      return;
    }

    if (result.status === 'SUCCESS') {
      setSystemState(prev => {
        if (!verifyActiveAccount(activeAccountRef.current, initialOwner)) return prev;
        if (result.hasNewerIntent) {
          return prev;
        }
        return {
          ...prev,
          cycles: prev.cycles.map(c => c.id === newCycle.id ? { ...c, ...result.serverCycle, isSynced: true } : c)
        };
      });
      showAppToast('چرخه جدید با موفقیت ایجاد شد.', 'success');
      if (result.hasNewerIntent) {
        requestSync('NETWORK_ONLINE', ownerId, authToken);
      }
      return;
    }

    if (result.status === 'CONFLICT') {
      doRollback();
      showAppToast(result.conflictDetails.messageFa, 'warning');
      requestSync('NETWORK_ONLINE', ownerId, authToken, true);
      return;
    }

    if (result.status === 'INVALID_SUCCESS_RESPONSE') {
      console.warn('[Create Cycle Mutation] Invalid success response, state remains unconfirmed:', result.errorMsg);
      return;
    }

    if (result.status === 'FORBIDDEN' || result.status === 'VALIDATION_ERROR' || result.status === 'ENTITY_MISSING') {
      doRollback();
      console.warn('[Create Cycle Mutation] Non-retryable error, quarantined and rolled back:', result);
      return;
    }

    if (result.status === 'AUTH_REQUIRED') {
      console.warn('[Create Cycle Mutation] Auth required, mutation preserved in queue for re-auth:', result);
      return;
    }

    if (result.status === 'RATE_LIMITED' || result.status === 'SERVER_RETRYABLE' || result.status === 'NETWORK_ERROR') {
      showAppToast('چرخه ایجاد شد و پس از رفع اختلال ارتباط با سرور، همگام‌سازی تکمیل می‌شود.', 'info');
      return;
    }
  }, [authToken, cycleMetrics?.pureStreak, systemState.userProfile?.id, systemState.cycles, systemState.logs, activeCycleId, selectedDate, activeTab, showAppToast, requestSync]);

  const handleUpdateSettings = useCallback(async (updatedSettings: SystemSettings) => {
    setSystemState(prev => ({
      ...prev,
      settings: updatedSettings
    }));
  }, []);

  const handleExportData = () => {
    const data = buildExportPayload(systemState);
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
    lastRemotePullTimestampRef.current = 0;
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

  const shouldReduceMotion = useReducedMotion();
  const pageMotion = useMemo(() => {
    if (shouldReduceMotion) {
      return {
        initial: { opacity: 1 },
        animate: { opacity: 1 },
        exit: { opacity: 1 },
        transition: { duration: 0 }
      };
    }
    return {
      initial: { opacity: 0, y: 6 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: -6 },
      transition: { duration: 0.18, ease: 'easeOut' as const }
    };
  }, [shouldReduceMotion]);

  return (
    <ErrorBoundary>
      <div className="min-h-screen surface-z0 text-role-primary flex flex-col w-full max-w-full selection:bg-amber selection:text-canvas-root">
        {/* Skip Link for direct keyboard navigation to main content */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:right-3 focus:z-[100] focus:px-4 focus:py-2.5 focus:bg-amber focus:text-canvas-root focus:font-black focus:text-xs focus:radius-component focus:shadow-subtle focus-ring-tactical transition-none"
        >
          پرش به محتوای اصلی
        </a>

        {/* Top Banner when Admin is Impersonating a User */}
        {impersonatingUser && (
          <div className="bg-blue-subtle border-b border-blue py-2.5 px-4 sticky top-0 z-50 shadow-subtle backdrop-blur-md">
            <div className="max-w-7xl w-full mx-auto flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs">
              <div className="flex items-center gap-2 text-blue font-bold">
                <Eye className="w-4 h-4 text-blue animate-pulse motion-reduce:animate-none shrink-0" />
                <span>
                  حالت شبیه‌سازی کاربر: در حال بررسی سامانه از دید «{impersonatingUser.name}»
                </span>
                <span className="text-[10px] surface-z1 text-blue border border-blue-subtle px-2 py-0.5 radius-capsule font-mono hidden md:inline-block">
                  {impersonatingUser.id}
                </span>
              </div>
              <button
                onClick={handleExitImpersonation}
                className="bg-blue hover:brightness-110 text-canvas-root font-black text-xs px-3.5 py-1.5 radius-component transition cursor-pointer flex items-center gap-1.5 shadow-subtle shrink-0 active:scale-95 focus-ring-tactical"
              >
                <ShieldCheck className="w-4 h-4 text-canvas-root" />
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
          unresolvedDebtCount={unresolvedDebtLogs.length}
          settings={systemState.settings}
          userProfile={systemState.userProfile}
          onOpenPaymentModal={() => setIsPaymentModalOpen(true)}
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
          onOpenNewCycleModal={() => setIsCreateCycleModalOpen(true)}
          onDeleteCycle={handleDeleteCycle}
          onOpenDebtAutopsy={() => {
            if (unresolvedDebtLogs.length > 0) {
              setAutopsyTargetLog(unresolvedDebtLogs[0]);
            } else {
              setActiveTab('battlefield');
            }
          }}
        />

        {/* Main Content Area */}
        <main id="main-content" tabIndex={-1} className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 pt-3 sm:pt-6 pb-32 lg:pb-16 min-w-0 outline-none">
          <AnimatePresence mode="wait">
              {activeTab === 'battlefield' && (
                <motion.div
                  key="battlefield"
                  {...pageMotion}
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
                  {...pageMotion}
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
                  {...pageMotion}
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
                  {...pageMotion}
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
                    onExportData={handleExportData}
                    onNavigateToAdmin={() => setActiveTab('admin')}
                  />
                </motion.div>
              )}

              {activeTab === 'admin' && (
                <motion.div
                  key="admin"
                  {...pageMotion}
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
            allUnresolvedLogs={unresolvedDebtLogs}
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
            onOpenDisciplineRules={() => setIsDisciplineRulesOpen(true)}
          />
        )}

        {/* Discipline Rules Modal */}
        {isDisciplineRulesOpen && (
          <DisciplineRulesModal
            isOpen={isDisciplineRulesOpen}
            onClose={() => setIsDisciplineRulesOpen(false)}
          />
        )}

        {/* Reset Confirmation Modal */}
        <ResetConfirmationModal
          isOpen={isResetConfirmOpen}
          onClose={() => setIsResetConfirmOpen(false)}
          onConfirm={handleConfirmReset}
        />
      </div>
    </ErrorBoundary>
  );
}
