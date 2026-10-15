import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    try {
      localStorage.setItem('shopbook_app_mode', 'easy');
    } catch {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4 font-sans">
          <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-2xl text-center space-y-4">
            <div className="w-14 h-14 bg-rose-500/20 text-rose-400 rounded-2xl flex items-center justify-center mx-auto text-2xl font-bold">
              ⚠️
            </div>
            <h1 className="text-xl font-bold text-slate-100">
              কিছু একটা সমস্যা হয়েছে
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              অ্যাপ লোড করার সময় একটি প্রযুক্তিগত ত্রুটি হয়েছে। নিচে ক্লিক করে Easy Mode-এ ফিরে যেতে পারেন।
            </p>
            {this.state.error?.message && (
              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-left font-mono text-xs text-rose-300 break-words max-h-32 overflow-y-auto">
                {this.state.error.toString()}
              </div>
            )}
            <div className="pt-2 flex flex-col gap-2">
              <button
                onClick={this.handleReset}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm transition-all shadow-lg shadow-emerald-950/50 cursor-pointer"
              >
                🔄 Easy Mode-এ ফিরে রিলোড করুন
              </button>
              <button
                onClick={() => window.location.reload()}
                className="w-full py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium rounded-xl text-xs transition-colors cursor-pointer"
              >
                শুধুমাত্র রিলোড দিন
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
