import React, { useState } from 'react';
import {
  LayoutDashboard,
  TrendingUp,
  ShoppingCart,
  LineChart,
  BookOpen,
  Users,
  Plus,
  ChevronDown,
  Monitor,
  Activity,
  FileText,
  CreditCard,
  PieChart,
  ShieldAlert,
  Wallet,
  Briefcase,
  Zap,
  Menu,
  X,
  Store,
  Calendar,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Settings,
  Bot,
  Globe,
  Sparkles,
  RefreshCw,
  Truck
} from 'lucide-react';
import LedgeroLogo from '../Shared/LedgeroLogo';

const navModules = [
  {
    key: 'hub',
    label: 'Dashboard',
    bnLabel: 'ড্যাশবোর্ড',
    icon: <LayoutDashboard size={15} />,
    items: [
      { key: 'main_dashboard', label: 'Main Business Dashboard', bnLabel: 'মূল ড্যাশবোর্ড', icon: <Monitor size={16} /> },
      { key: 'online_orders', label: 'Online Orders & Courier', bnLabel: 'অনলাইন অর্ডার ও কুরিয়ার', icon: <Truck size={16} /> },
      { key: 'daily_cash', label: 'Daily Cash Summary', bnLabel: 'দৈনিক ক্যাশ সামারি', icon: <Wallet size={16} /> },
      { key: 'recurring_expenses', label: 'Monthly Recurring Expenses', bnLabel: 'মাসিক নির্ধারিত খরচ', icon: <RefreshCw size={16} /> },
      { key: 'multi_biz', label: 'Multi-Business Manager', bnLabel: 'মাল্টি-বিজনেস ম্যানেজার', icon: <Briefcase size={16} /> },
    ]
  },
  {
    key: 'sales',
    label: 'Sales',
    bnLabel: 'বিক্রি',
    icon: <TrendingUp size={15} />,
    items: [
      { key: 'online_orders', label: 'Online Orders & Courier Tracking', bnLabel: '🚚 অনলাইন অর্ডার ও কুরিয়ার', icon: <Truck size={16} /> },
      { key: 'sales_pipeline', label: 'Sales Pipeline & Performance', bnLabel: 'সেলস পাইপলাইন', icon: <Activity size={16} /> },
      { key: 'invoices', label: 'Invoices & POS Receipts', bnLabel: 'ইনভয়েস ও রসিদ', shortcut: 'Alt + I', icon: <FileText size={16} /> },
      { key: 'customer_due', label: 'Customer Due Khata', bnLabel: 'গ্রাহক বাকি', icon: <Users size={16} /> },
      { key: 'catalog', label: 'Price List & Catalog', bnLabel: 'মূল্যতালিকা', icon: <BookOpen size={16} /> },
    ]
  },
  {
    key: 'purchases',
    label: 'Purchases',
    bnLabel: 'ক্রয়',
    icon: <ShoppingCart size={15} />,
    items: [
      { key: 'bills_payables', label: 'Bills to Pay & Payables Pipeline', bnLabel: 'প্রদেয় বিল', shortcut: 'Alt + B', icon: <CreditCard size={16} /> },
      { key: 'supplier_due', label: 'Supplier Due Khata', bnLabel: 'মহাজন বাকি', icon: <Users size={16} /> },
      { key: 'purchase_orders', label: 'Purchase Orders', bnLabel: 'পারচেজ অর্ডার', icon: <FileText size={16} /> },
      { key: 'expense_claims', label: 'Expense Claim Manager', bnLabel: 'খরচ দাবি', icon: <FileText size={16} /> },
    ]
  },
  {
    key: 'analytics',
    label: 'Analytics',
    bnLabel: 'অ্যানালিটিক্স',
    icon: <LineChart size={15} />,
    items: [
      { key: 'ai_agent', label: 'NAM AI Financial Assistant', bnLabel: 'NAM (নাম) এআই সহকারী', shortcut: 'Alt + A', icon: <Bot size={16} /> },
      { key: 'cash_flow', label: 'Cash Flow Manager', bnLabel: 'ক্যাশ ফ্লো টাইমলাইন', icon: <LineChart size={16} /> },
      { key: 'health_scorecards', label: 'Business Health Scorecards (14 KPIs)', bnLabel: '১৪টি KPI', icon: <PieChart size={16} /> },
      { key: 'virtual_cfo', label: 'Virtual CFO Commentary', bnLabel: 'এআই অডিট ও পরামর্শ', icon: <Zap size={16} /> },
      { key: 'standard_reports', label: 'Standard Financial Reports', bnLabel: 'স্ট্যান্ডার্ড রিপোর্ট', icon: <FileText size={16} /> },
    ]
  },
  {
    key: 'accounting',
    label: 'Accounting',
    bnLabel: 'অ্যাকাউন্টিং',
    icon: <BookOpen size={15} />,
    items: [
      { key: 'bank_rec', label: 'Bank Reconciliation', bnLabel: 'ব্যাংক সমন্বয়', icon: <CreditCard size={16} /> },
      { key: 'manual_journal', label: 'Manual Journal Entry', bnLabel: 'ম্যানুয়াল জার্নাল', shortcut: 'Alt + J', icon: <FileText size={16} /> },
      { key: 'fixed_assets', label: 'Fixed Assets Register (IAS 16)', bnLabel: 'স্থায়ী সম্পদ', icon: <Briefcase size={16} /> },
      { key: 'stock_audit', label: 'Physical Stock Audit (IAS 2)', bnLabel: 'স্টক অডিট', icon: <ShieldAlert size={16} /> },
      { key: 'period_lock', label: 'Period Lock & Fiscal Year Close', bnLabel: 'অর্থবছর বন্ধ', icon: <ShieldAlert size={16} /> },
    ]
  },
  {
    key: 'contacts',
    label: 'Contacts',
    bnLabel: 'যোগাযোগ',
    icon: <Users size={15} />,
    items: [
      { key: 'all_contacts', label: 'All Contacts Directory', bnLabel: 'সব যোগাযোগ', icon: <Users size={16} /> },
      { key: 'customers', label: 'Customer Accounts', bnLabel: 'গ্রাহক অ্যাকাউন্ট', icon: <Users size={16} /> },
      { key: 'suppliers', label: 'Supplier Accounts', bnLabel: 'সরবরাহকারী অ্যাকাউন্ট', icon: <Users size={16} /> },
      { key: 'payroll', label: 'Staff Payroll & Salary Slips', bnLabel: 'পে-রোল ও বেতনের স্লিপ', icon: <FileText size={16} /> },
    ]
  }
];

