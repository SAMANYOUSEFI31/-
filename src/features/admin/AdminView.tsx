import React, { useState, useEffect, useRef } from 'react';
import { 
  AdminUserItem, 
  AdminSubscriptionItem, 
  AdminOverviewStats, 
  UserProfile,
  AdminSubTab
} from '../../types';
import { toPersianDigits, formatPersianToman } from '../../shared/utils/numberUtils';
import { formatPersianDate } from '../../shared/utils/dateUtils';
import { soundFX } from '../../utils/audioEffects';
import { safeGetLocalStorage } from '../../sync/storageUtils';
import { ResponsiveSubTabBar, SubTabItem } from '../../shared/components/layout/ResponsiveSubTabBar';
import { TrendCurvedChart } from '../../shared/components/charts/TrendCurvedChart';
import { 
  ShieldCheck, 
  Users, 
  Crown, 
  CreditCard, 
  Database, 
  Search, 
  RefreshCw, 
  CheckCircle2, 
  Clock, 
  Sliders, 
  Zap, 
  ArrowUpRight, 
  AlertCircle,
  Calendar,
  Lock,
  Shield,
  ShieldAlert,
  ChevronDown,
  Sparkles,
  Server,
  UserPlus,
  Eye,
  User,
  TrendingUp,
  Activity,
  BarChart3,
  Flame,
  Award,
  Target,
  Copy,
  FileText,
  Layers,
  PieChart,
  Check,
  Coins,
  Download,
  FileSpreadsheet,
  Filter
} from 'lucide-react';

interface AdminViewProps {
  currentUser: UserProfile;
  authToken?: string | null;
  onBack?: () => void;
  onRefreshUserProfile?: () => void;
  onImpersonateUser?: (user: AdminUserItem) => void;
}

