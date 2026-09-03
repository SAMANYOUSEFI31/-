import React, { useState, useEffect } from 'react';
import { 
  AdminUserItem, 
  AdminSubscriptionItem, 
  AdminOverviewStats, 
  UserProfile 
} from '../types';
import { toPersianDigits, formatPersianToman } from '../utils/numberUtils';
import { soundFX } from '../utils/audioEffects';
import { safeGetLocalStorage } from '../utils/storageUtils';
import { ResponsiveSubTabBar, SubTabItem } from './ResponsiveSubTabBar';
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
  ChevronDown,
  Sparkles,
  Server,
  UserPlus,
  Eye,
  User
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
  const [activeSubTab, setActiveSubTab] = useState<'users' | 'subscriptions' | 'gateway'>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTier, setFilterTier] = useState<'all' | 'vip' | 'free'>('all');
  const [isUpdatingUser, setIsUpdatingUser] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // New Test User Form state
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserContact, setNewUserContact] = useState('');
  const [newUserTier, setNewUserTier] = useState<'free' | 'vip_samurai'>('free');
  const [newUserIsAdmin, setNewUserIsAdmin] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  type AdminSubTab = 'users' | 'subscriptions' | 'gateway';
  const ADMIN_SUB_TABS: SubTabItem<AdminSubTab>[] = [
    {
      id: 'users',
      label: `مدیریت کاربران (${toPersianDigits(users.length)})`,
      shortLabel: `کاربران (${toPersianDigits(users.length)})`,
      icon: Users,
      activeColor: 'text-amber-400'
    },
    {
      id: 'subscriptions',
      label: `تراکنش‌ها (${toPersianDigits(subscriptions.length)})`,
      shortLabel: `تراکنش (${toPersianDigits(subscriptions.length)})`,
      icon: CreditCard,
      activeColor: 'text-emerald-400'
    },
    {
      id: 'gateway',
      label: 'تنظیمات زرین‌پال و دیتابیس',
      shortLabel: 'درگاه و سرور',
      icon: Zap,
      activeColor: 'text-rose-400'
    }
  ];

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
      }
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setUsers(usersData.users || []);
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

      if (res.ok) {
        soundFX.playCheck();
        setActionMessage(`وضعیت کاربر با موفقیت به ${isVip ? 'سامورایی ویژه VIP' : 'کاربر عادی'} تغییر یافت.`);
        await fetchAdminData();
        if (onRefreshUserProfile) {
          onRefreshUserProfile();
        }
      } else {
        setActionMessage('خطا در به‌روزرسانی وضعیت کاربر.');
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

      const data = await res.json();
      if (res.ok) {
        soundFX.playCheck();
        setActionMessage(`نقش کاربری با موفقیت به ${newAdminStatus ? 'مدیر سامانه (Admin)' : 'کاربر عادی'} تغییر یافت.`);
        await fetchAdminData();
        if (onRefreshUserProfile) {
          onRefreshUserProfile();
        }
      } else {
        setActionMessage(data.error || 'خطا در تغییر سطح دسترسی کاربر.');
      }
    } catch (err) {
      console.error('Admin toggle status error:', err);
      setActionMessage('خطا در ارتباط با سرور.');
    } finally {
      setIsUpdatingUser(null);
    }
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
      <div className="bg-[#121215]/90 border border-zinc-800 rounded-3xl p-5 sm:p-7 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-zinc-800/90 border border-zinc-700/80 flex items-center justify-center text-zinc-200 shadow-md">
              <ShieldCheck className="w-6 h-6 text-zinc-200" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-zinc-100 tracking-tight">
                  قرارگاه فرماندهی و مدیریت سامورایی‌ها
                </h1>
                <span className="bg-zinc-800 text-zinc-300 border border-zinc-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  پنل ادمین
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                نظارت بر حساب‌ها، چرخه‌ها، مدیریت اشتراک‌های VIP و درگاه پرداخت زرین‌پال
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            {onBack && (
              <button
                onClick={onBack}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border border-zinc-700"
              >
                <span>بازگشت به تنظیمات</span>
              </button>
            )}
            <div className="bg-zinc-950 border border-zinc-800 px-3 py-1.5 rounded-xl text-xs flex items-center gap-2 text-zinc-300">
              <Server className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[11px] font-mono text-emerald-400">
                {stats?.databaseMode || 'PostgreSQL'}
              </span>
            </div>
            <button
              onClick={fetchAdminData}
              disabled={isLoading}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border border-zinc-700"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>به‌روزرسانی</span>
            </button>
          </div>
        </div>
      </div>

      {/* Action Notification Message */}
      {actionMessage && (
        <div className="bg-amber-950/60 border border-amber-500/40 text-amber-300 px-4 py-3 rounded-2xl text-xs flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{actionMessage}</span>
          </div>
          <button 
            onClick={() => setActionMessage(null)}
            className="text-amber-400/80 hover:text-amber-300 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Overview Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Users */}
        <div className="bg-[#121215]/80 border border-zinc-800/90 rounded-2xl p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span>کل جنگجویان ثبت‌شده</span>
            <Users className="w-4 h-4 text-zinc-400" />
          </div>
          <div className="mt-3">
            <span className="text-2xl sm:text-3xl font-black text-zinc-100 font-mono">
              {toPersianDigits(stats?.totalUsers || users.length || 1)}
            </span>
            <span className="text-xs text-zinc-400 mr-1.5">کاربر</span>
          </div>
        </div>

        {/* Total VIPs */}
        <div className="bg-[#121215]/80 border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-300 text-xs font-bold">
            <span>اشتراک‌های فعال VIP</span>
            <Crown className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-3">
            <span className="text-2xl sm:text-3xl font-black text-amber-400 font-mono">
              {toPersianDigits(stats?.totalVipUsers || users.filter(u => u.isVip).length || 0)}
            </span>
            <span className="text-xs text-amber-300/80 mr-1.5">سامورایی VIP</span>
          </div>
        </div>

        {/* Revenue */}
        <div className="bg-[#121215]/80 border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-300 text-xs font-bold">
            <span>درآمد کل اشتراک‌ها</span>
            <CreditCard className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-3">
            <span className="text-xl sm:text-2xl font-black text-emerald-300 font-mono">
              {formatPersianToman(stats?.totalRevenueToman || 0)}
            </span>
          </div>
        </div>

        {/* Cycles & Logs */}
        <div className="bg-[#121215]/80 border border-zinc-800/90 rounded-2xl p-4 sm:p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span>چرخه‌ها و روزهای ثبت‌شده</span>
            <Database className="w-4 h-4 text-zinc-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-black text-zinc-100 font-mono">
              {toPersianDigits(stats?.totalCycles || 1)}
            </span>
            <span className="text-xs text-zinc-400">چرخه /</span>
            <span className="text-lg font-bold text-zinc-300 font-mono">
              {toPersianDigits(stats?.totalDailyLogs || 25)}
            </span>
            <span className="text-[11px] text-zinc-400">روز نبرد</span>
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

      {/* SUB-TAB 1: USERS MANAGEMENT */}
      {activeSubTab === 'users' && (
        <div className="space-y-4">
          {/* Create Test User Header Button & Collapsible Form */}
          <div className="bg-[#121215]/90 border border-zinc-800 rounded-2xl p-4 shadow-lg">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm text-zinc-100 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-amber-400" />
                  <span>ایجاد حساب کاربری آزمایشی و تست چندکاربره</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  می‌توانید برای شبیه‌سازی کاربران مختلف (عادی، VIP یا مدیر) حساب جدید ایجاد نمایید و سامانه را از دید آنها بررسی کنید.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsCreateUserOpen(!isCreateUserOpen)}
                className="bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer flex items-center gap-2 shrink-0 shadow-md shadow-amber-500/20"
              >
                <UserPlus className="w-4 h-4" />
                <span>{isCreateUserOpen ? 'بستن فرم ایجاد' : 'ایجاد حساب کاربری تست جدید'}</span>
              </button>
            </div>

            {isCreateUserOpen && (
              <form onSubmit={handleCreateTestUser} className="mt-4 pt-4 border-t border-zinc-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-300 mb-1">نام جنگجو / کاربر</label>
                  <input
                    type="text"
                    required
                    placeholder="مثال: رستم جنگجو"
                    value={newUserName}
                    onChange={e => setNewUserName(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:outline-hidden focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-zinc-300 mb-1">ایمیل یا شماره موبایل</label>
                  <input
                    type="text"
                    placeholder="0912... یا test@user.com"
                    value={newUserContact}
                    onChange={e => setNewUserContact(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:outline-hidden focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-zinc-300 mb-1">نوع اشتراک اولیه</label>
                  <select
                    value={newUserTier}
                    onChange={e => setNewUserTier(e.target.value as any)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:outline-hidden focus:border-amber-500 cursor-pointer"
                  >
                    <option value="free">رونین عادی (رایگان)</option>
                    <option value="vip_samurai">سامورایی ویژه (VIP)</option>
                  </select>
                </div>

                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-2 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-zinc-300 cursor-pointer h-[38px] flex-1">
                    <input
                      type="checkbox"
                      checked={newUserIsAdmin}
                      onChange={e => setNewUserIsAdmin(e.target.checked)}
                      className="accent-amber-500 rounded"
                    />
                    <span className="text-[11px] font-bold">دسترسی مدیر (Admin)</span>
                  </label>

                  <button
                    type="submit"
                    disabled={isCreatingUser}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer h-[38px] flex items-center justify-center shrink-0 disabled:opacity-50"
                  >
                    {isCreatingUser ? 'در حال ثبت...' : 'ثبت کاربر'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Filter and Search Bar */}
          <div className="bg-[#121215]/80 border border-zinc-800 rounded-2xl p-3 sm:p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <input
                type="text"
                placeholder="جستجو با نام، شماره یا ایمیل..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-9 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-hidden focus:border-amber-500"
              />
              <Search className="w-4 h-4 text-zinc-400 absolute right-3 top-2.5" />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => setFilterTier('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  filterTier === 'all' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                همه ({toPersianDigits(users.length)})
              </button>
              <button
                onClick={() => setFilterTier('vip')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
                  filterTier === 'vip' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Crown className="w-3.5 h-3.5 text-amber-400" />
                <span>ویژه VIP ({toPersianDigits(users.filter(u => u.isVip).length)})</span>
              </button>
              <button
                onClick={() => setFilterTier('free')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  filterTier === 'free' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                رایگان ({toPersianDigits(users.filter(u => !u.isVip).length)})
              </button>
            </div>
          </div>

          {/* Users Table / Cards */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-[#09090b]/80 text-zinc-400 border-b border-zinc-800 font-bold">
                    <th className="py-3 px-4">کاربر</th>
                    <th className="py-3 px-4">اطلاعات تماس</th>
                    <th className="py-3 px-4">وضعیت اشتراک</th>
                    <th className="py-3 px-4">عملکرد (چرخه/لاگ)</th>
                    <th className="py-3 px-4">انقضای VIP</th>
                    <th className="py-3 px-4 text-center">اقدام مدیریتی / سوییچ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-zinc-500">
                        هیچ کاربری با این مشخصات یافت نشد.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map(user => {
                      const isCurrentUser = user.id === currentUser?.id;
                      const isVip = user.isVip;

                      return (
                        <tr key={user.id} className="hover:bg-zinc-800/40 transition-colors">
                          {/* User Name & ID */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center font-bold text-zinc-300">
                                {user.name ? user.name.slice(0, 1) : '武'}
                              </div>
                              <div>
                                <div className="font-bold text-zinc-200 flex items-center gap-1.5">
                                  <span>{user.name}</span>
                                  {isCurrentUser && (
                                    <span className="text-[9px] bg-sky-500/20 text-sky-400 px-1.5 py-0.2 rounded font-mono">
                                      شما
                                    </span>
                                  )}
                                  {user.isAdmin && (
                                    <span className="text-[9px] bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.2 rounded font-bold">
                                      مدیر
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-zinc-500 font-mono">
                                  {user.id}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Contact Info */}
                          <td className="py-3.5 px-4 font-mono text-zinc-300 text-[11px]">
                            {user.phoneNumber || user.email || 'حساب مهمان'}
                          </td>

                          {/* Tier Badge */}
                          <td className="py-3.5 px-4">
                            {isVip ? (
                              <span className="inline-flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2.5 py-0.5 rounded-full text-[11px] font-bold shadow-xs">
                                <Crown className="w-3 h-3 text-amber-400" />
                                <span>سامورایی VIP</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full text-[11px]">
                                <span>رونین (رایگان)</span>
                              </span>
                            )}
                          </td>

                          {/* Cycles & Logs */}
                          <td className="py-3.5 px-4 text-zinc-300 font-mono text-[11px]">
                            <span>{toPersianDigits(user.cyclesCount || 0)} چرخه</span>
                            <span className="text-zinc-500 mx-1">/</span>
                            <span>{toPersianDigits(user.logsCount || 0)} روز</span>
                          </td>

                          {/* VIP Expiry */}
                          <td className="py-3.5 px-4 text-zinc-400 text-[11px]">
                            {user.vipExpiresAt ? (
                              <span className="text-emerald-400 font-mono">
                                {new Date(user.vipExpiresAt).toLocaleDateString('fa-IR')}
                              </span>
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )}
                          </td>

                          {/* Action Controls */}
                          <td className="py-3.5 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {/* Toggle Admin Privilege Button */}
                              {(!isCurrentUser && user.email !== 'admin@bushido.app' && user.phoneNumber !== '09375454050') && (
                                <button
                                  type="button"
                                  onClick={() => handleToggleAdminStatus(user.id, !!user.isAdmin)}
                                  disabled={isUpdatingUser === user.id}
                                  className={`px-2 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer flex items-center gap-1 border ${
                                    user.isAdmin 
                                      ? 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border-purple-500/40' 
                                      : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 border-zinc-700 hover:text-zinc-200'
                                  }`}
                                  title={user.isAdmin ? 'عزل از مدیریت سامانه' : 'ارتقا به مدیر سامانه'}
                                >
                                  <ShieldCheck className={`w-3.5 h-3.5 ${user.isAdmin ? 'text-purple-400' : 'text-zinc-500'}`} />
                                  <span>{user.isAdmin ? 'عزل ادمین' : 'ارتقا ادمین'}</span>
                                </button>
                              )}

                              {/* Impersonate / Switch View Button */}
                              {onImpersonateUser && !isCurrentUser && (
                                <button
                                  type="button"
                                  onClick={() => onImpersonateUser(user)}
                                  className="bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer flex items-center gap-1"
                                  title="مشاهده سامانه از دید این کاربر"
                                >
                                  <Eye className="w-3.5 h-3.5 text-sky-400" />
                                  <span>دید کاربر</span>
                                </button>
                              )}

                              {isVip ? (
                                <>
                                  <button
                                    onClick={() => handleUpdateUserTier(user.id, 'vip_samurai', 90)}
                                    disabled={isUpdatingUser === user.id}
                                    className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer"
                                    title="تمدید ۹۰ روزه اشتراک"
                                  >
                                    +۹۰ روز
                                  </button>
                                  <button
                                    onClick={() => handleUpdateUserTier(user.id, 'ronin_free')}
                                    disabled={isUpdatingUser === user.id}
                                    className="bg-zinc-800 hover:bg-red-950/60 hover:text-red-300 hover:border-red-500/40 text-zinc-400 border border-zinc-700 px-2 py-1 rounded-lg text-[11px] transition cursor-pointer"
                                    title="تنزل به حساب رایگان"
                                  >
                                    تنزل
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => handleUpdateUserTier(user.id, 'vip_samurai', 90)}
                                  disabled={isUpdatingUser === user.id}
                                  className="bg-amber-500 hover:bg-amber-400 text-black font-black px-3 py-1 rounded-lg text-[11px] transition cursor-pointer shadow-sm flex items-center gap-1"
                                >
                                  <Crown className="w-3 h-3" />
                                  <span>ارتقا VIP</span>
                                </button>
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

      {/* SUB-TAB 2: SUBSCRIPTIONS & TRANSACTIONS AUDIT */}
      {activeSubTab === 'subscriptions' && (
        <div className="space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 bg-[#09090b]/80 border-b border-zinc-800 flex items-center justify-between">
              <span className="font-bold text-xs text-zinc-200">
                گزارش تراکنش‌های درگاه پرداخت (زرین‌پال / شاپرک)
              </span>
              <span className="text-[11px] text-zinc-400 font-mono">
                {toPersianDigits(subscriptions.length)} تراکنش ثبت‌شده
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-zinc-950 text-zinc-400 border-b border-zinc-800 font-bold">
                    <th className="py-3 px-4">شناسه تراکنش (Authority)</th>
                    <th className="py-3 px-4">کد پیگیری بانکی (RefId)</th>
                    <th className="py-3 px-4">مبلغ (تومان)</th>
                    <th className="py-3 px-4">طرح اشتراک</th>
                    <th className="py-3 px-4">شماره کارت</th>
                    <th className="py-3 px-4">وضعیت</th>
                    <th className="py-3 px-4">تاریخ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-mono">
                  {subscriptions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-zinc-500 font-sans">
                        هنوز تراکنشی در سیستم ثبت نشده است. با خرید اشتراک در سامانه، گزارش تراکنش در اینجا درج می‌شود.
                      </td>
                    </tr>
                  ) : (
                    subscriptions.map(sub => (
                      <tr key={sub.id} className="hover:bg-zinc-800/40 transition-colors">
                        <td className="py-3.5 px-4 text-amber-400 font-bold text-[11px]">
                          {sub.authority}
                        </td>
                        <td className="py-3.5 px-4 text-zinc-300 text-[11px]">
                          {sub.refId || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-emerald-400 font-bold text-[11px]">
                          {toPersianDigits(sub.amount.toLocaleString())} تومان
                        </td>
                        <td className="py-3.5 px-4 text-zinc-300 font-sans text-[11px]">
                          {sub.planId === 'samurai_annual' ? 'سالانه دلاوران' : 'فصل ۹۰ روزه VIP'}
                        </td>
                        <td className="py-3.5 px-4 text-zinc-400 text-[11px]">
                          {sub.cardPan || '—'}
                        </td>
                        <td className="py-3.5 px-4">
                          {sub.status === 'SUCCESS' ? (
                            <span className="inline-flex items-center gap-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full text-[10px] font-sans font-bold">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              موفق
                            </span>
                          ) : sub.status === 'FAILED' ? (
                            <span className="inline-flex items-center gap-1 bg-red-500/20 text-red-300 border border-red-500/30 px-2 py-0.5 rounded-full text-[10px] font-sans font-bold">
                              <AlertCircle className="w-3 h-3 text-red-400" />
                              ناموفق
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full text-[10px] font-sans font-bold">
                              <Clock className="w-3 h-3 text-amber-400" />
                              در انتظار تایید
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-zinc-400 text-[11px] font-sans">
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

      {/* SUB-TAB 3: GATEWAY & DB SETTINGS */}
      {activeSubTab === 'gateway' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Zarinpal Config Card */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
              <Zap className="w-5 h-5 text-amber-400" />
              <h2>پیکربندی درگاه پرداخت زرین‌پال (Zarinpal)</h2>
            </div>
            
            <p className="text-xs text-zinc-400 leading-relaxed">
              سیستم دیسیپلین بوشیدو مجهز به ماژول یکپارچه اتصال به شاپرک و درگاه زرین‌پال است. در حالت توسعه و تست محلی، شبیه‌ساز امن شاپرک به صورت داخلی و بدون نیاز به اینترنت فعال است.
            </p>

            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-zinc-400">وضعیت درگاه:</span>
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  آماده پذیرش تراکنش
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-400">حالت فعال:</span>
                <span className="text-amber-300 font-mono">Mock Gateway Simulator / Sandbox</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-400">فعال‌سازی درگاه واقعی:</span>
                <span className="text-zinc-300 font-mono text-[11px]">ZARINPAL_MERCHANT_ID در .env</span>
              </div>
            </div>

            <div className="text-[11px] text-zinc-500 leading-relaxed bg-[#09090b]/40 p-3 rounded-xl border border-zinc-800/60">
              💡 برای اتصال به درگاه واقعی پذیرنده زرین‌پال، کافیست شناسه مرچنت کد ۳۶ رقمی خود را در فایل <code className="text-amber-400">.env</code> در متغیر <code className="text-amber-400">ZARINPAL_MERCHANT_ID</code> قرار دهید.
            </div>
          </div>

          {/* Database & Architecture Card */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center gap-2 text-sky-400 font-bold text-sm">
              <Database className="w-5 h-5 text-sky-400" />
              <h2>پایگاه داده و معماری ذخیره‌سازی (PostgreSQL + Prisma)</h2>
            </div>
            
            <p className="text-xs text-zinc-400 leading-relaxed">
              لایه‌ی ذخیره‌سازی بوشیدو از معماری Dual-Engine بهره می‌برد؛ اتصال همزمان به PostgreSQL از طریق Prisma ORM و مکانیزم خودکار Fallback به ذخیره‌ساز ماندگار فایل محلی JSON.
            </p>

            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-zinc-400">موتور فعال پایگاه داده:</span>
                <span className="text-sky-300 font-mono font-bold">
                  {stats?.databaseMode || 'PostgreSQL (Prisma ORM)'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-400">احراز هویت:</span>
                <span className="text-purple-300 font-mono">JSON Web Tokens (JWT) + OTP</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-400">سقف چرخه‌ها:</span>
                <span className="text-zinc-300">رایگان (۱ چرخه) | ویژه VIP (نامحدود)</span>
              </div>
            </div>

            <div className="text-[11px] text-zinc-500 leading-relaxed bg-[#09090b]/40 p-3 rounded-xl border border-zinc-800/60">
              ⚡ در صورت اجرای پروژه در VS Code، با دستور <code className="text-sky-400">npx prisma db push</code> جداول روی دیتابیس PostgreSQL شما همگام‌سازی می‌شوند.
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