export default function AdvancedMegaNavbar({
  lang = 'bn',
  onToggleLang = () => {},
  activeBiz,
  onOpenBizModal = () => {},
  appMode = 'advanced',
  onToggleAppMode = () => {},
  dateKey,
  onPrevDay = () => {},
  onNextDay = () => {},
  onPickDate = () => {},
  onSelectScreen = () => {},
  onOpenQuickAction = () => {},
  isDemoMode = false,
  onToggleDemoMode = () => {},
  onOpenProfile = () => {},
  onOpenTutorial = () => {},
  isPrivacyMode = false,
  onTogglePrivacy = () => {},
  user
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeMobileModule, setActiveMobileModule] = useState(null);
  const isBn = lang === 'bn';

  const handleScreenSelect = (key) => {
    onSelectScreen(key);
    setMobileMenuOpen(false);
  };

  return (
    <nav className="w-full bg-slate-900 border-b border-slate-800 text-slate-100 sticky top-0 z-40 font-sans shadow-md">
      <div className="w-full px-2 sm:px-3 xl:px-4">
        <div className="flex items-center justify-between h-14 sm:h-16 gap-1 sm:gap-1.5">
          
          {/* Left: Brand & Business Switcher */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Mobile Hamburger Toggle */}
            <button 
              className="lg:hidden p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              title="Menu"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            {/* Logo Badge */}
            <div 
              className="flex items-center gap-1.5 cursor-pointer group" 
              onClick={() => handleScreenSelect('main_dashboard')}
              title="Ledgero ERP"
            >
              <LedgeroLogo size={26} rounded={true} />
              <div className="hidden sm:block">
                <div className="flex items-center gap-1">
                  <span className="font-black text-sm tracking-tight text-white group-hover:text-emerald-300 transition-colors">Ledgero</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-400/30">
                    ERP
                  </span>
                </div>
              </div>
            </div>

            {/* Business Switcher Pill */}
            <button
              onClick={onOpenBizModal}
              className="flex items-center gap-1 bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white border border-slate-700/80 px-2 py-1 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer truncate max-w-[100px] sm:max-w-[130px] xl:max-w-[150px]"
              title={isBn ? 'ব্যবসা পরিবর্তন করুন' : 'Switch Business'}
            >
              <Store size={12} className="text-amber-400 shrink-0" />
              <span className="truncate text-xs">{activeBiz?.name || (isBn ? 'ব্যবসা' : 'Business')}</span>
              <ChevronDown size={11} className="text-slate-400 shrink-0" />
            </button>
          </div>

          {/* Center: Mega Navigation Modules (Desktop) */}
          <div className="hidden lg:flex flex-1 items-center justify-center gap-0.5 xl:gap-1 px-1">
            {navModules.map((module) => (
              <div key={module.key} className="group relative">
                <button className="flex items-center gap-1 px-1.5 xl:px-2 py-1 text-[11px] xl:text-xs font-semibold text-slate-300 hover:text-white rounded-lg hover:bg-slate-800 transition-colors focus:outline-none cursor-pointer">
                  <span className="text-emerald-400 group-hover:text-emerald-300 transition-colors">{module.icon}</span>
                  <span className="whitespace-nowrap">{isBn ? module.bnLabel : module.label}</span>
                </button>

                {/* Dropdown Menu */}
                <div className="absolute top-full left-0 mt-1 w-64 bg-slate-900/98 backdrop-blur-xl border border-slate-700 rounded-xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 transform origin-top scale-95 group-hover:scale-100 z-50 p-1.5 space-y-0.5">
                  {module.items.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => handleScreenSelect(item.key)}
                      className="w-full text-left flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-white rounded-lg transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-slate-400">{item.icon}</span>
                        <span>{isBn ? item.bnLabel : item.label}</span>
                      </div>
                      {item.shortcut && (
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 ml-2 whitespace-nowrap">
                          {item.shortcut}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Right Actions & Utilities */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            
            {/* Language Toggle (বাংলা / English) */}
            <button
              onClick={onToggleLang}
              className="flex items-center gap-1 bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white border border-slate-700/80 px-2 py-1 rounded-xl text-[11px] xl:text-xs font-bold transition-all shadow-xs cursor-pointer shrink-0"
              title={lang === 'bn' ? 'Switch to English' : 'বাংলায় যান'}
            >
              <Globe size={12} className="text-teal-400 shrink-0" />
              <span>{lang === 'bn' ? 'English' : 'বাংলা'}</span>
            </button>

            {/* Mode Switcher Pill (Photo 2 style: Advanced ⚡ Easy) */}
            <button
              onClick={onToggleAppMode}
              className="flex items-center gap-1 bg-gradient-to-r from-purple-900/90 to-indigo-900/90 hover:from-purple-800 hover:to-indigo-800 text-purple-100 hover:text-white border border-purple-500/60 px-2 py-1 rounded-xl text-[11px] xl:text-xs font-bold transition-all shadow-xs cursor-pointer shrink-0"
              title={isBn ? 'ইজি মোডে ফিরে যান' : 'Switch to Easy Mode'}
            >
              <Sparkles size={12} className="text-amber-300 shrink-0" />
              <span className="font-extrabold text-white">Advanced</span>
              <span className="text-[9px] text-purple-300 font-semibold">⚡ Easy</span>
            </button>

            {/* Direct Online Orders Quick Button */}
            <button
              onClick={() => handleScreenSelect('online_orders')}
              className="flex items-center gap-1.5 bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 hover:text-white border border-emerald-500/40 px-2.5 py-1 rounded-xl text-[11px] xl:text-xs font-bold transition-all shadow-xs cursor-pointer shrink-0"
              title={isBn ? 'অনলাইন অর্ডার ও কুরিয়ার ট্র্যাকিং' : 'Online Orders & Courier Tracking'}
            >
              <Truck size={13} className="text-emerald-400 shrink-0" />
              <span>{isBn ? '🚚 অর্ডার' : '🚚 Orders'}</span>
            </button>

            {/* Date Switcher */}
            {dateKey && (
              <div className="hidden xl:flex items-center gap-0.5 bg-slate-800/90 border border-slate-700/80 rounded-xl px-1.5 py-0.5 text-xs">
                <button 
                  onClick={onPrevDay} 
                  className="p-0.5 hover:text-white text-slate-400 cursor-pointer" 
                  title={isBn ? 'পূর্ববর্তী দিন' : 'Previous Day'}
                >
                  <ChevronLeft size={13} />
                </button>
                <button 
                  onClick={onPickDate} 
                  className="font-bold text-amber-300 hover:text-amber-200 px-1 cursor-pointer flex items-center gap-1 text-[11px]"
                >
                  <Calendar size={12} className="text-amber-400" />
                  <span>{dateKey}</span>
                </button>
                <button 
                  onClick={onNextDay} 
                  className="p-0.5 hover:text-white text-slate-400 cursor-pointer" 
                  title={isBn ? 'পরবর্তী দিন' : 'Next Day'}
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            )}

            {/* Quick Action Button (+ New) */}
            <button
              onClick={onOpenQuickAction}
              className="flex items-center justify-center gap-1 h-8 sm:h-8.5 px-2 sm:px-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow-md shadow-emerald-950/40 transition-all font-bold text-xs border border-emerald-400/40 cursor-pointer shrink-0"
              title="Quick Action Palette (Alt+N)"
            >
              <Plus size={14} className="stroke-[3]" />
              <span className="hidden sm:inline">{isBn ? 'নতুন' : 'Create'}</span>
              <span className="hidden 2xl:inline text-[9px] font-mono bg-emerald-700/60 px-1 py-0.2 rounded border border-emerald-500/40 text-emerald-100">
                Alt+N
              </span>
            </button>

            {/* Tutorial Academy Guide */}
            <button
              onClick={onOpenTutorial}
              className="hidden 2xl:flex p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
              title={isBn ? 'টিউটোরিয়াল একাডেমি (F4)' : 'Academy Tutorial (F4)'}
            >
              <GraduationCap size={15} className="text-emerald-400" />
            </button>

            {/* Profile Avatar / Settings */}
            <button
              onClick={onOpenProfile}
              className="w-7.5 h-7.5 sm:w-8 sm:h-8 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700/80 flex items-center justify-center text-xs font-bold text-slate-200 cursor-pointer transition-all overflow-hidden shrink-0"
              title={isBn ? 'সেটিংস ও প্রোফাইল' : 'Settings & Profile'}
            >
              {user?.photoURL ? (
                <img src={user.photoURL} alt="" className="w-full h-full rounded-xl object-cover" referrerPolicy="no-referrer" />
              ) : (
                <span className="text-emerald-400 font-bold">{(user?.displayName || 'U')[0].toUpperCase()}</span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Accordion Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-slate-800 bg-slate-900/98 backdrop-blur-2xl max-h-[calc(100vh-4rem)] overflow-y-auto p-3 space-y-2 animate-fadeIn">
          {/* Business & Date Header */}
          <div className="flex items-center justify-between p-2 rounded-xl bg-slate-800/80 border border-slate-700/60 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-white">
              <Store size={14} className="text-amber-400" />
              <span>{activeBiz?.name}</span>
            </div>
            <div className="font-bold text-amber-300">{dateKey}</div>
          </div>

          {/* Nav Modules Accordion */}
          {navModules.map((module) => (
            <div key={module.key} className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
              <button 
                onClick={() => setActiveMobileModule(activeMobileModule === module.key ? null : module.key)}
                className="w-full flex items-center justify-between p-2.5 text-xs font-bold text-slate-200 hover:text-white hover:bg-slate-800/60 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400">{module.icon}</span>
                  <span>{isBn ? module.bnLabel : module.label}</span>
                </div>
                <ChevronDown 
                  size={14} 
                  className={`text-slate-400 transition-transform ${activeMobileModule === module.key ? 'rotate-180' : ''}`} 
                />
              </button>
              
              {activeMobileModule === module.key && (
                <div className="p-1 space-y-0.5 border-t border-slate-800/80 bg-slate-900/60">
                  {module.items.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => handleScreenSelect(item.key)}
                      className="w-full text-left flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">{item.icon}</span>
                        <span>{isBn ? item.bnLabel : item.label}</span>
                      </div>
                      {item.shortcut && (
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700">
                          {item.shortcut}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Mobile Footer Utilities */}
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setMobileMenuOpen(false); onToggleLang(); }}
                className="flex-1 py-2 rounded-xl text-xs font-bold bg-slate-800 text-slate-200 flex items-center justify-center gap-1.5 border border-slate-700/80"
              >
                <Globe size={14} className="text-teal-400" />
                <span>{lang === 'bn' ? 'English' : 'বাংলা'}</span>
              </button>
              <button
                onClick={() => { setMobileMenuOpen(false); onToggleAppMode(); }}
                className="flex-1 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-900/90 to-indigo-900/90 text-white flex items-center justify-center gap-1.5 border border-purple-500/60"
              >
                <Sparkles size={14} className="text-amber-300" />
                <span>{isBn ? 'ইজি মোড' : 'Easy Mode'}</span>
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => { setMobileMenuOpen(false); onOpenProfile(); }}
                className="flex-1 py-2 rounded-xl text-xs font-bold bg-slate-800 text-slate-200 flex items-center justify-center gap-1.5"
              >
                <Settings size={14} />
                <span>{isBn ? 'সেটিংস' : 'Settings'}</span>
              </button>
              <button
                onClick={() => { setMobileMenuOpen(false); onOpenTutorial(); }}
                className="flex-1 py-2 rounded-xl text-xs font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-800/50 flex items-center justify-center gap-1.5"
              >
                <GraduationCap size={14} />
                <span>{isBn ? 'টিউটোরিয়াল' : 'Tutorial'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