export const AdminView: React.FC<AdminViewProps> = ({ 
  currentUser, 
  authToken, 
  onBack, 
  onRefreshUserProfile,
  onImpersonateUser
}) => {
  const [stats, setStats] = useState<AdminOverviewStats | null>(null);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [subscriptions, setSubscriptions] = useState<AdminSubscriptionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCallerSuperAdmin, setIsCallerSuperAdmin] = useState(Boolean(currentUser?.isSuperAdmin));
  const [activeSubTab, setActiveSubTab] = useState<AdminSubTab>('analytics');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTier, setFilterTier] = useState<'all' | 'vip' | 'free'>('all');
  const [isUpdatingUser, setIsUpdatingUser] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Touch Swipe Gesture State
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  // New Test User Form state
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserContact, setNewUserContact] = useState('');
  const [newUserTier, setNewUserTier] = useState<'free' | 'vip_samurai'>('free');
  const [newUserIsAdmin, setNewUserIsAdmin] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  const ADMIN_SUB_TABS: SubTabItem<AdminSubTab>[] = [
    {
      id: 'analytics',
      label: 'دیدگاه کلان رشد و سلامت',
      shortLabel: 'رشد و تحلیل',
      icon: TrendingUp,
      activeColor: 'text-amber'
    },
    {
      id: 'users',
      label: `مدیریت کاربران (${toPersianDigits(users.length)})`,
      shortLabel: `کاربران (${toPersianDigits(users.length)})`,
      icon: Users,
      activeColor: 'text-amber'
    },
    {
      id: 'subscriptions',
      label: `تراکنش‌های مالی (${toPersianDigits(subscriptions.length)})`,
      shortLabel: `تراکنش‌ها (${toPersianDigits(subscriptions.length)})`,
      icon: CreditCard,
      activeColor: 'text-amber'
    }
  ];

  // Automatic transition if retention was previously selected
  useEffect(() => {
    if ((activeSubTab as string) === 'retention') {
      setActiveSubTab('analytics');
    }
  }, [activeSubTab]);

  // Touch Gesture Handling for Smooth RTL Horizontal Swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartXRef.current = e.touches[0].clientX;
      touchStartYRef.current = e.touches[0].clientY;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;

    const deltaX = touchEndX - touchStartXRef.current;
    const deltaY = touchEndY - touchStartYRef.current;

    // Reset touch coordinates
    touchStartXRef.current = null;
    touchStartYRef.current = null;

    // Require predominantly horizontal motion with minimum 48px threshold
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) >= 48) {
      const tabOrder: AdminSubTab[] = ['analytics', 'users', 'subscriptions'];
      const currentIndex = tabOrder.indexOf(activeSubTab);

      // In RTL: swipe left (deltaX < 0) advances to next tab, swipe right (deltaX > 0) goes to previous
      if (deltaX < 0 && currentIndex < tabOrder.length - 1) {
        setActiveSubTab(tabOrder[currentIndex + 1]);
      } else if (deltaX > 0 && currentIndex > 0) {
        setActiveSubTab(tabOrder[currentIndex - 1]);
      }
    }
  };

  const getHeaders = () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = authToken || safeGetLocalStorage('bushido_auth_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  };

  const fetchAdminData = async () => {
    setIsLoading(true);
    try {
      const headers = getHeaders();
      const [statsRes, usersRes, subsRes] = await Promise.all([
        fetch('/api/admin/stats', { headers }),
        fetch('/api/admin/users', { headers }),
        fetch('/api/admin/subscriptions', { headers })
      ]);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.stats);
        if (typeof statsData.isCallerSuperAdmin === 'boolean') {
          setIsCallerSuperAdmin(statsData.isCallerSuperAdmin);
        }
      }
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setUsers(usersData.users || []);
        if (typeof usersData.isCallerSuperAdmin === 'boolean') {
          setIsCallerSuperAdmin(usersData.isCallerSuperAdmin);
        }
      }
      if (subsRes.ok) {
        const subsData = await subsRes.json();
        setSubscriptions(subsData.subscriptions || []);
      }
    } catch (err) {
      console.error('Failed to fetch admin data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, [authToken]);

  const handleCreateTestUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim()) return;

    setIsCreatingUser(true);
    setActionMessage(null);
    try {
      const isEmail = newUserContact.includes('@');
      const res = await fetch('/api/admin/users/create-test', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          name: newUserName.trim(),
          email: isEmail ? newUserContact.trim() : undefined,
          phoneNumber: !isEmail && newUserContact.trim() ? newUserContact.trim() : undefined,
          tier: newUserTier,
          isVip: newUserTier === 'vip_samurai',
          isAdmin: newUserIsAdmin
        })
      });
      const data = await res.json();
      if (res.ok) {
        soundFX.playCheck();
        setActionMessage(data.message || 'حساب کاربری آزمایشی با موفقیت ایجاد شد.');
        setNewUserName('');
        setNewUserContact('');
        setIsCreateUserOpen(false);
        await fetchAdminData();
      } else {
        setActionMessage(data.error || 'خطا در ساخت حساب تستی.');
      }
    } catch (err) {
      console.error('Create test user error:', err);
      setActionMessage('خطا در ارتباط با سرور.');
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleUpdateUserTier = async (userId: string, targetTier: 'vip_samurai' | 'ronin_free', daysExtension = 90) => {
    setIsUpdatingUser(userId);
    setActionMessage(null);
    try {
      const isVip = targetTier === 'vip_samurai';
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({
          tier: targetTier,
          isVip,
          daysExtension: isVip ? daysExtension : 0
        })
      });

      const data = await res.json().catch(() => null);
      if (res.ok) {
        soundFX.playCheck();
        setActionMessage(`وضعیت کاربر با موفقیت به ${isVip ? 'سامورایی ویژه VIP' : 'کاربر عادی'} تغییر یافت.`);
        await fetchAdminData();
        if (onRefreshUserProfile) {
          onRefreshUserProfile();
        }
      } else {
        setActionMessage(data?.messageFa || data?.error || 'خطا در به‌روزرسانی وضعیت کاربر.');
      }
    } catch (err) {
      console.error('Admin update user error:', err);
      setActionMessage('خطا در ارتباط با سرور.');
    } finally {
      setIsUpdatingUser(null);
    }
  };

  const handleToggleAdminStatus = async (userId: string, currentAdminStatus: boolean) => {
    setIsUpdatingUser(userId);
    setActionMessage(null);
    try {
      const newAdminStatus = !currentAdminStatus;
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({
          isAdmin: newAdminStatus
        })
      });

      const data = await res.json().catch(() => null);
      if (res.ok) {
        soundFX.playCheck();
        setActionMessage(`نقش کاربری با موفقیت به ${newAdminStatus ? 'مدیر سامانه (Admin)' : 'کاربر عادی'} تغییر یافت.`);
        await fetchAdminData();
        if (onRefreshUserProfile) {
          onRefreshUserProfile();
        }
      } else {
        setActionMessage(data?.messageFa || data?.error || 'خطا در تغییر سطح دسترسی کاربر.');
      }
    } catch (err) {
      console.error('Admin toggle status error:', err);
      setActionMessage('خطا در ارتباط با سرور.');
    } finally {
      setIsUpdatingUser(null);
    }
  };

  const [isCopiedReport, setIsCopiedReport] = useState(false);
  const [analyticsTimeRange, setAnalyticsTimeRange] = useState<'7d' | '30d' | '90d' | '1y' | 'all'>('30d');

  // Macro Timeframe & Comparative Analytics (Signups vs VIP Conversions & Revenue)
  const macroAnalytics = React.useMemo(() => {
    const now = new Date();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    let daysLimit = 30;
    if (analyticsTimeRange === '7d') daysLimit = 7;
    else if (analyticsTimeRange === '30d') daysLimit = 30;
    else if (analyticsTimeRange === '90d') daysLimit = 90;
    else if (analyticsTimeRange === '1y') daysLimit = 365;
    else if (analyticsTimeRange === 'all') daysLimit = 0; // all time

    const filterByDate = (dateIsoStr?: string | null) => {
      if (!dateIsoStr) return false;
      if (daysLimit === 0) return true;
      const itemTime = new Date(dateIsoStr).getTime();
      return (now.getTime() - itemTime) <= (daysLimit * MS_PER_DAY);
    };

    const windowUsers = users.filter(u => filterByDate(u.createdAt));
    const windowSubs = subscriptions.filter(s => filterByDate(s.createdAt) && s.status === 'SUCCESS');
    
    const windowSignups = windowUsers.length;
    const windowVips = windowUsers.filter(u => u.isVip).length;
    const windowRevenue = windowSubs.reduce((sum, s) => sum + (s.amount || 0), 0);
    const windowConversionRate = windowSignups > 0 ? Number(((windowVips / windowSignups) * 100).toFixed(1)) : 0;
    const windowAOV = windowSubs.length > 0 ? Math.round(windowRevenue / windowSubs.length) : (windowVips > 0 ? Math.round(windowRevenue / windowVips) : 0);
    const windowActiveUsers = windowUsers.filter(u => (u.logsCount || 0) > 0).length;

    // Generate Comparative Buckets (Signups vs VIP Conversions vs Revenue)
    interface Bucket {
      key: string;
      label: string;
      subLabel?: string;
      signups: number;
      vipConversions: number;
      revenue: number;
      conversionRate: number;
      isCurrentPeriod?: boolean;
    }

    const buckets: Bucket[] = [];

    if (analyticsTimeRange === '7d') {
      const weekDayNames = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const iso = d.toISOString().split('T')[0];
        const dayLabel = i === 0 ? 'امروز' : i === 1 ? 'دیروز' : weekDayNames[d.getDay()];
        
        const bUsers = users.filter(u => u.createdAt && u.createdAt.split('T')[0] === iso);
        const bSubs = subscriptions.filter(s => s.createdAt && s.createdAt.split('T')[0] === iso && s.status === 'SUCCESS');
        const signups = bUsers.length;
        const vipConversions = bUsers.filter(u => u.isVip).length || bSubs.length;
        const revenue = bSubs.reduce((sum, s) => sum + (s.amount || 0), 0);
        const conversionRate = signups > 0 ? Math.round((vipConversions / signups) * 100) : (vipConversions > 0 ? 100 : 0);

        buckets.push({
          key: iso,
          label: dayLabel,
          subLabel: formatPersianDate(iso, { short: true }),
          signups,
          vipConversions,
          revenue,
          conversionRate,
          isCurrentPeriod: i === 0
        });
      }
    } else if (analyticsTimeRange === '30d') {
      // 10 intervals of 3 days
      const bucketSizeDays = 3;
      const numBuckets = 10;
      for (let b = numBuckets - 1; b >= 0; b--) {
        const startDayOffset = (b + 1) * bucketSizeDays - 1;
        const endDayOffset = b * bucketSizeDays;
        
        const dStart = new Date(now);
        dStart.setDate(dStart.getDate() - startDayOffset);
        const dEnd = new Date(now);
        dEnd.setDate(dEnd.getDate() - endDayOffset);

        const isoStart = dStart.toISOString().split('T')[0];
        const isoEnd = dEnd.toISOString().split('T')[0];

        const bUsers = users.filter(u => {
          if (!u.createdAt) return false;
          const uIso = u.createdAt.split('T')[0];
          return uIso >= isoStart && uIso <= isoEnd;
        });
        const bSubs = subscriptions.filter(s => {
          if (!s.createdAt || s.status !== 'SUCCESS') return false;
          const sIso = s.createdAt.split('T')[0];
          return sIso >= isoStart && sIso <= isoEnd;
        });

        const signups = bUsers.length;
        const vipConversions = bUsers.filter(u => u.isVip).length || bSubs.length;
        const revenue = bSubs.reduce((sum, s) => sum + (s.amount || 0), 0);
        const conversionRate = signups > 0 ? Math.round((vipConversions / signups) * 100) : (vipConversions > 0 ? 100 : 0);

        buckets.push({
          key: `3d-${b}`,
          label: b === 0 ? '۳ روز اخیر' : `${toPersianDigits((b * 3) + 1)}-${toPersianDigits((b + 1) * 3)} روز پیش`,
          subLabel: `${formatPersianDate(isoStart, { short: true })}`,
          signups,
          vipConversions,
          revenue,
          conversionRate,
          isCurrentPeriod: b === 0
        });
      }
    } else if (analyticsTimeRange === '90d') {
      // 12 weekly intervals
      const numBuckets = 12;
      for (let b = numBuckets - 1; b >= 0; b--) {
        const startDayOffset = (b + 1) * 7 - 1;
        const endDayOffset = b * 7;
        
        const dStart = new Date(now);
        dStart.setDate(dStart.getDate() - startDayOffset);
        const dEnd = new Date(now);
        dEnd.setDate(dEnd.getDate() - endDayOffset);

        const isoStart = dStart.toISOString().split('T')[0];
        const isoEnd = dEnd.toISOString().split('T')[0];

        const bUsers = users.filter(u => {
          if (!u.createdAt) return false;
          const uIso = u.createdAt.split('T')[0];
          return uIso >= isoStart && uIso <= isoEnd;
        });
        const bSubs = subscriptions.filter(s => {
          if (!s.createdAt || s.status !== 'SUCCESS') return false;
          const sIso = s.createdAt.split('T')[0];
          return sIso >= isoStart && sIso <= isoEnd;
        });

        const signups = bUsers.length;
        const vipConversions = bUsers.filter(u => u.isVip).length || bSubs.length;
        const revenue = bSubs.reduce((sum, s) => sum + (s.amount || 0), 0);
        const conversionRate = signups > 0 ? Math.round((vipConversions / signups) * 100) : (vipConversions > 0 ? 100 : 0);

        buckets.push({
          key: `w-${b}`,
          label: b === 0 ? 'هفته جاری' : `هفته ${toPersianDigits(numBuckets - b)}`,
          subLabel: formatPersianDate(isoStart, { short: true }),
          signups,
          vipConversions,
          revenue,
          conversionRate,
          isCurrentPeriod: b === 0
        });
      }
    } else {
      // 12 periodic / monthly intervals for 1y and all
      const numBuckets = 12;
      for (let b = numBuckets - 1; b >= 0; b--) {
        const startDayOffset = (b + 1) * 30 - 1;
        const endDayOffset = b * 30;
        
        const dStart = new Date(now);
        dStart.setDate(dStart.getDate() - startDayOffset);
        const dEnd = new Date(now);
        dEnd.setDate(dEnd.getDate() - endDayOffset);

        const isoStart = dStart.toISOString().split('T')[0];
        const isoEnd = dEnd.toISOString().split('T')[0];

        const bUsers = users.filter(u => {
          if (!u.createdAt) return false;
          const uIso = u.createdAt.split('T')[0];
          return uIso >= isoStart && uIso <= isoEnd;
        });
        const bSubs = subscriptions.filter(s => {
          if (!s.createdAt || s.status !== 'SUCCESS') return false;
          const sIso = s.createdAt.split('T')[0];
          return sIso >= isoStart && sIso <= isoEnd;
        });

        const signups = bUsers.length;
        const vipConversions = bUsers.filter(u => u.isVip).length || bSubs.length;
        const revenue = bSubs.reduce((sum, s) => sum + (s.amount || 0), 0);
        const conversionRate = signups > 0 ? Math.round((vipConversions / signups) * 100) : (vipConversions > 0 ? 100 : 0);

        buckets.push({
          key: `m-${b}`,
          label: b === 0 ? 'ماه جاری' : `ماه ${toPersianDigits(numBuckets - b)}`,
          subLabel: formatPersianDate(isoStart, { short: true }),
          signups,
          vipConversions,
          revenue,
          conversionRate,
          isCurrentPeriod: b === 0
        });
      }
    }

    const maxBucketSignups = Math.max(1, ...buckets.map(b => b.signups));
    const maxBucketVips = Math.max(1, ...buckets.map(b => b.vipConversions));
    const maxBucketVolume = Math.max(1, maxBucketSignups, maxBucketVips);

    return {
      windowSignups,
      windowVips,
      windowRevenue,
      windowConversionRate,
      windowAOV,
      windowActiveUsers,
      buckets,
      maxBucketVolume
    };
  }, [users, subscriptions, analyticsTimeRange]);

  // Comprehensive Excel/CSV Exporter (UTF-8 with BOM for Excel Persian Compatibility)
  const handleExportComprehensiveCSV = (type: 'users' | 'subscriptions') => {
    try {
      let csvContent = '';
      let fileName = '';

      if (type === 'users') {
        const headers = [
          'شناسه کاربر',
          'نام و نام خانوادگی',
          'شماره موبایل',
          'ایمیل',
          'سطح دسترسی',
          'وضعیت اشتراک',
          'طرح',
          'تاریخ ثبت‌نام (شمسی)',
          'تاریخ ثبت‌نام (میلادی)',
          'تاریخ انقضای VIP (شمسی)',
          'روزهای باقیمانده VIP',
          'تعداد روزهای نبرد (Logs)',
          'تعداد چرخه‌ها',
          'تعداد تراکنش‌های پرداخت'
        ];

        const rows = users.map(u => {
          const role = u.isSuperAdmin ? 'سوپر ادمین (فرمانده ارشد)' : u.isAdmin ? 'مدیر سامانه' : 'کاربر عادی';
          const tierLabel = u.isVip ? 'سامورایی ویژه (VIP)' : 'رونین عادی (رایگان)';
          const jalaliCreated = u.createdAt ? formatPersianDate(u.createdAt.split('T')[0]) : '---';
          const isoCreated = u.createdAt || '---';
          const jalaliExpires = u.vipExpiresAt ? formatPersianDate(u.vipExpiresAt.split('T')[0]) : (u.isVip ? 'نامحدود' : 'ندارد');
          
          let remainingDays = '0';
          if (u.vipExpiresAt) {
            const diff = Math.ceil((new Date(u.vipExpiresAt).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
            remainingDays = diff > 0 ? String(diff) : 'منقضی‌شده';
          } else if (u.isVip) {
            remainingDays = 'نامحدود';
          }

          const userSubsCount = subscriptions.filter(s => s.userId === u.id && s.status === 'SUCCESS').length;

          return [
            `"${u.id}"`,
            `"${(u.name || 'بدون نام').replace(/"/g, '""')}"`,
            `"${u.phoneNumber || '---'}"`,
            `"${u.email || '---'}"`,
            `"${role}"`,
            `"${tierLabel}"`,
            `"${u.tier}"`,
            `"${jalaliCreated}"`,
            `"${isoCreated}"`,
            `"${jalaliExpires}"`,
            `"${remainingDays}"`,
            `"${u.logsCount || 0}"`,
            `"${u.cyclesCount || 0}"`,
            `"${userSubsCount}"`
          ].join(',');
        });

        csvContent = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
        fileName = `bushido-users-report-${analyticsTimeRange}-${new Date().toISOString().split('T')[0]}.csv`;
      } else if (type === 'subscriptions') {
        const headers = [
          'شناسه تراکنش',
          'کاربر',
          'شناسه کاربر',
          'پلن / پکیج',
          'مبلغ (تومان)',
          'وضعیت پرداخت',
          'کد پیگیری زرین‌پال / مرجع',
          'درگاه پرداخت',
          'تاریخ پرداخت (شمسی)',
          'تاریخ و ساعت (میلادی)'
        ];

        const rows = subscriptions.map(s => {
          const jalaliDate = s.createdAt ? formatPersianDate(s.createdAt.split('T')[0]) : '---';
          const statusFa = s.status === 'SUCCESS' ? 'موفق' : s.status === 'FAILED' ? 'ناموفق' : 'در انتظار';
          const planTitle = s.planId === 'samurai_quarterly' ? '۳ ماهه فصلی' : s.planId === 'samurai_monthly' ? '۱ ماهه' : s.planId === 'samurai_annual' ? '۱ ساله' : 'ویژه VIP';
          const matchedUser = users.find(u => u.id === s.userId);
          const userName = matchedUser?.name || 'کاربر';

          return [
            `"${s.id}"`,
            `"${userName.replace(/"/g, '""')}"`,
            `"${s.userId}"`,
            `"${planTitle}"`,
            `"${s.amount}"`,
            `"${statusFa}"`,
            `"${s.refId || s.authority || '---'}"`,
            `"زرین‌پال"`,
            `"${jalaliDate}"`,
            `"${s.createdAt || '---'}"`
          ].join(',');
        });

        csvContent = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
        fileName = `bushido-subscriptions-audit-${new Date().toISOString().split('T')[0]}.csv`;
      }

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      soundFX.playCheck();
      setActionMessage(`فایل اکسل/CSV جامع (${fileName}) با موفقیت دانلود گردید.`);
    } catch (err) {
      console.error('Export error:', err);
      setActionMessage('خطا در ایجاد و دانلود فایل گزارش اکسل.');
    }
  };

  // Phase 2: Derive Cohort Lifecycle Data
  const cohortData = React.useMemo(() => {
    const now = new Date().getTime();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    const newUsers = users.filter(u => (now - new Date(u.createdAt).getTime()) <= 7 * MS_PER_DAY);
    const middleUsers = users.filter(u => {
      const diff = now - new Date(u.createdAt).getTime();
      return diff > 7 * MS_PER_DAY && diff <= 30 * MS_PER_DAY;
    });
    const veteranUsers = users.filter(u => (now - new Date(u.createdAt).getTime()) > 30 * MS_PER_DAY);

    const calcActiveRate = (arr: AdminUserItem[]) => {
      if (arr.length === 0) return 0;
      const active = arr.filter(u => (u.logsCount || 0) > 0).length;
      return Math.round((active / arr.length) * 100);
    };

    return {
      newbies: {
        count: newUsers.length,
        activeRate: calcActiveRate(newUsers),
        vipCount: newUsers.filter(u => u.isVip).length
      },
      settled: {
        count: middleUsers.length,
        activeRate: calcActiveRate(middleUsers),
        vipCount: middleUsers.filter(u => u.isVip).length
      },
      veterans: {
        count: veteranUsers.length,
        activeRate: calcActiveRate(veteranUsers),
        vipCount: veteranUsers.filter(u => u.isVip).length
      }
    };
  }, [users]);

  // Copy Executive KPI Summary Report for Product Manager / Management
  const handleCopyExecutiveSummary = () => {
    const vipCount = users.filter(u => u.isVip).length;
    const conversionRate = users.length > 0 ? ((vipCount / users.length) * 100).toFixed(1) : '۰';
    const totalRev = stats?.totalRevenueToman || 0;
    const successfulSubs = subscriptions.filter(s => s.status === 'SUCCESS').length;
    const activeUsersCount = users.filter(u => (u.logsCount || 0) > 0).length;
    const activeRate = users.length > 0 ? ((activeUsersCount / users.length) * 100).toFixed(0) : '۰';

    const report = `📊 گزارش تحلیلی و عملکرد سیستم دیسیپلین بوشیدو (PO Report)
بازه زمانی گزارش: ${analyticsTimeRange === '7d' ? '۷ روز اخیر' : analyticsTimeRange === '30d' ? '۳۰ روز اخیر' : analyticsTimeRange === '90d' ? '۹۰ روز اخیر (فصل)' : analyticsTimeRange === '1y' ? '۱ سال اخیر' : 'کل تاریخچه'}
تاریخ صدور: ${new Date().toLocaleDateString('fa-IR')}
------------------------------------------------
👥 کل جنگجویان ثبت‌نامی در بازه: ${toPersianDigits(macroAnalytics.windowSignups)} نفر
👑 خریداران اشتراک سامورایی VIP در بازه: ${toPersianDigits(macroAnalytics.windowVips)} نفر
🎯 نرخ تبدیل به VIP (Conversion): ${toPersianDigits(macroAnalytics.windowConversionRate)}٪
💰 کل درآمد محقق‌شده در بازه: ${formatPersianToman(macroAnalytics.windowRevenue)}
⚡ میانگین ارزش هر مشترک (AOV): ${formatPersianToman(macroAnalytics.windowAOV)}
💳 تراکنش‌های موفق بانکی کل: ${toPersianDigits(successfulSubs)} فقره
🔥 کاربران فعال کل: ${toPersianDigits(activeUsersCount)} نفر (${toPersianDigits(activeRate)}٪)
------------------------------------------------
🌱 کوهورت تازه پیوسته (<۷ روز): ${toPersianDigits(cohortData.newbies.count)} نفر (فعالیت: ${toPersianDigits(cohortData.newbies.activeRate)}٪)
🛡️ کوهورت مستقر (۷ تا ۳۰ روز): ${toPersianDigits(cohortData.settled.count)} نفر (فعالیت: ${toPersianDigits(cohortData.settled.activeRate)}٪)
⚔️ کوهورت کهنه‌سرباز (>۳۰ روز): ${toPersianDigits(cohortData.veterans.count)} نفر (فعالیت: ${toPersianDigits(cohortData.veterans.activeRate)}٪)
`;

    navigator.clipboard.writeText(report).then(() => {
      setIsCopiedReport(true);
      soundFX.playCheck();
      setTimeout(() => setIsCopiedReport(false), 3000);
    }).catch(err => {
      console.error('Copy report error:', err);
    });
  };

  const filteredUsers = users.filter(u => {
    const matchesSearch = 
      (u.name && u.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (u.email && u.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (u.phoneNumber && u.phoneNumber.includes(searchQuery)) ||
      u.id.includes(searchQuery);

    if (!matchesSearch) return false;

    if (filterTier === 'vip') return u.isVip;
    if (filterTier === 'free') return !u.isVip;
    return true;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-200 w-full max-w-5xl mx-auto" dir="rtl">
      
      {/* Top Header Card */}
      <div className="surface-z1 border-standard radius-modal p-5 sm:p-7 shadow-subtle">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 radius-component surface-z2 border-standard flex items-center justify-center text-role-primary shadow-subtle">
              <ShieldCheck className="w-6 h-6 text-role-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-black text-role-primary tracking-tight">
                  قرارگاه فرماندهی و مدیریت سامورایی‌ها
                </h1>
                <span className="surface-z2 text-role-secondary border-standard text-[10px] font-bold px-2 py-0.5 radius-badge">
                  پنل ادمین
                </span>
                {isCallerSuperAdmin ? (
                  <span className="inline-flex items-center gap-1 bg-amber-subtle text-amber border border-amber/40 text-[10px] font-bold px-2.5 py-0.5 radius-badge shadow-subtle">
                    <Crown className="w-3 h-3 text-amber" />
                    <span>سطح دسترسی: سوپر ادمین (فرمانده کل)</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 bg-blue-subtle text-blue border border-blue/40 text-[10px] font-bold px-2.5 py-0.5 radius-badge shadow-subtle">
                    <Shield className="w-3 h-3 text-blue" />
                    <span>سطح دسترسی: مدیر عملیاتی (حفاظت از مدیران فعال است)</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-role-secondary mt-0.5">
                {isCallerSuperAdmin
                  ? 'اختیارات کامل نظارت، انتصاب و عزل مدیران، مدیریت چرخه‌ها و تراکنش‌های بانکی'
                  : 'نظارت و مدیریت کاربران عادی (حساب مدیران سامانه دارای مصونیت کامل است)'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            {onBack && (
              <button
                onClick={onBack}
                className="btn-contract-secondary px-3.5 py-1.5 radius-component text-xs font-bold flex items-center gap-1.5 focus-ring-tactical"
              >
                <span>بازگشت به تنظیمات</span>
              </button>
            )}
            <div className="surface-z0 border-standard px-3 py-1.5 radius-component text-xs flex items-center gap-2 text-role-secondary">
              <Server className="w-3.5 h-3.5 text-emerald" />
              <span className="text-[11px] font-mono text-emerald">
                {stats?.databaseMode || 'PostgreSQL'}
              </span>
            </div>
            <button
              onClick={fetchAdminData}
              disabled={isLoading}
              className="btn-contract-secondary px-3.5 py-1.5 radius-component text-xs font-bold flex items-center gap-1.5 focus-ring-tactical"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>به‌روزرسانی</span>
            </button>
          </div>
        </div>
      </div>

      {/* Action Notification Message */}
      {actionMessage && (
        <div className="bg-amber-subtle border border-amber-subtle text-amber px-4 py-3 radius-card text-xs flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-amber shrink-0" />
            <span>{actionMessage}</span>
          </div>
          <button 
            onClick={() => setActionMessage(null)}
            className="btn-contract-ghost p-1 radius-control text-amber font-bold text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Overview Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Users */}
        <div className="surface-z1 border-standard radius-card p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-role-secondary text-xs">
            <span>کل جنگجویان ثبت‌شده</span>
            <Users className="w-4 h-4 text-role-muted" />
          </div>
          <div className="mt-3">
            <span className="text-2xl sm:text-3xl font-black text-role-primary font-mono">
              {toPersianDigits(stats?.totalUsers || users.length || 1)}
            </span>
            <span className="text-xs text-role-muted mr-1.5">کاربر</span>
          </div>
        </div>

        {/* Total VIPs */}
        <div className="surface-z1 border-standard radius-card p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-role-primary text-xs font-bold">
            <span>اشتراک‌های فعال VIP</span>
            <Crown className="w-4 h-4 text-amber" />
          </div>
          <div className="mt-3">
            <span className="text-2xl sm:text-3xl font-black text-amber font-mono">
              {toPersianDigits(stats?.totalVipUsers || users.filter(u => u.isVip).length || 0)}
            </span>
            <span className="text-xs text-amber mr-1.5">سامورایی VIP</span>
          </div>
        </div>

        {/* Revenue */}
        <div className="surface-z1 border-standard radius-card p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-role-primary text-xs font-bold">
            <span>درآمد کل اشتراک‌ها</span>
            <CreditCard className="w-4 h-4 text-emerald" />
          </div>
          <div className="mt-3">
            <span className="text-xl sm:text-2xl font-black text-emerald font-mono">
              {formatPersianToman(stats?.totalRevenueToman || 0)}
            </span>
          </div>
        </div>

        {/* Cycles & Logs */}
        <div className="surface-z1 border-standard radius-card p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-role-secondary text-xs">
            <span>چرخه‌ها و روزهای ثبت‌شده</span>
            <Database className="w-4 h-4 text-role-muted" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-black text-role-primary font-mono">
              {toPersianDigits(stats?.totalCycles || 1)}
            </span>
            <span className="text-xs text-role-muted">چرخه /</span>
            <span className="text-lg font-bold text-role-secondary font-mono">
              {toPersianDigits(stats?.totalDailyLogs || 25)}
            </span>
            <span className="text-[11px] text-role-muted">روز نبرد</span>
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs (Responsive Ergonomic Bar) */}
      <ResponsiveSubTabBar<AdminSubTab>
        tabs={ADMIN_SUB_TABS}
        activeTab={activeSubTab}
        onSelectTab={setActiveSubTab}
        layoutId="activeAdminSubTabIndicator"
      />

      {/* SUB-TABS CONTENT CONTAINER (With Touch Swipe Gestures) */}
      <div 
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="space-y-4 touch-pan-y"
      >
        {/* SUB-TAB 1: GROWTH & PRODUCT ANALYTICS */}
        {activeSubTab === 'analytics' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Executive Growth & Revenue Banner */}
            <div className="surface-z1 border-standard radius-card p-4 sm:p-5 shadow-subtle space-y-4">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 radius-component surface-z2 border-standard flex items-center justify-center text-amber shrink-0">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-black text-sm text-role-primary">
                      دیدگاه کلان رشد، سلامت محصول و درآمد (Macro Growth & Financial Insights)
                    </h2>
                    <p className="text-xs text-role-secondary mt-0.5">
                      رصد بازه‌های زمانی، مقایسه همزمان روند جذب و تبدیل به VIP، و سلامت ماندگاری جنگجویان
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleExportComprehensiveCSV('users')}
                    className="surface-z2 hover:bg-surface-elevated text-role-primary border-standard text-xs font-bold px-3 py-1.5 radius-component flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="دانلود فایل اکسل کامل دیتابیس کاربران و رکوردها"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald" />
                    <span>خروجی اکسل کاربران</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExportComprehensiveCSV('subscriptions')}
                    className="surface-z2 hover:bg-surface-elevated text-role-primary border-standard text-xs font-bold px-3 py-1.5 radius-component flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="دانلود فایل اکسل تراکنش‌های مالی و درگاه بانکی"
                  >
                    <CreditCard className="w-3.5 h-3.5 text-amber" />
                    <span>خروجی مالی</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyExecutiveSummary}
                    className="surface-z2 hover:bg-surface-elevated text-role-primary border-standard text-xs font-bold px-3 py-1.5 radius-component flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {isCopiedReport ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald" />
                        <span className="text-emerald">گزارش کپی شد</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-amber" />
                        <span>کپی گزارش خلاصه</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Macro Timeframe Selector Toolbar - Seamless Sub-surface */}
              <div className="surface-z2 radius-component p-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-role-primary flex items-center gap-1.5">
                    <Filter className="w-3.5 h-3.5 text-amber" />
                    <span>انتخاب بازه کلان:</span>
                  </span>
                  <div className="inline-flex surface-z0 radius-component p-0.5">
                    {[
                      { id: '7d', label: '۷ روز' },
                      { id: '30d', label: '۳۰ روز' },
                      { id: '90d', label: '۹۰ روز (فصل)' },
                      { id: '1y', label: '۱ سال' },
                      { id: 'all', label: 'کل تاریخچه' }
                    ].map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setAnalyticsTimeRange(t.id as any);
                          soundFX.playCheck();
                        }}
                        className={`px-2.5 py-1 text-xs font-bold radius-component transition-all cursor-pointer ${
                          analyticsTimeRange === t.id
                            ? 'bg-amber text-canvas-root shadow-subtle'
                            : 'text-role-secondary hover:text-role-primary'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-[11px] text-role-muted flex items-center gap-2">
                  <span>وضعیت فیلتر:</span>
                  <span className="text-role-primary font-bold">
                    {analyticsTimeRange === '7d' && '۷ روز گذشته تا امروز'}
                    {analyticsTimeRange === '30d' && '۳۰ روز اخیر (یک ماهه)'}
                    {analyticsTimeRange === '90d' && '۳ ماهه فصلی اخیر (Quarterly)'}
                    {analyticsTimeRange === '1y' && 'یک سال اخیر (Annual)'}
                    {analyticsTimeRange === 'all' && 'تمام دوران پایگاه داده'}
                  </span>
                </div>
              </div>
            </div>

            {/* Continuous Spline Curved Area Chart: Replaces Old Rectangular Bar Chart & wireframe boxes */}
            <TrendCurvedChart
              buckets={macroAnalytics.buckets}
              windowSignups={macroAnalytics.windowSignups}
              windowVips={macroAnalytics.windowVips}
              windowConversionRate={macroAnalytics.windowConversionRate}
              windowRevenue={macroAnalytics.windowRevenue}
              windowActiveUsers={macroAnalytics.windowActiveUsers}
              windowAOV={macroAnalytics.windowAOV}
              timeRangeLabel={
                analyticsTimeRange === '7d' ? '۷ روز اخیر' :
                analyticsTimeRange === '30d' ? '۳۰ روز اخیر' :
                analyticsTimeRange === '90d' ? '۳ ماه اخیر' :
                analyticsTimeRange === '1y' ? '۱ سال اخیر' : 'تمام دوران'
              }
            />

            {/* Funnel & Cohorts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Conversion Funnel */}
              <div className="surface-z1 border-standard radius-card p-4 sm:p-5 flex flex-col justify-between shadow-subtle space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald" />
                    <h3 className="font-bold text-xs sm:text-sm text-role-primary">قیف تبدیل جامع کاربران (Conversion Funnel)</h3>
                  </div>
                  <span className="text-[11px] text-role-secondary">کل تاریخچه</span>
                </div>

                <div className="space-y-3.5 my-2">
                  {/* Step 1: All Signups */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-role-primary font-medium">۱. ثبت‌نام اولیه</span>
                      <span className="font-mono font-bold text-role-primary">{toPersianDigits(users.length)} (۱۰۰٪)</span>
                    </div>
                    <div className="w-full h-2 surface-z2 radius-component overflow-hidden">
                      <div className="h-full bg-zinc-400 w-full" />
                    </div>
                  </div>

                  {/* Step 2: Engaged */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-role-primary font-medium">۲. شروع نبرد و ثبت رکورد روزانه</span>
                      <span className="font-mono font-bold text-orange">
                        {toPersianDigits(users.filter(u => (u.logsCount || 0) > 0).length)} (
                        {toPersianDigits(
                          users.length > 0
                            ? Math.round((users.filter(u => (u.logsCount || 0) > 0).length / users.length) * 100)
                            : 0
                        )}٪)
                      </span>
                    </div>
                    <div className="w-full h-2 surface-z2 radius-component overflow-hidden">
                      <div 
                        className="h-full bg-orange transition-all duration-500" 
                        style={{
                          width: `${users.length > 0 ? (users.filter(u => (u.logsCount || 0) > 0).length / users.length) * 100 : 0}%`
                        }}
                      />
                    </div>
                  </div>

                  {/* Step 3: VIP Paid */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-role-primary font-medium">۳. ارتقا به عضویت سامورایی VIP</span>
                      <span className="font-mono font-bold text-amber">
                        {toPersianDigits(users.filter(u => u.isVip).length)} (
                        {toPersianDigits(
                          users.length > 0
                            ? ((users.filter(u => u.isVip).length / users.length) * 100).toFixed(1)
                            : 0
                        )}٪)
                      </span>
                    </div>
                    <div className="w-full h-2 surface-z2 radius-component overflow-hidden">
                      <div 
                        className="h-full bg-amber transition-all duration-500" 
                        style={{
                          width: `${users.length > 0 ? (users.filter(u => u.isVip).length / users.length) * 100 : 0}%`
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div className="surface-z2 radius-component p-3 text-[11px] text-role-secondary flex items-center justify-between">
                  <span>کل درآمد انباشته:</span>
                  <span className="font-bold text-emerald font-mono">
                    {formatPersianToman(stats?.totalRevenueToman || 0)}
                  </span>
                </div>
              </div>

              {/* Cohort Lifecycle & Retention */}
              <div className="surface-z1 border-standard radius-card p-4 sm:p-5 flex flex-col justify-between shadow-subtle space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PieChart className="w-4 h-4 text-blue" />
                    <h3 className="font-bold text-xs sm:text-sm text-role-primary">
                      دسته‌بندی چرخه عمر کاربران (Lifecycle Cohorts)
                    </h3>
                  </div>
                  <span className="text-[11px] text-role-secondary">پایداری و بقا</span>
                </div>

                <div className="space-y-3 my-2">
                  {/* Newbies */}
                  <div className="surface-z2 radius-component p-3 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-role-primary block">
                        تازه پیوسته (کمتر از ۷ روز)
                      </span>
                      <span className="text-[11px] text-role-secondary">
                        {toPersianDigits(cohortData.newbies.count)} کاربر ({toPersianDigits(cohortData.newbies.vipCount)} VIP)
                      </span>
                    </div>
                    <div className="text-left">
                      <span className="text-xs font-bold font-mono text-emerald">
                        {toPersianDigits(cohortData.newbies.activeRate)}٪ فعال
                      </span>
                    </div>
                  </div>

                  {/* Settled */}
                  <div className="surface-z2 radius-component p-3 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-role-primary block">
                        مستقر در نبرد (۷ تا ۳۰ روز)
                      </span>
                      <span className="text-[11px] text-role-secondary">
                        {toPersianDigits(cohortData.settled.count)} کاربر ({toPersianDigits(cohortData.settled.vipCount)} VIP)
                      </span>
                    </div>
                    <div className="text-left">
                      <span className="text-xs font-bold font-mono text-amber">
                        {toPersianDigits(cohortData.settled.activeRate)}٪ فعال
                      </span>
                    </div>
                  </div>

                  {/* Veterans */}
                  <div className="surface-z2 radius-component p-3 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-role-primary block">
                        کهنه‌سربازان بوشیدو (بیش از ۳۰ روز)
                      </span>
                      <span className="text-[11px] text-role-secondary">
                        {toPersianDigits(cohortData.veterans.count)} کاربر ({toPersianDigits(cohortData.veterans.vipCount)} VIP)
                      </span>
                    </div>
                    <div className="text-left">
                      <span className="text-xs font-bold font-mono text-orange">
                        {toPersianDigits(cohortData.veterans.activeRate)}٪ فعال
                      </span>
                    </div>
                  </div>
                </div>

                <div className="surface-z2 radius-component p-3 text-[11px] text-role-secondary flex items-center justify-between">
                  <span>شاخص سلامت چسبندگی محصول:</span>
                  <span className="font-bold text-role-primary font-mono">
                    {toPersianDigits(
                      users.length > 0 
                        ? Math.round((users.filter(u => (u.logsCount || 0) >= 3).length / users.length) * 100)
                        : 0
                    )}٪ دارای عادت پایدار (۳+ روز)
                  </span>
                </div>
              </div>
            </div>

            {/* Retention & Product Health Indicators */}
            <div className="surface-z1 border-standard radius-card p-4 sm:p-5 shadow-subtle space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue" />
                  <h3 className="font-bold text-xs sm:text-sm text-role-primary">
                    شاخص‌های ماندگاری و پیشگیری از ریزش (Retention & Churn Indicators)
                  </h3>
                </div>
                <span className="text-[11px] text-role-secondary">پایش وفاداری به نبرد روزانه</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Active Fighters Ratio */}
                <div className="surface-z2 radius-component p-3.5 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs font-bold text-role-primary">
                    <span>جنگجویان فعال (Active Fighters)</span>
                    <Flame className="w-4 h-4 text-orange" />
                  </div>
                  <div className="mt-2.5">
                    <span className="text-xl font-black text-role-primary font-mono">
                      {toPersianDigits(users.filter(u => (u.logsCount || 0) > 0).length)}
                    </span>
                    <span className="text-xs text-role-muted mr-1">کاربر فعال</span>
                    <p className="text-[11px] text-role-secondary mt-0.5">
                      {toPersianDigits(
                        (users.length > 0
                          ? ((users.filter(u => (u.logsCount || 0) > 0).length / users.length) * 100).toFixed(0)
                          : '۰')
                      )}٪ از کل ثبت‌نام‌شدگان
                    </p>
                  </div>
                </div>

                {/* Cycle Completion Health */}
                <div className="surface-z2 radius-component p-3.5 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs font-bold text-role-primary">
                    <span>نرخ استمرار چرخه‌ها</span>
                    <Target className="w-4 h-4 text-emerald" />
                  </div>
                  <div className="mt-2.5">
                    <span className="text-xl font-black text-emerald font-mono">
                      {toPersianDigits(stats?.totalCycles || users.reduce((acc, u) => acc + (u.cyclesCount || 0), 0) || 1)}
                    </span>
                    <span className="text-xs text-emerald mr-1">چرخه نبرد</span>
                    <p className="text-[11px] text-role-secondary mt-0.5">پایگاه تعهدات جنگجویان</p>
                  </div>
                </div>

                {/* Churn Risk */}
                <div className="surface-z2 radius-component p-3.5 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs font-bold text-role-primary">
                    <span>کاربران راکد (Inactivity Pool)</span>
                    <AlertCircle className="w-4 h-4 text-debt" />
                  </div>
                  <div className="mt-2.5">
                    <span className="text-xl font-black text-debt font-mono">
                      {toPersianDigits(users.filter(u => (u.logsCount || 0) === 0).length)}
                    </span>
                    <span className="text-xs text-debt mr-1">نیازمند تشویق</span>
                    <p className="text-[11px] text-role-secondary mt-0.5">بدون ثبت رکورد اولیه نبرد</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUB-TAB 2: USERS MANAGEMENT */}
        {activeSubTab === 'users' && (
          <div className="space-y-4 animate-in fade-in duration-200">
          {/* Create Test User Header Button & Collapsible Form */}
          <div className="surface-z1 border-standard radius-card p-4 shadow-subtle">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm text-role-primary flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-amber" />
                  <span>ایجاد حساب کاربری آزمایشی و تست چندکاربره</span>
                </h3>
                <p className="text-xs text-role-secondary mt-0.5">
                  می‌توانید برای شبیه‌سازی کاربران مختلف (عادی، VIP یا مدیر) حساب جدید ایجاد نمایید و سامانه را از دید آنها بررسی کنید.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsCreateUserOpen(!isCreateUserOpen)}
                className="btn-contract-secondary font-bold text-xs px-4 py-2 radius-component flex items-center gap-2 shrink-0 shadow-subtle focus-ring-tactical"
              >
                <UserPlus className="w-4 h-4" />
                <span>{isCreateUserOpen ? 'بستن فرم ایجاد' : 'ایجاد حساب کاربری تست جدید'}</span>
              </button>
            </div>

            {isCreateUserOpen && (
              <form onSubmit={handleCreateTestUser} className="mt-3 surface-z2 radius-component p-3.5 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 border border-standard/40 shadow-subtle">
                <div>
                  <label className="block text-[11px] font-bold text-role-primary mb-1">نام جنگجو / کاربر</label>
                  <input
                    type="text"
                    required
                    placeholder="مثال: رستم جنگجو"
                    value={newUserName}
                    onChange={e => setNewUserName(e.target.value)}
                    className="w-full surface-z0 border-standard radius-component px-3 py-2 text-xs text-role-primary focus:outline-hidden focus:border-amber"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-role-primary mb-1">ایمیل یا شماره موبایل</label>
                  <input
                    type="text"
                    placeholder="0912... یا test@user.com"
                    value={newUserContact}
                    onChange={e => setNewUserContact(e.target.value)}
                    className="w-full surface-z0 border-standard radius-component px-3 py-2 text-xs text-role-primary focus:outline-hidden focus:border-amber"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-role-primary mb-1">نوع اشتراک اولیه</label>
                  <select
                    value={newUserTier}
                    onChange={e => setNewUserTier(e.target.value as any)}
                    className="w-full surface-z0 border-standard radius-component px-3 py-2 text-xs text-role-primary focus:outline-hidden focus:border-amber cursor-pointer"
                  >
                    <option value="free">رونین عادی (رایگان)</option>
                    <option value="vip_samurai">سامورایی ویژه (VIP)</option>
                  </select>
                </div>

                <div className="flex items-end gap-2">
                  <label className={`flex items-center gap-2 surface-z0 border-standard radius-component px-3 py-2 text-xs text-role-secondary h-[38px] flex-1 ${
                    isCallerSuperAdmin ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'
                  }`}>
                    <input
                      type="checkbox"
                      checked={newUserIsAdmin}
                      disabled={!isCallerSuperAdmin}
                      onChange={e => setNewUserIsAdmin(e.target.checked)}
                      className="accent-amber rounded"
                    />
                    <span className="text-[11px] font-bold">
                      {isCallerSuperAdmin ? 'دسترسی مدیر سامانه (Admin)' : 'دسترسی مدیر (منحصراً توسط سوپر ادمین)'}
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={isCreatingUser}
                    className="btn-contract-primary font-bold text-xs px-4 py-2 radius-component h-[38px] flex items-center justify-center shrink-0 focus-ring-tactical"
                  >
                    {isCreatingUser ? 'در حال ثبت...' : 'ثبت کاربر'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Filter and Search Bar */}
          <div className="surface-z1 border-standard radius-card p-3 sm:p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <input
                type="text"
                placeholder="جستجو با نام، شماره یا ایمیل..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full surface-z0 border-standard radius-component px-9 py-2 text-xs text-role-primary placeholder:text-role-muted focus:outline-hidden focus:border-amber"
              />
              <Search className="w-4 h-4 text-role-muted absolute right-3 top-2.5" />
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => setFilterTier('all')}
                className={`px-3 py-1.5 radius-control text-xs font-bold ${
                  filterTier === 'all' ? 'btn-contract-secondary text-role-primary' : 'btn-contract-ghost text-role-muted'
                }`}
              >
                همه ({toPersianDigits(users.length)})
              </button>
              <button
                onClick={() => setFilterTier('vip')}
                className={`px-3 py-1.5 radius-control text-xs font-bold flex items-center gap-1 ${
                  filterTier === 'vip' ? 'btn-contract-secondary text-amber' : 'btn-contract-ghost text-role-muted'
                }`}
              >
                <Crown className="w-3.5 h-3.5 text-amber" />
                <span>ویژه VIP ({toPersianDigits(users.filter(u => u.isVip).length)})</span>
              </button>
              <button
                onClick={() => setFilterTier('free')}
                className={`px-3 py-1.5 radius-control text-xs font-bold ${
                  filterTier === 'free' ? 'btn-contract-secondary text-role-primary' : 'btn-contract-ghost text-role-muted'
                }`}
              >
                رایگان ({toPersianDigits(users.filter(u => !u.isVip).length)})
              </button>

              <button
                type="button"
                onClick={() => handleExportComprehensiveCSV('users')}
                className="surface-z2 hover:bg-surface-elevated text-role-primary border-standard text-xs font-bold px-3 py-1.5 radius-component flex items-center gap-1.5 transition-colors cursor-pointer mr-auto sm:mr-0"
                title="دانلود فایل اکسل دیتابیس کاربران"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald" />
                <span>خروجی اکسل</span>
              </button>
            </div>
          </div>

          {/* Users Table / Cards */}
          <div className="surface-z1 border-standard radius-card overflow-hidden shadow-subtle">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="surface-z0 text-role-muted border-b border-standard font-bold">
                    <th className="py-3 px-4">کاربر</th>
                    <th className="py-3 px-4">اطلاعات تماس</th>
                    <th className="py-3 px-4">وضعیت اشتراک</th>
                    <th className="py-3 px-4">عملکرد (چرخه/لاگ)</th>
                    <th className="py-3 px-4">انقضای VIP</th>
                    <th className="py-3 px-4 text-center">اقدام مدیریتی / سوییچ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-role-muted">
                        هیچ کاربری با این مشخصات یافت نشد.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map(user => {
                      const isCurrentUser = user.id === currentUser?.id;
                      const isVip = user.isVip;

                      return (
                        <tr key={user.id} className="hover:surface-z2 transition-colors">
                          {/* User Name & ID */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 radius-control surface-z2 border-standard flex items-center justify-center font-bold text-role-secondary">
                                {user.name ? user.name.slice(0, 1) : '武'}
                              </div>
                              <div>
                                <div className="font-bold text-role-primary flex items-center gap-1.5 flex-wrap">
                                  <span>{user.name}</span>
                                  {isCurrentUser && (
                                    <span className="text-[9px] bg-blue-subtle text-blue px-1.5 py-0.2 radius-badge font-mono">
                                      شما
                                    </span>
                                  )}
                                  {user.isSuperAdmin ? (
                                    <span className="text-[9px] bg-amber-subtle text-amber border border-amber/50 px-1.5 py-0.5 radius-badge font-black inline-flex items-center gap-0.5 shadow-subtle">
                                      <span>👑</span>
                                      <span>سوپر ادمین</span>
                                    </span>
                                  ) : user.isAdmin ? (
                                    <span className="text-[9px] bg-debt-subtle text-debt border border-debt-subtle px-1.5 py-0.2 radius-badge font-bold">
                                      مدیر
                                    </span>
                                  ) : null}
                                </div>
                                <span className="text-[10px] text-role-muted font-mono">
                                  {user.id}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Contact Info */}
                          <td className="py-3.5 px-4 font-mono text-role-secondary text-[11px]">
                            {user.phoneNumber || user.email || 'حساب مهمان'}
                          </td>

                          {/* Tier Badge */}
                          <td className="py-3.5 px-4">
                            {isVip ? (
                              <span className="inline-flex items-center gap-1 bg-amber-subtle text-amber border border-amber-subtle px-2.5 py-0.5 radius-badge text-[11px] font-bold">
                                <Crown className="w-3 h-3 text-amber" />
                                <span>سامورایی VIP</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 surface-z2 text-role-muted px-2 py-0.5 radius-badge text-[11px]">
                                <span>رونین (رایگان)</span>
                              </span>
                            )}
                          </td>

                          {/* Cycles & Logs */}
                          <td className="py-3.5 px-4 text-role-secondary font-mono text-[11px]">
                            <span>{toPersianDigits(user.cyclesCount || 0)} چرخه</span>
                            <span className="text-role-muted mx-1">/</span>
                            <span>{toPersianDigits(user.logsCount || 0)} روز</span>
                          </td>

                          {/* VIP Expiry */}
                          <td className="py-3.5 px-4 text-role-muted text-[11px]">
                            {user.vipExpiresAt ? (
                              <span className="text-emerald font-mono">
                                {new Date(user.vipExpiresAt).toLocaleDateString('fa-IR')}
                              </span>
                            ) : (
                              <span className="text-role-muted">—</span>
                            )}
                          </td>

                          {/* Action Controls */}
                          <td className="py-3.5 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              {/* 1. Super Admin Shield: Full Immutability */}
                              {user.isSuperAdmin ? (
                                <span 
                                  className="px-2.5 py-1 radius-control text-[11px] font-bold border border-amber/40 bg-amber-subtle text-amber flex items-center gap-1 select-none"
                                  title="حساب مالک و سوپر ادمین دارای مصونیت کامل است و قابل تغییر، تنزل یا عزل نمی‌باشد."
                                >
                                  <Lock className="w-3 h-3 text-amber" />
                                  <span>مصونیت دائم</span>
                                </span>
                              ) : user.isAdmin ? (
                                /* 2. Admin Accounts: Fully Protected against Non-Super-Admins */
                                !isCallerSuperAdmin ? (
                                  <span 
                                    className="px-2.5 py-1 radius-control text-[11px] font-bold border border-standard surface-z2 text-role-muted flex items-center gap-1.5 select-none"
                                    title="تغییر مشخصات، تنزل یا عزل سایر مدیران منحصراً در صلاحیت سوپر ادمین است."
                                  >
                                    <ShieldAlert className="w-3.5 h-3.5 text-role-muted" />
                                    <span>حفاظت مدیر</span>
                                  </span>
                                ) : (
                                  /* Caller IS Super Admin: Can manage other Admins */
                                  <>
                                    {!isCurrentUser && (
                                      <button
                                        type="button"
                                        onClick={() => handleToggleAdminStatus(user.id, true)}
                                        disabled={isUpdatingUser === user.id}
                                        className="btn-contract-ghost text-autopsy hover:bg-debt-subtle/30 px-2.5 py-1 radius-control text-[11px] font-bold flex items-center gap-1 transition-colors"
                                        title="عزل این کاربر از مدیریت سامانه و بازگردانی به کاربر عادی"
                                      >
                                        <ShieldCheck className="w-3.5 h-3.5 text-autopsy" />
                                        <span>عزل ادمین</span>
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleUpdateUserTier(user.id, 'vip_samurai', 90)}
                                      disabled={isUpdatingUser === user.id}
                                      className="btn-contract-secondary text-amber px-2.5 py-1 radius-control text-[11px] font-bold"
                                      title="تمدید ۹۰ روزه اشتراک"
                                    >
                                      +۹۰ روز
                                    </button>
                                  </>
                                )
                              ) : (
                                /* 3. Regular Users */
                                <>
                                  {/* Super Admin only: Promote regular user to Admin */}
                                  {isCallerSuperAdmin && !isCurrentUser && (
                                    <button
                                      type="button"
                                      onClick={() => handleToggleAdminStatus(user.id, false)}
                                      disabled={isUpdatingUser === user.id}
                                      className="btn-contract-secondary text-role-muted hover:text-role-primary px-2 py-1 radius-control text-[11px] font-bold flex items-center gap-1 transition-colors"
                                      title="ارتقای این کاربر به سطح دسترسی مدیر سامانه (Admin)"
                                    >
                                      <ShieldCheck className="w-3.5 h-3.5 text-role-muted" />
                                      <span>ارتقا ادمین</span>
                                    </button>
                                  )}

                                  {/* Impersonate / Switch View (Only for regular users) */}
                                  {onImpersonateUser && !isCurrentUser && (
                                    <button
                                      type="button"
                                      onClick={() => onImpersonateUser(user)}
                                      className="btn-contract-secondary text-blue px-2.5 py-1 radius-control text-[11px] font-bold flex items-center gap-1 focus-ring-tactical"
                                      title="مشاهده سامانه از دید این کاربر"
                                    >
                                      <Eye className="w-3.5 h-3.5 text-blue" />
                                      <span>دید کاربر</span>
                                    </button>
                                  )}

                                  {/* VIP Controls for Regular Users */}
                                  {isVip ? (
                                    <>
                                      <button
                                        onClick={() => handleUpdateUserTier(user.id, 'vip_samurai', 90)}
                                        disabled={isUpdatingUser === user.id}
                                        className="btn-contract-secondary text-amber px-2.5 py-1 radius-control text-[11px] font-bold"
                                        title="تمدید ۹۰ روزه اشتراک"
                                      >
                                        +۹۰ روز
                                      </button>
                                      <button
                                        onClick={() => handleUpdateUserTier(user.id, 'ronin_free')}
                                        disabled={isUpdatingUser === user.id}
                                        className="btn-contract-danger-ghost px-2 py-1 radius-control text-[11px] font-bold"
                                        title="تنزل به حساب رایگان"
                                      >
                                        تنزل
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => handleUpdateUserTier(user.id, 'vip_samurai', 90)}
                                      disabled={isUpdatingUser === user.id}
                                      className="btn-contract-mastery px-3 py-1 radius-control text-[11px] font-bold shadow-subtle flex items-center gap-1 focus-ring-tactical"
                                    >
                                      <Crown className="w-3 h-3 text-canvas-root" />
                                      <span>ارتقا VIP</span>
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: SUBSCRIPTIONS & TRANSACTIONS AUDIT */}
      {activeSubTab === 'subscriptions' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {/* Financial Key Performance Metrics */}
          {(() => {
            const successfulSubs = subscriptions.filter(s => s.status === 'SUCCESS');
            const totalRev = successfulSubs.reduce((acc, s) => acc + (s.amount || 0), 0);
            const successRate = subscriptions.length > 0 ? Math.round((successfulSubs.length / subscriptions.length) * 100) : 100;
            const avgTicket = successfulSubs.length > 0 ? Math.round(totalRev / successfulSubs.length) : 0;

            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="surface-z1 border-standard radius-card p-4 flex flex-col justify-between shadow-subtle">
                  <div className="flex items-center justify-between text-xs text-role-secondary">
                    <span>مجموع درآمد واریزی</span>
                    <Coins className="w-4 h-4 text-emerald" />
                  </div>
                  <div className="mt-3">
                    <span className="text-xl sm:text-2xl font-black text-emerald font-mono">
                      {toPersianDigits(totalRev.toLocaleString('fa-IR'))}
                    </span>
                    <span className="text-xs text-role-muted mr-1.5">تومان</span>
                  </div>
                </div>

                <div className="surface-z1 border-standard radius-card p-4 flex flex-col justify-between shadow-subtle">
                  <div className="flex items-center justify-between text-xs text-role-secondary">
                    <span>تراکنش‌های موفق</span>
                    <CheckCircle2 className="w-4 h-4 text-amber" />
                  </div>
                  <div className="mt-3">
                    <span className="text-xl sm:text-2xl font-black text-role-primary font-mono">
                      {toPersianDigits(successfulSubs.length)}
                    </span>
                    <span className="text-xs text-role-muted mr-1.5">از {toPersianDigits(subscriptions.length)} تراکنش</span>
                  </div>
                </div>

                <div className="surface-z1 border-standard radius-card p-4 flex flex-col justify-between shadow-subtle">
                  <div className="flex items-center justify-between text-xs text-role-secondary">
                    <span>نرخ موفقیت درگاه</span>
                    <Activity className="w-4 h-4 text-blue" />
                  </div>
                  <div className="mt-3">
                    <span className="text-xl sm:text-2xl font-black text-blue font-mono">
                      {toPersianDigits(successRate)}٪
                    </span>
                    <span className="text-xs text-role-muted mr-1.5">پرداخت موفق</span>
                  </div>
                </div>

                <div className="surface-z1 border-standard radius-card p-4 flex flex-col justify-between shadow-subtle">
                  <div className="flex items-center justify-between text-xs text-role-secondary">
                    <span>میانگین ارزش سفارش</span>
                    <CreditCard className="w-4 h-4 text-orange" />
                  </div>
                  <div className="mt-3">
                    <span className="text-xl sm:text-2xl font-black text-role-primary font-mono">
                      {toPersianDigits(avgTicket.toLocaleString('fa-IR'))}
                    </span>
                    <span className="text-xs text-role-muted mr-1.5">تومان</span>
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="surface-z1 border-standard radius-card overflow-hidden shadow-subtle">
            <div className="p-4 surface-z0 border-b border-standard flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <span className="font-bold text-xs text-role-primary block">
                  گزارش تراکنش‌های درگاه پرداخت (زرین‌پال / شاپرک)
                </span>
                <span className="text-[11px] text-role-muted font-mono mt-0.5 block">
                  {toPersianDigits(subscriptions.length)} تراکنش ثبت‌شده در پایگاه داده
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleExportComprehensiveCSV('subscriptions')}
                className="surface-z2 hover:bg-surface-elevated text-role-primary border-standard text-xs font-bold px-3 py-1.5 radius-component flex items-center gap-1.5 transition-colors cursor-pointer"
                title="دانلود فایل اکسل تراکنش‌های مالی"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald" />
                <span>خروجی اکسل تراکنش‌ها</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="surface-z0 text-role-muted border-b border-standard font-bold">
                    <th className="py-3 px-4">شناسه تراکنش (Authority)</th>
                    <th className="py-3 px-4">کد پیگیری بانکی (RefId)</th>
                    <th className="py-3 px-4">مبلغ (تومان)</th>
                    <th className="py-3 px-4">طرح اشتراک</th>
                    <th className="py-3 px-4">شماره کارت</th>
                    <th className="py-3 px-4">وضعیت</th>
                    <th className="py-3 px-4">تاریخ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)] font-mono">
                  {subscriptions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-role-muted font-sans">
                        هنوز تراکنشی در سیستم ثبت نشده است. با خرید اشتراک در سامانه، گزارش تراکنش در اینجا درج می‌شود.
                      </td>
                    </tr>
                  ) : (
                    subscriptions.map(sub => (
                      <tr key={sub.id} className="hover:surface-z2 transition-colors">
                        <td className="py-3.5 px-4 text-amber font-bold text-[11px]">
                          {sub.authority}
                        </td>
                        <td className="py-3.5 px-4 text-role-secondary text-[11px]">
                          {sub.refId || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-emerald font-bold text-[11px]">
                          {toPersianDigits(sub.amount.toLocaleString())} تومان
                        </td>
                        <td className="py-3.5 px-4 text-role-secondary font-sans text-[11px]">
                          {sub.planId === 'samurai_annual' ? 'سالانه دلاوران' : 'فصل ۹۰ روزه VIP'}
                        </td>
                        <td className="py-3.5 px-4 text-role-muted text-[11px]">
                          {sub.cardPan || '—'}
                        </td>
                        <td className="py-3.5 px-4">
                          {sub.status === 'SUCCESS' ? (
                            <span className="inline-flex items-center gap-1 bg-emerald-subtle text-emerald border border-emerald-subtle px-2 py-0.5 radius-badge text-[10px] font-sans font-bold">
                              <CheckCircle2 className="w-3 h-3 text-emerald" />
                              موفق
                            </span>
                          ) : sub.status === 'FAILED' ? (
                            <span className="inline-flex items-center gap-1 bg-debt-subtle text-debt border border-debt-subtle px-2 py-0.5 radius-badge text-[10px] font-sans font-bold">
                              <AlertCircle className="w-3 h-3 text-debt" />
                              ناموفق
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 bg-amber-subtle text-amber border border-amber-subtle px-2 py-0.5 radius-badge text-[10px] font-sans font-bold">
                              <Clock className="w-3 h-3 text-amber" />
                              در انتظار تایید
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-role-muted text-[11px] font-sans">
                          {new Date(sub.createdAt).toLocaleDateString('fa-IR')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Diagnostic & Infrastructure Footer Bar */}
      <div className="surface-z0 border-standard radius-card p-3 sm:p-4 text-xs flex flex-col sm:flex-row items-center justify-between gap-3 text-role-muted">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 text-emerald" />
            <span>پایگاه داده:</span>
            <span className="font-mono text-role-primary font-bold">{stats?.databaseMode || 'PostgreSQL'}</span>
          </div>
          <span className="text-role-muted">•</span>
          <div className="flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-amber" />
            <span>احراز هویت:</span>
            <span className="font-mono text-role-primary">JWT + OTP</span>
          </div>
        </div>

        <div className="text-[11px] text-role-muted">
          سیستم مدیریت هوشمند دیسیپلین بوشیدو • نگارش ۱.۰.۱
        </div>
      </div>

    </div>
  );
};
